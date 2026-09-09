// domain/scheduler/sm2.ts
// 從 quiz.py 的 calculate_next_review_date() + evaluate_answer() 移植並合併
// 純函式,不碰資料庫、不碰時間以外的外部狀態
// quality 只能來自 grader.calculateQuality() 的輸出,這裡不做任何自評相關邏輯

export interface SM2State {
  reviewInterval: number;
  easeFactor: number;
  reviewCount: number;
  consecutiveCorrect: number;
  totalReviews: number;
}

export interface SM2Result {
  nextInterval: number;
  nextEaseFactor: number;
  nextReviewDate: string; // ISO 字串
  nextReviewCount: number;
  nextConsecutiveCorrect: number;
  nextTotalReviews: number;
}

const MIN_EASE_FACTOR = 1.3;
const MASTERY_STREAK = 3; // 連續答對幾次視為「已掌握」,歸零 reviewCount

export function calculateNextReview(
  state: SM2State,
  quality: number,
  overdueDays: number
): SM2Result {
  const isCorrect = quality >= 3;

  let nextInterval: number;
  let nextEaseFactor: number;

  if (!isCorrect) {
    // 答錯或超時:間隔乘性下降(減半),EF 輕微下降,下限 1.3
    nextEaseFactor = Math.max(MIN_EASE_FACTOR, state.easeFactor - 0.1);
    nextInterval = Math.max(1, Math.floor(state.reviewInterval / 2));
  } else {
    // 答對:間隔加性增長,並依逾期天數給額外加成;EF 微升
    nextEaseFactor = state.easeFactor + 0.02;
    const overdueBonus = 1 + 0.1 * overdueDays;
    nextInterval = Math.round(state.reviewInterval + 1 * overdueBonus);
  }

  // 答題後的狀態轉移(原本在 quiz.py 的 evaluate_answer 裡)
  let nextReviewCount: number;
  let nextConsecutiveCorrect: number;

  if (!isCorrect) {
    nextReviewCount = state.reviewCount + 1;
    nextConsecutiveCorrect = 0;
  } else {
    nextConsecutiveCorrect = state.consecutiveCorrect + 1;
    if (nextConsecutiveCorrect >= MASTERY_STREAK) {
      nextReviewCount = 0;
      nextConsecutiveCorrect = 0;
    } else {
      nextReviewCount = state.reviewCount;
    }
  }

  const nextReviewDate = new Date(
    Date.now() + nextInterval * 24 * 60 * 60 * 1000
  ).toISOString();

  return {
    nextInterval,
    nextEaseFactor,
    nextReviewDate,
    nextReviewCount,
    nextConsecutiveCorrect,
    nextTotalReviews: state.totalReviews + 1,
  };
}
