// domain/selection/questionSelector.ts
// 從 quiz.py 的 get_priority_question() / choose_priority_question() 移植
// 純函式:輸入目前所有單字的複習狀態,決定下一題該出哪個 wordId
// 不碰資料庫、不知道 UI,也不知道辨識引擎存在

import type { ReviewState } from '../../types/word.js';

export interface WordEntry {
  wordId: string;
  state: ReviewState;
  overdueDays?: number; // 由呼叫端算好傳入(比較 nextReviewDate 與現在時間),預設 0
}

export interface DailyQuota {
  dailyAnsweredCount: number;
  dailyMaxQuota: number;
  dailyNewQuotaRemaining: number;
}

// 沿用 quiz.py 的公式: priority = review_count*80 + overdue_days*20 + is_new*50
export function calculatePriority(state: ReviewState, overdueDays: number): number {
  const isNew = state.reviewCount === 0 && !state.lastReviewed;
  return state.reviewCount * 80 + overdueDays * 20 + (isNew ? 50 : 0);
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

function weightedPick(entries: WordEntry[]): string {
  const weights = entries.map((e) => calculatePriority(e.state, e.overdueDays ?? 0));
  const total = weights.reduce((sum, w) => sum + w, 0);

  // 全部權重都是 0(理論上不該發生,防禦性處理):均勻隨機挑一個
  if (total <= 0) {
    const index = Math.floor(Math.random() * entries.length);
    return entries[index].wordId;
  }

  let threshold = Math.random() * total;
  for (let i = 0; i < entries.length; i++) {
    threshold -= weights[i];
    if (threshold <= 0) {
      return entries[i].wordId;
    }
  }
  return entries[entries.length - 1].wordId;
}

export function pickNextWordId(entries: WordEntry[], quota: DailyQuota): string | null {
  if (quota.dailyAnsweredCount >= quota.dailyMaxQuota) {
    return null;
  }

  const { newWords, dueWords } = splitNewAndDue(entries);

  // 優先出新字,直到當日新字配額用完
  if (quota.dailyNewQuotaRemaining > 0 && newWords.length > 0) {
    const index = Math.floor(Math.random() * newWords.length);
    return newWords[index].wordId;
  }

  if (dueWords.length === 0) {
    return null;
  }

  return weightedPick(dueWords);
}
