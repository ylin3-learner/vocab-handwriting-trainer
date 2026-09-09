import { Word, ReviewState, createInitialReviewState } from '../../types/word';
import { WordRepository } from '../../services/wordRepository/WordRepository';
import { ProgressStore, AttemptRecord } from '../../services/storage/ProgressStore';
import { gradeAnswer, GradingResult } from '../../domain/grading/grader';
import { calculateNextReview, SM2Result } from '../../domain/scheduler/sm2';
import { mergeSM2ResultWithState } from '../../domain/scheduler/reviewStateMapper';
import { calculateOverdueDays } from '../../domain/date/overdue';
import { pickNextWordId, WordEntry } from '../../domain/selection/questionSelector';
import { levenshteinDistance, normalizedSimilarity } from '../../domain/string/similarity';

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
  dailyMaxQuota: number;
  dailyNewQuota: number;
  now?: () => Date;
}

export class QuizOrchestrator {
  private studentId: string;
  private deps: QuizOrchestratorDeps;
  private words: Word[] = [];
  private wordMap = new Map<string, Word>();
  private dailyAnsweredCount = 0;
  private dailyNewQuotaRemaining = 0;
  private stateCache: Map<string, ReviewState> | null = null;

  constructor(studentId: string, deps: QuizOrchestratorDeps) {
    this.studentId = studentId;
    this.deps = deps;
    this.dailyNewQuotaRemaining = deps.dailyNewQuota;
  }

  async init(): Promise<void> {
    this.words = await this.deps.wordRepository.getAll();
    for (const w of this.words) {
      this.wordMap.set(w.id, w);
    }
    // 🔥 預載所有狀態（一次讀取，避免重複查詢）
    this.stateCache = await this.deps.progressStore.getAllStates(this.studentId);
  }

  private getNow(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async nextQuestion(): Promise<QuizQuestion | null> {
    if (this.dailyAnsweredCount >= this.deps.dailyMaxQuota) {
      return null;
    }

    const entries: WordEntry[] = [];
    for (const word of this.words) {
      // 從快取讀取，若無則建立初始狀態
      const state = this.stateCache?.get(word.id) ?? createInitialReviewState();
      const overdueDays = calculateOverdueDays(state.nextReviewDate, this.getNow());
      entries.push({ wordId: word.id, state, overdueDays });
    }

    console.log('🔍 選題前的 entries (前 10 筆):', entries.slice(0, 10).map(e => ({
      wordId: e.wordId,
      reviewCount: e.state.reviewCount,
      overdueDays: e.overdueDays,
      isNew: e.state.reviewCount === 0 && !e.state.lastReviewed,
      priority: (e.state.reviewCount * 80) + ((e.overdueDays ?? 0) * 20) + ((e.state.reviewCount === 0 && !e.state.lastReviewed) ? 50 : 0)
    })));

    const selectedId = pickNextWordId(entries, {
      dailyAnsweredCount: this.dailyAnsweredCount,
      dailyMaxQuota: this.deps.dailyMaxQuota,
      dailyNewQuotaRemaining: this.dailyNewQuotaRemaining,
    });

    if (!selectedId) return null;

    const word = this.wordMap.get(selectedId);
    if (!word) return null;

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

    // ===== 判分 =====
    const grading = gradeAnswer({
      recognizedText: submission.recognizedText,
      correctAnswer: word.word,
      elapsedMs: submission.elapsedMs,
      timeLimitMs: this.deps.timeLimitMs,
      timedOut: submission.timedOut,
    });

    // ===== 計算相似度指標 (Sprint 6-B) =====
    const editDistance = levenshteinDistance(
      submission.recognizedText,
      word.word
    );
    const similarity = normalizedSimilarity(
      submission.recognizedText,
      word.word
    );

    // ===== SM-2 排程 =====
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

    // ===== 儲存進度 (使用 Transaction) =====
    await this.deps.progressStore.saveState(this.studentId, wordId, nextState);

    // 更新快取
    this.stateCache?.set(wordId, nextState);

    // ===== 記錄作答 (包含新的相似度訊號) =====
    const attempt: AttemptRecord = {
      studentId: this.studentId,
      wordId,
      timestamp: now.toISOString(),
      recognizedText: submission.recognizedText,
      isCorrect: grading.isCorrect,
      responseTimeMs: submission.elapsedMs,
      snapshotImageUrl: submission.snapshotImageUrl,

      // Sprint 6-B 新增欄位
      editDistance,
      similarity,
      snapshotEaseFactor: scheduling.nextEaseFactor,
      snapshotInterval: scheduling.nextInterval,
      // vocabVersion: 預留給未來
    };
    await this.deps.progressStore.recordAttempt(attempt);

    // ===== 更新配額 =====
    this.dailyAnsweredCount += 1;
    if (grading.isCorrect) {
      const stateBefore = currentState;
      if (stateBefore.reviewCount === 0 && !stateBefore.lastReviewed) {
        this.dailyNewQuotaRemaining = Math.max(0, this.dailyNewQuotaRemaining - 1);
      }
    }

    return { grading, scheduling, nextState };
  }
}