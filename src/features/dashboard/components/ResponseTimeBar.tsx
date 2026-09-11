// src/features/dashboard/components/ResponseTimeBar.tsx
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { ResponseTimeDistribution } from '../../../types/analytics';

interface Props {
  distribution: ResponseTimeDistribution;
}

const COLORS = ['#28a745', '#ffc107', '#dc3545'];

export const ResponseTimeBar: React.FC<Props> = ({ distribution }) => {
  const data = [
    { name: '快 (<3s)', value: distribution.fast },
    { name: '正常 (3~8s)', value: distribution.normal },
    { name: '慢 (>8s)', value: distribution.slow },
  ];

  return (
    <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <h3 style={{ margin: '0 0 0.5rem 0' }}>⏱️ 反應時間分佈</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f5" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#495057' }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#adb5bd' }} />
          <Tooltip
            contentStyle={{ borderRadius: '6px', border: '1px solid #dee2e6', fontSize: '0.9rem' }}
            formatter={(value) => [`${value} 題`, '']}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((_, index) => (
              <Cell key={index} fill={COLORS[index]!} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};