// src/domain/scheduler/sm2.ts

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
const MASTERY_STREAK = 3;

export function calculateNextReview(
  state: SM2State,
  quality: number,
  overdueDays: number,
  now: Date // 🔥 新增：傳入當下時間，確保純函式性質
): SM2Result {
  const isCorrect = quality >= 3;

  let nextInterval: number;
  let nextEaseFactor: number;

  if (!isCorrect) {
    nextEaseFactor = Math.max(MIN_EASE_FACTOR, state.easeFactor - 0.1);
    nextInterval = Math.max(1, Math.floor(state.reviewInterval / 2));
  } else {
    nextEaseFactor = state.easeFactor + 0.02;
    const overdueBonus = 1 + 0.1 * overdueDays;
    nextInterval = Math.round(state.reviewInterval + 1 * overdueBonus);
  }

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

  // 🔥 修正：使用傳入的 now，而不是 Date.now()
  const nextReviewDate = new Date(
    now.getTime() + nextInterval * 24 * 60 * 60 * 1000
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