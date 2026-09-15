// src/features/quiz/AnswerProcessor.ts
import { Word, ReviewState } from '../../types/word';
import { AttemptRecord } from '../../services/storage/ProgressStore';
import { gradeAnswer, GradingResult } from '../../domain/grading/grader';
import { calculateNextReview, SM2Result } from '../../domain/scheduler/sm2';
import { mergeSM2ResultWithState } from '../../domain/scheduler/reviewStateMapper';
import { calculateOverdueDays } from '../../domain/date/overdue';
import { levenshteinDistance, normalizedSimilarity } from '../../domain/string/similarity';
import { AnswerSubmission } from './QuizOrchestrator';

/**
 * 連續答對幾次後，將 everWrong 清除（移出複習池）。
 *
 * 為什麼不用 sm2.ts 的 consecutiveCorrect？
 *   因為 sm2.ts 的 MASTERY_STREAK = 3，consecutiveCorrect 達 3 就歸零，
 *   永遠不會累積到 5。所以這裡自己維護 correctStreak。
 *
 * 閾值 5 的依據：連續答對 5 次代表學生已經在多個不同的複習週期
 * （間隔約 1、2、3、4、5 天）都答對，實質上已掌握。
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
    // 4. 更新 correctStreak 與 everWrong
    //
    // correctStreak：自上次答錯以來連續答對的次數（獨立於 sm2.ts）
    //   - 答對 → +1
    //   - 答錯 → 歸零
    //
    // everWrong：
    //   - 答錯 → 設為 true（永久追蹤）
    //   - 答對 + 之前 everWrong=true + correctStreak >= 5 → 清除為 false
    //   - 其他 → 保持不變
    //
    // 🔥 防禦 legacy 資料：
    //   舊版資料可能沒寫入過 everWrong / correctStreak，
    //   讀出來會是 undefined。這裡 coerce 成 boolean / number，
    //   確保輸出永遠是乾淨的 ReviewState，
    //   不會再撞回 Firestore 的 Unsupported field value: undefined。
    // ============================================================
    const mergedState = mergeSM2ResultWithState(currentState, scheduling, now);

    const prevEverWrong = currentState.everWrong === true;
    const prevStreak = currentState.correctStreak ?? 0;
    const nextStreak = grading.isCorrect ? prevStreak + 1 : 0;

    const shouldClearEverWrong =
      prevEverWrong && nextStreak >= EVER_WRONG_CLEAR_THRESHOLD;

    const nextEverWrong = !grading.isCorrect
      ? true
      : (shouldClearEverWrong ? false : prevEverWrong);

    const nextState: ReviewState = {
      ...mergedState,
      everWrong: nextEverWrong,
      correctStreak: shouldClearEverWrong ? 0 : nextStreak,
    };

    if (shouldClearEverWrong) {
      console.log(
        `🎓 [AnswerProcessor]「${word.word}」連續答對 ${nextStreak} 次，移出複習池`
      );
    }

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