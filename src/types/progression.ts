// src/types/progression.ts
// 自適應學習的資料契約

/**
 * 建議的每日最低練習題數。
 *
 * 這個數字來自教學現場經驗與統計學依據：
 *   中央極限定理（CLT）指出，當樣本數 n ≥ 30，
 *   樣本平均的分佈會趨近常態分佈，無論母體為何。
 *
 *   學習評估的本質是「從學生腦海中的潛在能力分佈抽樣」，
 *   因此 30 題是統計上能穩定逼近真實能力的最低樣本數。
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

  // 🔥 Stage 2 新增：程度鑑定
  /** 是否已完成程度鑑定。新學生預設 false。 */
  placementDone: boolean;
  /** 鑑定過程紀錄。未鑑定時為 undefined。 */
  placementHistory?: PlacementHistoryEntry;
}

export interface LevelHistoryEntry {
  level: number;
  changedAt: string;
  reason: string;
  triggeredBy: 'initial' | 'promotion' | 'demotion' | 'manual' | 'placement';
}

// 🔥 Stage 2 新增：程度鑑定的資料契約

/**
 * 鑑定過程中的單一步驟。
 *
 * 例如學生在 L3 答 3 題對 2 題 → 升 L4，
 * 這一級就會產生一筆 { level: 3, correct: 2, total: 3, action: 'promote' }。
 */
export interface PlacementStep {
  /** 該步驟對應的等級 */
  level: number;
  /** 該步驟答對題數 */
  correct: number;
  /** 該步驟總題數 */
  total: number;
  /** 該步驟結束後的動作 */
  action: 'promote' | 'demote' | 'stop';
}

/**
 * 一次完整的鑑定紀錄。
 *
 * 保留完整步驟的教學價值：
 *   老師可以看到「林佑綸在 L3 對 2 題、L4 對 1 題 → 停在 L4」，
 *   比單純看到「L4」更有助於理解學生的能力邊界。
 */
export interface PlacementHistoryEntry {
  /** 鑑定開始時間（ISO） */
  startedAt: string;
  /** 鑑定結束時間（ISO） */
  finishedAt: string;
  /** 最終等級 */
  finalLevel: number;
  /** 每一級的完整紀錄 */
  steps: PlacementStep[];
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
 *
 * @param startLevel 起始等級（預設 1）
 * @param placementDone 是否已完成鑑定（預設 false）
 */
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
    // placementHistory 未設定（undefined），因為還沒鑑定
  };
}