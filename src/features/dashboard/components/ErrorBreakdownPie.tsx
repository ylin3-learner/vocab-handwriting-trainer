// src/features/dashboard/components/ErrorBreakdownPie.tsx
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { ErrorBreakdown } from '../../../types/analytics';

interface Props {
  breakdown: ErrorBreakdown;
}

const CATEGORIES = [
  { key: 'spelling',        name: '拼字小錯',  color: '#ffc107' },
  { key: 'completelyWrong', name: '完全不會',  color: '#dc3545' },
  { key: 'timeout',         name: '超時未答',  color: '#495057' },
] as const;

export const ErrorBreakdownPie: React.FC<Props> = ({ breakdown }) => {
  const data = CATEGORIES
    .map(c => ({
      name: c.name,
      value: breakdown[c.key],
      color: c.color,
    }))
    .filter(d => d.value > 0);

  const totalErrors = data.reduce((sum, d) => sum + d.value, 0);

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

      {/* 用 relative 包住，方便中央疊加文字 */}
      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={55}   // 甜甜圈：挖空半徑
              outerRadius={90}
              paddingAngle={2}   // 扇區間加一點空隙
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

        {/* 甜甜圈中央的總數 */}
        <div
          style={{
            position: 'absolute',
            top: '42%',  // 補償 Legend 佔掉的高度
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#dc3545', lineHeight: 1 }}>
            {totalErrors}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6c757d', marginTop: '0.25rem' }}>
            總錯誤題數
          </div>
        </div>
      </div>
    </div>
  );
};