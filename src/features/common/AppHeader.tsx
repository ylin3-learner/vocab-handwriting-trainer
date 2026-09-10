// src/features/common/AppHeader.tsx
import React from 'react';

export type AppMode = 'login' | 'quiz' | 'teacherLogin' | 'dashboard' | 'admin' | 'assignments';

interface AppHeaderProps {
  currentMode: AppMode;
  role: 'student' | 'teacher' | 'admin' | null;
  isAnonymous: boolean;
  onNavigate: (mode: AppMode) => void;
  onLogout: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  currentMode,
  role,
  isAnonymous,
  onNavigate,
  onLogout,
}) => {
  const isLoggedIn = role !== null;
  const isTeacherOrAdmin = role === 'teacher' || role === 'admin';
  const isAdmin = role === 'admin';

  const navBtnStyle = (active: boolean, color: string) => ({
    padding: '0.5rem 1.5rem',
    background: active ? darken(color) : color,
    color: 'white',
    border: active ? '2px solid #212529' : 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: active ? 'bold' : 'normal',
    boxShadow: active ? 'inset 0 2px 4px rgba(0,0,0,0.2)' : 'none',
    transition: 'all 0.15s',
  });

  return (
    <div style={{
      textAlign: 'center',
      padding: '0.75rem 1rem',
      background: '#f8f9fa',
      borderBottom: '1px solid #dee2e6',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '0.5rem',
      flexWrap: 'wrap',
    }}>
      {/* 學生登入 */}
      <button
        onClick={() => onNavigate('login')}
        style={navBtnStyle(currentMode === 'login', '#28a745')}
      >
        🏠 學生登入
      </button>

      {/* 教師後台 */}
      <button
        onClick={() => onNavigate('dashboard')}
        style={navBtnStyle(currentMode === 'dashboard', '#007bff')}
      >
        📊 教師後台
      </button>

      {/* 作業管理 */}
      <button
        onClick={() => onNavigate('assignments')}
        style={navBtnStyle(currentMode === 'assignments', '#17a2b8')}
      >
        📋 作業管理
      </button>

      {/* 管理後台（僅 admin 顯示）*/}
      {isAdmin && (
        <button
          onClick={() => onNavigate('admin')}
          style={navBtnStyle(currentMode === 'admin', '#6c757d')}
        >
          ⚙️ 管理後台
        </button>
      )}

      {/* 登入狀態 + 登出（僅已登入時顯示）*/}
      {isLoggedIn && (
        <>
          <span style={{
            padding: '0.5rem 1rem',
            color: '#495057',
            fontSize: '0.85rem',
            background: '#e9ecef',
            borderRadius: '12px',
            marginLeft: '0.5rem',
          }}>
            {role === 'admin' && '👑 管理員'}
            {role === 'teacher' && '👨‍🏫 教師'}
            {role === 'student' && isAnonymous && '👤 學生'}
            {role === 'student' && !isAnonymous && '👤 學生'}
          </span>
          <button
            onClick={onLogout}
            style={{
              padding: '0.5rem 1.5rem',
              background: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            🚪 登出
          </button>
        </>
      )}
    </div>
  );
};

// 簡單的「變暗」輔助函式（用於高亮）
function darken(hex: string): string {
  const map: Record<string, string> = {
    '#28a745': '#1e7e34',
    '#007bff': '#0056b3',
    '#17a2b8': '#117a8b',
    '#6c757d': '#495057',
  };
  return map[hex] || hex;
}