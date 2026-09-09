// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDEM-PRlkZ4MDC2OjDBxDg5tkF9hOgvEkk",
  authDomain: "vocab-handwriting-trainer.firebaseapp.com",
  projectId: "vocab-handwriting-trainer",
  storageBucket: "vocab-handwriting-trainer.firebasestorage.app",
  messagingSenderId: "14667272941",
  appId: "1:14667272941:web:935910b464531c8ad232e4",
  measurementId: "G-G0LSMLVZDK"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// 匯出 Firestore 資料庫實例
export const db = getFirestore(app);