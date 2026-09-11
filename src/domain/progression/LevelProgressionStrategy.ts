// src/domain/progression/LevelProgressionStrategy.ts
import { ProgressionInput, ProgressionDecision } from '../../types/progression';

/**
 * 等級調整策略介面
 *
 * 這是 Strategy Pattern 的核心。未來若要換成 IRT / Elo / BKT，
 * 只要新增一個實作此介面的 class，不需要改動 Service 層。
 */
export interface LevelProgressionStrategy {
  /** 策略名稱（用於日誌與除錯） */
  readonly name: string;

  /**
   * 純函式：根據輸入決定是否調整等級
   * - 絕對不碰 Firestore
   * - 絕對不碰 UI
   * - 相同輸入必定相同輸出
   */
  evaluate(input: ProgressionInput): ProgressionDecision;
}