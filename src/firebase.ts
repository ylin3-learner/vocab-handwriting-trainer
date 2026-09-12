// src/firebase.ts
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// ============================================================
// 🔥 Firestore 離線持久化
//
// - 生產環境：IndexedDB 快取，重複讀取不消耗網路請求
// - 開發環境：記憶體快取，避免 HMR 與 IndexedDB 衝突
//
// 影響：
//   教師重複查看學生 → 第二次起從快取讀，0 網路請求
//   學生重複登入     → 單字庫、進度從快取讀
// ============================================================
export const db = initializeFirestore(app, {
  localCache: import.meta.env.PROD
    ? persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      })
    : memoryLocalCache(),
});

// 匯出 Firebase 身份驗證實例
export const auth = getAuth(app);