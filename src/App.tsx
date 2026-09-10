// src/App.tsx
import React, { useState } from 'react';
import { StudentLogin } from './features/login/StudentLogin';
import { TeacherLogin } from './features/login/TeacherLogin';
import { QuizScreen } from './features/quiz/QuizScreen';
import { TeacherDashboard } from './features/dashboard/TeacherDashboard';
import { AdminPanel } from './features/admin/AdminPanel';
import { AssignmentManager } from './features/dashboard/AssignmentManager';
import { QuizOrchestrator } from './features/quiz/QuizOrchestrator';
import { AppHeader, AppMode } from './features/common/AppHeader';
import { useAuth } from './contexts/AuthContext';

export const App: React.FC = () => {
  const [orchestrator, setOrchestrator] = useState<QuizOrchestrator | null>(null);
  const [mode, setMode] = useState<AppMode>('login');
  const [pendingTarget, setPendingTarget] = useState<AppMode | null>(null);

  const { user, role, loading, signOutUser } = useAuth();

  const isAnonymous = user?.isAnonymous ?? false;
  const hasTeacherAccess = role === 'teacher' || role === 'admin';
  const hasAdminAccess = role === 'admin';

  // ===== 導航邏輯 =====
  const handleNavigate = (target: AppMode) => {
    console.log(`🧭 [App] 導航請求：${mode} → ${target}（role=${role}）`);

    // 免驗證頁面
    if (target === 'login' || target === 'quiz' || target === 'teacherLogin') {
      setMode(target);
      return;
    }

    // 需要教師權限
    if (target === 'dashboard' || target === 'assignments') {
      if (hasTeacherAccess) {
        setMode(target);
      } else {
        setPendingTarget(target);
        setMode('teacherLogin');
      }
      return;
    }

    // 需要管理員權限
    if (target === 'admin') {
      if (hasAdminAccess) {
        setMode(target);
      } else if (hasTeacherAccess) {
        alert('❌ 您沒有管理員權限');
      } else {
        setPendingTarget(target);
        setMode('teacherLogin');
      }
      return;
    }
  };

  // ===== 教師登入成功 =====
  const handleLoginSuccess = () => {
    console.log(`✅ [App] 教師登入成功，導向：${pendingTarget ?? 'dashboard'}`);
    const target = pendingTarget ?? 'dashboard';
    setPendingTarget(null);
    setMode(target);
  };

  // ===== 登出 =====
  const handleLogout = async () => {
    if (!window.confirm('確定要登出嗎？')) return;
    await signOutUser();
    setMode('login');
    setPendingTarget(null);
    setOrchestrator(null);
  };

  // ===== 載入中 =====
  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', fontSize: '1.2rem' }}>
        🔐 載入中...
      </div>
    );
  }

  // ===== 測驗中（隱藏導航列，避免學生分心）=====
  if (mode === 'quiz' && orchestrator) {
    return (
      <QuizScreen
        orchestrator={orchestrator}
        onSessionEnd={() => setMode('login')}
      />
    );
  }

  // ===== 教師登入頁 =====
  if (mode === 'teacherLogin') {
    return (
      <>
        <AppHeader
          currentMode={mode}
          role={role}
          isAnonymous={isAnonymous}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
        />
        <TeacherLogin
          onSuccess={handleLoginSuccess}
          onCancel={() => {
            setMode('login');
            setPendingTarget(null);
          }}
        />
      </>
    );
  }

  // ===== 教師後台 =====
  if (mode === 'dashboard' && hasTeacherAccess) {
    return (
      <>
        <AppHeader
          currentMode={mode}
          role={role}
          isAnonymous={isAnonymous}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
        />
        <TeacherDashboard />
      </>
    );
  }

  // ===== 作業管理 =====
  if (mode === 'assignments' && hasTeacherAccess) {
    return (
      <>
        <AppHeader
          currentMode={mode}
          role={role}
          isAnonymous={isAnonymous}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
        />
        <AssignmentManager />
      </>
    );
  }

  // ===== 管理後台 =====
  if (mode === 'admin' && hasAdminAccess) {
    return (
      <>
        <AppHeader
          currentMode={mode}
          role={role}
          isAnonymous={isAnonymous}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
        />
        <AdminPanel />
      </>
    );
  }

  // ===== 預設：學生登入頁 =====
  return (
    <>
      <AppHeader
        currentMode="login"
        role={role}
        isAnonymous={isAnonymous}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />
      <StudentLogin
        onStart={(o) => {
          setOrchestrator(o);
          setMode('quiz');
        }}
      />
    </>
  );
};