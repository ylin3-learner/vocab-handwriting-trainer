// src/features/dashboard/components/StudentGrowthChart.tsx
import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { DailySnapshot } from '../../../types/dailySnapshot';

interface Props {
  snapshots: DailySnapshot[];
}

const UNLOCK_THRESHOLD = 7;

export const StudentGrowthChart: React.FC<Props> = ({ snapshots }) => {
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

  // 資料足夠 → 顯示雙軸折線圖
  const chartData = snapshots.map(s => ({
    date: s.date.slice(5), // 只顯示 MM-DD
    正確率: s.correctRate,
    等級: s.level,
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
        資料來源：每日首次練習時自動記錄
      </p>
    </div>
  );
};