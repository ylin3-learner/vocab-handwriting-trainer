// domain/grading/grader.ts
// 唯一負責任判定「這題算不算對、SM-2 該給幾分」
// 不接受任何使用者自評輸入,quality 完全由客觀訊號(拼字是否精準、有沒有超時)算出

import { CorrectnessSignal, classifyCorrectness } from './correctnessSignal';

export interface GradingInput {
  recognizedText: string;
  correctAnswer: string;
  elapsedMs: number;
  timeLimitMs: number;
  timedOut: boolean;
}

export interface GradingResult {
  isCorrect: boolean;
  quality: number; // 0-5,交給 sm2.ts 使用
  recognizedText: string;
  correctnessSignal: CorrectnessSignal;  // 🔥 新增
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function isExactMatch(recognizedText: string, correctAnswer: string): boolean {
  return normalize(recognizedText) === normalize(correctAnswer);
}

export function calculateQuality(
  isCorrect: boolean,
  elapsedMs: number,
  timeLimitMs: number,
  timedOut: boolean
): number {
  if (timedOut || !isCorrect) {
    return 0;
  }
  // 答對的情況下,依剩餘時間比例給分:反應越快分數越高
  // 全部時間都用完但險勝 → quality 3(SM-2 門檻,>=3 才算「有記住」)
  // 幾乎立刻寫完 → quality 5
  const timeRatio = Math.min(elapsedMs / Math.max(timeLimitMs, 1), 1);
  const quality = 5 - Math.floor(timeRatio * 2); // 5 → 3 的階梯衰減,用 floor 避免快速作答被誤扣分
  return Math.max(3, Math.min(5, quality));
}

/**
 * 客觀判分。
 *
 * 🔥 設計原則：
 *   - matched 只計算一次（DRY）
 *   - isCorrect 從 correctnessSignal 派生（SSOT）
 *   - 兩種視圖都回傳：isCorrect（SM-2 用）與 correctnessSignal（ML 用）
 */
export function gradeAnswer(input: GradingInput): GradingResult {
  const { recognizedText, correctAnswer, elapsedMs, timeLimitMs, timedOut } = input;

  // 🔥 計算兩件事實，然後只算一次
  const matched = isExactMatch(recognizedText, correctAnswer);
  const correctnessSignal = classifyCorrectness(matched, timedOut);

  // 🔥 isCorrect 從訊號派生（唯一真實來源）
  const isCorrect = correctnessSignal === 'true-positive';

  const quality = calculateQuality(isCorrect, elapsedMs, timeLimitMs, timedOut);

  return {
    isCorrect,
    quality,
    recognizedText,
    correctnessSignal,
  };
}
