import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateNextReview } from './sm2.js';
import { createInitialReviewState } from '../../types/word.js';

test('全新單字第一次答對(quality=5) → interval 從 0 加性增長為 1,EF 微升', () => {
  const state = createInitialReviewState();
  const result = calculateNextReview(state, 5, 0);
  assert.equal(result.nextInterval, 1);
  assert.ok(result.nextEaseFactor > state.easeFactor);
});

test('答對且逾期越久(overdueDays 越大)→ interval 增長幅度越大(對應原本的 overdue_bonus)', () => {
  const state = { ...createInitialReviewState(), reviewInterval: 3, easeFactor: 2.5 };
  const noOverdue = calculateNextReview(state, 5, 0);
  const withOverdue = calculateNextReview(state, 5, 10);
  assert.ok(
    withOverdue.nextInterval > noOverdue.nextInterval,
    `逾期應該讓下次間隔拉更長: ${withOverdue.nextInterval} vs ${noOverdue.nextInterval}`
  );
});

test('答錯(quality<3) → interval 乘性下降(減半),EF 輕微下降', () => {
  const state = { ...createInitialReviewState(), reviewInterval: 8, easeFactor: 2.5 };
  const result = calculateNextReview(state, 0, 0);
  assert.equal(result.nextInterval, 4);
  assert.ok(result.nextEaseFactor < state.easeFactor);
});

test('interval 最小值是 1 天,不會出現 0 或負數(答錯時的下限)', () => {
  const state = { ...createInitialReviewState(), reviewInterval: 1, easeFactor: 2.5 };
  const result = calculateNextReview(state, 0, 0);
  assert.ok(result.nextInterval >= 1);
});

test('EF 有下限 1.3,不會一路降到不合理的低點(沿用原本 quiz.py 的下限)', () => {
  let state = { ...createInitialReviewState(), reviewInterval: 5, easeFactor: 1.3 };
  const result = calculateNextReview(state, 0, 0);
  assert.ok(result.nextEaseFactor >= 1.3);
});

test('nextReviewDate 是合法的 ISO 日期字串,且晚於現在', () => {
  const state = createInitialReviewState();
  const result = calculateNextReview(state, 5, 0);
  const date = new Date(result.nextReviewDate);
  assert.ok(!Number.isNaN(date.getTime()), 'nextReviewDate 應該可以被解析成日期');
  assert.ok(date.getTime() > Date.now(), 'nextReviewDate 應該晚於現在');
});

test('連續答對三次應該要讓 reviewCount 歸零(呼應 quiz.py 的「太棒了已經掌握」邏輯)', () => {
  // 這一段邏輯原本在 quiz.py 的 evaluate_answer 裡,屬於「複習狀態轉移」,搬到這裡統一管理
  let state = { ...createInitialReviewState(), reviewCount: 2, consecutiveCorrect: 2 };
  const result = calculateNextReview(state, 5, 0);
  assert.equal(result.nextReviewCount, 0);
  assert.equal(result.nextConsecutiveCorrect, 0);
});

test('答對但還沒滿三次連續 → consecutiveCorrect 累加,reviewCount 不變', () => {
  let state = { ...createInitialReviewState(), reviewCount: 2, consecutiveCorrect: 0 };
  const result = calculateNextReview(state, 5, 0);
  assert.equal(result.nextConsecutiveCorrect, 1);
  assert.equal(result.nextReviewCount, 2);
});

test('答錯 → reviewCount 加一,consecutiveCorrect 歸零', () => {
  let state = { ...createInitialReviewState(), reviewCount: 1, consecutiveCorrect: 2 };
  const result = calculateNextReview(state, 0, 0);
  assert.equal(result.nextReviewCount, 2);
  assert.equal(result.nextConsecutiveCorrect, 0);
});
