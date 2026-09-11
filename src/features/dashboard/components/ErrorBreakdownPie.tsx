// src/features/dashboard/components/ErrorBreakdownPie.tsx
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { ErrorBreakdown } from '../../../types/analytics';

interface Props {
  breakdown: ErrorBreakdown;
}

// 改為包含 color 的物件陣列，避免使用 indexOf 反查
const CATEGORIES = [
  { key: 'spelling',        name: '拼字小錯',  color: '#ffc107' },
  { key: 'completelyWrong', name: '完全不會',  color: '#dc3545' },
  { key: 'timeout',         name: '超時未答',  color: '#6c757d' },
] as const;

export const ErrorBreakdownPie: React.FC<Props> = ({ breakdown }) => {
  const data = CATEGORIES
    .map(c => ({
      name: c.name,
      value: breakdown[c.key],
      color: c.color,
    }))
    .filter(d => d.value > 0);

  // 邊界情境：沒有任何錯誤
  if (data.length === 0) {
    return (
      <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h3 style={{ margin: '0 0 0.5rem 0' }}>❌ 錯誤類型分佈</h3>
        <p style={{ color: '#28a745', textAlign: 'center', padding: '2rem 0' }}>
          🎉 全部答對，沒有錯誤！
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <h3 style={{ margin: '0 0 0.5rem 0' }}>❌ 錯誤類型分佈</h3>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={({ name, value }) => `${name}: ${value}`}
            labelLine={false}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: '6px', border: '1px solid #dee2e6', fontSize: '0.9rem' }}
            formatter={(value) => [`${value} 題`, '']}
          />
          <Legend wrapperStyle={{ fontSize: '0.85rem' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};