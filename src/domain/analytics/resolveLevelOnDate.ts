// src/domain/analytics/resolveLevelOnDate.ts
import type { LevelHistoryEntry } from '../../types/progression';
import { getLocalDateString } from '../date/timezone';

/**
 * 推導「某一天」學生所處的等級。
 *
 * 演算法：
 *   1. 過濾出所有「變更日期 <= 目標日期」的 levelHistory 條目
 *   2. 取最新的一筆（changedAt 最大）
 *   3. 若無任何條目，回傳 1（初始等級）
 *
 * 為什麼需要這個函式：
 *   dailySnapshots.level 在 2026-10-13 的回填時被錯填成「今天的等級」，
 *   導致成長曲線的等級線被抹平。改從 levelHistory 推導，就能還原
 *   每一天真實的等級。
 *
 * 為什麼用本地日期對齊：
 *   levelHistory.changedAt 是 UTC ISO 字串，snapshot.date 是本地
 *   YYYY-MM-DD。直接字串比對會在跨日邊界出錯（例如台北 00:30 的
 *   變更，UTC 還在昨天）。用 getLocalDateString 統一轉成本地日期
 *   再比對。
 *
 * @param date       目標日期（YYYY-MM-DD，本地時區）
 * @param levelHistory 等級變更歷史（可能為空）
 * @param timeZone   學生所屬時區（IANA 名稱，例如 'Asia/Taipei'）
 * @returns 學生在該日期所處的等級（L1~L6）
 */
export function resolveLevelOnDate(
    date: string,
    levelHistory: LevelHistoryEntry[],
    timeZone: string
): number {
    if (levelHistory.length === 0) return 1;

    const applicable = levelHistory.filter(h => {
        const t = new Date(h.changedAt).getTime();
        if (Number.isNaN(t)) return false;   // 跳過壞掉的條目，不要讓它污染推導
        const localDate = getLocalDateString(new Date(t), timeZone);
        if (!localDate) return false;        // 第二層保險
        return localDate <= date;
    });

    if (applicable.length === 0) return 1;

    const latest = applicable.reduce((a, b) =>
        new Date(a.changedAt).getTime() > new Date(b.changedAt).getTime() ? a : b
    );

    return latest.level;
}