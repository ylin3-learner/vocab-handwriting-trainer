// 對應 data/schema/words.schema.json 的固定欄位契約
// 老師的 Excel 只要能轉出符合這個型別的物件,系統就能吃

export interface Word {
  id: string;           // 由 word 內容產生的穩定 ID,單字庫換版也不會跑掉
  word: string;         // 正確拼字答案
  meaning: string;       // 中文意思
  sentence: string;      // 出題例句
  root?: string;         // 字根(選填)
  rootMeaning?: string;  // 字根意思(選填)
  hint?: string;         // 記憶提示(選填)
  level?: string;        // 難度/分組標籤(選填)

  /**
   * 🔥 隨機排序鍵 (0 <= x < 1)。
   *
   * 用途：Firestore 隨機抽樣。
   *   查詢時用隨機起點 `where('random', '>=', r)` 做範圍查詢，
   *   避免每次都從字母序最前面開始抓同一批單字。
   *
   * 生成時機：AdminPanel 寫入 Firestore 時自動生成，
   *         老師的 CSV 不需要提供這個欄位。
   */
  random?: number;
}

// 學生單一單字的複習狀態,存在 Firestore,不放進 Excel
export interface ReviewState {
  reviewInterval: number;      // 天數
  easeFactor: number;          // SM-2 EF 值
  reviewCount: number;         // 錯誤次數(沿用 quiz.py 的語意:答對且連續3次才歸零)
  consecutiveCorrect: number;
  totalReviews: number;
  lastReviewed: string | null;     // ISO 字串,尚未複習過為 null
  nextReviewDate: string | null;
  everWrong?: boolean; // 是否曾被答錯過（決定是否進入複習池）
   /**
   * 自上次答錯以來連續答對的次數。
   *
   * 與 sm2.ts 的 `consecutiveCorrect` 不同：
   *   - `consecutiveCorrect` 在達成 MASTERY_STREAK（3）後歸零
   *   - `correctStreak` 只在答錯時歸零，用來判斷是否已「真正掌握」
   *
   * 當 correctStreak 達到 EVER_WRONG_CLEAR_THRESHOLD（5）時，
   * AnswerProcessor 會清除 everWrong，將該字移出複習池。
   */
  correctStreak?: number;
}

// 建立一個從未複習過的初始狀態,新單字第一次出現時使用
export function createInitialReviewState(): ReviewState {
  return {
    reviewInterval: 0,
    easeFactor: 2.5,
    reviewCount: 0,
    consecutiveCorrect: 0,
    totalReviews: 0,
    lastReviewed: null,
    nextReviewDate: null,
    correctStreak: 0,
  };
}