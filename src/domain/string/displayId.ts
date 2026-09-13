// src/domain/string/displayId.ts

/**
 * 建構學生的複合識別碼（displayId）。
 *
 * 格式：`{className}_{seatNumber}_{studentName}`
 * 例如：`709_1_林佑綸`
 *
 * 為什麼需要這個？
 *   Firebase 匿名登入每次產生新 UID，若用 uid 當 key，
 *   學生換裝置或重新登入就會遺失學習狀態。
 *   用 displayId 才能跨 UID 持續追蹤同一位學生。
 *
 * @param className 班級（例如 "709"）
 * @param seatNumber 座號（例如 "1"）
 * @param studentName 姓名（例如 "林佑綸"）
 * @param fallback 當任一欄位缺失時的 fallback（通常是 uid）
 */
export function buildDisplayId(
  className: string | undefined | null,
  seatNumber: string | undefined | null,
  studentName: string | undefined | null,
  fallback: string
): string {
  if (className && seatNumber && studentName) {
    return `${className}_${seatNumber}_${studentName}`;
  }
  return fallback;
}