// src/features/dashboard/TeacherDashboard.tsx
import React, { useState, useEffect } from 'react';
import { AnalyticsService, StudentStat, WeakWord } from '../../services/analytics/AnalyticsService';
import { useStudentDetail } from './hooks/useStudentDetail';
import { StudentDetailPanel } from './components/StudentDetailPanel';

const analytics = new AnalyticsService();

export const TeacherDashboard: React.FC = () => {
  // ============================================================
  // 班級層級 state
  // ============================================================
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentStat[]>([]);
  const [weakWords, setWeakWords] = useState<WeakWord[]>([]);
  const [summary, setSummary] = useState<{
    totalStudents: number;
    totalQuestions: number;
    avgCorrectRate: number;
    highRiskCount: number;
  }>({ totalStudents: 0, totalQuestions: 0, avgCorrectRate: 0, highRiskCount: 0 });
  const [dataSource, setDataSource] = useState<'aggregated' | 'raw'>('aggregated');

  // ============================================================
  // 🔥 Master-Detail：選中的學生 ID
  // ============================================================
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const {
    data: detail,
    loading: detailLoading,
    error: detailError,
  } = useStudentDetail(selectedStudentId);

  // ============================================================
  // 資料載入（班級層級）
  // ============================================================
  const loadData = async () => {
    setLoading(true);
    try {
      const classStats = await analytics.getAllClassStats();

      if (classStats.length > 0) {
        console.log(`✅ [TeacherDashboard] 使用預聚合統計（${classStats.length} 個班級）`);
        setDataSource('aggregated');

        const studentMap = new Map<string, StudentStat>();
        const wordErrorMap = new Map<string, { errorCount: number; totalCount: number }>();
        let totalAttempts = 0;
        let totalCorrect = 0;

        for (const cs of classStats) {
          totalAttempts += cs.totalAttempts || 0;
          totalCorrect += cs.totalCorrect || 0;

          if (cs.students) {
            for (const [displayId, s] of Object.entries(cs.students)) {
              const existing = studentMap.get(displayId);
              if (existing) {
                existing.totalAttempts += s.attempts;
                existing.correctCount += s.correct;
              } else {
                studentMap.set(displayId, {
                  id: displayId,
                  name: s.name || displayId,
                  class: cs.className,
                  totalAttempts: s.attempts,
                  correctCount: s.correct,
                  correctRate: 0,
                  avgResponseTime: 0,
                  riskLevel: 'low',
                });
              }
            }
          }

          if (cs.wordErrors) {
            for (const [wordId, w] of Object.entries(cs.wordErrors)) {
              const existing = wordErrorMap.get(wordId);
              if (existing) {
                existing.errorCount += w.errorCount;
                existing.totalCount += w.totalCount;
              } else {
                wordErrorMap.set(wordId, {
                  errorCount: w.errorCount,
                  totalCount: w.totalCount,
                });
              }
            }
          }
        }

        const studentsArr: StudentStat[] = [];
        studentMap.forEach(s => {
          const rate = s.totalAttempts > 0 ? s.correctCount / s.totalAttempts : 0;
          let risk: 'low' | 'medium' | 'high' = 'low';
          if (rate < 0.6) risk = 'high';
          else if (rate < 0.8) risk = 'medium';

          studentsArr.push({
            ...s,
            correctRate: Math.round(rate * 100),
            riskLevel: risk,
          });
        });

        // 依正確率由低到高排序（需要關注的排前面）
        studentsArr.sort((a, b) => a.correctRate - b.correctRate);

        const weakWordsArr: WeakWord[] = [];
        wordErrorMap.forEach((w, wordId) => {
          weakWordsArr.push({
            wordId,
            wordText: wordId,
            errorCount: w.errorCount,
            totalAttempts: w.totalCount,
            errorRate: Math.round((w.errorCount / w.totalCount) * 100),
          });
        });
        weakWordsArr.sort((a, b) => b.errorRate - a.errorRate);

        setStudents(studentsArr);
        setWeakWords(weakWordsArr.slice(0, 5));
        setSummary({
          totalStudents: studentsArr.length,
          totalQuestions: totalAttempts,
          avgCorrectRate: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
          highRiskCount: studentsArr.filter(s => s.riskLevel === 'high').length,
        });

        return;
      }

      // Fallback
      console.log('⚠️ [TeacherDashboard] 無預聚合統計，使用逐筆掃描（可能較慢）');
      setDataSource('raw');
      const [stats, words, summ] = await Promise.all([
        analytics.getAllStudentsStats(),
        analytics.getTopWeakWords(5),
        analytics.getClassSummary(),
      ]);
      setStudents(stats);
      setWeakWords(words);
      setSummary(summ);
    } catch (error) {
      console.error('載入儀表板數據失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ============================================================
  // 早期返回
  // ============================================================
  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>📊 載入教師數據中...</div>;
  }

  // ============================================================
  // 主畫面
  // ============================================================
  return (
    <div style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ borderBottom: '3px solid #007bff', paddingBottom: '0.5rem' }}>
        📊 教師數據總覽
        <button
          onClick={loadData}
          style={{ marginLeft: '1rem', fontSize: '0.8rem', padding: '0.3rem 1rem', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          🔄 重新整理
        </button>
        <span style={{
          marginLeft: '1rem',
          fontSize: '0.75rem',
          padding: '0.2rem 0.6rem',
          background: dataSource === 'aggregated' ? '#d4edda' : '#fff3cd',
          borderRadius: '4px',
          color: dataSource === 'aggregated' ? '#155724' : '#856404',
        }}>
          {dataSource === 'aggregated' ? '⚡ 預聚合統計' : '🐢 即時掃描'}
        </span>
      </h1>

      {/* 摘要卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', margin: '2rem 0' }}>
        <div style={{ background: '#f8f9fa', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: 0, color: '#6c757d', fontSize: '0.9rem' }}>👨‍🎓 學生總數</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '0.5rem 0' }}>{summary.totalStudents}</p>
        </div>
        <div style={{ background: '#f8f9fa', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: 0, color: '#6c757d', fontSize: '0.9rem' }}>📝 總答題數</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '0.5rem 0' }}>{summary.totalQuestions}</p>
        </div>
        <div style={{ background: '#f8f9fa', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: 0, color: '#6c757d', fontSize: '0.9rem' }}>🎯 班級平均正確率</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '0.5rem 0', color: summary.avgCorrectRate > 70 ? '#28a745' : '#dc3545' }}>
            {summary.avgCorrectRate}%
          </p>
        </div>
        <div style={{ background: '#f8f9fa', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: 0, color: '#6c757d', fontSize: '0.9rem' }}>⚠️ 高風險學生</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '0.5rem 0', color: '#dc3545' }}>{summary.highRiskCount}</p>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 🔥 Master-Detail 佈局 */}
      {/* ============================================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem' }}>

        {/* 左欄：學生列表（Master） */}
        <div style={{
          background: 'white',
          padding: '1rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          maxHeight: 'calc(100vh - 200px)',
          overflowY: 'auto',
        }}>
          <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>📋 學生列表</h2>

          {students.length === 0 ? (
            <p style={{ color: '#6c757d', fontSize: '0.9rem' }}>
              尚無學生資料。
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {students.map((s) => {
                const isSelected = selectedStudentId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStudentId(s.id)}
                    style={{
                      textAlign: 'left',
                      padding: '0.75rem',
                      background: isSelected ? '#e7f3ff' : '#f8f9fa',
                      border: isSelected ? '2px solid #007bff' : '1px solid #dee2e6',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.95rem' }}>{s.name}</strong>
                      <span style={{
                        fontSize: '0.85rem',
                        fontWeight: 'bold',
                        color: s.correctRate >= 80 ? '#28a745' : s.correctRate >= 60 ? '#ffc107' : '#dc3545',
                      }}>
                        {s.correctRate}%
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#6c757d', marginTop: '0.25rem' }}>
                      {s.class} ・ {s.totalAttempts} 題
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* 弱點單字（放在列表下方） */}
          {weakWords.length > 0 && (
            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #dee2e6' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>🔍 全班弱點單字</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {weakWords.map((w) => (
                  <li key={w.wordId} style={{
                    padding: '0.4rem 0',
                    borderBottom: '1px solid #f1f3f5',
                    fontSize: '0.85rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}>
                    <span style={{ background: '#e9ecef', padding: '1px 6px', borderRadius: '3px' }}>{w.wordText}</span>
                    <span style={{ color: w.errorRate > 60 ? '#dc3545' : '#ffc107' }}>
                      {w.errorRate}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* 右欄：學生詳情（Detail） */}
        <div>
          {!selectedStudentId && (
            <div style={{
              background: '#f8f9fa',
              padding: '4rem 2rem',
              borderRadius: '8px',
              textAlign: 'center',
              color: '#6c757d',
            }}>
              <h2 style={{ fontSize: '1.5rem' }}>👈 請從左側選擇一位學生</h2>
              <p>點擊學生名字即可查看個人化的學習診斷報告。</p>
            </div>
          )}

          {selectedStudentId && detailLoading && (
            <div style={{ background: '#f8f9fa', padding: '4rem 2rem', borderRadius: '8px', textAlign: 'center' }}>
              <p>⏳ 正在載入學生分析...</p>
            </div>
          )}

          {selectedStudentId && detailError && (
            <div style={{ background: '#f8d7da', padding: '2rem', borderRadius: '8px', color: '#721c24' }}>
              <h3>❌ 載入失敗</h3>
              <p>{detailError}</p>
            </div>
          )}

          {selectedStudentId && detail && !detailLoading && !detailError && (
            <StudentDetailPanel analytics={detail} />
          )}
        </div>
      </div>
    </div>
  );
};