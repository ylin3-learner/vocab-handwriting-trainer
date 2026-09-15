// src/domain/selection/questionSelector.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePriority, splitNewAndDue, pickNextWordId } from './questionSelector.js';
import { createInitialReviewState } from '../../types/word.js';

// ============================================================
// calculatePriority：純函式，不受重構影響
// ============================================================

test('從未複習過的新單字 → priority 有 is_new 加成', () => {
  const state = createInitialReviewState();
  const priority = calculatePriority(state, 0);
  assert.ok(priority > 0);
});

test('逾期越久 priority 越高(overdueDays 加成)', () => {
  const state = { ...createInitialReviewState(), reviewCount: 1, lastReviewed: '2024-01-01' };
  const p1 = calculatePriority(state, 0);
  const p2 = calculatePriority(state, 10);
  assert.ok(p2 > p1, `逾期久應該優先權更高: ${p2} vs ${p1}`);
});

test('錯誤次數越多 priority 越高(review_count 加成)', () => {
  const stateLow = { ...createInitialReviewState(), reviewCount: 1, lastReviewed: '2024-01-01' };
  const stateHigh = { ...createInitialReviewState(), reviewCount: 5, lastReviewed: '2024-01-01' };
  assert.ok(calculatePriority(stateHigh, 0) > calculatePriority(stateLow, 0));
});

// ============================================================
// splitNewAndDue：純函式，不受重構影響
// ============================================================

test('splitNewAndDue 把「從沒複習過」跟「複習過的」分成兩堆', () => {
  const entries = [
    { wordId: 'a', state: createInitialReviewState() },
    { wordId: 'b', state: { ...createInitialReviewState(), reviewCount: 1, lastReviewed: '2024-01-01' } },
  ];
  const { newWords, dueWords } = splitNewAndDue(entries);
  assert.deepEqual(newWords.map((e) => e.wordId), ['a']);
  assert.deepEqual(dueWords.map((e) => e.wordId), ['b']);
});

// ============================================================
// pickNextWordId：重構後只負責「選擇」
//
// 🔥 重構說明：
//   移除「已達每日總配額 → return null」的測試，
//   因為該判斷已移至 SessionQuotaPolicy。
//   pickNextWordId 現在只受 dailyNewQuotaRemaining 影響。
// ============================================================

test('新字配額還有剩,且有新字可選 → 優先挑新字', () => {
  const entries = [
    { wordId: 'new1', state: createInitialReviewState() },
    { wordId: 'old1', state: { ...createInitialReviewState(), reviewCount: 5, lastReviewed: '2024-01-01' } },
  ];
  const picked = pickNextWordId(entries, {
    dailyNewQuotaRemaining: 3,
  });
  assert.equal(picked, 'new1');
});

test('新字配額用完（= 0）→ 從舊字挑', () => {
  const entries = [
    { wordId: 'new1', state: createInitialReviewState() },
    // 🔥 放 5 個以上舊字，避免觸發 MIN_DUE_POOL fallback
    { wordId: 'old1', state: { ...createInitialReviewState(), reviewCount: 5, lastReviewed: '2024-01-01' } },
    { wordId: 'old2', state: { ...createInitialReviewState(), reviewCount: 3, lastReviewed: '2024-01-01' } },
    { wordId: 'old3', state: { ...createInitialReviewState(), reviewCount: 2, lastReviewed: '2024-01-01' } },
    { wordId: 'old4', state: { ...createInitialReviewState(), reviewCount: 1, lastReviewed: '2024-01-01' } },
    { wordId: 'old5', state: { ...createInitialReviewState(), reviewCount: 4, lastReviewed: '2024-01-01' } },
  ];
  const picked = pickNextWordId(entries, {
    dailyNewQuotaRemaining: 0,
  });
  // dueWords 有 5 個（≥ MIN_DUE_POOL），不會觸發 fallback
  // 會走加權隨機，結果一定是 old1~old5 之一
  assert.ok(
    ['old1', 'old2', 'old3', 'old4', 'old5'].includes(picked!),
    `應該從舊字挑，實際：${picked}`
  );
});

test('沒有新字配額或新字已出完 → 從舊字用權重抽,只有一個舊字時必定抽到它', () => {
  const entries = [
    { wordId: 'old1', state: { ...createInitialReviewState(), reviewCount: 5, lastReviewed: '2024-01-01' } },
  ];
  const picked = pickNextWordId(entries, {
    dailyNewQuotaRemaining: 0,
  });
  assert.equal(picked, 'old1');
});

test('dueWords 少於 5 且有新字 → 從新字挑（避免重複出同一批舊字）', () => {
  const entries = [
    { wordId: 'new1', state: createInitialReviewState() },
    { wordId: 'new2', state: createInitialReviewState() },
    { wordId: 'old1', state: { ...createInitialReviewState(), reviewCount: 3, lastReviewed: '2024-01-01' } },
    { wordId: 'old2', state: { ...createInitialReviewState(), reviewCount: 3, lastReviewed: '2024-01-01' } },
  ];
  const picked = pickNextWordId(entries, {
    dailyNewQuotaRemaining: 0,  // 新字配額已用完
  });
  // dueWords 只有 2 個 < 5，且有新字可選 → 應該從新字挑
  assert.ok(picked === 'new1' || picked === 'new2', `應該從新字挑，實際：${picked}`);
});

test('沒有任何可選單字 → 回傳 null', () => {
  const picked = pickNextWordId([], {
    dailyNewQuotaRemaining: 5,
  });
  assert.equal(picked, null);
});

test('只有新字、新字配額為 0 → 因 MIN_DUE_POOL fallback 而回傳新字（非 null）', () => {
  // 邊界：newQuotaRemaining = 0 且沒有 dueWords，但有新字
  // 因為 MIN_DUE_POOL = 5 且 dueWords.length = 0 < 5，會走「從新字抽」分支
  // 所以這個案例其實會回傳新字，不是 null
  // 這個測試保留是為了確認行為
  const entries = [
    { wordId: 'new1', state: createInitialReviewState() },
  ];
  const picked = pickNextWordId(entries, {
    dailyNewQuotaRemaining: 0,
  });
  assert.equal(picked, 'new1');
});