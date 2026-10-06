// src/domain/progression/metricsCalculator.ts
import { AttemptRecord } from '../../services/storage/ProgressStore';
import { PerformanceMetrics } from '../../types/progression';

/** 題目超時閾值（與題目限制一致） */
const TIMEOUT_THRESHOLD_MS = 8000;

export function calculateMetrics(
  recentAttempts: AttemptRecord[],
  currentLevelAttempts: number,
  options?: {
    attemptsAtLevel?: number;
    attemptsBelowLevel?: number;
    attemptsAboveLevel?: number;
    probeCorrectRate?: number;
  }
): PerformanceMetrics {
  // ===== 邊界：無資料 =====
  if (recentAttempts.length === 0) {
    return {
      recentAttempts: 0,
      correctRate: 0,
      avgResponseTimeMs: 0,
      timeoutRate: 0,
      attemptsInCurrentLevel: currentLevelAttempts,
      attemptsAtLevel: 0,
      attemptsBelowLevel: 0,
      attemptsAboveLevel: 0,
      probeCorrectRate: 0,
      earlyCorrectRate: 0,
      lateCorrectRate: 0,
      trend: 0,
      consecutiveCorrect: 0,
      consecutiveWrong: 0,
    };
  }

  // ===== 過濾 timeout =====
  const timeouts = recentAttempts.filter(
    (a) => (a.responseTimeMs || 0) > TIMEOUT_THRESHOLD_MS
  );
  const validAttempts = recentAttempts.filter(
    (a) => (a.responseTimeMs || 0) <= TIMEOUT_THRESHOLD_MS
  );

  const timeoutRate = timeouts.length / recentAttempts.length;

  const correctRate =
    validAttempts.length > 0
      ? validAttempts.filter((a) => a.isCorrect).length / validAttempts.length
      : 0;

  const avgResponseTimeMs =
    validAttempts.length > 0
      ? validAttempts.reduce((sum, a) => sum + (a.responseTimeMs || 0), 0) /
        validAttempts.length
      : 0;

  // ===== 連續答對/答錯（由新到舊） =====
  const sorted = [...recentAttempts].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  let consecutiveCorrect = 0;
  let consecutiveWrong = 0;
  for (const attempt of sorted) {
    const isTimeout = (attempt.responseTimeMs || 0) > TIMEOUT_THRESHOLD_MS;
    if (isTimeout) break;
    if (attempt.isCorrect) {
      if (consecutiveWrong > 0) break;
      consecutiveCorrect++;
    } else {
      if (consecutiveCorrect > 0) break;
      consecutiveWrong++;
    }
  }

  // ===== 🔥 時間趨勢：前半 vs 後半 =====
  const sortedByTime = [...recentAttempts].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const half = Math.floor(sortedByTime.length / 2);

  const earlyAttempts = sortedByTime.slice(0, half);
  const lateAttempts = sortedByTime.slice(half);

  const earlyCorrectRate =
    earlyAttempts.length > 0
      ? earlyAttempts.filter((a) => a.isCorrect).length / earlyAttempts.length
      : 0;

  const lateCorrectRate =
    lateAttempts.length > 0
      ? lateAttempts.filter((a) => a.isCorrect).length / lateAttempts.length
      : 0;

  const trend = lateCorrectRate - earlyCorrectRate;

  return {
    recentAttempts: recentAttempts.length,
    correctRate,
    avgResponseTimeMs,
    timeoutRate,
    attemptsInCurrentLevel: currentLevelAttempts,
    attemptsAtLevel: options?.attemptsAtLevel ?? 0,
    attemptsBelowLevel: options?.attemptsBelowLevel ?? 0,
    attemptsAboveLevel: options?.attemptsAboveLevel ?? 0,
    probeCorrectRate: options?.probeCorrectRate ?? 0,
    earlyCorrectRate,
    lateCorrectRate,
    trend,
    consecutiveCorrect,
    consecutiveWrong,
  };
}