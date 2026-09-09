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

  const loadData = async () => {
    setLoading(true);
    try {
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
      </h1>

      {/* 摘要卡片（對應 6.2） */}
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
        {/* 左欄：學生總覽表格（6.2, 6.3, 6.5） */}
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h2>📋 學生表現總覽</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f1f3f5', textAlign: 'left' }}>
                  <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>姓名</th>
                  <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>班級</th>
                  <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>答題數</th>
                  <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>正確率</th>
                  <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>平均秒數</th>
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
                    <td style={{ padding: '10px' }}>{s.avgResponseTime}s</td>
                    <td style={{ padding: '10px' }}>
                      {s.riskLevel === 'high' && <span style={{ background: '#dc3545', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>⚠️ 需輔導</span>}
                      {s.riskLevel === 'medium' && <span style={{ background: '#ffc107', color: 'black', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>📈 可加強</span>}
                      {s.riskLevel === 'low' && s.totalAttempts > 0 && <span style={{ background: '#28a745', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>✅ 表現良好</span>}
                      {s.totalAttempts === 0 && <span style={{ background: '#6c757d', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>⏳ 尚未練習</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 右欄：弱點分析（6.4）與清理功能 */}
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
        </div>
      </div>
    </div>
  );
};