// src/domain/progression/evaluationGuard.ts

/**
 * 等級評估的守衛邏輯（純函式）。
 *
 * 從 LevelProgressionService.evaluate 抽出，讓核心「是否該評估」
 * 的判斷成為可獨立測試的純函式。
 */

/** 兩次評估之間最少需要的題數 */
export const MIN_ATTEMPTS_BETWEEN_EVALUATIONS = 10;

export interface EvaluationGuardInput {
  totalAttempts: number;
  levelLockedUntilTotalAttempts: number;
  lastEvaluatedAtTotalAttempts: number;
}

export type EvaluationGuardResult =
  | { shouldEvaluate: true }
  | { shouldEvaluate: false; reason: 'locked'; remainingAttempts: number }
  | { shouldEvaluate: false; reason: 'too-soon'; attemptsSinceLastEval: number };

/**
 * 純函式：判斷是否應該進行等級評估。
 *
 * 規則（依序檢查）：
 *   1. 若 totalAttempts < levelLockedUntil → 鎖定中，跳過
 *   2. 若 (totalAttempts - lastEvaluatedAt) < 10 → 距上次評估太近，跳過
 *   3. 否則 → 應該評估
 */
export function checkEvaluationGuard(
  input: EvaluationGuardInput
): EvaluationGuardResult {
  const { totalAttempts, levelLockedUntilTotalAttempts, lastEvaluatedAtTotalAttempts } = input;

  if (totalAttempts < levelLockedUntilTotalAttempts) {
    return {
      shouldEvaluate: false,
      reason: 'locked',
      remainingAttempts: levelLockedUntilTotalAttempts - totalAttempts,
    };
  }

  const attemptsSinceLastEval = totalAttempts - lastEvaluatedAtTotalAttempts;
  if (attemptsSinceLastEval < MIN_ATTEMPTS_BETWEEN_EVALUATIONS) {
    return {
      shouldEvaluate: false,
      reason: 'too-soon',
      attemptsSinceLastEval,
    };
  }

  return { shouldEvaluate: true };
}