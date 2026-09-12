// src/features/quiz/AnswerProcessor.ts
import { Word, ReviewState } from '../../types/word';
import { AttemptRecord } from '../../services/storage/ProgressStore';
import { gradeAnswer, GradingResult } from '../../domain/grading/grader';
import { calculateNextReview, SM2Result } from '../../domain/scheduler/sm2';
import { mergeSM2ResultWithState } from '../../domain/scheduler/reviewStateMapper';
import { calculateOverdueDays } from '../../domain/date/overdue';
import { levenshteinDistance, normalizedSimilarity } from '../../domain/string/similarity';
import { AnswerSubmission } from './QuizOrchestrator';

export interface ProcessAnswerParams {
  word: Word;
  submission: AnswerSubmission;
  currentState: ReviewState;
  timeLimitMs: number;
  studentId: string;
  studentDisplayId?: string;
  now: Date;
}

export interface ProcessedAnswer {
  grading: GradingResult;
  scheduling: SM2Result;
  nextState: ReviewState;
  attempt: AttemptRecord;
  editDistance: number;
  similarity: number;
}

/**
 * 純運算：評分 + SM-2 排程 + 組裝 AttemptRecord。
 *
 * 設計原則：
 * - 不碰 I/O（不寫 Firestore、不寫本地）
 * - 相同輸入必定相同輸出
 * - 由呼叫者決定「要怎麼寫」（batch / 記憶體 / 其他）
 *
 * 這個模組被 QuizOrchestrator 和 PlacementOrchestrator 共用。
 */
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
    // 2. 計算編輯距離與相似度（用於錯誤分類與弱點分析）
    // ============================================================
    const editDistance = levenshteinDistance(
      submission.recognizedText,
      word.word
    );
    const similarity = normalizedSimilarity(
      submission.recognizedText,
      word.word
    );

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

    // ============================================================
    // 4. 合併成新狀態，並標記 everWrong
    //
    // 設計：SM-2 只追蹤錯題。
    //   - 首次答對 → everWrong 保持 false（不進複習池）
    //   - 首次答錯 → everWrong 永久為 true（進複習池）
    // ============================================================
    const mergedState = mergeSM2ResultWithState(currentState, scheduling, now);
    const nextState: ReviewState = {
      ...mergedState,
      everWrong: currentState.everWrong === true || !grading.isCorrect,
    };

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
      snapshotImageUrl: submission.snapshotImageUrl,
      editDistance,
      similarity,
      snapshotEaseFactor: scheduling.nextEaseFactor,
      snapshotInterval: scheduling.nextInterval,
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