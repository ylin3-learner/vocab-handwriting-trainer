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
            <th style={{ padding: '8px', borderBottom: '2px solid #dee2e6', width: '40px' }}>#</th>
            <th style={{ padding: '8px', borderBottom: '2px solid #dee2e6' }}>單字</th>
            <th style={{ padding: '8px', borderBottom: '2px solid #dee2e6' }}>錯誤率</th>
            <th style={{ padding: '8px', borderBottom: '2px solid #dee2e6', textAlign: 'right' }}>平均反應</th>
          </tr>
        </thead>
        <tbody>
          {words.map((w, idx) => {
            const errorRate = w.totalAttempts > 0
              ? Math.round((w.wrongCount / w.totalAttempts) * 100)
              : 0;
            const isSlow = w.avgResponseTimeMs > 8000;

            return (
              <tr key={w.wordId} style={{ borderBottom: '1px solid #f1f3f5' }}>
                <td style={{ padding: '8px', fontWeight: 'bold', color: '#6c757d' }}>#{idx + 1}</td>
                <td style={{ padding: '8px' }}>
                  <span style={{
                    background: '#e9ecef',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}>
                    {w.word}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>
                  {/* 🔥 錯誤率 + 視覺化 bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{
                      flex: 1,
                      height: '6px',
                      background: '#f1f3f5',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      maxWidth: '80px',
                    }}>
                      <div style={{
                        width: `${errorRate}%`,
                        height: '100%',
                        background: errorRate >= 80 ? '#dc3545' : errorRate >= 50 ? '#ffc107' : '#28a745',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <span style={{
                      fontWeight: 'bold',
                      fontSize: '0.85rem',
                      color: errorRate >= 80 ? '#dc3545' : errorRate >= 50 ? '#856404' : '#28a745',
                      minWidth: '40px',
                    }}>
                      {errorRate}%
                    </span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#adb5bd', marginTop: '2px' }}>
                    錯 {w.wrongCount} / 共 {w.totalAttempts}
                  </div>
                </td>
                <td style={{
                  padding: '8px',
                  textAlign: 'right',
                  color: isSlow ? '#dc3545' : '#495057',
                  fontWeight: isSlow ? 'bold' : 'normal',
                }}>
                  {(w.avgResponseTimeMs / 1000).toFixed(1)}s
                  {isSlow && <span style={{ fontSize: '0.7rem', marginLeft: '4px' }}>⚠️</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};