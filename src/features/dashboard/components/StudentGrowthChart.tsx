// src/features/dashboard/components/StudentGrowthChart.tsx
import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { DailySnapshot } from '../../../types/dailySnapshot';
import type { LevelHistoryEntry } from '../../../types/progression';
import { getLocalDateString } from '../../../domain/date/timezone';

interface Props {
  snapshots: DailySnapshot[];
  /** 等級變更歷史。若無（例如舊 session 快取），fallback 到空陣列。 */
  levelHistory?: LevelHistoryEntry[];
  /** 學生所屬時區（IANA 名稱，例如 'Asia/Taipei'）。用於把 UTC 時間戳轉成本地日期。 */
  timeZone?: string;
}

const UNLOCK_THRESHOLD = 7;
const DEFAULT_TIME_ZONE = 'Asia/Taipei';

/**
 * 🔥 推導「某一天」學生所處的等級。
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
 */
function resolveLevelOnDate(
  date: string,
  levelHistory: LevelHistoryEntry[],
  timeZone: string
): number {
  if (levelHistory.length === 0) return 1;

  const applicable = levelHistory.filter(h => {
    const localDate = getLocalDateString(new Date(h.changedAt), timeZone);
    return localDate <= date;
  });

  if (applicable.length === 0) return 1;

  const latest = applicable.reduce((a, b) =>
    new Date(a.changedAt) > new Date(b.changedAt) ? a : b
  );

  return latest.level;
}

export const StudentGrowthChart: React.FC<Props> = ({
  snapshots,
  levelHistory = [],
  timeZone = DEFAULT_TIME_ZONE,
}) => {
  // 資料不足 → 顯示進度提示
  if (snapshots.length < UNLOCK_THRESHOLD) {
    const remaining = UNLOCK_THRESHOLD - snapshots.length;
    return (
      <div style={{
        background: 'white', padding: '1rem', borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      }}>
        <h3 style={{ margin: '0 0 0.5rem 0' }}>📈 個人化成長曲線</h3>
        <div style={{
          textAlign: 'center', padding: '2rem 1rem',
          background: '#f8f9fa', borderRadius: '6px',
        }}>
          <p style={{ fontSize: '1.2rem', margin: '0 0 0.5rem 0' }}>
            🔒 已累積 {snapshots.length} / {UNLOCK_THRESHOLD} 天
          </p>
          <p style={{ color: '#6c757d', margin: 0, fontSize: '0.9rem' }}>
            再練習 {remaining} 天即可解鎖成長曲線
          </p>
          <div style={{
            marginTop: '1rem', height: '8px', background: '#e9ecef',
            borderRadius: '4px', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${(snapshots.length / UNLOCK_THRESHOLD) * 100}%`,
              background: '#007bff', borderRadius: '4px',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      </div>
    );
  }

  // 🔥 等級從 levelHistory 推導，不再讀 snapshot.level
  const chartData = snapshots.map(s => ({
    date: s.date.slice(5), // 只顯示 MM-DD
    正確率: s.correctRate,
    等級: resolveLevelOnDate(s.date, levelHistory, timeZone),
  }));

  return (
    <div style={{
      background: 'white', padding: '1rem', borderRadius: '8px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    }}>
      <h3 style={{ margin: '0 0 0.5rem 0' }}>📈 個人化成長曲線</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f5" />
          <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#495057' }} />
          <YAxis
            yAxisId="left"
            domain={[0, 100]}
            tick={{ fontSize: 12, fill: '#007bff' }}
            label={{ value: '正確率 (%)', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#007bff' } }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 6]}
            tick={{ fontSize: 12, fill: '#28a745' }}
            label={{ value: '等級', angle: 90, position: 'insideRight', style: { fontSize: 12, fill: '#28a745' } }}
          />
          <Tooltip
            contentStyle={{ borderRadius: '6px', border: '1px solid #dee2e6', fontSize: '0.9rem' }}
          />
          <Legend wrapperStyle={{ fontSize: '0.85rem' }} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="正確率"
            stroke="#007bff"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            yAxisId="right"
            type="stepAfter"
            dataKey="等級"
            stroke="#28a745"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#6c757d', textAlign: 'center' }}>
        資料來源：每日快照 ＋ 等級變更歷史
      </p>
    </div>
  );
};