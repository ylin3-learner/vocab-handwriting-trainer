import { SM2Result } from './sm2';
import { ReviewState } from '../../types/word';

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
  };
}