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

  // 🔥 需求 B：當前等級（來自 learningState.currentLevel）
  currentLevel: number;

  // 學習概況
  totalAttempts: number;
  correctCount: number;
  correctRate: number;        // 0~100
  activeDaysLast7: number;    // 近 7 天有練習的天數

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

  // 🔥 需求 C：每日快照（供成長曲線使用）
  dailySnapshots: DailySnapshot[];
}