// src/App.tsx
import React, { useState, lazy, Suspense } from 'react';
import { StudentLogin } from './features/login/StudentLogin';
import { TeacherLogin } from './features/login/TeacherLogin';
import { QuizScreen } from './features/quiz/QuizScreen';
import { QuizOrchestrator } from './features/quiz/QuizOrchestrator';
import { AppHeader, AppMode } from './features/common/AppHeader';
import { useAuth } from './contexts/AuthContext';

// 🔥 動態載入：這些頁面只有教師/管理員會用到
// 學生登入答題時，完全不會下載這些程式碼
const TeacherDashboard = lazy(() =>
  import('./features/dashboard/TeacherDashboard').then(m => ({ default: m.TeacherDashboard }))
);
const AssignmentManager = lazy(() =>
  import('./features/dashboard/AssignmentManager').then(m => ({ default: m.AssignmentManager }))
);
const AdminPanel = lazy(() =>
  import('./features/admin/AdminPanel').then(m => ({ default: m.AdminPanel }))
);

// 🔥 共用的載入畫面
const PageLoader: React.FC = () => (
  <div style={{ padding: '3rem', textAlign: 'center', fontSize: '1.2rem', color: '#6c757d' }}>
    ⏳ 載入頁面中...
  </div>
);

export const App: React.FC = () => {
  const [orchestrator, setOrchestrator] = useState<QuizOrchestrator | null>(null);
  const [mode, setMode] = useState<AppMode>('login');
  const [pendingTarget, setPendingTarget] = useState<AppMode | null>(null);

  const { user, role, loading, signOutUser } = useAuth();

  const isAnonymous = user?.isAnonymous ?? false;
  const hasTeacherAccess = role === 'teacher' || role === 'admin';
  const hasAdminAccess = role === 'admin';

  // ===== 導航邏輯（保持不變）=====
  const handleNavigate = (target: AppMode) => {
    console.log(`🧭 [App] 導航請求：${mode} → ${target}（role=${role}）`);

    if (target === 'login' || target === 'quiz' || target === 'teacherLogin') {
      setMode(target);
      return;
    }

    if (target === 'dashboard' || target === 'assignments') {
      if (hasTeacherAccess) {
        setMode(target);
      } else {
        setPendingTarget(target);
        setMode('teacherLogin');
      }
      return;
    }

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

  const handleLoginSuccess = () => {
    console.log(`✅ [App] 教師登入成功，導向：${pendingTarget ?? 'dashboard'}`);
    const target = pendingTarget ?? 'dashboard';
    setPendingTarget(null);
    setMode(target);
  };

  const handleLogout = async () => {
    if (!window.confirm('確定要登出嗎？')) return;
    await signOutUser();
    setMode('login');
    setPendingTarget(null);
    setOrchestrator(null);
  };

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', fontSize: '1.2rem' }}>
        🔐 載入中...
      </div>
    );
  }

  // ===== 測驗中（保持不變，學生答題不需要 Lazy）=====
  if (mode === 'quiz' && orchestrator) {
    return (
      <QuizScreen
        orchestrator={orchestrator}
        onSessionEnd={() => setMode('login')}
      />
    );
  }

  // ===== 教師登入頁（保持不變）=====
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

  // ===== 教師後台（改為 Lazy + Suspense）=====
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
        <Suspense fallback={<PageLoader />}>
          <TeacherDashboard />
        </Suspense>
      </>
    );
  }

  // ===== 作業管理（改為 Lazy + Suspense）=====
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
        <Suspense fallback={<PageLoader />}>
          <AssignmentManager />
        </Suspense>
      </>
    );
  }

  // ===== 管理後台（改為 Lazy + Suspense）=====
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
        <Suspense fallback={<PageLoader />}>
          <AdminPanel />
        </Suspense>
      </>
    );
  }

  // ===== 預設：學生登入頁（保持不變）=====
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