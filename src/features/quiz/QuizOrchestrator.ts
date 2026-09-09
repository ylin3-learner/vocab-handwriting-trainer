import { Word, ReviewState } from '../../types/word';
import { WordRepository } from '../../services/wordRepository/WordRepository';
import { ProgressStore, AttemptRecord } from '../../services/storage/ProgressStore';
import { gradeAnswer, GradingResult } from '../../domain/grading/grader';
import { calculateNextReview, SM2Result } from '../../domain/scheduler/sm2';
import { mergeSM2ResultWithState } from '../../domain/scheduler/reviewStateMapper';
import { calculateOverdueDays } from '../../domain/date/overdue';
import { pickNextWordId, WordEntry } from '../../domain/selection/questionSelector';

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
      const state = await this.deps.progressStore.getState(this.studentId, word.id);
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

    const grading = gradeAnswer({
      recognizedText: submission.recognizedText,
      correctAnswer: word.word,
      elapsedMs: submission.elapsedMs,
      timeLimitMs: this.deps.timeLimitMs,
      timedOut: submission.timedOut,
    });

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

    await this.deps.progressStore.saveState(this.studentId, wordId, nextState);

    const attempt: AttemptRecord = {
      studentId: this.studentId,
      wordId,
      timestamp: now.toISOString(),
      recognizedText: submission.recognizedText,
      isCorrect: grading.isCorrect,
      responseTimeMs: submission.elapsedMs,
      snapshotImageUrl: submission.snapshotImageUrl,
    };
    await this.deps.progressStore.recordAttempt(attempt);

    this.dailyAnsweredCount += 1;
    if (grading.isCorrect) {
      // 簡單配額邏輯：答對才扣新字配額（防止亂猜耗盡額度）
      const stateBefore = currentState;
      if (stateBefore.reviewCount === 0 && !stateBefore.lastReviewed) {
        this.dailyNewQuotaRemaining = Math.max(0, this.dailyNewQuotaRemaining - 1);
      }
    }

    return { grading, scheduling, nextState };
  }
}