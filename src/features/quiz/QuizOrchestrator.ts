// src/features/quiz/QuizOrchestrator.ts
import { Word, ReviewState, createInitialReviewState } from '../../types/word';
import { WordRepository } from '../../services/wordRepository/WordRepository';
import { ProgressStore, AttemptRecord } from '../../services/storage/ProgressStore';
import { GradingResult } from '../../domain/grading/grader';
import { SM2Result } from '../../domain/scheduler/sm2';
import { calculateOverdueDays } from '../../domain/date/overdue';
import { pickNextWordId, WordEntry } from '../../domain/selection/questionSelector';
import {
  AssignmentService,
  ActiveAssignment,
  DEFAULT_SPEECH_RATE,
  DEFAULT_SPEECH_FLOOR_RATE,
} from '../../services/assignment/AssignmentService';
import { ClassStatsService } from '../../services/analytics/ClassStatsService';
import { StudentStateService } from '../../services/progression/StudentStateService';
import { LevelProgressionService } from '../../services/progression/LevelProgressionService';
import { ProgressionDecision } from '../../types/progression';
import { AttemptBatcher } from '../../services/storage/AttemptBatcher';
import { LocalStorageProgressStore } from '../../services/storage/LocalStorageProgressStore';
import { DailySnapshot } from '../../types/dailySnapshot';
import { QuizSessionApi, SessionDisplayInfo } from './QuizSessionApi';
import { AnswerProcessor } from './AnswerProcessor';

import {
  SessionQuotaPolicy,
  QuotaExceededBehavior,
} from '../../domain/quiz/SessionQuotaPolicy';

// 🔥 新增
import { QuizTimingPolicy } from '../../domain/quiz/QuizTimingPolicy';

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

import { buildDisplayId } from '../../domain/string/displayId';

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

  private customSpeechFloor: number | undefined;

  private attemptBatcher: AttemptBatcher;
  private localStore: LocalStorageProgressStore;
  private answerProcessor: AnswerProcessor;

  private dailyCorrectCount = 0;
  private dailyTotalResponseTime = 0;
  private todaySnapshotDate: string | null = null;

  private quotaPolicy: SessionQuotaPolicy;

  // 🔥 新增：本 session 的作答時限（init 時解析）
  private timingPolicy = new QuizTimingPolicy();
  private resolvedTimeLimitMs: number = QuizTimingPolicy.DEFAULT_TIME_LIMIT_MS;

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

    this.quotaPolicy = new SessionQuotaPolicy({
      dailyMaxQuota: deps.defaultDailyMaxQuota,
      exceededBehavior: 'stop',
    });

    // 🔥 初始時限：用 deps 的預設（init 會依作業設定覆蓋）
    this.resolvedTimeLimitMs = deps.timeLimitMs;
  }

  getCurrentLevel(): number {
    return this.currentLevel;
  }

  private getDisplayId(): string {
    return buildDisplayId(
      this.className,
      this.deps.studentSeatNumber,
      this.deps.studentName,
      this.studentId
    );
  }

  getDisplayInfo(): SessionDisplayInfo {
    const assignmentName =
      this.activeAssignment?.assignment.name ?? '每日練習（預設配額）';
    const isContinueMode = this.quotaPolicy.isInContinueMode(this.dailyAnsweredCount);

    if (isContinueMode) {
      return {
        mode: 'normal',
        title: `${assignmentName} · 課後加強`,
        subtitle: '已達建議題數，可繼續練習',
        progressCurrent: this.dailyAnsweredCount,
        progressTotal: this.dailyMaxQuota,
        progressLabel: '已答',
        showProgress: true,
      };
    }

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
  // 語音設定
  // ============================================================

  getSpeechRate(): number {
    return this.activeAssignment?.assignment.speechRate ?? DEFAULT_SPEECH_RATE;
  }

  getSpeechFloorRate(): number | null {
    if (this.customSpeechFloor !== undefined) {
      return this.customSpeechFloor;
    }
    return this.activeAssignment?.assignment.speechFloorRate ?? DEFAULT_SPEECH_FLOOR_RATE;
  }

  // 🔥 新增：給 QuizScreen 查詢本 session 時限（用於評分前的預判）
  getTimeLimitMs(): number {
    return this.resolvedTimeLimitMs;
  }

  // ============================================================
  // init
  // ============================================================

  async init(): Promise<void> {
    console.log('═══════════════════════════════════════');
    console.log(`🚀 [QuizOrchestrator.init] 開始初始化`);
    console.log(`   學生：${this.studentId}，班級：${this.className || '（未填）'}`);
    console.log(`   displayId：${this.getDisplayId()}`);
    console.log('═══════════════════════════════════════');

    const displayId = this.getDisplayId();

    // 步驟 0：讀取學習狀態
    try {
      await this.studentStateService.initializeIfNeeded(displayId, 1);
      const learningState = await this.studentStateService.getState(displayId);
      this.currentLevel = learningState.currentLevel;
      this.customSpeechFloor = learningState.customSpeechFloor;
      console.log(`   ✅ 當前等級：L${this.currentLevel}`);
      if (this.customSpeechFloor !== undefined) {
        console.log(`   🔊 個人語速下限：${this.customSpeechFloor}`);
      }
    } catch (e) {
      console.warn('⚠️ 讀取學習狀態失敗，使用預設 L1:', e);
      this.currentLevel = 1;
    }

    // 步驟 0.5：檢查今日快照
    const today = this.getNow().toISOString().slice(0, 10);
    try {
      const snapDoc = await getDoc(
        doc(db, 'studentStates', displayId, 'dailySnapshots', today)
      );
      if (snapDoc.exists()) {
        this.todaySnapshotDate = today;
        console.log(`   ✅ 今日快照已存在，跳過建立`);
      }
    } catch (e) {
      console.warn('⚠️ 檢查每日快照失敗（不影響測驗）:', e);
    }

    // 步驟 1：讀取作業設定
    try {
      this.activeAssignment = await this.assignmentService.getActiveAssignment(
        this.className,
        this.getDisplayId()
      );
    } catch (e) {
      console.warn('⚠️ 讀取作業設定失敗，使用預設配額:', e);
      this.activeAssignment = null;
    }

    if (this.activeAssignment) {
      this.dailyMaxQuota = this.activeAssignment.assignment.dailyQuota;
      this.dailyNewQuotaRemaining = this.activeAssignment.newWordCount;
      console.log(
        `   ✅ 讀取作業「${this.activeAssignment.assignment.name}」，配額 ${this.dailyMaxQuota} 題`
      );
    } else {
      this.dailyMaxQuota = this.deps.defaultDailyMaxQuota;
      this.dailyNewQuotaRemaining = this.deps.defaultDailyNewQuota;
      console.warn(`   ⚠️ 無生效作業，使用預設配額：${this.dailyMaxQuota} 題`);
    }

    // 🔥 依作業設定初始化配額政策
    const exceededBehavior: QuotaExceededBehavior =
      this.activeAssignment?.assignment.quotaExceededBehavior ?? 'stop';
    this.quotaPolicy = new SessionQuotaPolicy({
      dailyMaxQuota: this.dailyMaxQuota,
      exceededBehavior,
    });
    console.log(
      `   📋 配額政策：${exceededBehavior === 'continue' ? '允許課後加強' : '達配額即停止'}`
    );

    // 🔥 解析本 session 的作答時限
    this.resolvedTimeLimitMs = this.timingPolicy.resolve({
      assignmentMs: this.activeAssignment?.assignment.timeLimitMs,
    });
    console.log(`   ⏱️ 作答時限：${this.resolvedTimeLimitMs}ms（${this.resolvedTimeLimitMs / 1000} 秒）`);

    // 步驟 2：讀取學生進度狀態
    this.stateCache = await this.deps.progressStore.getAllStates(displayId);
    console.log(`   ✅ 已載入 ${this.stateCache.size} 個單字的進度狀態`);

    // 步驟 3~7：建立單字池
    await this.buildWordPool();

    console.log(`✅ [QuizOrchestrator.init] 完成！單字池：${this.words.length} 個，等級：L${this.currentLevel}`);
  }

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

    const excludeIds = new Set(this.stateCache!.keys());
    const targetLevel = this.activeAssignment?.assignment.targetLevel;

    let newWords: Word[];
    if (targetLevel && targetLevel !== this.currentLevel) {
      newWords = await this.buildWeightedNewWords(excludeIds, targetLevel, newPoolSize);
    } else {
      newWords = await this.buildDefaultNewWords(excludeIds, newPoolSize);
    }

    this.words = [...reviewWords, ...newWords];
    for (const w of this.words) {
      this.wordMap.set(w.id, w);
    }
  }

  private async buildWeightedNewWords(
    excludeIds: Set<string>,
    targetLevel: number,
    totalSize: number
  ): Promise<Word[]> {
    const currentLevel = this.currentLevel;
    const diff = Math.abs(targetLevel - currentLevel);

    let targetRatio: number;
    let currentRatio: number;
    let probeLevel: number;

    if (diff >= 3) {
      targetRatio = 0.3;
      currentRatio = 0.6;
      probeLevel = Math.round((targetLevel + currentLevel) / 2);
      console.warn(
        `⚠️ [加權出題] |target=L${targetLevel} - current=L${currentLevel}| >= 3，啟用護欄`
      );
    } else {
      targetRatio = 0.6;
      currentRatio = 0.3;
      probeLevel = targetLevel < 6 ? targetLevel + 1 : targetLevel;
    }

    const targetCount = Math.floor(totalSize * targetRatio);
    const currentCount = Math.floor(totalSize * currentRatio);
    const probeCount = totalSize - targetCount - currentCount;

    const usedIds = new Set(excludeIds);

    const targetWords = await this.deps.wordRepository.getNewWordsByLevels(usedIds, [targetLevel], targetCount);
    targetWords.forEach(w => usedIds.add(w.id));

    const currentWords = await this.deps.wordRepository.getNewWordsByLevels(usedIds, [currentLevel], currentCount);
    currentWords.forEach(w => usedIds.add(w.id));

    const probeWords = await this.deps.wordRepository.getNewWordsByLevels(usedIds, [probeLevel], probeCount);

    console.log(
      `📊 [加權出題] target=L${targetLevel}, current=L${currentLevel}, probe=L${probeLevel}`
    );

    return [...targetWords, ...currentWords, ...probeWords];
  }

  private async buildDefaultNewWords(
    excludeIds: Set<string>,
    totalSize: number
  ): Promise<Word[]> {
    const probeRatio = 0.1;
    const probeCount = Math.floor(totalSize * probeRatio);
    const mainCount = totalSize - probeCount;

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
    if (mainWords.length + probeWords.length < totalSize && this.currentLevel > 1) {
      const fallbackExclude = new Set([
        ...excludeIds,
        ...mainWords.map((w) => w.id),
        ...probeWords.map((w) => w.id),
      ]);
      const need = totalSize - mainWords.length - probeWords.length;
      fallbackWords = await this.deps.wordRepository.getNewWordsByLevels(
        fallbackExclude,
        [this.currentLevel - 1],
        need
      );
    }

    return [...mainWords, ...probeWords, ...fallbackWords];
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
    if (!this.quotaPolicy.shouldContinue(this.dailyAnsweredCount)) {
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

    // 🔥 使用解析後的時限
    return {
      word,
      timeLimitMs: this.resolvedTimeLimitMs,
      isProbe,
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

    const displayId = this.getDisplayId();
    const studentDisplayId = displayId !== this.studentId ? displayId : undefined;

    const currentState = await this.deps.progressStore.getState(displayId, wordId);
    const now = this.getNow();

    const processed = this.answerProcessor.process({
      word,
      submission,
      currentState,
      // 🔥 使用解析後的時限（讓 grader 用正確的閾值判斷超時）
      timeLimitMs: this.resolvedTimeLimitMs,
      studentId: this.studentId,
      studentDisplayId,
      now,
    });

    this.dailyAnsweredCount += 1;
    this.sessionAttempts += 1;
    this.dailyCorrectCount += processed.grading.isCorrect ? 1 : 0;
    this.dailyTotalResponseTime += submission.elapsedMs;

    if (processed.grading.isCorrect) {
      if (currentState.reviewCount === 0 && !currentState.lastReviewed) {
        this.dailyNewQuotaRemaining = Math.max(0, this.dailyNewQuotaRemaining - 1);
      }
    }

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

    try {
      await this.localStore.saveState(displayId, wordId, processed.nextState);
      await this.localStore.recordAttempt(processed.attempt);
      this.stateCache?.set(wordId, processed.nextState);
    } catch (e) {
      console.warn('⚠️ 本地寫入失敗:', e);
    }

    try {
      await this.attemptBatcher.commit({
        studentId: this.studentId,
        studentDisplayId,
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
        .saveState(displayId, wordId, processed.nextState)
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
        .incrementTotalAttempts(displayId)
        .catch((error) => console.warn('⚠️ 累加總題數失敗:', error));
    }

    console.log(`✍️ [submitAnswer]「${word.word}」→ ${processed.grading.isCorrect ? '✅ 正確' : '❌ 錯誤'}（quality=${processed.grading.quality}）`);

    let progressionDecision: ProgressionDecision | null = null;
    if (this.sessionAttempts > 0 && this.sessionAttempts % 10 === 0) {
      try {
        progressionDecision = await this.levelProgressionService.evaluate(displayId);
        if (progressionDecision && progressionDecision.action !== 'hold') {
          console.log(`🎉 [submitAnswer] 等級調整：${progressionDecision.action} → L${progressionDecision.newLevel}`);
          this.currentLevel = progressionDecision.newLevel;
        }
      } catch (e) {
        console.warn('⚠️ 等級評估失敗（不影響測驗）:', e);
      }
    }

    // 🔥 修正錯字：schedule → scheduling
    return {
      grading: processed.grading,
      scheduling: processed.scheduling,
      nextState: processed.nextState,
      progressionDecision,
    };
  }
}