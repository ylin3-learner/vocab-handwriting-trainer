// src/features/dashboard/components/LearningStyleRadar.tsx
import React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { RadarMetrics } from '../../../domain/analytics/radarMetrics';

interface Props {
  metrics: RadarMetrics;
}

const PASS_LINE = 60; // 及格線基準

export const LearningStyleRadar: React.FC<Props> = ({ metrics }) => {
  const data = [
    { subject: '準確度',   value: metrics.accuracy,    reference: PASS_LINE, fullMark: 100 },
    { subject: '速度',     value: metrics.speed,       reference: PASS_LINE, fullMark: 100 },
    { subject: '拼字精準', value: metrics.spelling,    reference: PASS_LINE, fullMark: 100 },
    { subject: '抗壓性',   value: metrics.stress,      reference: PASS_LINE, fullMark: 100 },
    { subject: '穩定度',   value: metrics.consistency, reference: PASS_LINE, fullMark: 100 },
  ];

  return (
    <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <h3 style={{ margin: '0 0 0.5rem 0' }}>🎯 學習風格雷達圖</h3>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data}>
          <PolarGrid stroke="#dee2e6" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 13, fill: '#495057' }} />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tickCount={6}
            tick={{ fontSize: 10, fill: '#adb5bd' }}
          />
          {/* 及格參考線（灰色虛線） */}
          <Radar
            name={`及格線 (${PASS_LINE})`}
            dataKey="reference"
            stroke="#adb5bd"
            fill="#adb5bd"
            fillOpacity={0.05}
            strokeDasharray="4 4"
            strokeWidth={1.5}
          />
          {/* 學生表現 */}
          <Radar
            name="學生表現"
            dataKey="value"
            stroke="#007bff"
            fill="#007bff"
            fillOpacity={0.4}
          />
          <Tooltip
            contentStyle={{ borderRadius: '6px', border: '1px solid #dee2e6', fontSize: '0.9rem' }}
            formatter={(value) => [`${value} 分`, '']}
          />
          <Legend wrapperStyle={{ fontSize: '0.85rem' }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};