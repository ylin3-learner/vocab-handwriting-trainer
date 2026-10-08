// src/domain/quiz/HandwritingLockPolicy.ts

/**
 * 手寫作答模式。
 *
 * - 'normal'：一般練習，可清除重寫、可多筆書寫
 * - 'locked'：比賽模擬，第一筆落下後鎖定，不可清除、不可再寫
 *
 * 設計依據：
 *   比賽規則「答案不得塗改」——一旦動筆就定生死。
 *   模擬此壓力，訓練學生「想清楚再寫」的能力。
 *
 * 鎖定時機：第一筆落下的瞬間（startDraw），而非題目出現時。
 *   理由：題目出現就鎖定會讓手滑誤觸直接報廢整題，太嚴苛。
 */
export type HandwritingMode = 'normal' | 'locked';

/**
 * 職責：依優先序決定「本題的手寫模式」。
 *
 * 優先序：學生個人 > 作業設定 > 系統預設
 *
 * 與 QuizTimingPolicy 對稱的設計，讓老師可以為不同作業
 * 切換「平常練習模式」與「賽前模擬模式」，不需改程式碼。
 *
 * 邊界保護：
 *   無效值（undefined / 未知字串）一律 fallback 到系統預設 'normal'，
 *   確保向後相容——舊作業讀取時不會因為缺少此欄位而壞掉。
 */
export class HandwritingLockPolicy {
  /** 系統預設：一般練習模式（可清除） */
  static readonly DEFAULT_MODE: HandwritingMode = 'normal';

  resolve(context: {
    studentCustomMode?: HandwritingMode;
    assignmentMode?: HandwritingMode;
  }): HandwritingMode {
    const raw =
      context.studentCustomMode ??
      context.assignmentMode ??
      HandwritingLockPolicy.DEFAULT_MODE;

    return this.normalize(raw);
  }

  /**
   * 驗證是否為合法模式。
   * UI 用來顯示警告，不阻擋輸入。
   */
  isValid(mode: unknown): mode is HandwritingMode {
    return mode === 'normal' || mode === 'locked';
  }

  private normalize(mode: unknown): HandwritingMode {
    return this.isValid(mode) ? mode : HandwritingLockPolicy.DEFAULT_MODE;
  }
}