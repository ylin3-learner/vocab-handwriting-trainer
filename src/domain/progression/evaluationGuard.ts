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
 *
 * 🔥 這個常數在比賽模式下有第二個作用：
 *   比賽作業過期後，學生的下一次評估用的就是完全刷新的 30 題窗口，
 *   沒有比賽期間的舊數據稀釋——這正是 CAT 的 Freeze-and-Refresh
 *   機制所說的「未實施的題目根據更新後的能力估計重新選擇」。
 */
export const MIN_ATTEMPTS_BETWEEN_EVALUATIONS = 30;

export interface EvaluationGuardInput {
  totalAttempts: number;
  levelLockedUntilTotalAttempts: number;
  lastEvaluatedAtTotalAttempts: number;
  /**
   * 🔥 比賽模式：啟用時直接跳過評估。
   *
   * 由呼叫端（LevelProgressionService）從 CompetitionModePolicy 解析後傳入。
   * 作業過期後自動變為 false，DDA 自然恢復。
   */
  competitionMode?: boolean;
}

export type EvaluationGuardResult =
  | { shouldEvaluate: true }
  | { shouldEvaluate: false; reason: 'locked'; remainingAttempts: number }
  | { shouldEvaluate: false; reason: 'too-soon'; attemptsSinceLastEval: number }
  | { shouldEvaluate: false; reason: 'competition-mode' };

export function checkEvaluationGuard(
  input: EvaluationGuardInput
): EvaluationGuardResult {
  const {
    totalAttempts,
    levelLockedUntilTotalAttempts,
    lastEvaluatedAtTotalAttempts,
    competitionMode,
  } = input;

  // ============================================================
  // 🔥 比賽模式：直接跳過所有評估
  // ============================================================
  if (competitionMode === true) {
    return { shouldEvaluate: false, reason: 'competition-mode' };
  }

  // ============================================================
  // 鎖定檢查
  // ============================================================
  if (totalAttempts < levelLockedUntilTotalAttempts) {
    return {
      shouldEvaluate: false,
      reason: 'locked',
      remainingAttempts: levelLockedUntilTotalAttempts - totalAttempts,
    };
  }

  // ============================================================
  // 距上次評估太近
  // ============================================================
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