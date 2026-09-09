import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePriority, splitNewAndDue, pickNextWordId } from './questionSelector.js';
import { createInitialReviewState } from '../../types/word.js';

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

test('splitNewAndDue 把「從沒複習過」跟「複習過的」分成兩堆', () => {
  const entries = [
    { wordId: 'a', state: createInitialReviewState() },
    { wordId: 'b', state: { ...createInitialReviewState(), reviewCount: 1, lastReviewed: '2024-01-01' } },
  ];
  const { newWords, dueWords } = splitNewAndDue(entries);
  assert.deepEqual(newWords.map((e) => e.wordId), ['a']);
  assert.deepEqual(dueWords.map((e) => e.wordId), ['b']);
});

test('每日新字配額用完時,即使還有新字也不再挑新字', () => {
  const entries = [
    { wordId: 'new1', state: createInitialReviewState() },
    { wordId: 'old1', state: { ...createInitialReviewState(), reviewCount: 2, lastReviewed: '2024-01-01' } },
  ];
  const picked = pickNextWordId(entries, {
    dailyAnsweredCount: 100,
    dailyMaxQuota: 100, // 已達每日總配額上限
    dailyNewQuotaRemaining: 5,
  });
  assert.equal(picked, null, '已達每日總配額時應該回傳 null,提示今日練習結束');
});

test('新字配額還有剩,且有新字可選 → 優先挑新字(不是用權重機率,是直接給新字)', () => {
  const entries = [
    { wordId: 'new1', state: createInitialReviewState() },
    { wordId: 'old1', state: { ...createInitialReviewState(), reviewCount: 5, lastReviewed: '2024-01-01' } },
  ];
  const picked = pickNextWordId(entries, {
    dailyAnsweredCount: 0,
    dailyMaxQuota: 150,
    dailyNewQuotaRemaining: 3,
  });
  assert.equal(picked, 'new1');
});

test('沒有新字配額或新字已出完 → 從舊字用權重抽,權重全部集中在單一舊字時必定抽到它', () => {
  const entries = [
    { wordId: 'old1', state: { ...createInitialReviewState(), reviewCount: 5, lastReviewed: '2024-01-01' } },
  ];
  const picked = pickNextWordId(entries, {
    dailyAnsweredCount: 0,
    dailyMaxQuota: 150,
    dailyNewQuotaRemaining: 0,
  });
  assert.equal(picked, 'old1');
});

test('沒有任何可選單字(全部複習完且無新字)→ 回傳 null', () => {
  const picked = pickNextWordId([], {
    dailyAnsweredCount: 0,
    dailyMaxQuota: 150,
    dailyNewQuotaRemaining: 5,
  });
  assert.equal(picked, null);
});
