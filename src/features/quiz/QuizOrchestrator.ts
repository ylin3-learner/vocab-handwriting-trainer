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
      const state = this.stateCache?.get(word.id) ?? createInitialReviewState();
      const overdueDays = calculateOverdueDays(state.nextReviewDate, this.getNow());
      entries.push({ wordId: word.id, state, overdueDays });
    }

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

    // ===== 計算相似度指標 =====
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

    // ===== 儲存進度（失敗不拋出錯誤，只記錄日誌） =====
    try {
      await this.deps.progressStore.saveState(this.studentId, wordId, nextState);
      // 更新快取
      this.stateCache?.set(wordId, nextState);
    } catch (error) {
      console.warn('⚠️ 儲存進度失敗（已加入同步佇列）:', error);
      // 即使儲存失敗，快取還是要更新，讓下一題能讀到最新狀態
      this.stateCache?.set(wordId, nextState);
    }

    // ===== 記錄作答（失敗不拋出錯誤，只記錄日誌） =====
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

    try {
      await this.deps.progressStore.recordAttempt(attempt);
    } catch (error) {
      console.warn('⚠️ 記錄作答失敗（已加入同步佇列）:', error);
    }

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