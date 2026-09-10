// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '../firebase';

export type UserRole = 'student' | 'teacher' | 'admin' | null;

interface AuthContextType {
  user: User | null;
  role: UserRole;
  loading: boolean;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  signOutUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log('🔐 [AuthContext] onAuthStateChanged:', firebaseUser?.uid ?? 'null');
      setUser(firebaseUser);

      if (firebaseUser) {
        try {
          // 從 ID token 讀取自訂聲明（force refresh 確保拿到最新的 role）
          const tokenResult = await firebaseUser.getIdTokenResult(true);
          const userRole = tokenResult.claims.role as string | undefined;

          if (userRole === 'admin') {
            setRole('admin');
            console.log('🔐 [AuthContext] 角色：admin');
          } else if (userRole === 'teacher') {
            setRole('teacher');
            console.log('🔐 [AuthContext] 角色：teacher');
          } else if (firebaseUser.isAnonymous) {
            setRole('student');
            console.log('🔐 [AuthContext] 角色：student（匿名）');
          } else {
            setRole(null);
            console.warn('⚠️ [AuthContext] 已登入但沒有角色');
          }
        } catch (e) {
          console.error('❌ [AuthContext] 讀取 role 失敗:', e);
          setRole(null);
        }
      } else {
        setRole(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signOutUser = async () => {
    await signOut(auth);
    console.log('🔐 [AuthContext] 已登出');
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signOutUser }}>
      {children}
    </AuthContext.Provider>
  );
};