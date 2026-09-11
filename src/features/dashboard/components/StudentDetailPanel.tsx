// src/features/dashboard/components/StudentDetailPanel.tsx
import React, { useMemo, useRef, useState } from 'react';
import { StudentAnalytics, LearningStyle } from '../../../types/analytics';
import { calculateRadarMetrics } from '../../../domain/analytics/radarMetrics';
import { LearningStyleRadar } from './LearningStyleRadar';
import { ErrorBreakdownPie } from './ErrorBreakdownPie';
import { ResponseTimeBar } from './ResponseTimeBar';
import { WeakWordsTable } from './WeakWordsTable';
import { generateStudentReportPdf } from '../../../services/export/studentReportPdf';
import { useAuth } from '../../../contexts/AuthContext';

interface Props {
  analytics: StudentAnalytics;
  isArchived?: boolean;
  onArchiveToggle?: (
    displayId: string,
    studentName: string,
    className: string,
    isCurrentlyArchived: boolean,
    archivedBy: string
  ) => Promise<void>;
}

const LEARNING_STYLE_LABELS: Record<LearningStyle, { text: string; color: string; emoji: string }> = {
  'fast-accurate': { text: '快又準', color: '#28a745', emoji: '🚀' },
  'slow-accurate': { text: '慢但準', color: '#17a2b8', emoji: '🐢' },
  'fast-inaccurate': { text: '快但錯', color: '#ffc107', emoji: '⚡' },
  'slow-inaccurate': { text: '慢又錯', color: '#dc3545', emoji: '⚠️' },
  'insufficient-data': { text: '樣本不足', color: '#6c757d', emoji: '📊' },
};

export const StudentDetailPanel: React.FC<Props> = ({
  analytics,
  isArchived = false,
  onArchiveToggle,
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const { user } = useAuth();

  const radarMetrics = useMemo(() => calculateRadarMetrics(analytics), [analytics]);
  const styleInfo = LEARNING_STYLE_LABELS[analytics.learningStyle];

  const handleExportPdf = async () => {
    if (!reportRef.current) return;
    setIsExporting(true);
    try {
      await generateStudentReportPdf(reportRef.current, analytics);
    } catch (e) {
      console.error('❌ PDF 匯出失敗:', e);
      alert('匯出失敗，請稍後再試');
    } finally {
      setIsExporting(false);
    }
  };

  const handleArchiveClick = async () => {
    if (!onArchiveToggle) return;

    const action = isArchived ? '取消歸檔' : '歸檔';
    const message = isArchived
      ? `確定要把「${analytics.name}」從歸檔中恢復嗎？\n他將會重新出現在學生列表中。`
      : `確定要歸檔「${analytics.name}」嗎？\n歸檔後他會從學生列表隱藏，但資料不會被刪除。`;

    if (!window.confirm(message)) return;

    setIsArchiving(true);
    try {
      await onArchiveToggle(
        analytics.studentId,
        analytics.name,
        analytics.className,
        isArchived,
        user?.email ?? user?.uid ?? 'unknown'
      );
      console.log(`✅ 已${action}「${analytics.name}」`);
    } catch (e) {
      console.error(`❌ ${action}失敗:`, e);
      alert(`${action}失敗，請稍後再試`);
    } finally {
      setIsArchiving(false);
    }
  };

  if (analytics.totalAttempts === 0) {
    return (
      <div style={{ background: '#f8f9fa', padding: '3rem', borderRadius: '8px', textAlign: 'center' }}>
        <h2 style={{ color: '#6c757d' }}>📭 尚無練習紀錄</h2>
        <p style={{ color: '#adb5bd' }}>此學生還沒有任何作答資料。</p>
      </div>
    );
  }

  return (
    <div>
      {/* ===== 按鈕列：歸檔 + 匯出 PDF ===== */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {onArchiveToggle && (
          <button
            onClick={handleArchiveClick}
            disabled={isArchiving}
            style={{
              padding: '0.5rem 1.25rem',
              background: isArchiving ? '#adb5bd' : isArchived ? '#17a2b8' : '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isArchiving ? 'default' : 'pointer',
              fontSize: '0.9rem',
              fontWeight: 'bold',
            }}
          >
            {isArchiving
              ? '⏳ 處理中...'
              : isArchived
                ? '📤 取消歸檔'
                : '📦 歸檔此學生'}
          </button>
        )}

        <button
          onClick={handleExportPdf}
          disabled={isExporting}
          style={{
            padding: '0.5rem 1.25rem',
            background: isExporting ? '#6c757d' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: isExporting ? 'default' : 'pointer',
            fontSize: '0.9rem',
            fontWeight: 'bold',
          }}
        >
          {isExporting ? '⏳ 產生 PDF 中...' : '📥 匯出 PDF 報告'}
        </button>
      </div>

      {/* 若已歸檔，顯示提示橫幅 */}
      {isArchived && (
        <div style={{
          background: '#fff3cd',
          border: '1px solid #ffeeba',
          borderRadius: '6px',
          padding: '0.5rem 1rem',
          marginBottom: '0.75rem',
          fontSize: '0.85rem',
          color: '#856404',
        }}>
          📦 此學生已被歸檔，目前從學生列表中隱藏。
        </div>
      )}

      {/* ===== 截圖區域 ===== */}
      <div
        ref={reportRef}
        style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        {/* 列印用標題 */}
        <div style={{
          textAlign: 'center',
          borderBottom: '3px solid #007bff',
          paddingBottom: '0.75rem',
          marginBottom: '1rem',
        }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#212529' }}>
            📊 學生個人化學習診斷報告
          </h1>
          <p style={{ margin: '0.5rem 0 0 0', color: '#6c757d', fontSize: '0.85rem' }}>
            產出時間：{new Date().toLocaleString('zh-TW')}
          </p>
        </div>

        {/* 學生摘要 */}
        <div style={{
          background: '#f8f9fa',
          padding: '1rem',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
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
            fontSize: '0.9rem',
          }}>
            {styleInfo.emoji} {styleInfo.text}
          </div>
        </div>

        {/* 圖表 2x2 網格 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <LearningStyleRadar metrics={radarMetrics} />
          <ErrorBreakdownPie breakdown={analytics.errorBreakdown} />
          <ResponseTimeBar distribution={analytics.responseTimeDistribution} />
          <WeakWordsTable words={analytics.weakestWords} />
        </div>

        {/* 列印用頁尾 */}
        <div style={{
          marginTop: '1.5rem',
          paddingTop: '1rem',
          borderTop: '1px dashed #adb5bd',
          fontFamily: '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif',
        }}>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.9rem', color: '#495057', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              ✏️ 老師建議：
            </div>
            {[1, 2, 3].map(i => (
              <div
                key={i}
                style={{
                  borderBottom: '1px solid #adb5bd',
                  height: '1.8rem',
                  marginBottom: '0.5rem',
                  lineHeight: '1.8rem',
                  color: '#ffffff',
                  fontSize: '0.1rem',
                }}
              >
                &nbsp;
              </div>
            ))}
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.85rem',
            color: '#495057',
            marginTop: '1rem',
          }}>
            <span>導師簽名：_____________________</span>
            <span>家長簽名：_____________________</span>
          </div>
        </div>
      </div>
    </div>
  );
};