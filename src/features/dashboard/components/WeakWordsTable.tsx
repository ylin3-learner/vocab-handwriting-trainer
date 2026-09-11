// src/features/dashboard/components/WeakWordsTable.tsx
import React from 'react';
import { WeakWordDetail } from '../../../types/analytics';

interface Props {
  words: WeakWordDetail[];
}

export const WeakWordsTable: React.FC<Props> = ({ words }) => {
  if (words.length === 0) {
    return (
      <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h3 style={{ margin: '0 0 0.5rem 0' }}>🔥 弱點單字 Top 5</h3>
        <p style={{ color: '#28a745', textAlign: 'center', padding: '2rem 0' }}>
          🎉 沒有弱點單字！
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <h3 style={{ margin: '0 0 0.5rem 0' }}>🔥 弱點單字 Top 5</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ background: '#f8f9fa', textAlign: 'left' }}>
            <th style={{ padding: '8px', borderBottom: '2px solid #dee2e6' }}>#</th>
            <th style={{ padding: '8px', borderBottom: '2px solid #dee2e6' }}>單字</th>
            <th style={{ padding: '8px', borderBottom: '2px solid #dee2e6', textAlign: 'center' }}>錯誤次數</th>
            <th style={{ padding: '8px', borderBottom: '2px solid #dee2e6', textAlign: 'right' }}>平均反應時間</th>
          </tr>
        </thead>
        <tbody>
          {words.map((w, idx) => (
            <tr key={w.wordId} style={{ borderBottom: '1px solid #f1f3f5' }}>
              <td style={{ padding: '8px', fontWeight: 'bold', color: '#6c757d' }}>#{idx + 1}</td>
              <td style={{ padding: '8px' }}>
                <span style={{ background: '#e9ecef', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                  {w.word}
                </span>
              </td>
              <td style={{ padding: '8px', textAlign: 'center', color: '#dc3545', fontWeight: 'bold' }}>
                {w.wrongCount} / {w.totalAttempts}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', color: w.avgResponseTimeMs > 8000 ? '#dc3545' : '#495057' }}>
                {(w.avgResponseTimeMs / 1000).toFixed(1)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};