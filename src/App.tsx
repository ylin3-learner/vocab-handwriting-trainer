// src/App.tsx
import React, { useState, lazy, Suspense, useEffect } from 'react';
import { StudentLogin } from './features/login/StudentLogin';
import { TeacherLogin } from './features/login/TeacherLogin';
import { QuizScreen } from './features/quiz/QuizScreen';
import { QuizSessionApi } from './features/quiz/QuizSessionApi';
import { AppHeader, AppMode } from './features/common/AppHeader';
import { useAuth } from './contexts/AuthContext';
import { subscribeQuotaStatus } from './services/status/quotaMonitor';

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

// 🔥 全域配額警示橫幅
const QuotaBanner: React.FC = () => (
  <div
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      background: '#dc3545',
      color: 'white',
      padding: '0.75rem 1rem',
      textAlign: 'center',
      zIndex: 9999,
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    }}
  >
    <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>
      ⚠️ 系統暫時無法使用
    </div>
    <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', opacity: 0.9 }}>
      今日使用量已達上限，請稍後再試（每日下午約 3~4 點重置）
    </div>
  </div>
);

export const App: React.FC = () => {
  const [orchestrator, setOrchestrator] = useState<QuizSessionApi | null>(null);
  const [mode, setMode] = useState<AppMode>('login');
  const [pendingTarget, setPendingTarget] = useState<AppMode | null>(null);

  // 🔥 配額狀態
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const { user, role, loading, signOutUser } = useAuth();

  const isAnonymous = user?.isAnonymous ?? false;
  const hasTeacherAccess = role === 'teacher' || role === 'admin';
  const hasAdminAccess = role === 'admin';

  // 🔥 訂閱配額狀態（含 fetch monkey patch 偵測 + 熔斷器主動通知）
  useEffect(() => {
    const unsubscribe = subscribeQuotaStatus(setQuotaExceeded);
    return unsubscribe;
  }, []);

  // 🔥 統一包裝：任何頁面都會顯示橫幅（若有配額問題）
  const withBanner = (content: React.ReactNode) => (
    <>
      {quotaExceeded && <QuotaBanner />}
      {content}
    </>
  );

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
    return withBanner(
      <div style={{ padding: '3rem', textAlign: 'center', fontSize: '1.2rem' }}>
        🔐 載入中...
      </div>
    );
  }

  // ===== 測驗中（保持不變，學生答題不需要 Lazy）=====
  if (mode === 'quiz' && orchestrator) {
    return withBanner(
      <QuizScreen
        orchestrator={orchestrator}
        onSessionEnd={() => setMode('login')}
      />
    );
  }

  // ===== 教師登入頁（保持不變）=====
  if (mode === 'teacherLogin') {
    return withBanner(
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
    return withBanner(
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
    return withBanner(
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
    return withBanner(
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
  return withBanner(
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