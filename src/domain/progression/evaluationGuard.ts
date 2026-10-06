// src/domain/progression/evaluationGuard.ts

/**
 * 兩次評估之間最少需要的題數。
 *
 * 🔥 從 10 改為 30，與統計窗口（WINDOW_SIZE = 30）對齊。
 *
 * 原因：
 *   舊版每 10 題評估一次，但評估窗口是 30 題。
 *   這導致每次評估只用 10 題新數據 + 20 題舊數據，
 *   舊數據主導決策，造成震盪。
 *
 *   改成 30 題後，每次評估都是「完整的窗口更新」，
 *   統計上更可靠。
 */
export const MIN_ATTEMPTS_BETWEEN_EVALUATIONS = 30;

export interface EvaluationGuardInput {
  totalAttempts: number;
  levelLockedUntilTotalAttempts: number;
  lastEvaluatedAtTotalAttempts: number;
}

export type EvaluationGuardResult =
  | { shouldEvaluate: true }
  | { shouldEvaluate: false; reason: 'locked'; remainingAttempts: number }
  | { shouldEvaluate: false; reason: 'too-soon'; attemptsSinceLastEval: number };

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