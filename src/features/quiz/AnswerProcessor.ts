// src/features/quiz/AnswerProcessor.ts
import { Word, ReviewState } from '../../types/word';
import { AttemptRecord } from '../../services/storage/ProgressStore';
import { gradeAnswer, GradingResult } from '../../domain/grading/grader';
import { calculateNextReview, SM2Result } from '../../domain/scheduler/sm2';
import { mergeSM2ResultWithState } from '../../domain/scheduler/reviewStateMapper';
import { calculateOverdueDays } from '../../domain/date/overdue';
import { levenshteinDistance, normalizedSimilarity } from '../../domain/string/similarity';
import { AnswerSubmission } from './QuizOrchestrator';
import { getLocalDateString } from '../../domain/date/timezone';

const EVER_WRONG_CLEAR_THRESHOLD = 5;

export interface ProcessAnswerParams {
  word: Word;
  submission: AnswerSubmission;
  currentState: ReviewState;
  timeLimitMs: number;
  studentId: string;
  studentDisplayId?: string;
  now: Date;
  studentTimeZone: string;
  isProbe?: boolean; // 🔥 新增：是否為探針題
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
      isProbe = false, // 🔥 預設為 false
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
      overdueDays,
      now // 修正：把 now 傳進去
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
        nextDailyStreak += 1;
      } else {
        nextDailyStreak = 1;
        nextCorrectStreak += 1;
      }
    } else {
      nextDailyStreak = 0;
      nextCorrectStreak = 0;
    }

    const shouldClearEverWrong = prevEverWrong && nextCorrectStreak >= EVER_WRONG_CLEAR_THRESHOLD;

    // 🔥 核心修正：探針題隔離沙盒 (Explore-Sandbox)
    let nextEverWrong = !grading.isCorrect
      ? true
      : (shouldClearEverWrong ? false : prevEverWrong);

    if (isProbe && !grading.isCorrect) {
      // 探針題答錯：不污染 SM-2 錯題池，直接沿用原本狀態（通常是 false）
      nextEverWrong = prevEverWrong;
      console.log(`🛡️ [AnswerProcessor] 探針題「${word.word}」答錯，啟動單向隔離，不寫入錯題池`);
    }

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
      isProbe, // 🔥 新增：寫入 AttemptRecord 供未來分析
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