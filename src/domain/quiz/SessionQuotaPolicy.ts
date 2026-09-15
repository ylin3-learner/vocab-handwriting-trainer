// src/domain/quiz/SessionQuotaPolicy.ts

/**
 * 配額用盡後的行為。
 *
 * - 'stop'：達到配額即結束 session（預設，符合比賽節奏）
 * - 'continue'：達到配額後仍可繼續練習（課後加強）
 */
export type QuotaExceededBehavior = 'stop' | 'continue';

export interface SessionQuotaPolicyConfig {
  /** 每日建議題數 */
  dailyMaxQuota: number;
  /** 配額用盡後的行為 */
  exceededBehavior: QuotaExceededBehavior;
}

/**
 * 職責：決定 session 是否應該繼續出題。
 *
 * 設計依據：
 *   - Anki 的「軟上限」哲學：限制是建議，使用者可選擇繼續
 *   - 技術約束（Firestore 配額）與教學設計分離
 *   - 純函式，無副作用，可獨立單元測試
 */
export class SessionQuotaPolicy {
  constructor(private config: SessionQuotaPolicyConfig) {}

  /**
   * 是否應該繼續出下一題。
   */
  shouldContinue(answeredCount: number): boolean {
    if (answeredCount < this.config.dailyMaxQuota) return true;
    return this.config.exceededBehavior === 'continue';
  }

  /**
   * 是否已超過建議配額（用於 UI 顯示）。
   */
  isExceeded(answeredCount: number): boolean {
    return answeredCount >= this.config.dailyMaxQuota;
  }

  /**
   * 距離配額還剩幾題（用於進度顯示）。
   */
  getRemainingBeforeExceeded(answeredCount: number): number {
    return Math.max(0, this.config.dailyMaxQuota - answeredCount);
  }

  /**
   * 是否處於「課後加強」模式（已超額但允許繼續）。
   */
  isInContinueMode(answeredCount: number): boolean {
    return (
      this.isExceeded(answeredCount) &&
      this.config.exceededBehavior === 'continue'
    );
  }
}