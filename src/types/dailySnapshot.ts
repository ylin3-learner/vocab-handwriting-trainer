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

  /**
   * @deprecated 自 2026-10-14 起不再寫入。
   *
   * 這個欄位記錄的是「快照建立當下學生的等級」，但成長曲線需要的是
   * 「每一天學生所處的等級」。前者會在回填時被錯填成「今天的等級」，
   * 導致圖表被抹平。
   *
   * 等級的唯一真實來源是 `studentStates/{displayId}.levelHistory`。
   * 舊快照文件仍可能帶此欄位，讀取時忽略即可。型別保留 optional
   * 是為了讓舊資料仍可反序列化。
   */
  level?: number;

  /** 快照建立時間（ISO） */
  capturedAt: string;
}