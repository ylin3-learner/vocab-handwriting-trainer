// src/domain/scheduler/reviewStateMapper.ts
import { SM2Result } from './sm2';
import { ReviewState } from '../../types/word';

/**
 * 將 SM-2 計算結果合併回 ReviewState。
 *
 * 職責邊界：
 *   - SM-2 負責：reviewInterval / easeFactor / reviewCount /
 *                consecutiveCorrect / totalReviews / lastReviewed / nextReviewDate
 *   - 非 SM-2 欄位（everWrong / correctStreak）：沿用 currentState，
 *     由 AnswerProcessor 在 merge 之後依作答結果決定是否覆寫。
 *
 * 🔥 防禦 legacy 資料：
 *   舊版資料可能沒寫入過 everWrong / correctStreak，
 *   讀出來會是 undefined。這裡 coerce 成 boolean / number，
 *   確保回傳的 ReviewState 永遠合法。
 */
export function mergeSM2ResultWithState(
  currentState: ReviewState,
  sm2Result: SM2Result,
  now: Date
): ReviewState {
  return {
    reviewInterval: sm2Result.nextInterval,
    easeFactor: sm2Result.nextEaseFactor,
    reviewCount: sm2Result.nextReviewCount,
    consecutiveCorrect: sm2Result.nextConsecutiveCorrect,
    totalReviews: sm2Result.nextTotalReviews,
    lastReviewed: now.toISOString(),
    nextReviewDate: sm2Result.nextReviewDate,

    // 🔥 沿用 currentState 的非 SM-2 欄位（coerce 成合法型別）
    everWrong: currentState.everWrong === true,
    correctStreak: currentState.correctStreak ?? 0,
  };
}