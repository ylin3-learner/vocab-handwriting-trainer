// src/domain/placement/placementDecision.ts

/**
 * 程度鑑定的階梯決策邏輯。
 *
 * 從 PlacementOrchestrator 抽出，讓核心決策成為可獨立測試的純函式。
 */

export type PlacementAction = 'promote' | 'demote' | 'stop';

export interface PlacementStepDecision {
  /** 下一級要去的等級 */
  newLevel: number;
  /** 是否為最終決策（true = 鑑定結束） */
  isFinal: boolean;
  /** 這一步的動作（用於記錄 placementSteps） */
  action: PlacementAction;
}

export const PLACEMENT_MIN_LEVEL = 1;
export const PLACEMENT_MAX_LEVEL = 6;
/** 3 題中至少對 2 題才升級 */
export const PLACEMENT_PROMOTE_THRESHOLD = 2;

/**
 * 純函式：根據當前等級與答對題數，決定下一步。
 *
 * 規則：
 *   - 答對 ≥ 2：升級（若已在 L6 則停在 L6）
 *   - 答對 ≤ 1：降級（若已在 L1 則停在 L1）
 *
 * 邊界：
 *   - L6 對 2+ 題 → 停 L6（不能升 L7）
 *   - L6 對 0~1 題 → 降 L5（不是停）
 *   - L1 對 0~1 題 → 停 L1（不能降 L0）
 *   - L1 對 2+ 題 → 升 L2（不是停）
 */
export function decidePlacementStep(
  currentLevel: number,
  correct: number
): PlacementStepDecision {
  const promote = correct >= PLACEMENT_PROMOTE_THRESHOLD;

  if (promote) {
    if (currentLevel >= PLACEMENT_MAX_LEVEL) {
      return { newLevel: PLACEMENT_MAX_LEVEL, isFinal: true, action: 'stop' };
    }
    return { newLevel: currentLevel + 1, isFinal: false, action: 'promote' };
  } else {
    if (currentLevel <= PLACEMENT_MIN_LEVEL) {
      return { newLevel: PLACEMENT_MIN_LEVEL, isFinal: true, action: 'stop' };
    }
    return { newLevel: currentLevel - 1, isFinal: false, action: 'demote' };
  }
}