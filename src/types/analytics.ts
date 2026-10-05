// src/types/analytics.ts
// 學生個人化分析的資料契約

import { DailySnapshot } from './dailySnapshot';

export interface WeakWordDetail {
  wordId: string;
  word: string;              // 顯示用（若 wordMap 找不到則 fallback 為 wordId）
  wrongCount: number;
  totalAttempts: number;
  avgResponseTimeMs: number;
}

export interface ResponseTimeDistribution {
  fast: number;      // < 3000ms
  normal: number;    // 3000 ~ 8000ms
  slow: number;      // > 8000ms（超過題目限制）
}

export interface ErrorBreakdown {
  spelling: number;         // 拼字小錯（editDistance 1~3 且 similarity >= 0.5）
  completelyWrong: number;  // 完全不會（similarity < 0.3 或 recognizedText 為空）
  timeout: number;          // 超時（responseTimeMs > 8000）
}

export type LearningStyle =
  | 'fast-accurate'      // 快又準
  | 'slow-accurate'      // 慢但準
  | 'fast-inaccurate'    // 快但錯
  | 'slow-inaccurate'    // 慢又錯
  | 'insufficient-data'; // 樣本不足

export interface StudentAnalytics {
  // 基本資訊
  studentId: string;
  name: string;
  className: string;

  // 當前等級
  currentLevel: number;

  // 學習概況
  totalAttempts: number;
  correctCount: number;
  correctRate: number;
  activeDaysLast7: number;

  // 行為診斷
  avgResponseTimeMs: number;
  responseTimeDistribution: ResponseTimeDistribution;

  // 錯誤類型分類
  errorBreakdown: ErrorBreakdown;

  // 弱點單字 Top 5
  weakestWords: WeakWordDetail[];

  // 學習風格標籤
  learningStyle: LearningStyle;

  // 資料時間範圍
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;

  // 每日快照
  dailySnapshots: DailySnapshot[];

  // 個人語速下限（若未設定則 undefined）
  customSpeechFloor?: number;

  // 新增：學生的時區（用於顯示本地日期）
  timeZone?: string;

  // 🔥 資料來源（由 AnalyticsService 注入）
  //
  // 為什麼需要：
  //   前端無法區分「資料是剛剛從 server 拿的」與「資料是 N 小時前的
  //   IndexedDB 快取」。UI 需要這個欄位才能誠實顯示資料新鮮度。
  //
  // 'cache'：來自 Firestore IndexedDB 快取（可能過期）
  // 'server'：來自 Firestore 伺服器（保證最新）
  dataSource?: 'cache' | 'server';
}