// src/types/progression.ts
// 自適應學習的資料契約

/**
 * 建議的每日最低練習題數。
 *
 * 這個數字來自教學現場經驗：低於此值時，學生需要過多天數才能累積
 * 足夠的樣本讓 LevelProgressionService 做出可靠的等級評估。
 *
 * ⚠️ 這是「建議值」而非「硬性限制」。老師可以設定更低，但應被告知後果。
 */
export const RECOMMENDED_MIN_QUOTA = 30;

/**
 * 學生的學習狀態（存在 students/{uid}.learningState）
 */
export interface StudentLearningState {
  /** 當前等級 1~6 */
  currentLevel: number;
  /** 學生在系統中的累計總題數 */
  totalAttempts: number;
  /** 鎖定至「總題數達到此值」才能再次評估（防抖動） */
  levelLockedUntilTotalAttempts: number;
  /** 上次評估時的總題數（避免重複評估） */
  lastEvaluatedAtTotalAttempts: number;
  /** 等級變更歷史 */
  levelHistory: LevelHistoryEntry[];
}

export interface LevelHistoryEntry {
  level: number;
  changedAt: string;
  reason: string;
  triggeredBy: 'initial' | 'promotion' | 'demotion' | 'manual';
}

/**
 * 表現指標（策略的輸入）
 */
export interface PerformanceMetrics {
  recentAttempts: number;
  correctRate: number;
  avgResponseTimeMs: number;
  timeoutRate: number;
  attemptsInCurrentLevel: number;
  consecutiveCorrect: number;
  consecutiveWrong: number;
}

export interface ProgressionInput {
  metrics: PerformanceMetrics;
  currentLevel: number;
  minLevel: number;
  maxLevel: number;
  totalAttempts: number;
}

export interface ProgressionDecision {
  action: 'promote' | 'demote' | 'hold';
  newLevel: number;
  reason: string;
  lockUntilAttempts: number;
}

/**
 * 建立初始學習狀態
 */
export function createInitialLearningState(startLevel: number = 1): StudentLearningState {
  return {
    currentLevel: startLevel,
    totalAttempts: 0,
    levelLockedUntilTotalAttempts: 0,
    lastEvaluatedAtTotalAttempts: 0,
    levelHistory: [
      {
        level: startLevel,
        changedAt: new Date().toISOString(),
        reason: '初始等級',
        triggeredBy: 'initial',
      },
    ],
  };
}