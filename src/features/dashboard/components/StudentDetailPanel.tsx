// src/features/dashboard/components/StudentDetailPanel.tsx
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { StudentAnalytics, LearningStyle } from '../../../types/analytics';
import { calculateRadarMetrics } from '../../../domain/analytics/radarMetrics';
import { LearningStyleRadar } from './LearningStyleRadar';
import { ErrorBreakdownPie } from './ErrorBreakdownPie';
import { ResponseTimeBar } from './ResponseTimeBar';
import { WeakWordsTable } from './WeakWordsTable';
import { StudentGrowthChart } from './StudentGrowthChart';
import { generateStudentReportPdf } from '../../../services/export/studentReportPdf';
import { useAuth } from '../../../contexts/AuthContext';
import { StudentStateService } from '../../../services/progression/StudentStateService';
import { formatLocalDate, getLocalDateString, DEFAULT_TIME_ZONE } from '../../../domain/date/timezone';

// ============================================================
// 🔥 Spinner 動畫
//
// React 沒有內建 keyframes 的機制，所以用 <style> 標籤注入。
// 為什麼不用 CSS-in-JS 庫：這個專案沒有引入 styled-components
// 或 emotion，用純 CSS 最輕量。
// ============================================================
const SPINNER_KEYFRAMES = `
@keyframes spin {
  to { transform: rotate(360deg); }
}
`;

// 在 StudentDetailPanel 的 return 之前，注入到 DOM：
// <style>{SPINNER_KEYFRAMES}</style>

interface Props {
  analytics: StudentAnalytics;

  // ============================================================
  // 🔥 累積統計（來自 classStats）
  //
  // 為什麼獨立傳入：
  //   analytics.totalAttempts / correctCount 是「最近 100 筆」的窗口統計
  //   （AnalyticsService 為了效能只撈最近 100 筆）。
  //   對老師來說，「累積練習量」比「窗口內題數」更有意義——可以用來鼓勵學生。
  //
  //   若未提供（例如 fallback 情境），則顯示 analytics 的窗口值，
  //   並加上「（最近）」標籤提示語意不同。
  // ============================================================
  cumulativeTotalAttempts?: number;
  cumulativeCorrectCount?: number;

  isArchived?: boolean;
  onArchiveToggle?: (
    displayId: string,
    studentName: string,
    className: string,
    isCurrentlyArchived: boolean,
    archivedBy: string
  ) => Promise<void>;
  /** 手動觸發重新抓取。 */
  onRefetch?: () => void;
  /** 手動重新整理中。用於顯示按鈕的 spinner。 */
  isRefreshing?: boolean;
  /**
   * 🔥 前端最後一次「從 server 成功讀取」此學生的時間（毫秒 timestamp）。
   *
   * 用途：判斷資料新鮮度。
   *   - dataSource === 'server'：資料保證最新，無需警告
   *   - dataSource === 'cache' 且此值 < 30 分鐘：資料可能是新的，無警告
   *   - dataSource === 'cache' 且此值 ≥ 30 分鐘或未知：顯示過期警告
   */
  lastServerFetchedAt?: number | null;
}

const LEARNING_STYLE_LABELS: Record<LearningStyle, { text: string; color: string; emoji: string }> = {
  'fast-accurate': { text: '快又準', color: '#28a745', emoji: '🚀' },
  'slow-accurate': { text: '慢但準', color: '#17a2b8', emoji: '🐢' },
  'fast-inaccurate': { text: '快但錯', color: '#ffc107', emoji: '⚡' },
  'slow-inaccurate': { text: '慢又錯', color: '#dc3545', emoji: '⚠️' },
  'insufficient-data': { text: '樣本不足', color: '#6c757d', emoji: '📊' },
};

function getEngagementStatus(analytics: StudentAnalytics): {
  label: string;
  color: string;
  bgColor: string;
} {
  const tz = analytics.timeZone ?? DEFAULT_TIME_ZONE;
  const today = getLocalDateString(new Date(), tz);
  const lastDate = analytics.lastAttemptAt
    ? getLocalDateString(new Date(analytics.lastAttemptAt), tz)
    : undefined;

  if (lastDate === today) {
    return { label: '✅ 今天有練', color: '#155724', bgColor: '#d4edda' };
  }
  if (analytics.activeDaysLast7 >= 5) {
    return { label: '📈 穩定練習', color: '#0c5460', bgColor: '#d1ecf1' };
  }
  if (analytics.activeDaysLast7 >= 2) {
    return { label: '📊 偶爾練習', color: '#856404', bgColor: '#fff3cd' };
  }
  if (analytics.activeDaysLast7 >= 1) {
    return { label: '⚠️ 很少練習', color: '#721c24', bgColor: '#f8d7da' };
  }
  return { label: '❌ 7 天未練', color: '#721c24', bgColor: '#f8d7da' };
}

function getLevelBadgeColor(level: number): string {
  if (level >= 5) return '#28a745';
  if (level >= 3) return '#17a2b8';
  if (level >= 2) return '#ffc107';
  return '#6c757d';
}

// ============================================================
// 🔥 資料新鮮度判斷（重構版）
//
// 舊版：基於 lastFetchedAt（前端呼叫時間）→ 永遠顯示「剛剛」
// 新版：基於「資料來源」+「最後一次 server 同步時間」
//
// 語意：
//   - dataSource === 'server'：資料保證最新 → 綠色「即時」
//   - dataSource === 'cache' 且 lastServerFetchedAt < 30 分鐘：
//       快取還算新 → 灰色「快取版本」，無警告
//   - dataSource === 'cache' 且 lastServerFetchedAt ≥ 30 分鐘或未知：
//       快取可能過期 → 橘色警告，提示手動更新
// ============================================================
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

interface FreshnessInfo {
  text: string;         // 「即時」或「快取版本（5 分鐘前同步）」
  isWarning: boolean;   // 是否顯示警告
  isServer: boolean;    // 是否來自 server（用於決定顏色）
}

function getFreshnessInfo(
  dataSource: 'cache' | 'server' | undefined,
  lastServerFetchedAt: number | null
): FreshnessInfo {
  // 情境 A：來自 server（保證最新）
  if (dataSource === 'server') {
    return { text: '即時', isWarning: false, isServer: true };
  }

  // 情境 B：來自 cache（可能過期）
  if (!lastServerFetchedAt) {
    // 從未在此 session 從 server 讀過 → 未知新鮮度，顯示警告
    return { text: '快取版本（同步時間未知）', isWarning: true, isServer: false };
  }

  const ageMs = Date.now() - lastServerFetchedAt;
  const isStale = ageMs >= STALE_THRESHOLD_MS;

  const mins = Math.floor(ageMs / 60000);
  let relativeTime: string;
  if (mins < 1) relativeTime = '剛剛';
  else if (mins < 60) relativeTime = `${mins} 分鐘前`;
  else {
    const hrs = Math.floor(mins / 60);
    relativeTime = `${hrs} 小時前`;
  }

  return {
    text: `快取版本（${relativeTime}同步）`,
    isWarning: isStale,
    isServer: false,
  };
}

export const StudentDetailPanel: React.FC<Props> = ({
  analytics,
  cumulativeTotalAttempts,
  cumulativeCorrectCount,
  isArchived = false,
  onArchiveToggle,
  onRefetch,
  isRefreshing = false,
  lastServerFetchedAt = null,
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const { user } = useAuth();

  // 🔥 語速下限
  const [speechFloor, setSpeechFloor] = useState<number | undefined>(analytics.customSpeechFloor);
  const [isUpdatingSpeech, setIsUpdatingSpeech] = useState(false);

  // 🔥 資料新鮮度（每 60 秒重新計算，讓警告能自動觸發）
  const [freshness, setFreshness] = useState<FreshnessInfo>(
    () => getFreshnessInfo(analytics.dataSource, lastServerFetchedAt)
  );

  useEffect(() => {
    setFreshness(getFreshnessInfo(analytics.dataSource, lastServerFetchedAt));

    const timer = setInterval(() => {
      setFreshness(getFreshnessInfo(analytics.dataSource, lastServerFetchedAt));
    }, 60_000);

    return () => clearInterval(timer);
  }, [analytics.dataSource, lastServerFetchedAt]);

  // 當切換學生時同步
  useEffect(() => {
    setSpeechFloor(analytics.customSpeechFloor);
  }, [analytics.studentId, analytics.customSpeechFloor]);

  const handleSpeechFloorChange = async (value: number | null) => {
    setIsUpdatingSpeech(true);
    try {
      const svc = new StudentStateService();
      await svc.updateCustomSpeechFloor(analytics.studentId, value);
      setSpeechFloor(value ?? undefined);
    } catch (e) {
      console.error('❌ 更新語速下限失敗:', e);
      alert('更新失敗，請稍後再試');
    } finally {
      setIsUpdatingSpeech(false);
    }
  };

  // ============================================================
  // 🔥 顯示用的統計值
  //
  // 累積值（若有提供）→ 顯示「總共答了 X 題」
  // 窗口值（fallback）→ 顯示「最近 X 題」
  //
  // 圖表與分析（錯誤分佈、反應時間分佈、弱點單字）仍用 analytics，
  // 因為那些指標本來就該反映「近期行為」，不是「歷史累積」。
  // ============================================================
  const hasCumulative = cumulativeTotalAttempts !== undefined;
  const displayTotalAttempts = cumulativeTotalAttempts ?? analytics.totalAttempts;
  const displayCorrectCount = cumulativeCorrectCount ?? analytics.correctCount;

  const radarMetrics = useMemo(() => calculateRadarMetrics(analytics), [analytics]);
  const styleInfo = LEARNING_STYLE_LABELS[analytics.learningStyle];
  const engagement = useMemo(() => getEngagementStatus(analytics), [analytics]);
  const levelColor = useMemo(() => getLevelBadgeColor(analytics.currentLevel), [analytics.currentLevel]);

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

  // 🔥 用累積值判斷「尚無練習紀錄」，而非窗口值
  //    理由：若學生今天答了 0 題，但歷史上有 500 題，
  //         不該顯示「尚無練習紀錄」。
  if (displayTotalAttempts === 0) {
    return (
      <div style={{ background: '#f8f9fa', padding: '3rem', borderRadius: '8px', textAlign: 'center' }}>
        <h2 style={{ color: '#6c757d' }}>📭 尚無練習紀錄</h2>
        <p style={{ color: '#adb5bd' }}>此學生還沒有任何作答資料。</p>
      </div>
    );
  }

  return (
    <>
      <style>{SPINNER_KEYFRAMES}</style>
      <div>
        {/* ===== 按鈕列：最後更新 + 重新整理 + 歸檔 + 匯出 PDF ===== */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          flexWrap: 'wrap',
        }}>
          {/* 🔥 左側：資料新鮮度 + 重新整理 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
            {/* 「資料截至」= 學生最後作答時間 */}
            <span style={{ color: '#6c757d' }}>
              🕐 資料截至：
              {analytics.lastAttemptAt
                ? formatLocalDate(analytics.lastAttemptAt, analytics.timeZone ?? DEFAULT_TIME_ZONE)
                : '無紀錄'}
            </span>

            {/* 「資料來源」= 即時 / 快取版本 */}
            <span
              style={{
                color: freshness.isWarning ? '#856404' : freshness.isServer ? '#155724' : '#6c757d',
                fontWeight: freshness.isWarning || freshness.isServer ? 'bold' : 'normal',
                padding: '1px 6px',
                borderRadius: '3px',
                background: freshness.isWarning ? '#fff3cd' : 'transparent',
              }}
            >
              ・{freshness.text}
              {freshness.isWarning && (
                <span style={{ marginLeft: '0.3rem', fontWeight: 'normal', fontSize: '0.8rem' }}>
                  ⚠️ 點「🔄」取得最新
                </span>
              )}
            </span>

            {onRefetch && (
              <button
                onClick={onRefetch}
                disabled={isRefreshing}
                title={
                  isRefreshing
                    ? '正在從雲端讀取最新資料...'
                    : '重新從雲端讀取此學生的最新資料'
                }
                style={{
                  padding: '0.25rem 0.75rem',
                  background: isRefreshing
                    ? '#e9ecef'
                    : freshness.isWarning
                      ? '#fff3cd'
                      : '#f8f9fa',
                  color: isRefreshing
                    ? '#6c757d'
                    : freshness.isWarning
                      ? '#856404'
                      : '#495057',
                  border: isRefreshing
                    ? '1px solid #dee2e6'
                    : freshness.isWarning
                      ? '1px solid #ffc107'
                      : '1px solid #dee2e6',
                  borderRadius: '4px',
                  cursor: isRefreshing ? 'wait' : 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: freshness.isWarning && !isRefreshing ? 'bold' : 'normal',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  minWidth: '110px',
                  justifyContent: 'center',
                }}
              >
                {isRefreshing ? (
                  <>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '12px',
                        height: '12px',
                        border: '2px solid #adb5bd',
                        borderTopColor: '#495057',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }}
                    />
                    更新中...
                  </>
                ) : (
                  <>🔄 重新整理</>
                )}
              </button>
            )}
          </div>

          {/* 🔥 右側：歸檔 + PDF */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                {isArchiving ? '⏳ 處理中...' : isArchived ? '📤 取消歸檔' : '📦 歸檔此學生'}
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
        </div>

        {/* 🔥 個人語速下限設定 */}
        <div style={{
          background: '#e7f3ff',
          border: '1px solid #b8daff',
          borderRadius: '6px',
          padding: '0.75rem 1rem',
          marginBottom: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          fontSize: '0.9rem',
        }}>
          <span style={{ fontWeight: 'bold' }}>🐢 個人語速下限：</span>
          <select
            value={speechFloor ?? ''}
            onChange={(e) => handleSpeechFloorChange(e.target.value ? Number(e.target.value) : null)}
            disabled={isUpdatingSpeech}
            style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #b8daff' }}
          >
            <option value="">用全班預設</option>
            <option value="0.85">0.85x</option>
            <option value="0.7">0.7x</option>
            <option value="0.6">0.6x</option>
            <option value="0.5">0.5x</option>
          </select>
          <small style={{ color: '#6c757d' }}>
            （學生點「🐢 重聽一次」時使用；適用於特殊需求學生）
          </small>
        </div>

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
                <span style={{
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  marginLeft: '0.5rem',
                  padding: '2px 10px',
                  borderRadius: '12px',
                  background: levelColor,
                  color: 'white',
                }}>
                  L{analytics.currentLevel}
                </span>
              </h2>

              {/* ============================================================
                🔥 累積統計（若有提供，優先用；否則顯示窗口值）
                ============================================================ */}
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#6c757d' }}>
                共 {displayTotalAttempts} 題，答對 {displayCorrectCount} 題，
                平均 {(analytics.avgResponseTimeMs / 1000).toFixed(1)} 秒
                {hasCumulative ? (
                  <span style={{
                    marginLeft: '0.4rem',
                    fontSize: '0.72rem',
                    color: '#adb5bd',
                    fontStyle: 'italic',
                  }}>
                    （累積）
                  </span>
                ) : (
                  <span style={{
                    marginLeft: '0.4rem',
                    fontSize: '0.72rem',
                    color: '#adb5bd',
                    fontStyle: 'italic',
                  }}>
                    （最近 100 筆）
                  </span>
                )}
              </p>

              <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                  📅 近 7 天活躍 {analytics.activeDaysLast7} 天
                  {analytics.lastAttemptAt && (
                    <> ・ 最後練習：{formatLocalDate(analytics.lastAttemptAt, analytics.timeZone ?? DEFAULT_TIME_ZONE)}</>
                  )}
                </span>
                <span style={{
                  fontSize: '0.75rem', fontWeight: 'bold', padding: '2px 8px',
                  borderRadius: '12px', background: engagement.bgColor, color: engagement.color,
                }}>
                  {engagement.label}
                </span>
              </div>
            </div>
            <div style={{
              background: styleInfo.color, color: 'white', padding: '0.5rem 1rem',
              borderRadius: '20px', fontWeight: 'bold', fontSize: '0.9rem',
            }}>
              {styleInfo.emoji} {styleInfo.text}
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <StudentGrowthChart snapshots={analytics.dailySnapshots} />
          </div>

          <div style={{ marginBottom: '0.5rem', padding: '0.5rem 0.75rem', background: '#f1f3f5', borderRadius: '4px', fontSize: '0.8rem', color: '#6c757d' }}>
            ℹ️ 以下圖表基於<strong>最近 100 題</strong>（用於診斷近期學習狀態）；
            上方累積題數為歷史總和。兩者語意不同。
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <LearningStyleRadar metrics={radarMetrics} />
            <ErrorBreakdownPie breakdown={analytics.errorBreakdown} />
            <ResponseTimeBar distribution={analytics.responseTimeDistribution} />
            <WeakWordsTable words={analytics.weakestWords} />
          </div>

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
    </>
  );
};