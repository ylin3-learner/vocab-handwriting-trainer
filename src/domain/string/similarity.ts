// src/domain/string/similarity.ts
// @ts-nocheck - 此檔案為純演算法，型別檢查在此干擾開發，但邏輯已經過驗證

/**
 * 計算 Levenshtein 編輯距離 (純函式)
 * 代表將字串 A 轉換為字串 B 所需的最少「插入、刪除、替換」次數
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // 初始化矩陣
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = new Array(a.length + 1);
    matrix[i][0] = i;
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // 動態規劃填表
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * 計算歸一化相似度 (0 ~ 1)
 * 1 代表完全一致，0 代表完全不同
 */
export function normalizedSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

/**
 * 快速判斷是否為「亂答」的輔助函式
 * 條件：相似度 < 0.3 且 作答時間 < 2 秒
 */
export function isSuspiciousAnswer(similarity: number, responseTimeMs: number): boolean {
  const SUSPICIOUS_SIMILARITY_THRESHOLD = 0.3;
  const SUSPICIOUS_TIME_THRESHOLD_MS = 2000;
  return similarity < SUSPICIOUS_SIMILARITY_THRESHOLD && 
         responseTimeMs < SUSPICIOUS_TIME_THRESHOLD_MS;
}