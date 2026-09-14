// src/services/progression/LevelProgressionService.ts
import { PerformanceTracker } from './PerformanceTracker';
import { StudentStateService } from './StudentStateService';
import { RuleBasedStrategy } from '../../domain/progression/RuleBasedStrategy';
import { LevelProgressionStrategy } from '../../domain/progression/LevelProgressionStrategy';
import { checkEvaluationGuard } from '../../domain/progression/evaluationGuard';
import { ProgressionDecision, LevelHistoryEntry } from '../../types/progression';

export class LevelProgressionService {
  private static readonly MIN_LEVEL = 1;
  private static readonly MAX_LEVEL = 6;

  constructor(
    private tracker: PerformanceTracker = new PerformanceTracker(),
    private stateService: StudentStateService = new StudentStateService(),
    private strategy: LevelProgressionStrategy = new RuleBasedStrategy()
  ) {}

  /**
   * 評估學生是否需要調整等級
   *
   * 守衛邏輯（鎖定檢查、距上次評估時間）由純函式 checkEvaluationGuard 處理。
   */
  async evaluate(displayId: string): Promise<ProgressionDecision | null> {
    // ============================================================
    // 步驟 1：讀取當前狀態
    // ============================================================
    const state = await this.stateService.getState(displayId);
    const totalAttempts = state.totalAttempts;

    // ============================================================
    // 步驟 2：守衛檢查（鎖定期 + 距上次評估時間）
    // ============================================================
    const guard = checkEvaluationGuard({
      totalAttempts,
      levelLockedUntilTotalAttempts: state.levelLockedUntilTotalAttempts,
      lastEvaluatedAtTotalAttempts: state.lastEvaluatedAtTotalAttempts,
    });

    if (!guard.shouldEvaluate) {
      if (guard.reason === 'locked') {
        console.log(`🔒 [LevelProgression] 鎖定中，剩 ${guard.remainingAttempts} 題`);
      } else {
        console.log(`⏭️ [LevelProgression] 距上次評估僅 ${guard.attemptsSinceLastEval} 題，跳過`);
      }
      return null;
    }

    // ============================================================
    // 步驟 3：取得表現指標
    // ============================================================
    const metrics = await this.tracker.getRecentMetrics(
      displayId,
      state.currentLevel
    );

    // ============================================================
    // 步驟 4：套用策略
    // ============================================================
    const decision = this.strategy.evaluate({
      metrics,
      currentLevel: state.currentLevel,
      minLevel: LevelProgressionService.MIN_LEVEL,
      maxLevel: LevelProgressionService.MAX_LEVEL,
      totalAttempts,
    });

    console.log(
      `🎯 [LevelProgression] ${this.strategy.name} 決策：${decision.action}（${decision.reason}）`
    );

    // ============================================================
    // 步驟 5：寫回 Firestore
    // ============================================================
    if (decision.action === 'hold') {
      await this.stateService.markEvaluated(displayId, totalAttempts);
      return decision;
    }

    const triggeredBy =
      decision.action === 'promote' ? 'promotion' : 'demotion';

    const historyEntry: LevelHistoryEntry = {
      level: decision.newLevel,
      changedAt: new Date().toISOString(),
      reason: decision.reason,
      triggeredBy,
    };

    await this.stateService.updateLevel(
      displayId,
      decision.newLevel,
      historyEntry,
      decision.lockUntilAttempts,
      totalAttempts
    );

    return decision;
  }

  async setLevelManually(displayId: string, level: number, reason: string): Promise<void> {
    if (level < LevelProgressionService.MIN_LEVEL || level > LevelProgressionService.MAX_LEVEL) {
      throw new Error(`等級必須介於 ${LevelProgressionService.MIN_LEVEL}~${LevelProgressionService.MAX_LEVEL}`);
    }

    const state = await this.stateService.getState(displayId);

    const historyEntry: LevelHistoryEntry = {
      level,
      changedAt: new Date().toISOString(),
      reason,
      triggeredBy: 'manual',
    };

    await this.stateService.updateLevel(
      displayId,
      level,
      historyEntry,
      state.totalAttempts + 30,
      state.totalAttempts
    );
  }
}