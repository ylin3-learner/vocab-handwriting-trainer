// src/domain/progression/metricsCalculator.ts
import { AttemptRecord } from '../../services/storage/ProgressStore';
import { PerformanceMetrics } from '../../types/progression';

/** 反應時間超過此值視為 timeout（與題目限制一致） */
const TIMEOUT_THRESHOLD_MS = 8000;

/**
 * 純函式：從作答紀錄計算表現指標
 *
 * @param recentAttempts 最近 N 筆作答（已由 Service 層排好序）
 * @param currentLevelAttempts 當前 level 累計的作答（用於判斷是否夠樣本）
 */
export function calculateMetrics(
  recentAttempts: AttemptRecord[],
  currentLevelAttempts: number
): PerformanceMetrics {
  // ===== 邊界情境：無資料 =====
  if (recentAttempts.length === 0) {
    return {
      recentAttempts: 0,
      correctRate: 0,
      avgResponseTimeMs: 0,
      timeoutRate: 0,
      attemptsInCurrentLevel: currentLevelAttempts,
      consecutiveCorrect: 0,
      consecutiveWrong: 0,
    };
  }

  // ===== 分類：timeout vs. 有效作答 =====
  const timeouts = recentAttempts.filter(
    (a) => (a.responseTimeMs || 0) > TIMEOUT_THRESHOLD_MS
  );
  const validAttempts = recentAttempts.filter(
    (a) => (a.responseTimeMs || 0) <= TIMEOUT_THRESHOLD_MS
  );

  const timeoutRate = timeouts.length / recentAttempts.length;

  // ===== 正確率：分母排除 timeout =====
  const correctRate =
    validAttempts.length > 0
      ? validAttempts.filter((a) => a.isCorrect).length / validAttempts.length
      : 0;

  // ===== 平均反應時間：排除 timeout =====
  const avgResponseTimeMs =
    validAttempts.length > 0
      ? validAttempts.reduce((sum, a) => sum + (a.responseTimeMs || 0), 0) /
        validAttempts.length
      : 0;

  // ===== 連續答對/答錯：從最新一筆往回算 =====
  // 注意：這裡的 recentAttempts 應為「由新到舊」排序
  const sorted = [...recentAttempts].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  let consecutiveCorrect = 0;
  let consecutiveWrong = 0;
  for (const attempt of sorted) {
    const isTimeout = (attempt.responseTimeMs || 0) > TIMEOUT_THRESHOLD_MS;
    if (isTimeout) break; // Timeout 中斷連續計算
    if (attempt.isCorrect) {
      if (consecutiveWrong > 0) break;
      consecutiveCorrect++;
    } else {
      if (consecutiveCorrect > 0) break;
      consecutiveWrong++;
    }
  }

  return {
    recentAttempts: recentAttempts.length,
    correctRate,
    avgResponseTimeMs,
    timeoutRate,
    attemptsInCurrentLevel: currentLevelAttempts,
    consecutiveCorrect,
    consecutiveWrong,
  };
}