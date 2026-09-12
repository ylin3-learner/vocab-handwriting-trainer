// src/domain/analytics/studentAnalyzer.ts
import { AttemptRecord } from '../../services/storage/ProgressStore';
import { Word } from '../../types/word';
import {
  StudentAnalytics,
  WeakWordDetail,
  ResponseTimeDistribution,
  ErrorBreakdown,
  LearningStyle,
} from '../../types/analytics';

// 閾值常數（集中管理，方便未來調參）
const THRESHOLDS = {
  FAST_MS: 3000,
  NORMAL_MS: 8000,          // 與題目 8 秒限制一致
  SPELLING_MAX_EDIT: 3,     // editDistance 1~3 視為拼字小錯
  SPELLING_MIN_SIM: 0.5,    // similarity >= 0.5 才算「像」
  COMPLETELY_WRONG_SIM: 0.3,
  ACCURATE_RATE: 80,        // 正確率 >= 80% 視為「準」
  MIN_SAMPLES_FOR_STYLE: 5, // 少於 5 題不判定學習風格
  ACTIVE_DAYS_WINDOW: 7,
  WEAK_WORDS_LIMIT: 5,
} as const;

/**
 * 純函式：分析單一學生的學習狀況
 *
 * @param attempts 該學生的所有作答紀錄
 * @param profile 學生的基本資料（name, class, currentLevel）
 * @param wordMap wordId -> Word 的映射（用於顯示單字）
 * @returns StudentAnalytics
 *
 * 注意：dailySnapshots 由 AnalyticsService 讀取後填入，此純函式不負責。
 */
export function analyzeStudent(
  attempts: AttemptRecord[],
  profile: {
    studentId: string;
    name: string;
    className: string;
    currentLevel?: number;
  },
  wordMap: Map<string, Word>
): StudentAnalytics {
  // ===== 邊界情境：無作答紀錄 =====
  if (attempts.length === 0) {
    return createEmptyAnalytics(profile);
  }

  // ===== 1. 學習概況 =====
  const totalAttempts = attempts.length;
  const correctCount = attempts.filter(a => a.isCorrect).length;
  const correctRate = Math.round((correctCount / totalAttempts) * 100);

  // ===== 2. 近 7 天活躍天數 =====
  const activeDaysLast7 = calculateActiveDays(attempts, THRESHOLDS.ACTIVE_DAYS_WINDOW);

  // ===== 3. 反應時間分析 =====
  const totalResponseTime = attempts.reduce((sum, a) => sum + (a.responseTimeMs || 0), 0);
  const avgResponseTimeMs = Math.round(totalResponseTime / totalAttempts);
  const responseTimeDistribution = calculateResponseTimeDistribution(attempts);

  // ===== 4. 錯誤類型分類（只統計錯誤的題目） =====
  const errorBreakdown = calculateErrorBreakdown(attempts);

  // ===== 5. 弱點單字 Top 5 =====
  const weakestWords = calculateWeakestWords(attempts, wordMap, THRESHOLDS.WEAK_WORDS_LIMIT);

  // ===== 6. 學習風格標籤 =====
  const learningStyle = determineLearningStyle(
    totalAttempts,
    avgResponseTimeMs,
    correctRate
  );

  // ===== 7. 資料時間範圍 =====
  const sortedTimestamps = attempts
    .map(a => a.timestamp)
    .filter(Boolean)
    .sort();
  const firstAttemptAt = sortedTimestamps[0] ?? null;
  const lastAttemptAt = sortedTimestamps[sortedTimestamps.length - 1] ?? null;

  return {
    studentId: profile.studentId,
    name: profile.name,
    className: profile.className,
    currentLevel: profile.currentLevel ?? 1, // 🔥 需求 B
    totalAttempts,
    correctCount,
    correctRate,
    activeDaysLast7,
    avgResponseTimeMs,
    responseTimeDistribution,
    errorBreakdown,
    weakestWords,
    learningStyle,
    firstAttemptAt,
    lastAttemptAt,
    dailySnapshots: [], // 🔥 需求 C：由 AnalyticsService 填入
  };
}

// ============================================================
// 內部輔助函式（都是純函式）
// ============================================================

function createEmptyAnalytics(profile: {
  studentId: string;
  name: string;
  className: string;
  currentLevel?: number;
}): StudentAnalytics {
  return {
    studentId: profile.studentId,
    name: profile.name,
    className: profile.className,
    currentLevel: profile.currentLevel ?? 1, // 🔥 需求 B
    totalAttempts: 0,
    correctCount: 0,
    correctRate: 0,
    activeDaysLast7: 0,
    avgResponseTimeMs: 0,
    responseTimeDistribution: { fast: 0, normal: 0, slow: 0 },
    errorBreakdown: { spelling: 0, completelyWrong: 0, timeout: 0 },
    weakestWords: [],
    learningStyle: 'insufficient-data',
    firstAttemptAt: null,
    lastAttemptAt: null,
    dailySnapshots: [], // 🔥 需求 C
  };
}

function calculateActiveDays(attempts: AttemptRecord[], windowDays: number): number {
  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  const daysSet = new Set<string>();
  for (const a of attempts) {
    if (!a.timestamp) continue;
    const ts = new Date(a.timestamp).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    const dayKey = a.timestamp.slice(0, 10); // "YYYY-MM-DD"
    daysSet.add(dayKey);
  }
  return daysSet.size;
}

function calculateResponseTimeDistribution(
  attempts: AttemptRecord[]
): ResponseTimeDistribution {
  const dist: ResponseTimeDistribution = { fast: 0, normal: 0, slow: 0 };
  for (const a of attempts) {
    const t = a.responseTimeMs || 0;
    if (t < THRESHOLDS.FAST_MS) dist.fast++;
    else if (t <= THRESHOLDS.NORMAL_MS) dist.normal++;
    else dist.slow++;
  }
  return dist;
}

function calculateErrorBreakdown(attempts: AttemptRecord[]): ErrorBreakdown {
  const breakdown: ErrorBreakdown = { spelling: 0, completelyWrong: 0, timeout: 0 };

  for (const a of attempts) {
    if (a.isCorrect) continue;

    const editDist = a.editDistance ?? -1;
    const sim = a.similarity ?? 0;
    const text = (a.recognizedText || '').trim();
    const time = a.responseTimeMs || 0;

    if (time > THRESHOLDS.NORMAL_MS) {
      breakdown.timeout++;
      continue;
    }

    if (sim < THRESHOLDS.COMPLETELY_WRONG_SIM || text === '') {
      breakdown.completelyWrong++;
      continue;
    }

    if (
      editDist >= 1 &&
      editDist <= THRESHOLDS.SPELLING_MAX_EDIT &&
      sim >= THRESHOLDS.SPELLING_MIN_SIM
    ) {
      breakdown.spelling++;
      continue;
    }

    breakdown.completelyWrong++;
  }

  return breakdown;
}

function calculateWeakestWords(
  attempts: AttemptRecord[],
  wordMap: Map<string, Word>,
  limit: number
): WeakWordDetail[] {
  const stats = new Map<
    string,
    { wrongCount: number; totalAttempts: number; totalTime: number }
  >();

  for (const a of attempts) {
    const entry = stats.get(a.wordId) ?? {
      wrongCount: 0,
      totalAttempts: 0,
      totalTime: 0,
    };
    entry.totalAttempts++;
    entry.totalTime += a.responseTimeMs || 0;
    if (!a.isCorrect) entry.wrongCount++;
    stats.set(a.wordId, entry);
  }

  const list: WeakWordDetail[] = [];
  stats.forEach((s, wordId) => {
    if (s.wrongCount === 0) return;
    const wordObj = wordMap.get(wordId);
    list.push({
      wordId,
      word: wordObj?.word ?? wordId,
      wrongCount: s.wrongCount,
      totalAttempts: s.totalAttempts,
      avgResponseTimeMs: Math.round(s.totalTime / s.totalAttempts),
    });
  });

  list.sort((a, b) => {
    if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount;
    return b.avgResponseTimeMs - a.avgResponseTimeMs;
  });

  return list.slice(0, limit);
}

function determineLearningStyle(
  totalAttempts: number,
  avgResponseTimeMs: number,
  correctRate: number
): LearningStyle {
  if (totalAttempts < THRESHOLDS.MIN_SAMPLES_FOR_STYLE) {
    return 'insufficient-data';
  }

  const isFast = avgResponseTimeMs < THRESHOLDS.FAST_MS;
  const isAccurate = correctRate >= THRESHOLDS.ACCURATE_RATE;

  if (isFast && isAccurate) return 'fast-accurate';
  if (!isFast && isAccurate) return 'slow-accurate';
  if (isFast && !isAccurate) return 'fast-inaccurate';
  return 'slow-inaccurate';
}