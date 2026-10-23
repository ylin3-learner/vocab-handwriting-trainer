// src/features/quiz/AnswerProcessor.ts
import { Word, ReviewState } from '../../types/word';
import { AttemptRecord } from '../../services/storage/ProgressStore';
import { gradeAnswer, GradingResult } from '../../domain/grading/grader';
import { calculateNextReview, SM2Result } from '../../domain/scheduler/sm2';
import { mergeSM2ResultWithState } from '../../domain/scheduler/reviewStateMapper';
import { calculateOverdueDays } from '../../domain/date/overdue';
import { levenshteinDistance, normalizedSimilarity } from '../../domain/string/similarity';
import { AnswerSubmission } from './QuizOrchestrator';
import { getLocalDateString } from '../../domain/date/timezone'; // 🔥 引入時區工具

/**
 * 跨天連續答對幾次後，將 everWrong 清除（移出複習池）。
 */
const EVER_WRONG_CLEAR_THRESHOLD = 5;

export interface ProcessAnswerParams {
  word: Word;
  submission: AnswerSubmission;
  currentState: ReviewState;
  timeLimitMs: number;
  studentId: string;
  studentDisplayId?: string;
  now: Date;
  studentTimeZone: string; // 🔥 新增：用於計算日期
}

export interface ProcessedAnswer {
  grading: GradingResult;
  scheduling: SM2Result;
  nextState: ReviewState;
  attempt: AttemptRecord;
  editDistance: number;
  similarity: number;
}

export class AnswerProcessor {
  process(params: ProcessAnswerParams): ProcessedAnswer {
    const {
      word,
      submission,
      currentState,
      timeLimitMs,
      studentId,
      studentDisplayId,
      now,
      studentTimeZone,
    } = params;

    // ============================================================
    // 1. 評分
    // ============================================================
    const grading = gradeAnswer({
      recognizedText: submission.recognizedText,
      correctAnswer: word.word,
      elapsedMs: submission.elapsedMs,
      timeLimitMs,
      timedOut: submission.timedOut,
    });

    // ============================================================
    // 2. 計算編輯距離與相似度
    // ============================================================
    const editDistance = levenshteinDistance(submission.recognizedText, word.word);
    const similarity = normalizedSimilarity(submission.recognizedText, word.word);

    // ============================================================
    // 3. SM-2 排程計算
    // ============================================================
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

    const mergedState = mergeSM2ResultWithState(currentState, scheduling, now);

    // ============================================================
    // 4. 雙軌解耦計數器 (Dual-Track Scheduler)
    // ============================================================
    const today = getLocalDateString(now, studentTimeZone);

    const prevEverWrong = currentState.everWrong === true;
    const prevCorrectStreak = currentState.correctStreak ?? 0;
    const prevDailyStreak = currentState.dailyStreak ?? 0;
    const prevLastStreakDate = currentState.lastStreakDate ?? '';

    let nextCorrectStreak = prevCorrectStreak;
    let nextDailyStreak = prevDailyStreak;

    if (grading.isCorrect) {
      if (prevLastStreakDate === today) {
        // 同一天內答對：只增加日內連對次數，不增加跨天次數
        nextDailyStreak += 1;
      } else {
        // 跨天答對：日內次數重置為 1，跨天次數 +1
        nextDailyStreak = 1;
        nextCorrectStreak += 1;
      }
    } else {
      // 答錯：日內與跨天計數全部歸零
      nextDailyStreak = 0;
      nextCorrectStreak = 0;
    }

    const shouldClearEverWrong = prevEverWrong && nextCorrectStreak >= EVER_WRONG_CLEAR_THRESHOLD;

    const nextEverWrong = !grading.isCorrect
      ? true
      : (shouldClearEverWrong ? false : prevEverWrong);

    const nextState: ReviewState = {
      ...mergedState,
      everWrong: nextEverWrong,
      correctStreak: shouldClearEverWrong ? 0 : nextCorrectStreak,
      dailyStreak: nextDailyStreak,
      lastStreakDate: today,
    };

    if (shouldClearEverWrong) {
      console.log(`🎓 [AnswerProcessor]「${word.word}」跨天連續答對 ${nextCorrectStreak} 次，正式移出複習池`);
    }

    // 🔥 判斷是否要保留原始軌跡
    const shouldCaptureStrokeData =
      grading.correctnessSignal !== 'true-positive' || submission.timedOut;

    // ============================================================
    // 5. 組裝 AttemptRecord
    // ============================================================
    const attempt: AttemptRecord = {
      studentId,
      studentDisplayId,
      wordId: word.id,
      timestamp: now.toISOString(),
      recognizedText: submission.recognizedText,
      isCorrect: grading.isCorrect,
      responseTimeMs: submission.elapsedMs,
      timeLimitMs,
      snapshotImageUrl: submission.snapshotImageUrl,
      editDistance,
      similarity,
      snapshotEaseFactor: scheduling.nextEaseFactor,
      snapshotInterval: scheduling.nextInterval,
      timedOut: submission.timedOut,
      correctnessSignal: grading.correctnessSignal,
      forcedMatch: submission.forcedMatch,
      candidatesSnapshot: submission.candidatesSnapshot,
      rawStrokeData: shouldCaptureStrokeData ? submission.rawStrokeData : undefined,
    };

    return {
      grading,
      scheduling,
      nextState,
      attempt,
      editDistance,
      similarity,
    };
  }
}