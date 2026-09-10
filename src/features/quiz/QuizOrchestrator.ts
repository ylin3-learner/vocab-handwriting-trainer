// src/features/quiz/QuizOrchestrator.ts
import { Word, ReviewState, createInitialReviewState } from '../../types/word';
import { WordRepository } from '../../services/wordRepository/WordRepository';
import { ProgressStore, AttemptRecord } from '../../services/storage/ProgressStore';
import { gradeAnswer, GradingResult } from '../../domain/grading/grader';
import { calculateNextReview, SM2Result } from '../../domain/scheduler/sm2';
import { mergeSM2ResultWithState } from '../../domain/scheduler/reviewStateMapper';
import { calculateOverdueDays } from '../../domain/date/overdue';
import { pickNextWordId, WordEntry } from '../../domain/selection/questionSelector';
import { levenshteinDistance, normalizedSimilarity } from '../../domain/string/similarity';
import { AssignmentService, ActiveAssignment } from '../../services/assignment/AssignmentService';
import { ClassStatsService } from '../../services/analytics/ClassStatsService';

export interface QuizQuestion {
  word: Word;
  timeLimitMs: number;
}

export interface AnswerSubmission {
  recognizedText: string;
  elapsedMs: number;
  timedOut: boolean;
  snapshotImageUrl?: string;
}

export interface SubmitAnswerResult {
  grading: GradingResult;
  scheduling: SM2Result;
  nextState: ReviewState;
}

export interface QuizOrchestratorDeps {
  wordRepository: WordRepository;
  progressStore: ProgressStore;
  timeLimitMs: number;
  defaultDailyMaxQuota: number;
  defaultDailyNewQuota: number;
  studentName?: string;
  now?: () => Date;
}

export class QuizOrchestrator {
  private studentId: string;
  private className: string;
  private deps: QuizOrchestratorDeps;
  private words: Word[] = [];
  private wordMap = new Map<string, Word>();
  private dailyAnsweredCount = 0;
  private dailyMaxQuota = 0;
  private dailyNewQuotaRemaining = 0;
  private stateCache: Map<string, ReviewState> | null = null;
  private assignmentService: AssignmentService;
  private activeAssignment: ActiveAssignment | null = null;
  private classStatsService: ClassStatsService;
  private askedToday = new Set<string>();

  constructor(studentId: string, className: string, deps: QuizOrchestratorDeps) {
    this.studentId = studentId;
    this.className = className;
    this.deps = deps;
    this.classStatsService = new ClassStatsService();
    this.assignmentService = new AssignmentService();
  }

  async init(): Promise<void> {
    console.log('═══════════════════════════════════════');
    console.log(`🚀 [QuizOrchestrator.init] 開始初始化`);
    console.log(`   學生：${this.studentId}，班級：${this.className || '（未填）'}`);
    console.log('═══════════════════════════════════════');

    // ===== 步驟 1：讀取作業設定 =====
    console.log('📋 [步驟 1] 讀取作業設定...');
    try {
      this.activeAssignment = await this.assignmentService.getActiveAssignment(this.className);
    } catch (e) {
      console.warn('⚠️ 讀取作業設定失敗，使用預設配額:', e);
      this.activeAssignment = null;
    }

    if (this.activeAssignment) {
      this.dailyMaxQuota = this.activeAssignment.assignment.dailyQuota;
      this.dailyNewQuotaRemaining = this.activeAssignment.newWordCount;
      console.log(`   ✅ 讀取作業「${this.activeAssignment.assignment.name}」`);
      console.log(`      配額：${this.dailyMaxQuota} 題（複習 ${this.activeAssignment.reviewWordCount} + 新詞 ${this.activeAssignment.newWordCount}）`);
    } else {
      this.dailyMaxQuota = this.deps.defaultDailyMaxQuota;
      this.dailyNewQuotaRemaining = this.deps.defaultDailyNewQuota;
      console.warn(`   ⚠️ 無生效作業，使用預設配額：${this.dailyMaxQuota} 題`);
    }

    // ===== 步驟 2：讀取學生進度狀態 =====
    console.log('📋 [步驟 2] 讀取學生進度狀態...');
    this.stateCache = await this.deps.progressStore.getAllStates(this.studentId);
    console.log(`   ✅ 已載入 ${this.stateCache.size} 個單字的進度狀態`);

    // ===== 步驟 3：計算池子大小（倍數化） =====
    const K2 = this.dailyNewQuotaRemaining;
    const K1 = Math.max(0, this.dailyMaxQuota - K2);

    const REVIEW_POOL_MULTIPLIER = 3;
    const NEW_POOL_MULTIPLIER = 3;
    const MIN_REVIEW_POOL = 50;
    const MIN_NEW_POOL = 30;

    const reviewPoolSize = Math.max(K1 * REVIEW_POOL_MULTIPLIER, MIN_REVIEW_POOL);
    const newPoolSize = Math.max(K2 * NEW_POOL_MULTIPLIER, MIN_NEW_POOL);

    console.log(`📊 [步驟 3] 池子大小：複習目標 ${reviewPoolSize}，新詞目標 ${newPoolSize}`);
    console.log(`   （配額：K1=${K1}, K2=${K2}）`);

    // ===== 步驟 4：挑選複習候選（已到期 + 最近學過） =====
    const allStates = Array.from(this.stateCache.entries());

    // 4.1 已到期的複習單字（依 nextReviewDate 由舊到新）
    const dueStates = allStates
      .filter(([_, state]) => state.lastReviewed && state.nextReviewDate)
      .sort((a, b) => {
        const dateA = new Date(a[1].nextReviewDate!).getTime();
        const dateB = new Date(b[1].nextReviewDate!).getTime();
        return dateA - dateB;
      });

    const dueWordIds = dueStates.slice(0, reviewPoolSize).map(([id]) => id);

    // 4.2 若池子不足，補上「最近學過但未到期」的單字
    let supplementIds: string[] = [];
    if (dueWordIds.length < reviewPoolSize) {
      const supplementPool = allStates
        .filter(([id, s]) => s.lastReviewed && !dueWordIds.includes(id))
        .sort((a, b) => {
          return (b[1].lastReviewed ?? '').localeCompare(a[1].lastReviewed ?? '');
        });

      supplementIds = supplementPool
        .slice(0, reviewPoolSize - dueWordIds.length)
        .map(([id]) => id);
    }

    const finalReviewIds = [...dueWordIds, ...supplementIds];
    console.log(`   - 已到期複習：${dueWordIds.length} 個`);
    console.log(`   - 補充最近學過：${supplementIds.length} 個`);
    console.log(`   - 複習池總計：${finalReviewIds.length} 個`);

    // ===== 步驟 5：批次載入複習候選 =====
    let reviewWords: Word[] = [];
    if (finalReviewIds.length > 0) {
      console.log('📋 [步驟 5] 批次載入複習候選...');
      reviewWords = await this.deps.wordRepository.getWordsByIds(finalReviewIds);
      console.log(`   ✅ 載入 ${reviewWords.length} 個複習單字`);

      // 🔥 檢查是否所有 ID 都被載入（防禦：舊格式 wordId 會找不到）
      if (reviewWords.length < finalReviewIds.length) {
        const loadedIds = new Set(reviewWords.map(w => w.id));
        const missingIds = finalReviewIds.filter(id => !loadedIds.has(id));
        console.warn(`   ⚠️ ${missingIds.length} 個複習候選的 wordId 在單字庫中找不到`);
        console.warn(`      遺失的 ID 前 5 個：${missingIds.slice(0, 5).join(', ')}`);
        console.warn(`      → 這些是舊格式資料（Firestore 自動 ID），請清除 students 集合後重新開始`);
      }
    }

    // ===== 步驟 6：載入新詞候選 =====
    console.log('📋 [步驟 6] 載入新詞候選...');
    const excludeIds = new Set(this.stateCache.keys());
    const newWords = await this.deps.wordRepository.getNewWords(excludeIds, newPoolSize);
    console.log(`   ✅ 載入 ${newWords.length} 個新單字`);

    // ===== 步驟 7：合併成最終單字池 =====
    this.words = [...reviewWords, ...newWords];
    for (const w of this.words) {
      this.wordMap.set(w.id, w);
    }

    console.log('═══════════════════════════════════════');
    console.log(`✅ [QuizOrchestrator.init] 完成！`);
    console.log(`   單字池：${reviewWords.length} 複習 + ${newWords.length} 新詞 = ${this.words.length} 個`);
    console.log(`   （配額 ${this.dailyMaxQuota} 題，池子 ${this.words.length} 個，比例 1:${(this.words.length / this.dailyMaxQuota).toFixed(1)}）`);
    console.log('═══════════════════════════════════════');
  }

  getActiveAssignment(): ActiveAssignment | null {
    return this.activeAssignment;
  }

  getDailyProgress(): { answered: number; max: number } {
    return {
      answered: this.dailyAnsweredCount,
      max: this.dailyMaxQuota,
    };
  }

  private getNow(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async nextQuestion(): Promise<QuizQuestion | null> {
    if (this.dailyAnsweredCount >= this.dailyMaxQuota) {
      console.log(`📌 [nextQuestion] 已達配額上限 ${this.dailyMaxQuota} 題，結束`);
      return null;
    }

    // 🔥 優先從「今天還沒出過」的單字中選
    const availableWords = this.words.filter(w => !this.askedToday.has(w.id));
    const usingPool = availableWords.length > 0 ? availableWords : this.words;
    const isReusing = availableWords.length === 0;

    if (isReusing) {
      console.warn(`⚠️ [nextQuestion] 池子已用完（${this.words.length} 個全出過），允許重複`);
    }

    const entries: WordEntry[] = [];
    for (const word of usingPool) {
      const state = this.stateCache?.get(word.id) ?? createInitialReviewState();
      const overdueDays = calculateOverdueDays(state.nextReviewDate, this.getNow());
      entries.push({ wordId: word.id, state, overdueDays });
    }

    const selectedId = pickNextWordId(
      entries,
      {
        dailyAnsweredCount: this.dailyAnsweredCount,
        dailyMaxQuota: this.dailyMaxQuota,
        dailyNewQuotaRemaining: this.dailyNewQuotaRemaining,
      },
      this.activeAssignment?.explorationRate ?? 0.1
    );

    if (!selectedId) {
      console.log(`📌 [nextQuestion] 無候選單字可選`);
      return null;
    }

    const word = this.wordMap.get(selectedId);
    if (!word) return null;

    this.askedToday.add(selectedId);

    console.log(`📌 [nextQuestion] 選中「${word.word}」（進度 ${this.dailyAnsweredCount + 1}/${this.dailyMaxQuota}，池中剩 ${availableWords.length - 1} 個未出）`);

    return {
      word,
      timeLimitMs: this.deps.timeLimitMs,
    };
  }

  async submitAnswer(
    wordId: string,
    submission: AnswerSubmission
  ): Promise<SubmitAnswerResult> {
    const word = this.wordMap.get(wordId);
    if (!word) {
      throw new Error(`Word ${wordId} not found`);
    }

    const currentState = await this.deps.progressStore.getState(
      this.studentId,
      wordId
    );

    const grading = gradeAnswer({
      recognizedText: submission.recognizedText,
      correctAnswer: word.word,
      elapsedMs: submission.elapsedMs,
      timeLimitMs: this.deps.timeLimitMs,
      timedOut: submission.timedOut,
    });

    const editDistance = levenshteinDistance(
      submission.recognizedText,
      word.word
    );
    const similarity = normalizedSimilarity(
      submission.recognizedText,
      word.word
    );

    const now = this.getNow();
    const overdueDays = calculateOverdueDays(currentState.nextReviewDate, now);

    const scheduling = calculateNextReview(
      {
        reviewInterval: currentState.reviewInterval,
        easeFactor: currentState.easeFactor,
        reviewCount: currentState.reviewCount,
        consecutiveCorrect: currentState.consecutiveCorrect,
        totalReviews: currentState.totalReviews,
      },
      grading.quality,
      overdueDays
    );

    const nextState = mergeSM2ResultWithState(currentState, scheduling, now);

    // 🔥 儲存進度：fire-and-forget（不阻塞判分回傳）
    this.deps.progressStore
      .saveState(this.studentId, wordId, nextState)
      .then(() => this.stateCache?.set(wordId, nextState))
      .catch((error) => {
        console.warn('⚠️ 儲存進度失敗（已加入同步佇列）:', error);
        this.stateCache?.set(wordId, nextState);
      });

    // 🔥 記錄作答：fire-and-forget
    const attempt: AttemptRecord = {
      studentId: this.studentId,
      wordId,
      timestamp: now.toISOString(),
      recognizedText: submission.recognizedText,
      isCorrect: grading.isCorrect,
      responseTimeMs: submission.elapsedMs,
      snapshotImageUrl: submission.snapshotImageUrl,
      editDistance,
      similarity,
      snapshotEaseFactor: scheduling.nextEaseFactor,
      snapshotInterval: scheduling.nextInterval,
    };

    this.deps.progressStore
      .recordAttempt(attempt)
      .catch((error) => {
        console.warn('⚠️ 記錄作答失敗（已加入同步佇列）:', error);
      });

    // 🔥 班級統計：fire-and-forget
    this.classStatsService
      .recordAttempt({
        className: this.className,
        studentId: this.studentId,
        studentName: this.deps.studentName,
        wordId,
        isCorrect: grading.isCorrect,
      })
      .catch((error) => {
        console.warn('⚠️ 班級統計更新失敗:', error);
      });

    this.dailyAnsweredCount += 1;
    if (grading.isCorrect) {
      const stateBefore = currentState;
      if (stateBefore.reviewCount === 0 && !stateBefore.lastReviewed) {
        this.dailyNewQuotaRemaining = Math.max(0, this.dailyNewQuotaRemaining - 1);
      }
    }

    console.log(`✍️ [submitAnswer]「${word.word}」→ ${grading.isCorrect ? '✅ 正確' : '❌ 錯誤'}（quality=${grading.quality}），剩餘新詞配額：${this.dailyNewQuotaRemaining}`);

    return { grading, scheduling, nextState };
  }
}