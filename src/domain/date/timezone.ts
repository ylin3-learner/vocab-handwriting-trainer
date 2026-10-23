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
 * 取得指定時區「當天 00:00:00」對應的 UTC 時間。
 * 用於 Firestore 查詢（需要傳入 UTC ISO 字串）。
 */
export function getStartOfDayUTC(date: Date, timeZone: string): Date {
  try {
    const dateStr = getLocalDateString(date, timeZone);
    const midnightUTC = new Date(`${dateStr}T00:00:00Z`);
    
    // 透過 Intl 取得該時間點在該時區的 offset
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    });
    
    const parts = formatter.formatToParts(midnightUTC);
    const getPart = (type: string) => Number(parts.find(p => p.type === type)?.value || 0);
    
    const tzDate = new Date(Date.UTC(
      getPart('year'),
      getPart('month') - 1,
      getPart('day'),
      getPart('hour'),
      getPart('minute'),
      getPart('second')
    ));
    
    const offset = tzDate.getTime() - midnightUTC.getTime();
    return new Date(midnightUTC.getTime() - offset);
  } catch {
    // 如果時區無效，直接回退到 UTC 當天 00:00:00
    const dateStr = date.toISOString().slice(0, 10);
    return new Date(`${dateStr}T00:00:00Z`);
  }
}

/**
 * 將 Date 轉為指定時區的 YYYY-MM-DD 字串。
 */
export function getLocalDateString(
  date: Date,
  timeZone: string = DEFAULT_TIME_ZONE
): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return ''; 
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch (e) {
    // 🔥 修正：拔除硬編碼 +8，改為回退到預設時區，若預設時區也失敗則回退到 UTC
    try {
      const fallbackFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: DEFAULT_TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      return fallbackFormatter.format(date);
    } catch {
      return date.toISOString().slice(0, 10);
    }
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