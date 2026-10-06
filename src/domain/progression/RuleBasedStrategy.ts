// src/domain/progression/RuleBasedStrategy.ts
import {
  LevelProgressionStrategy,
} from './LevelProgressionStrategy';
import {
  ProgressionInput,
  ProgressionDecision,
} from '../../types/progression';

export const RULE_BASED_THRESHOLDS = {
  // === 升級條件 ===
  PROMOTE_MIN_CORRECT_RATE: 0.85,
  PROMOTE_MAX_AVG_TIME_MS: 7000,
  PROMOTE_MIN_ATTEMPTS_IN_LEVEL: 20,
  PROMOTE_MIN_RECENT_ATTEMPTS: 15,

  // 🔥 新增：Probe 升級條件
  PROMOTE_MIN_PROBE_ATTEMPTS: 3,
  PROMOTE_MIN_PROBE_CORRECT_RATE: 0.7,

  // === 降級條件 ===
  DEMOTE_MAX_CORRECT_RATE: 0.5,
  DEMOTE_MIN_ATTEMPTS_IN_LEVEL: 15,
  DEMOTE_MIN_RECENT_ATTEMPTS: 15,

  // 🔥 新增：降級需慢速（過濾快速猜錯）
  DEMOTE_MIN_AVG_TIME_MS: 5000,

  // 🔥 新增：趨勢保護（進步中不降級）
  TREND_PROTECTION_THRESHOLD: 0.2,

  // === 防抖動 ===
  LOCK_ATTEMPTS_AFTER_CHANGE: 50,   // 🔥 從 30 提高到 50

  // === 連續表現條件 ===
  PROMOTE_MIN_CONSECUTIVE_CORRECT: 5,
  DEMOTE_MIN_CONSECUTIVE_WRONG: 5,
} as const;

export class RuleBasedStrategy implements LevelProgressionStrategy {
  readonly name = 'RuleBased-v2';

  private static readonly THRESHOLDS = RULE_BASED_THRESHOLDS;

  evaluate(input: ProgressionInput): ProgressionDecision {
    const { metrics, currentLevel, minLevel, maxLevel, totalAttempts } = input;
    const T = RuleBasedStrategy.THRESHOLDS;

    // ============================================================
    // 防護 1：樣本不足 → hold
    // ============================================================
    if (metrics.recentAttempts < Math.min(T.PROMOTE_MIN_RECENT_ATTEMPTS, T.DEMOTE_MIN_RECENT_ATTEMPTS)) {
      return this.hold(currentLevel, `樣本不足（${metrics.recentAttempts} 題）`);
    }

    // ============================================================
    // 防護 2：已在最高/最低等級
    // ============================================================
    if (currentLevel >= maxLevel) {
      return this.hold(currentLevel, `已達最高等級 L${maxLevel}`);
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

    // 🔥 新增：Probe 表現好 → 即使當前等級樣本略少也能升
    const canPromoteByProbe =
      metrics.attemptsAboveLevel >= T.PROMOTE_MIN_PROBE_ATTEMPTS &&
      metrics.probeCorrectRate >= T.PROMOTE_MIN_PROBE_CORRECT_RATE &&
      metrics.attemptsAtLevel >= 10;

    if (canPromoteByRate || canPromoteByStreak || canPromoteByProbe) {
      const reason = canPromoteByProbe
        ? `Probe 表現優異（高階題正確率 ${(metrics.probeCorrectRate * 100).toFixed(0)}%）`
        : canPromoteByRate
          ? `正確率 ${(metrics.correctRate * 100).toFixed(0)}%、平均 ${(metrics.avgResponseTimeMs / 1000).toFixed(1)}s`
          : `連續答對 ${metrics.consecutiveCorrect} 題`;
      return this.promote(currentLevel + 1, reason, totalAttempts);
    }

    // ============================================================
    // 判斷 2：降級條件（🔥 新增趨勢保護與時間條件）
    // ============================================================
    const canDemoteByRate =
      metrics.correctRate < T.DEMOTE_MAX_CORRECT_RATE &&
      metrics.avgResponseTimeMs >= T.DEMOTE_MIN_AVG_TIME_MS &&  // 🔥 新增
      metrics.attemptsInCurrentLevel >= T.DEMOTE_MIN_ATTEMPTS_IN_LEVEL;

    const canDemoteByStreak =
      metrics.consecutiveWrong >= T.DEMOTE_MIN_CONSECUTIVE_WRONG &&
      metrics.attemptsInCurrentLevel >= T.DEMOTE_MIN_ATTEMPTS_IN_LEVEL;

    // 🔥 趨勢保護：如果學生在進步（trend > 0.2），不降級
    const isImproving = metrics.trend > T.TREND_PROTECTION_THRESHOLD;

    if ((canDemoteByRate || canDemoteByStreak) && !isImproving) {
      if (currentLevel <= minLevel) {
        return this.hold(currentLevel, `已達最低等級 L${minLevel}，無法再降`);
      }

      const reason = canDemoteByRate
        ? `正確率 ${(metrics.correctRate * 100).toFixed(0)}%、平均 ${(metrics.avgResponseTimeMs / 1000).toFixed(1)}s`
        : `連續答錯 ${metrics.consecutiveWrong} 題`;
      return this.demote(currentLevel - 1, reason, totalAttempts);
    }

    // ============================================================
    // 預設：保持
    // ============================================================
    const trendNote = isImproving ? '（進步中）' : '';
    return this.hold(
      currentLevel,
      `表現穩定（正確率 ${(metrics.correctRate * 100).toFixed(0)}%）${trendNote}`
    );
  }

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
      lockUntilAttempts: 0,
    };
  }
}