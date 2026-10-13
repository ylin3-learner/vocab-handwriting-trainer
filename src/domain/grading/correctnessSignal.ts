// src/domain/grading/correctnessSignal.ts

/**
 * 作答結果的語意訊號。
 *
 * 職責：把「辨識結果是否匹配」與「是否超時」兩個正交事實，
 *      分類成四種語意象限，供訓練資料分流、UI 顯示、與分析使用。
 *
 * 🔥 為什麼不直接用 isCorrect？
 *   isCorrect 把兩個獨立訊號混在一起：
 *     isCorrect = !timedOut && matched
 *                ↑              ↑
 *             時間訊號      辨識訊號
 *
 *   當我們拿 isCorrect 當訓練標籤時，「寫對但超時」的高品質手寫
 *   樣本會被標成負樣本，污染訓練集。
 *
 *   分離的好處：
 *     - 訓練手寫辨識模型：用 matched 而非 isCorrect
 *     - 訓練速度預測模型：用 timedOut 而非 isCorrect
 *     - SM-2 排程：用 isCorrect（比賽規則：超時算錯）
 *
 * 命名依據（分類學的標準術語）：
 *   - true-positive：  真陽性，寫對且沒超時
 *   - false-negative： 偽陰性，寫對但超時
 *   - true-negative：  真陰性，寫錯且沒超時
 *   - compound-error： 複合錯誤，寫錯且超時
 */
export type CorrectnessSignal =
  | 'true-positive'
  | 'false-negative'
  | 'true-negative'
  | 'compound-error';

/**
 * 純函式：把兩個事實分類成四象限。
 *
 * @param matched 辨識結果是否匹配正確答案
 * @param timedOut 是否超時
 */
export function classifyCorrectness(
  matched: boolean,
  timedOut: boolean
): CorrectnessSignal {
  if (matched && !timedOut) return 'true-positive';
  if (matched && timedOut) return 'false-negative';
  if (!matched && !timedOut) return 'true-negative';
  return 'compound-error';
}

/**
 * 反向查詢：給定訊號，判斷是否匹配正確答案。
 *
 * 用於：當只需 matched 訊號，但不需重新計算 editDistance 時。
 * 注意：這假設訊號是可信的。若訊號可能缺失，請直接計算 matched。
 */
export function isMatched(signal: CorrectnessSignal): boolean {
  return signal === 'true-positive' || signal === 'false-negative';
}

/**
 * 反向查詢：給定訊號，判斷是否超時。
 */
export function isTimedOut(signal: CorrectnessSignal): boolean {
  return signal === 'false-negative' || signal === 'compound-error';
}