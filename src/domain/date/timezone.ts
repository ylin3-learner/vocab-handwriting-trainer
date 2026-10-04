// src/domain/date/timezone.ts

/**
 * 時區工具。
 *
 * 核心原則：
 *   - 所有 timestamp 都以 UTC 儲存（Firestore 原生行為）
 *   - 只在需要「日期」時，轉換為使用者的本地時區
 *   - 使用 IANA 時區名稱（如 'Asia/Taipei'），而非數字 offset
 *     因為 offset 無法正確處理夏令時（DST）
 */

/** 系統預設時區（用於尚未偵測到使用者時區時的 fallback） */
export const DEFAULT_TIME_ZONE = 'Asia/Taipei';

/**
 * 偵測瀏覽器當前時區。
 *
 * 回傳 IANA 時區名稱（例如 'Asia/Taipei'、'America/New_York'）。
 * 若偵測失敗，回退到 DEFAULT_TIME_ZONE。
 *
 * 為什麼用 Intl.DateTimeFormat：
 *   - 瀏覽器原生支援，無外部依賴
 *   - 回傳 IANA 名稱，包含夏令時資訊
 *   - Chrome 24+ / Safari 10+ / Firefox 29+ 都支援
 */
export function detectTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * 將 Date 轉為指定時區的 YYYY-MM-DD 字串。
 *
 * @param date      任意 Date 物件
 * @param timeZone  IANA 時區名稱，預設為 DEFAULT_TIME_ZONE
 *
 * 為什麼不用 toISOString().slice(0, 10)：
 *   那個方法回傳 UTC 日期。對台北使用者來說，
 *   UTC 16:00 之後的作答會被錯誤地歸到前一日。
 *
 * 為什麼用 Intl.DateTimeFormat 而非手動 +8 小時：
 *   手動 offset 無法正確處理夏令時（DST）。
 *   例如美國東岸夏天是 UTC-4、冬天是 UTC-5。
 *   Intl 會自動處理。
 */
export function getLocalDateString(
  date: Date,
  timeZone: string = DEFAULT_TIME_ZONE
): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA 格式為 YYYY-MM-DD
    return formatter.format(date);
  } catch {
    // 時區名稱無效時的 fallback
    const fallback = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    return fallback.toISOString().slice(0, 10);
  }
}

/**
 * 將 ISO 字串轉為指定時區的 YYYY-MM-DD 字串。
 *
 * 便利函式，用於顯示場景。
 */
export function getLocalDateStringFromISO(
  isoString: string,
  timeZone: string = DEFAULT_TIME_ZONE
): string {
  return getLocalDateString(new Date(isoString), timeZone);
}

/**
 * 將 ISO 字串轉為指定時區的友善顯示（YYYY/M/D）。
 *
 * 用於 StudentDetailPanel 的「最後練習」等欄位。
 */
export function formatLocalDate(
  isoString: string,
  timeZone: string = DEFAULT_TIME_ZONE
): string {
  try {
    const date = new Date(isoString);
    const formatter = new Intl.DateTimeFormat('zh-TW', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    return formatter.format(date);
  } catch {
    return new Date(isoString).toLocaleDateString('zh-TW');
  }
}