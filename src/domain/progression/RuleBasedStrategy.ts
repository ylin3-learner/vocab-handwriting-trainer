// src/domain/progression/RuleBasedStrategy.ts
import {
  LevelProgressionStrategy,
} from './LevelProgressionStrategy';
import {
  ProgressionInput,
  ProgressionDecision,
} from '../../types/progression';

/**
 * 規則式等級調整策略
 *
 * 設計原則：
 * - 純函式，相同輸入必定相同輸出
 * - 所有閾值集中在 THRESHOLDS 物件，方便調參
 * - 若「升級條件」與「降級條件」同時不滿足 → hold
 */
export class RuleBasedStrategy implements LevelProgressionStrategy {
  readonly name = 'RuleBased-v1';

  /**
   * 所有閾值集中管理。未來若要調參，只改這裡。
   * 這些數值是根據 8 秒題目限制、國中生認知負荷推估的合理值。
   */
  private static readonly THRESHOLDS = {
    // === 升級條件 ===
    PROMOTE_MIN_CORRECT_RATE: 0.85,    // 最近 20 題正確率 ≥ 85%
    PROMOTE_MAX_AVG_TIME_MS: 5000,     // 平均反應時間 < 5 秒
    PROMOTE_MIN_ATTEMPTS_IN_LEVEL: 30, // 當前 level 至少答過 30 題
    PROMOTE_MIN_RECENT_ATTEMPTS: 15,   // 至少要有 15 題樣本才評估

    // === 降級條件 ===
    DEMOTE_MAX_CORRECT_RATE: 0.5,      // 最近 20 題正確率 < 50%
    DEMOTE_MIN_ATTEMPTS_IN_LEVEL: 20,  // 當前 level 至少答過 20 題
    DEMOTE_MIN_RECENT_ATTEMPTS: 15,    // 至少要有 15 題樣本才評估

    // === 防抖動 ===
    LOCK_ATTEMPTS_AFTER_CHANGE: 30,    // 升/降級後鎖 30 題

    // === 連續表現條件（輔助訊號）===
    PROMOTE_MIN_CONSECUTIVE_CORRECT: 5, // 連續答對 5 題（額外加分）
    DEMOTE_MIN_CONSECUTIVE_WRONG: 5,    // 連續答錯 5 題（額外加分）
  };

  evaluate(input: ProgressionInput): ProgressionDecision {
    const { metrics, currentLevel, minLevel, maxLevel, totalAttempts } = input;
    const T = RuleBasedStrategy.THRESHOLDS;

    // ============================================================
    // 防護 1：樣本不足 → 保持
    // ============================================================
    if (metrics.recentAttempts < Math.min(T.PROMOTE_MIN_RECENT_ATTEMPTS, T.DEMOTE_MIN_RECENT_ATTEMPTS)) {
      return this.hold(currentLevel, `樣本不足（${metrics.recentAttempts} 題）`);
    }

    // ============================================================
    // 防護 2：已在最高/最低等級 → 不動作
    // ============================================================
    if (currentLevel >= maxLevel) {
      return this.hold(currentLevel, `已達最高等級 L${maxLevel}`);
    }
    if (currentLevel <= minLevel && metrics.correctRate < T.DEMOTE_MAX_CORRECT_RATE) {
      return this.hold(currentLevel, `已達最低等級 L${minLevel}`);
    }

    // ============================================================
    // 判斷 1：升級條件
    // ============================================================
    const canPromoteByRate =
      metrics.correctRate >= T.PROMOTE_MIN_CORRECT_RATE &&
      metrics.avgResponseTimeMs < T.PROMOTE_MAX_AVG_TIME_MS &&
      metrics.attemptsInCurrentLevel >= T.PROMOTE_MIN_ATTEMPTS_IN_LEVEL;

    const canPromoteByStreak =
      metrics.consecutiveCorrect >= T.PROMOTE_MIN_CONSECUTIVE_CORRECT &&
      metrics.attemptsInCurrentLevel >= T.PROMOTE_MIN_ATTEMPTS_IN_LEVEL;

    if (canPromoteByRate || canPromoteByStreak) {
      const reason = canPromoteByRate
        ? `正確率 ${(metrics.correctRate * 100).toFixed(0)}%、平均 ${(metrics.avgResponseTimeMs / 1000).toFixed(1)}s，表現優異`
        : `連續答對 ${metrics.consecutiveCorrect} 題，表現優異`;
      return this.promote(currentLevel + 1, reason, totalAttempts);
    }

    // ============================================================
    // 判斷 2：降級條件
    // ============================================================
    const canDemoteByRate =
      metrics.correctRate < T.DEMOTE_MAX_CORRECT_RATE &&
      metrics.attemptsInCurrentLevel >= T.DEMOTE_MIN_ATTEMPTS_IN_LEVEL;

    const canDemoteByStreak =
      metrics.consecutiveWrong >= T.DEMOTE_MIN_CONSECUTIVE_WRONG &&
      metrics.attemptsInCurrentLevel >= T.DEMOTE_MIN_ATTEMPTS_IN_LEVEL;

    if (canDemoteByRate || canDemoteByStreak) {
      const reason = canDemoteByRate
        ? `正確率 ${(metrics.correctRate * 100).toFixed(0)}%，需要加強基礎`
        : `連續答錯 ${metrics.consecutiveWrong} 題，需要加強基礎`;
      return this.demote(currentLevel - 1, reason, totalAttempts);
    }

    // ============================================================
    // 預設：保持
    // ============================================================
    return this.hold(
      currentLevel,
      `表現穩定（正確率 ${(metrics.correctRate * 100).toFixed(0)}%）`
    );
  }

  // ============================================================
  // 內部輔助方法（純函式）
  // ============================================================

  private promote(newLevel: number, reason: string, totalAttempts: number): ProgressionDecision {
    return {
      action: 'promote',
      newLevel,
      reason: `升級：${reason}`,
      lockUntilAttempts: totalAttempts + RuleBasedStrategy.THRESHOLDS.LOCK_ATTEMPTS_AFTER_CHANGE,
    };
  }

  private demote(newLevel: number, reason: string, totalAttempts: number): ProgressionDecision {
    return {
      action: 'demote',
      newLevel,
      reason: `降級：${reason}`,
      lockUntilAttempts: totalAttempts + RuleBasedStrategy.THRESHOLDS.LOCK_ATTEMPTS_AFTER_CHANGE,
    };
  }

  private hold(level: number, reason: string): ProgressionDecision {
    return {
      action: 'hold',
      newLevel: level,
      reason,
      lockUntilAttempts: 0, // 保持不鎖定
    };
  }
}