// src/features/dashboard/components/StudentDetailPanel.tsx
import React, { useMemo } from 'react';
import { StudentAnalytics, LearningStyle } from '../../../types/analytics';
import { calculateRadarMetrics } from '../../../domain/analytics/radarMetrics';
import { LearningStyleRadar } from './LearningStyleRadar';
import { ErrorBreakdownPie } from './ErrorBreakdownPie';
import { ResponseTimeBar } from './ResponseTimeBar';
import { WeakWordsTable } from './WeakWordsTable';

interface Props {
  analytics: StudentAnalytics;
}

const LEARNING_STYLE_LABELS: Record<LearningStyle, { text: string; color: string; emoji: string }> = {
  'fast-accurate':    { text: '快又準',   color: '#28a745', emoji: '🚀' },
  'slow-accurate':    { text: '慢但準',   color: '#17a2b8', emoji: '🐢' },
  'fast-inaccurate':  { text: '快但錯',   color: '#ffc107', emoji: '⚡' },
  'slow-inaccurate':  { text: '慢又錯',   color: '#dc3545', emoji: '⚠️' },
  'insufficient-data':{ text: '樣本不足', color: '#6c757d', emoji: '📊' },
};

export const StudentDetailPanel: React.FC<Props> = ({ analytics }) => {
  // 用 useMemo 避免每次 render 重新計算
  const radarMetrics = useMemo(() => calculateRadarMetrics(analytics), [analytics]);

  const styleInfo = LEARNING_STYLE_LABELS[analytics.learningStyle];

  // 邊界情境：完全沒有作答紀錄
  if (analytics.totalAttempts === 0) {
    return (
      <div style={{ background: '#f8f9fa', padding: '3rem', borderRadius: '8px', textAlign: 'center' }}>
        <h2 style={{ color: '#6c757d' }}>📭 尚無練習紀錄</h2>
        <p style={{ color: '#adb5bd' }}>此學生還沒有任何作答資料。</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 頂部摘要 */}
      <div style={{
        background: 'white',
        padding: '1rem',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}>
        <div>
          <h2 style={{ margin: 0 }}>
            {analytics.name}
            <span style={{ fontSize: '0.9rem', color: '#6c757d', marginLeft: '0.5rem' }}>
              ({analytics.className})
            </span>
          </h2>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#6c757d' }}>
            共 {analytics.totalAttempts} 題，答對 {analytics.correctCount} 題，
            平均 {(analytics.avgResponseTimeMs / 1000).toFixed(1)} 秒
          </p>
        </div>
        <div style={{
          background: styleInfo.color,
          color: 'white',
          padding: '0.5rem 1rem',
          borderRadius: '20px',
          fontWeight: 'bold',
        }}>
          {styleInfo.emoji} {styleInfo.text}
        </div>
      </div>

      {/* 圖表區：2x2 網格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <LearningStyleRadar metrics={radarMetrics} />
        <ErrorBreakdownPie breakdown={analytics.errorBreakdown} />
        <ResponseTimeBar distribution={analytics.responseTimeDistribution} />
        <WeakWordsTable words={analytics.weakestWords} />
      </div>
    </div>
  );
};