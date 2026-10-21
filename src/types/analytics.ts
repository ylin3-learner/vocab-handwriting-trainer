// src/types/analytics.ts
import { DailySnapshot } from './dailySnapshot';
import type { LevelHistoryEntry } from './progression';

export interface WeakWordDetail {
  wordId: string;
  word: string;
  wrongCount: number;
  totalAttempts: number;
  avgResponseTimeMs: number;
}

export interface ResponseTimeDistribution {
  fast: number;
  normal: number;
  slow: number;
}

export interface ErrorBreakdown {
  spelling: number;
  completelyWrong: number;
  timeout: number;
}

export type LearningStyle =
  | 'fast-accurate'
  | 'slow-accurate'
  | 'fast-inaccurate'
  | 'slow-inaccurate'
  | 'insufficient-data';

export interface StudentAnalytics {
  studentId: string;
  name: string;
  className: string;
  currentLevel: number;
  totalAttempts: number;
  correctCount: number;
  correctRate: number;
  activeDaysLast7: number;
  avgResponseTimeMs: number;
  responseTimeDistribution: ResponseTimeDistribution;
  errorBreakdown: ErrorBreakdown;
  weakestWords: WeakWordDetail[];
  learningStyle: LearningStyle;
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;
  dailySnapshots: DailySnapshot[];
  levelHistory?: LevelHistoryEntry[];
  customSpeechFloor?: number;
  timeZone?: string;
  dataSource?: 'cache' | 'server';
  recentQuotaStats?: {
    date: string;
    answeredCount: number;
    targetQuota: number;
    status: 'completed' | 'incomplete';
    isCapped?: boolean; // 新增：是否已達到抓取上限（100筆）
  };
  
  // 🔥 新增：出席率統計
  attendanceStats?: {
    activeDays: number;
    targetDays: number;
    windowDays: number;
    isProportional: boolean;
    isMet: boolean;
  };
}