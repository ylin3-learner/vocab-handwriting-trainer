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
import { DailyStatsTracker } from '../../services/storage/DailyStatsTracker';

import {
  SessionQuotaPolicy,
  QuotaExceededBehavior,
} from '../../domain/quiz/SessionQuotaPolicy';

import { QuizTimingPolicy } from '../../domain/quiz/QuizTimingPolicy';

import {
  HandwritingLockPolicy,
  HandwritingMode,
} from '../../domain/quiz/HandwritingLockPolicy';

import {
  CompetitionModePolicy,
  CompetitionModeConfig,
} from '../../domain/quiz/CompetitionModePolicy';

import { buildDisplayId } from '../../domain/string/displayId';

import { getLocalDateString } from '../../domain/date/timezone';

import { doc, getDoc, getDocs, setDoc, query, where, collection } from 'firebase/firestore';
import { db } from '../../firebase';

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

  // 🔥 新增：IME 辨識的品質訊號
  //
  // forcedMatch：
  //   true  → IME 候選清單中存在目標字，系統主動選中它
  //           （可能是學生寫對，也可能是學生寫錯但 IME 猜成目標字）
  //   false → IME 候選清單中沒有目標字，系統選了候選[0]
  //
  // candidatesSnapshot：
  //   IME 回傳的前 5 個候選字，供訓練時分析辨識信心
  forcedMatch?: boolean;
  candidatesSnapshot?: string[];
  // 新增：原始筆跡軌跡 (三維陣列：筆畫 -> 點 -> [x, y, t, p])
  rawStrokeData?: number[][][]; 
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

  private dailyStatsTracker = new DailyStatsTracker();

  private quotaPolicy: SessionQuotaPolicy;

  private timingPolicy = new QuizTimingPolicy();
  private resolvedTimeLimitMs: number = QuizTimingPolicy.DEFAULT_TIME_LIMIT_MS;

  private handwritingLockPolicy = new HandwritingLockPolicy();
  private resolvedHandwritingMode: HandwritingMode = HandwritingLockPolicy.DEFAULT_MODE;

  // 🔥 比賽模式
  private competitionModePolicy = new CompetitionModePolicy();
  private competitionConfig: CompetitionModeConfig = CompetitionModePolicy.DEFAULT;

  private studentTimeZone: string = 'Asia/Taipei';

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
      subtitle: this.competitionConfig.enabled
        ? `🏁 比賽模式 · 凍結 L${this.competitionConfig.targetLevel}`
        : '',
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

  getTimeLimitMs(): number {
    return this.resolvedTimeLimitMs;
  }

  getHandwritingMode(): HandwritingMode {
    return this.resolvedHandwritingMode;
  }

  /**
   * 🔥 比賽模式查詢（供 UI 顯示用）。
   */
  isCompetitionMode(): boolean {
    return this.competitionConfig.enabled;
  }

  // ============================================================
  // 學生主動繼續練習
  // ============================================================

  canOfferContinue(): boolean {
    return this.quotaPolicy.canOfferContinue(this.dailyAnsweredCount);
  }

  continueSession(): void {
    this.quotaPolicy.optInToContinue();
    console.log('📚 [QuizOrchestrator] 學生選擇繼續練習，session 進入 continue 模式');
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

    try {
      await this.studentStateService.initializeIfNeeded(displayId, 1);
      const learningState = await this.studentStateService.getState(displayId);
      this.currentLevel = learningState.currentLevel;
      this.customSpeechFloor = learningState.customSpeechFloor;
      this.studentTimeZone = learningState.timeZone ?? 'Asia/Taipei';
      console.log(`   ✅ 當前等級：L${this.currentLevel}`);
      if (this.customSpeechFloor !== undefined) {
        console.log(`   🔊 個人語速下限：${this.customSpeechFloor}`);
      }
    } catch (e) {
      console.warn('⚠️ 讀取學習狀態失敗，使用預設 L1:', e);
      this.currentLevel = 1;
    }

    // ============================================================
    // 今日統計：從 Firestore 讀取（權威來源）
    //
    // 為什麼不信任 localStorage：
    //   - 學生可能清瀏覽器資料（老師教的 troubleshooting）
    //   - 學生可能換裝置（平板、手機、家裡電腦）
    //   - 學生可能用無痕模式
    //   這些都會導致 localStorage 歸零，但 Firestore 不會
    // ============================================================
    const today = getLocalDateString(this.getNow(), this.studentTimeZone);
    await this.loadTodayStats(displayId, today);
    console.log(
      `   📊 今日累計：${this.dailyAnsweredCount} 題（答對 ${this.dailyCorrectCount}）`
    );

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

      // 新增：將今日配額寫入 studentStates，供教師後台判斷是否烙跑
      try {
        const today = getLocalDateString(this.getNow(), this.studentTimeZone);
        await setDoc(doc(db, 'studentStates', displayId), {
          currentDailyQuota: this.dailyMaxQuota,
          quotaDate: today,
        }, { merge: true });
      } catch (e) {
        console.warn('⚠️ 寫入 currentDailyQuota 失敗:', e);
      }

    } else {
      this.dailyMaxQuota = this.deps.defaultDailyMaxQuota;
      this.dailyNewQuotaRemaining = this.deps.defaultDailyNewQuota;
      console.warn(`   ⚠️ 無生效作業，使用預設配額：${this.dailyMaxQuota} 題`);
    }

    const exceededBehavior: QuotaExceededBehavior =
      this.activeAssignment?.assignment.quotaExceededBehavior ?? 'stop';
    this.quotaPolicy = new SessionQuotaPolicy({
      dailyMaxQuota: this.dailyMaxQuota,
      exceededBehavior,
    });
    console.log(
      `   📋 配額政策：${exceededBehavior === 'continue' ? '允許課後加強' : '達配額即停止'}`
    );

    this.resolvedTimeLimitMs = this.timingPolicy.resolve({
      assignmentMs: this.activeAssignment?.assignment.timeLimitMs,
    });
    console.log(`   ⏱️ 作答時限：${this.resolvedTimeLimitMs}ms（${this.resolvedTimeLimitMs / 1000} 秒）`);

    this.resolvedHandwritingMode = this.handwritingLockPolicy.resolve({
      assignmentMode: this.activeAssignment?.assignment.handwritingMode,
    });
    console.log(
      `   🖊️ 手寫模式：${this.resolvedHandwritingMode === 'locked' ? '🔒 比賽模擬（動筆即鎖）' : '✏️ 一般練習'
      }`
    );

    // 🔥 比賽模式解析
    this.competitionConfig = this.competitionModePolicy.resolve({
      assignmentMode: this.activeAssignment?.assignment.competitionMode,
      targetLevel: this.activeAssignment?.assignment.targetLevel,
    });
    if (this.competitionConfig.enabled) {
      console.log(
        `   🏁 比賽模式：啟用（凍結等級 L${this.competitionConfig.targetLevel}，DDA 暫停）`
      );
    } else {
      console.log(`   🏁 比賽模式：關閉`);
    }

    this.stateCache = await this.deps.progressStore.getAllStates(displayId);
    console.log(`   ✅ 已載入 ${this.stateCache.size} 個單字的進度狀態`);

    await this.buildWordPool();

    console.log(`✅ [QuizOrchestrator.init] 完成！單字池：${this.words.length} 個，等級：L${this.currentLevel}`);
  }

  /**
   * 🔥 從 Firestore 載入今日統計，並同步回 localStorage。
   *
   * 讀取順序：
   *   1. studentStates/{displayId}/dailyStats/{date}（權威來源，0 讀取成本）
   *   2. attempts 集合查詢（舊資料 fallback，用於第一次遷移）
   *   3. localStorage（最後 fallback）
   *
   * 寫入：不論走哪條路徑，都同步回 localStorage 作為快取。
   */
  private async loadTodayStats(displayId: string, today: string): Promise<void> {
    try {
      // ============================================================
      // 路徑 1：讀 dailyStats 文件（權威來源，最快）
      // ============================================================
      const statsSnap = await getDoc(
        doc(db, 'studentStates', displayId, 'dailyStats', today)
      );

      if (statsSnap.exists()) {
        const d = statsSnap.data();
        this.dailyAnsweredCount = d.answeredCount ?? 0;
        this.dailyCorrectCount = d.correctCount ?? 0;
        this.dailyTotalResponseTime = d.totalResponseTimeMs ?? 0;
        console.log(`   📊 從 Firestore dailyStats 讀取`);
        this.syncToLocalStorage(displayId, today);
        return;
      }

      // ============================================================
      // 路徑 2：查 attempts 集合（舊資料 fallback）
      //
      // 用於：遷移前就存在的學生，還沒有 dailyStats 文件
      // ============================================================
      const todayStart = new Date(`${today}T00:00:00+08:00`);
      const attemptsSnap = await getDocs(
        query(
          collection(db, 'attempts'),
          where('studentDisplayId', '==', displayId),
          where('timestamp', '>=', todayStart.toISOString())
        )
      );

      if (!attemptsSnap.empty) {
        const attempts = attemptsSnap.docs.map(d => d.data());
        this.dailyAnsweredCount = attempts.length;
        this.dailyCorrectCount = attempts.filter(a => a.isCorrect).length;
        this.dailyTotalResponseTime = attempts.reduce(
          (sum, a) => sum + (a.responseTimeMs ?? 0), 0
        );
        console.log(`   📊 從 attempts 集合回填（${attempts.length} 筆）`);

        // 🔥 回填 dailyStats 文件，供下次快速讀取
        try {
          await setDoc(
            doc(db, 'studentStates', displayId, 'dailyStats', today),
            {
              date: today,
              answeredCount: this.dailyAnsweredCount,
              correctCount: this.dailyCorrectCount,
              totalResponseTimeMs: this.dailyTotalResponseTime,
              lastUpdated: this.getNow().toISOString(),
            }
          );
          console.log(`   📝 已回填 dailyStats 文件`);
        } catch (e) {
          console.warn('   ⚠️ 回填 dailyStats 失敗（不影響主流程）:', e);
        }

        this.syncToLocalStorage(displayId, today);
        return;
      }

      // ============================================================
      // 路徑 3：localStorage（最後 fallback）
      // ============================================================
      const localStats = this.dailyStatsTracker.load(displayId, today);
      this.dailyAnsweredCount = localStats.answeredCount;
      this.dailyCorrectCount = localStats.correctCount;
      this.dailyTotalResponseTime = localStats.totalResponseTimeMs;
      console.log(`   📊 從 localStorage 讀取（Firestore 無資料）`);

    } catch (e) {
      console.warn('⚠️ 無法從 Firestore 讀取今日統計，回退到 localStorage:', e);
      const localStats = this.dailyStatsTracker.load(displayId, today);
      this.dailyAnsweredCount = localStats.answeredCount;
      this.dailyCorrectCount = localStats.correctCount;
      this.dailyTotalResponseTime = localStats.totalResponseTimeMs;
    }
  }

  /**
   * 把目前的今日統計同步回 localStorage（作為快取）。
   */
  private syncToLocalStorage(displayId: string, today: string): void {
    try {
      this.dailyStatsTracker.set(displayId, {
        date: today,
        answeredCount: this.dailyAnsweredCount,
        correctCount: this.dailyCorrectCount,
        totalResponseTimeMs: this.dailyTotalResponseTime,
      });
    } catch (e) {
      console.warn('⚠️ 同步 localStorage 失敗（不影響主流程）:', e);
    }
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

    // ============================================================
    // 🔥 比賽模式：100% 從目標等級出題
    //
    // 不混入當前等級或 probe。目標是讓學生在比賽前專注於
    // 考試範圍，而不是被系統推到不該去的等級。
    // ============================================================
    let newWords: Word[];
    if (this.competitionConfig.enabled) {
      newWords = await this.deps.wordRepository.getNewWordsByLevels(
        excludeIds,
        [this.competitionConfig.targetLevel],
        newPoolSize
      );
      console.log(
        `🏁 [比賽模式] 出題等級鎖定 L${this.competitionConfig.targetLevel}，取得 ${newWords.length} 個單字`
      );
    } else {
      const targetLevel = this.activeAssignment?.assignment.targetLevel;
      if (targetLevel && targetLevel !== this.currentLevel) {
        newWords = await this.buildWeightedNewWords(excludeIds, targetLevel, newPoolSize);
      } else {
        newWords = await this.buildDefaultNewWords(excludeIds, newPoolSize);
      }
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
      { dailyNewQuotaRemaining: this.dailyNewQuotaRemaining },
      this.activeAssignment?.explorationRate ?? 0.1
    );

    if (!selectedId) {
      const isContinueMode = this.quotaPolicy.isInContinueMode(this.dailyAnsweredCount);
      if (isContinueMode) {
        console.warn(
          `⚠️ [nextQuestion] 課後加強模式下無候選單字（pool=${entries.length}），結束 session`
        );
      }
      return null;
    }

    const word = this.wordMap.get(selectedId);
    if (!word) return null;

    this.askedToday.add(selectedId);

    const wordLevel = Number(word.level ?? '0');
    const isProbe = wordLevel > this.currentLevel;

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
      timeLimitMs: this.resolvedTimeLimitMs,
      studentId: this.studentId,
      studentDisplayId,
      now,
    });

    // ============================================================
    // 🔥 今日統計：直接遞增記憶體計數（不依賴 localStorage）
    //
    // 為什麼不呼叫 dailyStatsTracker.increment()：
    //   它會從 localStorage 讀取舊值再加 1。但 localStorage 可能
    //   被清空（學生清瀏覽器資料、換裝置），導致計數從 0 開始。
    //   這裡直接操作記憶體計數，權威值在 Firestore 的 dailyStats，
    //   localStorage 只是快取。
    // ============================================================
    const today = getLocalDateString(now, this.studentTimeZone);
    this.dailyAnsweredCount += 1;
    if (processed.grading.isCorrect) {
      this.dailyCorrectCount += 1;
    }
    this.dailyTotalResponseTime += submission.elapsedMs;

    // 同步回 localStorage（作為快取，失敗不影響主流程）
    this.syncToLocalStorage(displayId, today);

    // 🔥 不再寫入 level 欄位。
    //   等級的唯一真實來源是 studentStates/{displayId}.levelHistory。
    //   快照只保留「當天表現」的聚合數據。
    const dailySnapshot: DailySnapshot = {
      date: today,
      totalAttempts: this.dailyAnsweredCount,
      correctCount: this.dailyCorrectCount,
      correctRate: this.dailyAnsweredCount > 0
        ? Math.round((this.dailyCorrectCount / this.dailyAnsweredCount) * 100)
        : 0,
      avgResponseTimeMs: this.dailyAnsweredCount > 0
        ? Math.round(this.dailyTotalResponseTime / this.dailyAnsweredCount)
        : 0,
      capturedAt: now.toISOString(),
    };

    this.sessionAttempts += 1;

    // 新字配額扣除
    if (processed.grading.isCorrect) {
      if (currentState.reviewCount === 0 && !currentState.lastReviewed) {
        this.dailyNewQuotaRemaining = Math.max(0, this.dailyNewQuotaRemaining - 1);
      }
    }

    // ============================================================
    // 本地寫入（快取）
    // ============================================================
    try {
      await this.localStore.saveState(displayId, wordId, processed.nextState);
      await this.localStore.recordAttempt(processed.attempt);
      this.stateCache?.set(wordId, processed.nextState);
    } catch (e) {
      console.warn('⚠️ 本地寫入失敗:', e);
    }

    // ============================================================
    // 雲端原子寫入（6 個寫入合併成 1 個 writeBatch）
    // ============================================================
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

    // ============================================================
    // 等級評估（比賽模式下會跳過）
    // ============================================================
    let progressionDecision: ProgressionDecision | null = null;
    if (this.sessionAttempts > 0 && this.sessionAttempts % 30 === 0) {
      try {
        progressionDecision = await this.levelProgressionService.evaluate(
          displayId,
          this.competitionConfig.enabled
        );
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