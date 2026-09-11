// src/features/dashboard/TeacherDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { AnalyticsService, StudentStat, WeakWord } from '../../services/analytics/AnalyticsService';
import { useStudentDetail } from './hooks/useStudentDetail';
import { StudentDetailPanel } from './components/StudentDetailPanel';
import { ArchivedStudentsService } from '../../services/analytics/ArchivedStudentsService';

const analytics = new AnalyticsService();
const archivedService = new ArchivedStudentsService();

export const TeacherDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentStat[]>([]);
  const [weakWords, setWeakWords] = useState<WeakWord[]>([]);
  const [summary, setSummary] = useState({
    totalStudents: 0,
    totalQuestions: 0,
    avgCorrectRate: 0,
    highRiskCount: 0,
  });
  const [dataSource, setDataSource] = useState<'aggregated' | 'raw'>('aggregated');

  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const { data: detail, loading: detailLoading, error: detailError } = useStudentDetail(selectedStudentId);

  const displayedStudents = useMemo(() => {
    return students.filter(s => {
      const isArchived = archivedIds.has(s.id);
      return showArchived ? true : !isArchived;
    });
  }, [students, archivedIds, showArchived]);

  const archivedCount = students.filter(s => archivedIds.has(s.id)).length;

  const loadData = async () => {
    setLoading(true);
    try {
      const [classStats, archivedSet] = await Promise.all([
        analytics.getAllClassStats(),
        archivedService.getAllArchivedIds(),
      ]);

      setArchivedIds(archivedSet);

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
                wordErrorMap.set(wordId, { errorCount: w.errorCount, totalCount: w.totalCount });
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

      console.log('⚠️ [TeacherDashboard] 無預聚合統計，使用逐筆掃描');
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

  const handleArchiveToggle = async (
    displayId: string,
    studentName: string,
    className: string,
    isCurrentlyArchived: boolean,
    archivedBy: string
  ) => {
    try {
      if (isCurrentlyArchived) {
        await archivedService.unarchiveStudent(displayId);
        setArchivedIds(prev => {
          const next = new Set(prev);
          next.delete(displayId);
          return next;
        });
      } else {
        await archivedService.archiveStudent(displayId, studentName, className, archivedBy);
        setArchivedIds(prev => new Set(prev).add(displayId));
      }
    } catch (e) {
      console.error('歸檔操作失敗:', e);
      alert('操作失敗，請稍後再試');
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>📊 載入教師數據中...</div>;
  }

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

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem' }}>
        <div style={{
          background: 'white',
          padding: '1rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          maxHeight: 'calc(100vh - 200px)',
          overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>📋 學生列表</h2>
            {archivedCount > 0 && (
              <button
                onClick={() => setShowArchived(v => !v)}
                style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.6rem',
                  background: showArchived ? '#6c757d' : '#f8f9fa',
                  color: showArchived ? 'white' : '#6c757d',
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {showArchived ? '✓ 顯示歸檔' : `📦 歸檔 (${archivedCount})`}
              </button>
            )}
          </div>

          {displayedStudents.length === 0 ? (
            <p style={{ color: '#6c757d', fontSize: '0.9rem' }}>
              {students.length === 0 ? '尚無學生資料。' : '所有學生都已歸檔。'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {displayedStudents.map((s) => {
                const isSelected = selectedStudentId === s.id;
                const isArchived = archivedIds.has(s.id);
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
                      opacity: isArchived ? 0.5 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.95rem' }}>
                        {isArchived && '📦 '}{s.name}
                      </strong>
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
                    <span style={{ color: w.errorRate > 60 ? '#dc3545' : '#ffc107' }}>{w.errorRate}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          {!selectedStudentId && (
            <div style={{ background: '#f8f9fa', padding: '4rem 2rem', borderRadius: '8px', textAlign: 'center', color: '#6c757d' }}>
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
            <StudentDetailPanel
              analytics={detail}
              isArchived={archivedIds.has(selectedStudentId)}
              onArchiveToggle={handleArchiveToggle}
            />
          )}
        </div>
      </div>
    </div>
  );
};