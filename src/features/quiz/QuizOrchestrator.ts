// src/features/quiz/QuizOrchestrator.ts
import { Word, ReviewState, createInitialReviewState } from '../../types/word';
import { WordRepository } from '../../services/wordRepository/WordRepository';
import { ProgressStore, AttemptRecord } from '../../services/storage/ProgressStore';
import { GradingResult } from '../../domain/grading/grader';
import { SM2Result } from '../../domain/scheduler/sm2';
import { calculateOverdueDays } from '../../domain/date/overdue';
import { pickNextWordId, WordEntry } from '../../domain/selection/questionSelector';
import { AssignmentService, ActiveAssignment } from '../../services/assignment/AssignmentService';
import { ClassStatsService } from '../../services/analytics/ClassStatsService';
import { StudentStateService } from '../../services/progression/StudentStateService';
import { LevelProgressionService } from '../../services/progression/LevelProgressionService';
import { ProgressionDecision } from '../../types/progression';
import { AttemptBatcher } from '../../services/storage/AttemptBatcher';
import { LocalStorageProgressStore } from '../../services/storage/LocalStorageProgressStore';
import { DailySnapshot } from '../../types/dailySnapshot';
import { QuizSessionApi, SessionDisplayInfo } from './QuizSessionApi';
import { AnswerProcessor } from './AnswerProcessor';

export interface QuizQuestion {
  word: Word;
  timeLimitMs: number;
  isProbe?: boolean;
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
  progressionDecision?: ProgressionDecision | null;
}

export interface QuizOrchestratorDeps {
  wordRepository: WordRepository;
  progressStore: ProgressStore;
  timeLimitMs: number;
  defaultDailyMaxQuota: number;
  defaultDailyNewQuota: number;
  studentName?: string;
  studentSeatNumber?: string;
  now?: () => Date;
}

export class QuizOrchestrator implements QuizSessionApi {
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

  private studentStateService: StudentStateService;
  private levelProgressionService: LevelProgressionService;
  private currentLevel: number = 1;
  private sessionAttempts: number = 0;

  private attemptBatcher: AttemptBatcher;
  private localStore: LocalStorageProgressStore;
  private answerProcessor: AnswerProcessor;

  private dailyCorrectCount = 0;
  private dailyTotalResponseTime = 0;
  private todaySnapshotDate: string | null = null;

  constructor(studentId: string, className: string, deps: QuizOrchestratorDeps) {
    this.studentId = studentId;
    this.className = className;
    this.deps = deps;
    this.classStatsService = new ClassStatsService();
    this.assignmentService = new AssignmentService();
    this.studentStateService = new StudentStateService();
    this.levelProgressionService = new LevelProgressionService();
    this.attemptBatcher = new AttemptBatcher();
    this.localStore = new LocalStorageProgressStore();
    this.answerProcessor = new AnswerProcessor();
  }

  getCurrentLevel(): number {
    return this.currentLevel;
  }

  // ============================================================
  // 🔥 QuizSessionApi 實作
  // ============================================================

  getDisplayInfo(): SessionDisplayInfo {
    const assignmentName = this.activeAssignment?.assignment.name ?? '每日練習（預設配額）';
    return {
      mode: 'normal',
      title: assignmentName,
      subtitle: '',
      progressCurrent: this.dailyAnsweredCount,
      progressTotal: this.dailyMaxQuota,
      progressLabel: '進度',
      showProgress: this.dailyMaxQuota > 0,
    };
  }

  // ============================================================
  // init（邏輯與原本相同，僅抽出 init 步驟）
  // ============================================================

  async init(): Promise<void> {
    console.log('═══════════════════════════════════════');
    console.log(`🚀 [QuizOrchestrator.init] 開始初始化`);
    console.log(`   學生：${this.studentId}，班級：${this.className || '（未填）'}`);
    console.log('═══════════════════════════════════════');

    // 步驟 0：讀取學習狀態
    try {
      await this.studentStateService.initializeIfNeeded(this.studentId, 1);
      const learningState = await this.studentStateService.getState(this.studentId);
      this.currentLevel = learningState.currentLevel;
      console.log(`   ✅ 當前等級：L${this.currentLevel}`);
    } catch (e) {
      console.warn('⚠️ 讀取學習狀態失敗，使用預設 L1:', e);
      this.currentLevel = 1;
    }

    // 步驟 0.5：檢查今日快照
    const today = this.getNow().toISOString().slice(0, 10);
    try {
      const { getDoc, doc } = await import('firebase/firestore');
      const { db } = await import('../../firebase');
      const snapDoc = await getDoc(doc(db, 'students', this.studentId, 'dailySnapshots', today));
      if (snapDoc.exists()) {
        this.todaySnapshotDate = today;
        console.log(`   ✅ 今日快照已存在，跳過建立`);
      }
    } catch (e) {
      console.warn('⚠️ 檢查每日快照失敗（不影響測驗）:', e);
    }

    // 步驟 1：讀取作業設定
    try {
      this.activeAssignment = await this.assignmentService.getActiveAssignment(this.className);
    } catch (e) {
      console.warn('⚠️ 讀取作業設定失敗，使用預設配額:', e);
      this.activeAssignment = null;
    }

    if (this.activeAssignment) {
      this.dailyMaxQuota = this.activeAssignment.assignment.dailyQuota;
      this.dailyNewQuotaRemaining = this.activeAssignment.newWordCount;
      console.log(`   ✅ 讀取作業「${this.activeAssignment.assignment.name}」，配額 ${this.dailyMaxQuota} 題`);
    } else {
      this.dailyMaxQuota = this.deps.defaultDailyMaxQuota;
      this.dailyNewQuotaRemaining = this.deps.defaultDailyNewQuota;
      console.warn(`   ⚠️ 無生效作業，使用預設配額：${this.dailyMaxQuota} 題`);
    }

    // 步驟 2：讀取學生進度狀態
    this.stateCache = await this.deps.progressStore.getAllStates(this.studentId);
    console.log(`   ✅ 已載入 ${this.stateCache.size} 個單字的進度狀態`);

    // 步驟 3~7：建立單字池
    await this.buildWordPool();

    console.log(`✅ [QuizOrchestrator.init] 完成！單字池：${this.words.length} 個，等級：L${this.currentLevel}`);
  }

  // ============================================================
  // 內部：建立單字池（從 init 抽出）
  // ============================================================
  private async buildWordPool(): Promise<void> {
    const K2 = this.dailyNewQuotaRemaining;
    const K1 = Math.max(0, this.dailyMaxQuota - K2);

    const REVIEW_POOL_MULTIPLIER = 3;
    const NEW_POOL_MULTIPLIER = 3;
    const MIN_REVIEW_POOL = 50;
    const MIN_NEW_POOL = 30;

    const reviewPoolSize = Math.max(K1 * REVIEW_POOL_MULTIPLIER, MIN_REVIEW_POOL);
    const newPoolSize = Math.max(K2 * NEW_POOL_MULTIPLIER, MIN_NEW_POOL);

    const allStates = Array.from(this.stateCache!.entries());

    // 複習候選：只挑 everWrong 的字
    const dueStates = allStates
      .filter(([_, state]) =>
        state.everWrong === true &&
        state.lastReviewed &&
        state.nextReviewDate
      )
      .sort((a, b) => {
        const dateA = new Date(a[1].nextReviewDate!).getTime();
        const dateB = new Date(b[1].nextReviewDate!).getTime();
        return dateA - dateB;
      });

    const dueWordIds = dueStates.slice(0, reviewPoolSize).map(([id]) => id);

    let supplementIds: string[] = [];
    if (dueWordIds.length < reviewPoolSize) {
      const supplementPool = allStates
        .filter(([id, s]) =>
          s.everWrong === true &&
          s.lastReviewed &&
          !dueWordIds.includes(id)
        )
        .sort((a, b) => (b[1].lastReviewed ?? '').localeCompare(a[1].lastReviewed ?? ''));

      supplementIds = supplementPool
        .slice(0, reviewPoolSize - dueWordIds.length)
        .map(([id]) => id);
    }

    const finalReviewIds = [...dueWordIds, ...supplementIds];
    let reviewWords: Word[] = [];
    if (finalReviewIds.length > 0) {
      reviewWords = await this.deps.wordRepository.getWordsByIds(finalReviewIds);
    }

    // 新詞候選
    const excludeIds = new Set(this.stateCache!.keys());
    const probeRatio = 0.1;
    const probeCount = Math.floor(newPoolSize * probeRatio);
    const mainCount = newPoolSize - probeCount;

    const mainWords = await this.deps.wordRepository.getNewWordsByLevels(
      excludeIds,
      [this.currentLevel],
      mainCount
    );

    const probeLevel = this.currentLevel < 6 ? this.currentLevel + 1 : this.currentLevel;
    const probeExclude = new Set([...excludeIds, ...mainWords.map((w) => w.id)]);
    const probeWords = await this.deps.wordRepository.getNewWordsByLevels(
      probeExclude,
      [probeLevel],
      probeCount
    );

    let fallbackWords: Word[] = [];
    if (mainWords.length + probeWords.length < newPoolSize && this.currentLevel > 1) {
      const fallbackExclude = new Set([
        ...excludeIds,
        ...mainWords.map((w) => w.id),
        ...probeWords.map((w) => w.id),
      ]);
      const need = newPoolSize - mainWords.length - probeWords.length;
      fallbackWords = await this.deps.wordRepository.getNewWordsByLevels(
        fallbackExclude,
        [this.currentLevel - 1],
        need
      );
    }

    const newWords = [...mainWords, ...probeWords, ...fallbackWords];
    this.words = [...reviewWords, ...newWords];
    for (const w of this.words) {
      this.wordMap.set(w.id, w);
    }
  }

  // ============================================================
  // getters
  // ============================================================
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

  // ============================================================
  // nextQuestion
  // ============================================================
  async nextQuestion(): Promise<QuizQuestion | null> {
    if (this.dailyAnsweredCount >= this.dailyMaxQuota) {
      return null;
    }

    const availableWords = this.words.filter((w) => !this.askedToday.has(w.id));
    const usingPool = availableWords.length > 0 ? availableWords : this.words;

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

    if (!selectedId) return null;

    const word = this.wordMap.get(selectedId);
    if (!word) return null;

    this.askedToday.add(selectedId);

    const wordLevel = Number(word.level ?? '0');
    const isProbe = wordLevel > this.currentLevel;

    return {
      word,
      timeLimitMs: this.deps.timeLimitMs,
      isProbe,
    };
  }

  // ============================================================
  // submitAnswer
  // ============================================================
  async submitAnswer(
    wordId: string,
    submission: AnswerSubmission
  ): Promise<SubmitAnswerResult> {
    const word = this.wordMap.get(wordId);
    if (!word) {
      throw new Error(`Word ${wordId} not found`);
    }

    const currentState = await this.deps.progressStore.getState(this.studentId, wordId);

    const studentDisplayId =
      this.className && this.deps.studentName && this.deps.studentSeatNumber
        ? `${this.className}_${this.deps.studentSeatNumber}_${this.deps.studentName}`
        : undefined;

    const now = this.getNow();

    // 🔥 使用 AnswerProcessor 純運算
    const processed = this.answerProcessor.process({
      word,
      submission,
      currentState,
      timeLimitMs: this.deps.timeLimitMs,
      studentId: this.studentId,
      studentDisplayId,
      now,
    });

    // ============================================================
    // 更新本地計數
    // ============================================================
    this.dailyAnsweredCount += 1;
    this.sessionAttempts += 1;
    this.dailyCorrectCount += processed.grading.isCorrect ? 1 : 0;
    this.dailyTotalResponseTime += submission.elapsedMs;

    if (processed.grading.isCorrect) {
      if (currentState.reviewCount === 0 && !currentState.lastReviewed) {
        this.dailyNewQuotaRemaining = Math.max(0, this.dailyNewQuotaRemaining - 1);
      }
    }

    // ============================================================
    // 每日快照（若為今天第一次答題）
    // ============================================================
    const today = now.toISOString().slice(0, 10);
    let dailySnapshot: DailySnapshot | undefined;

    if (this.todaySnapshotDate !== today) {
      dailySnapshot = {
        date: today,
        totalAttempts: this.dailyAnsweredCount,
        correctCount: this.dailyCorrectCount,
        correctRate: this.dailyAnsweredCount > 0
          ? Math.round((this.dailyCorrectCount / this.dailyAnsweredCount) * 100)
          : 0,
        avgResponseTimeMs: this.dailyAnsweredCount > 0
          ? Math.round(this.dailyTotalResponseTime / this.dailyAnsweredCount)
          : 0,
        level: this.currentLevel,
        capturedAt: now.toISOString(),
      };
      this.todaySnapshotDate = today;
    }

    // ============================================================
    // 寫入：先本地 → 嘗試批次 → 失敗回退
    // ============================================================
    try {
      await this.localStore.saveState(this.studentId, wordId, processed.nextState);
      await this.localStore.recordAttempt(processed.attempt);
      this.stateCache?.set(wordId, processed.nextState);
    } catch (e) {
      console.warn('⚠️ 本地寫入失敗:', e);
    }

    try {
      await this.attemptBatcher.commit({
        studentId: this.studentId,
        className: this.className,
        wordId,
        nextState: processed.nextState,
        attempt: processed.attempt,
        isCorrect: processed.grading.isCorrect,
        studentName: this.deps.studentName,
        studentSeatNumber: this.deps.studentSeatNumber,
        dailySnapshot,
      });
    } catch (batchError) {
      console.warn('⚠️ 批次寫入失敗，回退到個別寫入:', batchError);

      this.deps.progressStore
        .saveState(this.studentId, wordId, processed.nextState)
        .then(() => this.stateCache?.set(wordId, processed.nextState))
        .catch((error) => {
          console.warn('⚠️ 儲存進度失敗:', error);
          this.stateCache?.set(wordId, processed.nextState);
        });

      this.deps.progressStore
        .recordAttempt(processed.attempt)
        .catch((error) => console.warn('⚠️ 記錄作答失敗:', error));

      this.classStatsService
        .recordAttempt({
          className: this.className,
          studentId: this.studentId,
          studentName: this.deps.studentName,
          studentSeatNumber: this.deps.studentSeatNumber,
          wordId,
          isCorrect: processed.grading.isCorrect,
        })
        .catch((error) => console.warn('⚠️ 班級統計更新失敗:', error));

      this.studentStateService
        .incrementTotalAttempts(this.studentId)
        .catch((error) => console.warn('⚠️ 累加總題數失敗:', error));
    }

    console.log(`✍️ [submitAnswer]「${word.word}」→ ${processed.grading.isCorrect ? '✅ 正確' : '❌ 錯誤'}（quality=${processed.grading.quality}）`);

    // ============================================================
    // 每 10 題評估等級
    // ============================================================
    let progressionDecision: ProgressionDecision | null = null;
    if (this.sessionAttempts > 0 && this.sessionAttempts % 10 === 0) {
      try {
        progressionDecision = await this.levelProgressionService.evaluate(this.studentId);
        if (progressionDecision && progressionDecision.action !== 'hold') {
          console.log(`🎉 [submitAnswer] 等級調整：${progressionDecision.action} → L${progressionDecision.newLevel}`);
          this.currentLevel = progressionDecision.newLevel;
        }
      } catch (e) {
        console.warn('⚠️ 等級評估失敗（不影響測驗）:', e);
      }
    }

    return {
      grading: processed.grading,
      scheduling: processed.scheduling,
      nextState: processed.nextState,
      progressionDecision,
    };
  }
}