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
import { getLocalDateString, getStartOfDayUTC } from '../../domain/date/timezone';

import { doc, getDoc, getDocs, setDoc, query, where, collection, arrayUnion, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import type { SessionExitReason } from '../../services/storage/ProgressStore';

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
  forcedMatch?: boolean;
  candidatesSnapshot?: string[];
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

  isCompetitionMode(): boolean {
    return this.competitionConfig.enabled;
  }

  canOfferContinue(): boolean {
    return this.quotaPolicy.canOfferContinue(this.dailyAnsweredCount);
  }

  continueSession(): void {
    this.quotaPolicy.optInToContinue();
    console.log('📚 [QuizOrchestrator] 學生選擇繼續練習，session 進入 continue 模式');
  }

  subscribeToProgress(callback: (answered: number, max: number) => void): () => void {
    const displayId = this.getDisplayId();
    const today = getLocalDateString(this.getNow(), this.studentTimeZone);
    const statsRef = doc(db, 'studentStates', displayId, 'dailySnapshots', today);

    console.log(`📡 [QuizOrchestrator] 開始監聽即時進度 (dailySnapshots)`);

    const unsubscribe = onSnapshot(statsRef, (snap) => {
      if (snap.exists()) {
        const serverCount = snap.data().totalAttempts ?? 0;
        const serverCorrect = snap.data().correctCount ?? 0;

        if (serverCount > this.dailyAnsweredCount) {
          console.log(`🔄 [Realtime Sync] 題數更新：${this.dailyAnsweredCount} -> ${serverCount}`);
          this.dailyAnsweredCount = serverCount;
          this.dailyCorrectCount = serverCorrect;
        }
      }
      callback(this.dailyAnsweredCount, this.dailyMaxQuota);
    }, (error) => {
      console.error('❌ [Realtime Sync] 監聽失敗:', error);
    });

    return unsubscribe;
  }

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
    } catch (e) {
      console.warn('⚠️ 讀取學習狀態失敗，使用預設 L1:', e);
      this.currentLevel = 1;
    }

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

      try {
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

      // 新增：即便沒有作業，也要把「預設配額」寫入資料庫！
      try {
        await setDoc(doc(db, 'studentStates', displayId), {
          currentDailyQuota: this.dailyMaxQuota,
          quotaDate: today,
        }, { merge: true });
      } catch (e) {
        console.warn('⚠️ 寫入預設 currentDailyQuota 失敗:', e);
      }
    }

    const exceededBehavior: QuotaExceededBehavior =
      this.activeAssignment?.assignment.quotaExceededBehavior ?? 'stop';
    this.quotaPolicy = new SessionQuotaPolicy({
      dailyMaxQuota: this.dailyMaxQuota,
      exceededBehavior,
    });

    this.resolvedTimeLimitMs = this.timingPolicy.resolve({
      assignmentMs: this.activeAssignment?.assignment.timeLimitMs,
    });

    this.resolvedHandwritingMode = this.handwritingLockPolicy.resolve({
      assignmentMode: this.activeAssignment?.assignment.handwritingMode,
    });

    this.competitionConfig = this.competitionModePolicy.resolve({
      assignmentMode: this.activeAssignment?.assignment.competitionMode,
      targetLevel: this.activeAssignment?.assignment.targetLevel,
    });

    this.stateCache = await this.deps.progressStore.getAllStates(displayId);
    await this.buildWordPool();

    console.log(`✅ [QuizOrchestrator.init] 完成！單字池：${this.words.length} 個，等級：L${this.currentLevel}`);
  }

  private async loadTodayStats(displayId: string, today: string): Promise<void> {
    try {
      const snapshotRef = doc(db, 'studentStates', displayId, 'dailySnapshots', today);
      const snapshotSnap = await getDoc(snapshotRef);

      if (snapshotSnap.exists()) {
        const d = snapshotSnap.data() as DailySnapshot;
        this.dailyAnsweredCount = d.totalAttempts ?? 0;
        this.dailyCorrectCount = d.correctCount ?? 0;
        this.dailyTotalResponseTime = (d.avgResponseTimeMs ?? 0) * this.dailyAnsweredCount;
        console.log(`   📊 從 Firestore dailySnapshots 讀取 (${this.dailyAnsweredCount} 題)`);
        this.syncToLocalStorage(displayId, today);
        return;
      }

      // 修改：使用精準的 getStartOfDayUTC
      const todayStart = getStartOfDayUTC(this.getNow(), this.studentTimeZone);
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

        try {
          const dailySnapshot: DailySnapshot = {
            date: today,
            totalAttempts: this.dailyAnsweredCount,
            correctCount: this.dailyCorrectCount,
            correctRate: this.dailyAnsweredCount > 0 ? Math.round((this.dailyCorrectCount / this.dailyAnsweredCount) * 100) : 0,
            avgResponseTimeMs: this.dailyAnsweredCount > 0 ? Math.round(this.dailyTotalResponseTime / this.dailyAnsweredCount) : 0,
            capturedAt: this.getNow().toISOString(),
          };
          await setDoc(snapshotRef, dailySnapshot);
          console.log(`   📝 已回填 dailySnapshots 文件`);
        } catch (e) {
          console.warn('   ⚠️ 回填 dailySnapshots 失敗:', e);
        }

        this.syncToLocalStorage(displayId, today);
        return;
      }

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

  private syncToLocalStorage(displayId: string, today: string): void {
    try {
      this.dailyStatsTracker.set(displayId, {
        date: today,
        answeredCount: this.dailyAnsweredCount,
        correctCount: this.dailyCorrectCount,
        totalResponseTimeMs: this.dailyTotalResponseTime,
      });
    } catch (e) {
      console.warn('⚠️ 同步 localStorage 失敗:', e);
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
      .filter(([_, state]) => state.everWrong === true && state.lastReviewed && state.nextReviewDate)
      .sort((a, b) => new Date(a[1].nextReviewDate!).getTime() - new Date(b[1].nextReviewDate!).getTime());
    const dueWordIds = dueStates.slice(0, reviewPoolSize).map(([id]) => id);
    let supplementIds: string[] = [];
    if (dueWordIds.length < reviewPoolSize) {
      const supplementPool = allStates
        .filter(([id, s]) => s.everWrong === true && s.lastReviewed && !dueWordIds.includes(id))
        .sort((a, b) => (b[1].lastReviewed ?? '').localeCompare(a[1].lastReviewed ?? ''));
      supplementIds = supplementPool.slice(0, reviewPoolSize - dueWordIds.length).map(([id]) => id);
    }
    const finalReviewIds = [...dueWordIds, ...supplementIds];
    let reviewWords: Word[] = [];
    if (finalReviewIds.length > 0) {
      reviewWords = await this.deps.wordRepository.getWordsByIds(finalReviewIds);
    }
    const excludeIds = new Set(this.stateCache!.keys());
    let newWords: Word[];
    if (this.competitionConfig.enabled) {
      newWords = await this.deps.wordRepository.getNewWordsByLevels(excludeIds, [this.competitionConfig.targetLevel], newPoolSize);
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

  private async buildWeightedNewWords(excludeIds: Set<string>, targetLevel: number, totalSize: number): Promise<Word[]> {
    const currentLevel = this.currentLevel;
    const diff = Math.abs(targetLevel - currentLevel);
    let targetRatio, currentRatio, probeLevel;
    if (diff >= 3) {
      targetRatio = 0.3; currentRatio = 0.6;
      probeLevel = Math.round((targetLevel + currentLevel) / 2);
    } else {
      targetRatio = 0.6; currentRatio = 0.3;
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
    return [...targetWords, ...currentWords, ...probeWords];
  }

  private async buildDefaultNewWords(excludeIds: Set<string>, totalSize: number): Promise<Word[]> {
    const probeRatio = 0.1;
    const probeCount = Math.floor(totalSize * probeRatio);
    const mainCount = totalSize - probeCount;
    const mainWords = await this.deps.wordRepository.getNewWordsByLevels(excludeIds, [this.currentLevel], mainCount);
    const probeLevel = this.currentLevel < 6 ? this.currentLevel + 1 : this.currentLevel;
    const probeExclude = new Set([...excludeIds, ...mainWords.map((w) => w.id)]);
    const probeWords = await this.deps.wordRepository.getNewWordsByLevels(probeExclude, [probeLevel], probeCount);
    let fallbackWords: Word[] = [];
    if (mainWords.length + probeWords.length < totalSize && this.currentLevel > 1) {
      const fallbackExclude = new Set([...excludeIds, ...mainWords.map((w) => w.id), ...probeWords.map((w) => w.id)]);
      const need = totalSize - mainWords.length - probeWords.length;
      fallbackWords = await this.deps.wordRepository.getNewWordsByLevels(fallbackExclude, [this.currentLevel - 1], need);
    }
    return [...mainWords, ...probeWords, ...fallbackWords];
  }

  getActiveAssignment(): ActiveAssignment | null {
    return this.activeAssignment;
  }

  getDailyProgress(): { answered: number; max: number } {
    return { answered: this.dailyAnsweredCount, max: this.dailyMaxQuota };
  }

  private getNow(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async nextQuestion(): Promise<QuizQuestion | null> {
    if (!this.quotaPolicy.shouldContinue(this.dailyAnsweredCount)) {
      return null;
    }

    // 🔥 1. 先從當前題池過濾出今天沒寫過的
    let usingPool = this.words.filter((w) => !this.askedToday.has(w.id));

    // 🔥 2. 如果題池空了，啟動動態補題 (Dynamic Fetch)
    if (usingPool.length === 0) {
      console.log('⚠️ [Pool Exhausted] 靜態題池已耗盡，啟動動態補題...');
      const fallbackIds = Array.from(this.stateCache?.entries() ?? [])
        .filter(([id, state]) => state.everWrong === true && !this.askedToday.has(id))
        .map(([id]) => id);

      if (fallbackIds.length > 0) {
        console.log(`🔄 [Dynamic Fetch] 找到 ${fallbackIds.length} 個尚未複習的錯題`);
        const fallbackWords = await this.deps.wordRepository.getWordsByIds(fallbackIds);
        usingPool = fallbackWords;

        // 將補題的字加進 wordMap 備用
        for (const w of fallbackWords) {
          this.wordMap.set(w.id, w);
        }
      } else {
        // 如果連 stateCache 的錯題都被榨乾了，直接結束 Session
        console.log('🏁 [Pool Exhausted] 所有錯題今日都已複習完畢，結束 Session');
        return null;
      }
    }

    const entries: WordEntry[] = [];
    for (const word of usingPool) {
      const state = this.stateCache?.get(word.id) ?? createInitialReviewState();
      const overdueDays = calculateOverdueDays(state.nextReviewDate, this.getNow());
      entries.push({ wordId: word.id, state, overdueDays });
    }

    // 🔥 3. 過濾掉今天已經在日內軌道達標的字 (防日內無限迴圈)
    const today = getLocalDateString(this.getNow(), this.studentTimeZone);
    const filteredEntries = entries.filter((e) => {
      // 如果今天已經連續答對 2 次，今天就放過他，不要再抽出來
      if (e.state.lastStreakDate === today && (e.state.dailyStreak ?? 0) >= 2) {
        return false;
      }
      return true;
    });

    // 如果過濾後沒有字了，就從 entries 隨便抽一個（或者回傳 null 結束）
    const finalEntries = filteredEntries.length > 0 ? filteredEntries : entries;

    const selectedId = pickNextWordId(
      finalEntries,
      { dailyNewQuotaRemaining: this.dailyNewQuotaRemaining },
      this.activeAssignment?.explorationRate ?? 0.1
    );

    if (!selectedId) return null;

    const word = this.wordMap.get(selectedId);
    if (!word) return null;

    this.askedToday.add(selectedId);

    return {
      word,
      timeLimitMs: this.resolvedTimeLimitMs,
      isProbe: Number(word.level ?? '0') > this.currentLevel,
    };
  }

  async endContinueSession(reason: SessionExitReason): Promise<void> {
    console.log(`📚 [QuizOrchestrator] 學生主動結束課後練習，理由：${reason}`);
    try {
      const displayId = this.getDisplayId();
      const now = this.getNow();
      const today = getLocalDateString(now, this.studentTimeZone);
      const logEntry = {
        date: today,
        timestamp: now.toISOString(),
        reason,
        answeredCount: this.dailyAnsweredCount,
        sessionAttempts: this.sessionAttempts,
      };
      await setDoc(doc(db, 'studentStates', displayId), {
        sessionExitLogs: arrayUnion(logEntry)
      }, { merge: true });
      console.log('✅ 退出理由已記錄');
    } catch (e) {
      console.warn('⚠️ 記錄退出理由失敗:', e);
    }
  }

  async submitAnswer(wordId: string, submission: AnswerSubmission): Promise<SubmitAnswerResult> {
    const word = this.wordMap.get(wordId);
    if (!word) throw new Error(`Word ${wordId} not found`);

    const displayId = this.getDisplayId();
    const studentDisplayId = displayId !== this.studentId ? displayId : undefined;
    const currentState = await this.deps.progressStore.getState(displayId, wordId);
    const now = this.getNow();

    const processed = this.answerProcessor.process({
      word, submission, currentState, timeLimitMs: this.resolvedTimeLimitMs,
      studentId: this.studentId, studentDisplayId, now,
      studentTimeZone: this.studentTimeZone, // 🔥 傳入時區
    });

    const today = getLocalDateString(now, this.studentTimeZone);

    // 樂觀更新本地狀態
    this.dailyAnsweredCount += 1;
    if (processed.grading.isCorrect) {
      this.dailyCorrectCount += 1;
    }
    this.dailyTotalResponseTime += submission.elapsedMs;

    this.syncToLocalStorage(displayId, today);

    const dailySnapshot: DailySnapshot = {
      date: today,
      totalAttempts: this.dailyAnsweredCount,
      correctCount: this.dailyCorrectCount,
      correctRate: this.dailyAnsweredCount > 0 ? Math.round((this.dailyCorrectCount / this.dailyAnsweredCount) * 100) : 0,
      avgResponseTimeMs: this.dailyAnsweredCount > 0 ? Math.round(this.dailyTotalResponseTime / this.dailyAnsweredCount) : 0,
      capturedAt: now.toISOString(),
    };

    this.sessionAttempts += 1;

    if (processed.grading.isCorrect) {
      if (currentState.reviewCount === 0 && !currentState.lastReviewed) {
        this.dailyNewQuotaRemaining = Math.max(0, this.dailyNewQuotaRemaining - 1);
      }
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
      this.deps.progressStore.saveState(displayId, wordId, processed.nextState).then(() => this.stateCache?.set(wordId, processed.nextState)).catch((error) => console.warn('⚠️ 儲存進度失敗:', error));
      this.deps.progressStore.recordAttempt(processed.attempt).catch((error) => console.warn('⚠️ 記錄作答失敗:', error));
      this.classStatsService.recordAttempt({ className: this.className, studentId: this.studentId, studentName: this.deps.studentName, studentSeatNumber: this.deps.studentSeatNumber, wordId, isCorrect: processed.grading.isCorrect }).catch((error) => console.warn('⚠️ 班級統計更新失敗:', error));
      this.studentStateService.incrementTotalAttempts(displayId).catch((error) => console.warn('⚠️ 累加總題數失敗:', error));
    }

    let progressionDecision: ProgressionDecision | null = null;
    if (this.sessionAttempts > 0 && this.sessionAttempts % 30 === 0) {
      try {
        progressionDecision = await this.levelProgressionService.evaluate(displayId, this.competitionConfig.enabled);
        if (progressionDecision && progressionDecision.action !== 'hold') {
          this.currentLevel = progressionDecision.newLevel;
        }
      } catch (e) {
        console.warn('⚠️ 等級評估失敗:', e);
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