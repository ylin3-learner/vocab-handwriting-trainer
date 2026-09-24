// src/services/storage/DailyStatsTracker.ts

/**
 * 追蹤學生「當天累計」的答題統計（跨 session 持久化）。
 *
 * 為什麼需要？
 *   QuizOrchestrator 的 dailyAnsweredCount / dailyCorrectCount 原本是 session 級的，
 *   每次頁面刷新就歸零。這造成兩個問題：
 *     1. 每日快照只反映「當天第一次答題」的數據，正確率永遠偏低
 *     2. 每日配額可以被刷新繞過
 *
 *   localStorage 持久化讓「當天累計」跨 session 延續。
 *
 * Key 設計：
 *   dailyStats_{displayId}_{YYYY-MM-DD}
 *   每天一個 key，隔天自動變成新 key，不需要主動清理。
 *   舊 key 佔用極少空間（< 100 bytes/day）。
 */
export interface DailyStats {
  date: string;                  // YYYY-MM-DD
  answeredCount: number;
  correctCount: number;
  totalResponseTimeMs: number;
}

export class DailyStatsTracker {
  private getKey(displayId: string, date: string): string {
    return `dailyStats_${displayId}_${date}`;
  }

  /**
   * 讀取指定日期的累計統計。
   * 若不存在、日期不符、或解析失敗，回傳歸零的統計。
   */
  load(displayId: string, date: string): DailyStats {
    try {
      const raw = localStorage.getItem(this.getKey(displayId, date));
      if (!raw) return this.empty(date);

      const parsed = JSON.parse(raw) as Partial<DailyStats>;
      if (parsed.date !== date) return this.empty(date);

      return {
        date,
        answeredCount: parsed.answeredCount ?? 0,
        correctCount: parsed.correctCount ?? 0,
        totalResponseTimeMs: parsed.totalResponseTimeMs ?? 0,
      };
    } catch (e) {
      console.warn('⚠️ [DailyStatsTracker] 讀取失敗:', e);
      return this.empty(date);
    }
  }

  /**
   * 累加一次作答，並回傳累加後的統計。
   */
  increment(
    displayId: string,
    date: string,
    isCorrect: boolean,
    responseTimeMs: number
  ): DailyStats {
    const stats = this.load(displayId, date);
    stats.answeredCount += 1;
    if (isCorrect) stats.correctCount += 1;
    stats.totalResponseTimeMs += responseTimeMs;
    this.save(displayId, stats);
    return stats;
  }

  /**
   * 清除指定日期的統計（測試或手動重置用）。
   */
  clear(displayId: string, date: string): void {
    try {
      localStorage.removeItem(this.getKey(displayId, date));
    } catch {
      // ignore
    }
  }

  private save(displayId: string, stats: DailyStats): void {
    try {
      localStorage.setItem(
        this.getKey(displayId, stats.date),
        JSON.stringify(stats)
      );
    } catch (e) {
      console.warn('⚠️ [DailyStatsTracker] 寫入失敗:', e);
    }
  }

  private empty(date: string): DailyStats {
    return { date, answeredCount: 0, correctCount: 0, totalResponseTimeMs: 0 };
  }
}