// src/features/dashboard/TeacherDashboard.tsx
import React, { useState, useEffect } from 'react';
import { AnalyticsService, StudentStat, WeakWord } from '../../services/analytics/AnalyticsService';

const analytics = new AnalyticsService();

export const TeacherDashboard: React.FC = () => {
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

  const loadData = async () => {
    setLoading(true);
    try {
      // 優先使用預聚合的 classStats
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

      // Fallback：classStats 為空，使用原本的逐筆掃描
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

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>📊 載入教師數據中...</div>;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', fontFamily: 'sans-serif' }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>
        {/* 左欄：學生總覽表格 */}
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h2>📋 學生表現總覽</h2>
          {students.length === 0 ? (
            <p style={{ color: '#6c757d', padding: '1rem' }}>
              尚無學生資料。學生登入並作答後，資料會自動出現在這裡。
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f1f3f5', textAlign: 'left' }}>
                    <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>姓名</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>班級</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>答題數</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>正確率</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f1f3f5' }}>
                      <td style={{ padding: '10px' }}><strong>{s.name}</strong></td>
                      <td style={{ padding: '10px' }}>{s.class}</td>
                      <td style={{ padding: '10px' }}>{s.totalAttempts}</td>
                      <td style={{ padding: '10px' }}>{s.correctRate}%</td>
                      <td style={{ padding: '10px' }}>
                        {s.riskLevel === 'high' && <span style={{ background: '#dc3545', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>⚠️ 需輔導</span>}
                        {s.riskLevel === 'medium' && <span style={{ background: '#ffc107', color: 'black', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>📈 可加強</span>}
                        {s.riskLevel === 'low' && s.totalAttempts > 0 && <span style={{ background: '#28a745', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>✅ 表現良好</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 右欄：弱點分析 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <h2>🔍 Top-5 弱點單字</h2>
            {weakWords.length === 0 ? (
              <p style={{ color: '#6c757d' }}>尚無作答數據，或學生表現都很好！</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {weakWords.map((w, idx) => (
                  <li key={w.wordId} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
                    <span style={{ fontWeight: 'bold', marginRight: '8px' }}>#{idx + 1}</span>
                    <span style={{ background: '#e9ecef', padding: '2px 8px', borderRadius: '4px' }}>{w.wordText}</span>
                    <span style={{ float: 'right', color: w.errorRate > 60 ? '#dc3545' : '#ffc107' }}>
                      錯誤率 {w.errorRate}% ({w.errorCount}/{w.totalAttempts})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ background: '#e9ecef', padding: '1rem', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 0.5rem 0' }}>ℹ️ 關於資料同步</h4>
            <p style={{ fontSize: '0.9rem', color: '#495057', margin: 0 }}>
              學生的作答資料會先在他們的裝置上保存，然後自動背景同步到雲端。
              這個過程無需老師介入。如果學生剛答完題，資料可能需要 30 秒內才會出現在這裡。
            </p>
          </div>

          <div style={{ background: '#fff3cd', padding: '1rem', borderRadius: '8px', border: '1px solid #ffeeba' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#856404' }}>💡 小提醒</h4>
            <p style={{ fontSize: '0.85rem', color: '#856404', margin: 0 }}>
              學生換裝置登入時，只要輸入相同的姓名、班級、座號，
              統計資料就會自動合併。複習進度則依裝置分開儲存。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};