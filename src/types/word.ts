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
  };
}
