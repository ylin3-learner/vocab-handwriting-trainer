// src/types/dailySnapshot.ts

/**
 * 每日學習快照。
 *
 * 寫入時機：每天第一次答題時（C-2 策略）。
 * 目的：為成長曲線提供每日數據點。
 *
 * 設計依據：
 *   學習變化需要時間，過於頻繁的快照沒有意義。
 *   縱貫資料（longitudinal）才能回答「誰、從哪裡出發、
 *   用多快的速度、朝哪個方向走」。
 */
export interface DailySnapshot {
  /** 日期，格式 "YYYY-MM-DD" */
  date: string;

  /** 當天累計答題數（首次答題時為 1） */
  totalAttempts: number;

  /** 當天累計答對數 */
  correctCount: number;

  /** 當天正確率（0~100） */
  correctRate: number;

  /** 當天平均反應時間（ms） */
  avgResponseTimeMs: number;

  /** 當天結束時的等級（L1~L6） */
  level: number;

  /** 快照建立時間（ISO） */
  capturedAt: string;
}