// src/features/login/TeacherLogin.tsx
import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase';

interface TeacherLoginProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const TeacherLogin: React.FC<TeacherLoginProps> = ({ onSuccess, onCancel }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('請輸入電子郵件與密碼');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      console.log('🔐 [TeacherLogin] 登入成功');
      onSuccess();
    } catch (err: any) {
      console.error('❌ [TeacherLogin] 登入失敗:', err.code, err.message);

      // 友善的錯誤訊息
      switch (err.code) {
        case 'auth/invalid-email':
          setError('電子郵件格式不正確');
          break;
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          setError('電子郵件或密碼錯誤');
          break;
        case 'auth/too-many-requests':
          setError('嘗試次數過多，請稍後再試');
          break;
        default:
          setError('登入失敗，請稍後再試');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '3rem auto', padding: '2rem', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #dee2e6' }}>
      <h2 style={{ marginTop: 0, textAlign: 'center' }}>🔐 教師登入</h2>
      <p style={{ color: '#6c757d', fontSize: '0.9rem', textAlign: 'center' }}>
        請使用學校提供的教師帳號登入
      </p>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.3rem' }}>電子郵件</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teacher@school.edu"
            disabled={isLoading}
            autoFocus
            style={{ width: '100%', padding: '0.5rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.3rem' }}>密碼</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
            disabled={isLoading}
            style={{ width: '100%', padding: '0.5rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        {error && (
          <div style={{
            padding: '0.5rem',
            marginBottom: '1rem',
            background: '#f8d7da',
            color: '#721c24',
            borderRadius: '4px',
            fontSize: '0.9rem',
          }}>
            ❌ {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '0.75rem',
              background: isLoading ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              cursor: isLoading ? 'default' : 'pointer',
            }}
          >
            {isLoading ? '登入中...' : '登入'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              cursor: isLoading ? 'default' : 'pointer',
            }}
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
};