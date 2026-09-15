// src/domain/quiz/SessionQuotaPolicy.ts

/**
 * 配額用盡後的行為。
 *
 * - 'stop'：達到配額即結束 session，學生無法繼續（老師強制停止）
 * - 'continue'：允許學生在 done 頁面主動選擇繼續（老師開放彈性）
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
 *   - Anki 的「軟上限」哲學：限制是建議，學生可主動選擇繼續
 *   - 老師的 exceededBehavior 決定「學生是否有選擇權」
 *   - 純邏輯，無副作用，可獨立單元測試
 *
 * 狀態機：
 *
 *   [每日配額內]
 *        ↓ 答完配額
 *   [done 頁面]
 *        ├─ stop 模式 → 只有「返回登入」
 *        └─ continue 模式 → 顯示「繼續練習」按鈕
 *              ↓ 學生按按鈕
 *         [繼續練習中]（不再停止）
 */
export class SessionQuotaPolicy {
  /**
   * 學生是否已主動選擇繼續。
   *
   * - false：學生還在配額內，或已達配額但還沒按「繼續練習」
   * - true：學生已按下按鈕，session 進入 continue 模式
   */
  private studentOptedIn = false;

  constructor(private config: SessionQuotaPolicyConfig) {}

  /**
   * 是否應該繼續出下一題。
   *
   * - 配額內：一律繼續
   * - 配額外 + stop 模式：停止
   * - 配額外 + continue 模式 + 學生已選擇：繼續
   * - 配額外 + continue 模式 + 學生未選擇：停止（等學生按按鈕）
   */
  shouldContinue(answeredCount: number): boolean {
    if (answeredCount < this.config.dailyMaxQuota) return true;
    if (this.config.exceededBehavior === 'stop') return false;
    return this.studentOptedIn;
  }

  /**
   * 學生按下「繼續練習」按鈕時呼叫。
   * 幂等：多次呼叫只生效一次。
   */
  optInToContinue(): void {
    this.studentOptedIn = true;
  }

  /**
   * 是否應顯示「繼續練習」按鈕（給 done 頁面判斷）。
   *
   * 條件：
   *   1. 老師設定為 continue 模式
   *   2. 學生已達配額
   *   3. 學生尚未選擇繼續
   */
  canOfferContinue(answeredCount: number): boolean {
    return (
      this.config.exceededBehavior === 'continue' &&
      this.isExceeded(answeredCount) &&
      !this.studentOptedIn
    );
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
   * 是否處於「課後加強」模式（學生已選擇繼續，且已超額）。
   *
   * 注意：學生「尚未選擇繼續」時不算在 continue 模式內，
   * 因為他們還在 done 頁面（等待按按鈕）。
   */
  isInContinueMode(answeredCount: number): boolean {
    return (
      this.isExceeded(answeredCount) &&
      this.config.exceededBehavior === 'continue' &&
      this.studentOptedIn
    );
  }
}