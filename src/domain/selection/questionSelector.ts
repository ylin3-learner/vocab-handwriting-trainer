// src/domain/selection/questionSelector.ts
// 從 quiz.py 的 get_priority_question() / choose_priority_question() 移植
// 純函式:輸入目前所有單字的複習狀態,決定下一題該出哪個 wordId
// 不碰資料庫、不知道 UI,也不知道辨識引擎存在

import type { ReviewState } from '../../types/word.js';

export interface WordEntry {
  wordId: string;
  state: ReviewState;
  overdueDays?: number;
}

export interface DailyQuota {
  dailyAnsweredCount: number;
  dailyMaxQuota: number;
  dailyNewQuotaRemaining: number;
}

/**
 * 計算單字優先權
 * 🔥 使用對數衰減：避免 reviewCount 無限疊加導致權重爆炸
 *    - 答錯 1 次 → log1p(1)*100 ≈ 69
 *    - 答錯 5 次 → log1p(5)*100 ≈ 179
 *    - 答錯 10 次 → log1p(10)*100 ≈ 240
 *  （對比原本線性：答錯 1 次 80，答錯 10 次 800，會完全碾壓其他單字）
 */
export function calculatePriority(state: ReviewState, overdueDays: number): number {
  const isNew = state.reviewCount === 0 && !state.lastReviewed;
  const reviewWeight = Math.log1p(state.reviewCount) * 100;
  const overdueWeight = overdueDays * 20;
  const newBonus = isNew ? 80 : 0;

  const BASE_WEIGHT = 1;  // 避免權重全為 0

  return BASE_WEIGHT + reviewWeight + overdueWeight + newBonus;
}

export function isNewWord(state: ReviewState): boolean {
  return state.reviewCount === 0 && !state.lastReviewed;
}

export function splitNewAndDue(entries: WordEntry[]): {
  newWords: WordEntry[];
  dueWords: WordEntry[];
} {
  const newWords = entries.filter((e) => isNewWord(e.state));
  const dueWords = entries.filter((e) => !isNewWord(e.state));
  return { newWords, dueWords };
}

/**
 * 加權隨機選取
 * @param entries 候選單字
 * @param explorationRate 探索率 ε（0~1）：以該機率完全隨機選取，避免卡死
 */
function weightedPick(entries: WordEntry[], explorationRate: number): string {
  // 🔥 ε-greedy 探索：以 explorationRate 機率完全隨機選取
  if (Math.random() < explorationRate) {
    const randomIndex = Math.floor(Math.random() * entries.length);
    return entries[randomIndex]!.wordId;
  }

  const weights = entries.map((e) => calculatePriority(e.state, e.overdueDays ?? 0));
  const total = weights.reduce((sum, w) => sum + w, 0);

  if (total <= 0) {
    const index = Math.floor(Math.random() * entries.length);
    return entries[index]!.wordId;
  }

  let threshold = Math.random() * total;
  for (let i = 0; i < entries.length; i++) {
    threshold -= weights[i]!;
    if (threshold <= 0) {
      return entries[i]!.wordId;
    }
  }
  return entries[entries.length - 1]!.wordId;
}

export function pickNextWordId(
  entries: WordEntry[],
  quota: DailyQuota,
  explorationRate: number = 0.1
): string | null {
  if (quota.dailyAnsweredCount >= quota.dailyMaxQuota) {
    return null;
  }

  const { newWords, dueWords } = splitNewAndDue(entries);

  // 1. 優先抽新字
  if (quota.dailyNewQuotaRemaining > 0 && newWords.length > 0) {
    const index = Math.floor(Math.random() * newWords.length);
    return newWords[index]!.wordId;
  }

  // 2. dueWords 太少時，從 newWords 抽
  const MIN_DUE_POOL = 5;
  if (dueWords.length < MIN_DUE_POOL && newWords.length > 0) {
    console.log(`🔀 [pickNextWordId] dueWords 太少（${dueWords.length} < ${MIN_DUE_POOL}），從 newWords 抽`);
    const index = Math.floor(Math.random() * newWords.length);
    return newWords[index]!.wordId;
  }

  if (dueWords.length === 0) {
    return null;
  }

  return weightedPick(dueWords, explorationRate);
}