// src/services/progression/LevelProgressionService.ts
import { PerformanceTracker } from './PerformanceTracker';
import { StudentStateService } from './StudentStateService';
import { RuleBasedStrategy } from '../../domain/progression/RuleBasedStrategy';
import { LevelProgressionStrategy } from '../../domain/progression/LevelProgressionStrategy';
import { ProgressionDecision, LevelHistoryEntry } from '../../types/progression';

/**
 * 職責：協調 DDA 流程
 *
 * 依賴注入：
 * - tracker：取得指標
 * - stateService：讀寫狀態
 * - strategy：決定是否升級（可抽換為 IRT / BKT 等）
 *
 * 設計原則：
 * - 只做「協調」，不實作演算法
 * - 只做「協調」，不碰 Firestore 細節
 * - 提供 evaluate() 給 QuizOrchestrator 呼叫
 */
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
   * 注意：`state.totalAttempts` 由 `QuizOrchestrator.submitAnswer()` 每次答題時
   * 透過 `StudentStateService.incrementTotalAttempts()` 累加，是精確的跨 session 總數。
   *
   * @param displayId Firebase UID
   * @returns 決策結果（給 UI 顯示用；null 表示未評估）
   */
  async evaluate(displayId: string): Promise<ProgressionDecision | null> {
    // ============================================================
    // 步驟 1：讀取當前狀態
    // ============================================================
    const state = await this.stateService.getState(displayId);
    const totalAttempts = state.totalAttempts;

    // ============================================================
    // 步驟 2：檢查是否仍在鎖定期
    // ============================================================
    if (totalAttempts < state.levelLockedUntilTotalAttempts) {
      const remaining = state.levelLockedUntilTotalAttempts - totalAttempts;
      console.log(`🔒 [LevelProgression] 鎖定中，剩 ${remaining} 題`);
      return null;
    }

    // ============================================================
    // 步驟 3：檢查距離上次評估是否足夠
    // ============================================================
    const sinceLastEval = totalAttempts - state.lastEvaluatedAtTotalAttempts;
    if (sinceLastEval < 10) {
      console.log(`⏭️ [LevelProgression] 距上次評估僅 ${sinceLastEval} 題，跳過`);
      return null;
    }

    // ============================================================
    // 步驟 4：取得表現指標
    // ============================================================
    const metrics = await this.tracker.getRecentMetrics(
      displayId,
      state.currentLevel
    );

    // ============================================================
    // 步驟 5：套用策略
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
    // 步驟 6：寫回 Firestore
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

  /**
   * 手動設定等級（例如：老師指派、程度鑑定結果）
   */
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
      state.totalAttempts + 30, // 手動設定也鎖 30 題
      state.totalAttempts
    );
  }
}