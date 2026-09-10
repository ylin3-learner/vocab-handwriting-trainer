// src/App.tsx
import React, { useState } from 'react';
import { StudentLogin } from './features/login/StudentLogin';
import { QuizScreen } from './features/quiz/QuizScreen';
import { TeacherDashboard } from './features/dashboard/TeacherDashboard';
import { QuizOrchestrator } from './features/quiz/QuizOrchestrator';
import type { Word } from './types/word';
import { AdminPanel } from './features/admin/AdminPanel';
import { AssignmentManager } from './features/dashboard/AssignmentManager';

const ASSIGNMENT_PASSWORD = 'admin456';

// 你的單字資料
const SAMPLE_WORDS: Word[] = [
  { id: 'apple', word: 'apple', meaning: '蘋果', sentence: 'I eat an apple every day.' },
  { id: 'book', word: 'book', meaning: '書', sentence: 'This is my book.' },
  { id: 'cat', word: 'cat', meaning: '貓', sentence: 'The cat is sleeping.' },
  { id: 'dog', word: 'dog', meaning: '狗', sentence: 'The dog runs fast.' },
  { id: 'elephant', word: 'elephant', meaning: '大象', sentence: 'The elephant is huge.' },
];

const TEACHER_PASSWORD = 'teacher123'; // 教師密碼（可自行修改）

export const App: React.FC = () => {
  const [orchestrator, setOrchestrator] = useState<QuizOrchestrator | null>(null);
  const [mode, setMode] = useState<'login' | 'quiz' | 'dashboard' | 'admin' | 'assignments'>('login');

  // 處理教師後台進入
  const handleTeacherAccess = () => {
    const input = window.prompt('請輸入教師密碼：');
    if (input === TEACHER_PASSWORD) {
      setMode('dashboard');
    } else if (input !== null) {
      alert('❌ 密碼錯誤，請重新嘗試。');
    }
  };

  // 管理後台：密碼驗證
  const handleAdminAccess = () => {
    const input = window.prompt('請輸入管理員密碼：');
    if (input === 'admin456') {
      setMode('admin');
    } else if (input !== null) {
      alert('❌ 密碼錯誤');
    }
  };

  // 作業管理：密碼驗證（新增）
  const handleAssignmentAccess = () => {
    const input = window.prompt('請輸入作業管理密碼：');
    if (input === ASSIGNMENT_PASSWORD) {
      setMode('assignments');
    } else if (input !== null) {
      alert('❌ 密碼錯誤');
    }
  };

  // 測驗模式
  if (mode === 'quiz' && orchestrator) {
    return <QuizScreen orchestrator={orchestrator} onSessionEnd={() => setMode('login')} />;
  }

  // 教師儀表板模式
  if (mode === 'dashboard') {
    return <TeacherDashboard />;
  }

  // 在條件渲染中加入 admin 模式 (放在其他模式之前或之後皆可)
  if (mode === 'admin') {
    return <AdminPanel />;
  }

  // 條件渲染作業管理模式
  if (mode === 'assignments') {
    return <AssignmentManager />;
  }

  // 登入模式（預設）
  return (
    <div>
      {/* 頂部導航列：清楚區分學生與教師入口 */}
      <div style={{
        textAlign: 'center',
        marginTop: '1rem',
        display: 'flex',
        justifyContent: 'center',
        gap: '1rem'
      }}>
        <button
          onClick={() => setMode('login')}
          style={{
            padding: '0.5rem 1.5rem',
            background: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          🏠 學生登入
        </button>
        <button
          onClick={() => setMode('admin')}
          style={{ padding: '0.5rem 1.5rem', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          ⚙️ 管理後台
        </button>

        <button
          onClick={handleTeacherAccess}
          style={{
            padding: '0.5rem 1.5rem',
            background: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          📊 教師後台
        </button>
        <button
          onClick={handleAssignmentAccess}
          style={{
            padding: '0.5rem 1.5rem',
            background: '#17a2b8',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          📋 作業管理
        </button>
      </div>

      {/* 學生登入元件 */}
      <StudentLogin
        onStart={(o) => {
          setOrchestrator(o);
          setMode('quiz');
        }}
      />
    </div>
  );
};