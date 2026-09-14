// src/types/progression.ts
// 自適應學習的資料契約

export const RECOMMENDED_MIN_QUOTA = 30;

/**
 * 學生的學習狀態（存在 studentStates/{displayId}）
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

  // 🔥 Stage 2 新增：程度鑑定
  /** 是否已完成程度鑑定。新學生預設 false。 */
  placementDone: boolean;
  /** 鑑定過程紀錄。未鑑定時為 undefined。 */
  placementHistory?: PlacementHistoryEntry;

  // 🔥 語音設定：個人化語速下限
  /**
   * 個人語速下限（0.5 ~ 1.0）。
   *
   * 用於「🐢 重聽一次（慢速）」按鈕。若未設定，則採用
   * 作業的 speechFloorRate，若作業也未設定，則用 0.85。
   *
   * 老師可在「學生詳情」面板為個別學生設定（例如特殊生需要更慢）。
   */
  customSpeechFloor?: number;
}

export interface LevelHistoryEntry {
  level: number;
  changedAt: string;
  reason: string;
  triggeredBy: 'initial' | 'promotion' | 'demotion' | 'manual' | 'placement';
}

export interface PlacementStep {
  level: number;
  correct: number;
  total: number;
  action: 'promote' | 'demote' | 'stop';
}

export interface PlacementHistoryEntry {
  startedAt: string;
  finishedAt: string;
  finalLevel: number;
  steps: PlacementStep[];
}

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

export function createInitialLearningState(
  startLevel: number = 1,
  placementDone: boolean = false
): StudentLearningState {
  return {
    currentLevel: startLevel,
    totalAttempts: 0,
    levelLockedUntilTotalAttempts: 0,
    lastEvaluatedAtTotalAttempts: 0,
    levelHistory: [
      {
        level: startLevel,
        changedAt: new Date().toISOString(),
        reason: placementDone ? '鑑定結果' : '初始等級',
        triggeredBy: placementDone ? 'placement' : 'initial',
      },
    ],
    placementDone,
  };
}