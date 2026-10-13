// src/domain/grading/correctnessSignal.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  classifyCorrectness,
  isMatched,
  isTimedOut,
} from './correctnessSignal';

describe('classifyCorrectness', () => {
  test('matched + 未超時 → true-positive', () => {
    assert.strictEqual(classifyCorrectness(true, false), 'true-positive');
  });

  test('matched + 超時 → false-negative', () => {
    assert.strictEqual(classifyCorrectness(true, true), 'false-negative');
  });

  test('未 matched + 未超時 → true-negative', () => {
    assert.strictEqual(classifyCorrectness(false, false), 'true-negative');
  });

  test('未 matched + 超時 → compound-error', () => {
    assert.strictEqual(classifyCorrectness(false, true), 'compound-error');
  });

  test('純函式：相同輸入必定相同輸出', () => {
    const a = classifyCorrectness(true, false);
    const b = classifyCorrectness(true, false);
    assert.strictEqual(a, b);
  });
});

describe('isMatched', () => {
  test('true-positive → true', () => {
    assert.strictEqual(isMatched('true-positive'), true);
  });

  test('false-negative → true', () => {
    assert.strictEqual(isMatched('false-negative'), true);
  });

  test('true-negative → false', () => {
    assert.strictEqual(isMatched('true-negative'), false);
  });

  test('compound-error → false', () => {
    assert.strictEqual(isMatched('compound-error'), false);
  });
});

describe('isTimedOut', () => {
  test('true-positive → false', () => {
    assert.strictEqual(isTimedOut('true-positive'), false);
  });

  test('false-negative → true', () => {
    assert.strictEqual(isTimedOut('false-negative'), true);
  });

  test('true-negative → false', () => {
    assert.strictEqual(isTimedOut('true-negative'), false);
  });

  test('compound-error → true', () => {
    assert.strictEqual(isTimedOut('compound-error'), true);
  });
});

describe('一致性：classifyCorrectness 與反向查詢一致', () => {
  const cases = [
    { matched: true,  timedOut: false, expectMatched: true,  expectTimedOut: false },
    { matched: true,  timedOut: true,  expectMatched: true,  expectTimedOut: true  },
    { matched: false, timedOut: false, expectMatched: false, expectTimedOut: false },
    { matched: false, timedOut: true,  expectMatched: false, expectTimedOut: true  },
  ];

  for (const c of cases) {
    test(`matched=${c.matched}, timedOut=${c.timedOut}`, () => {
      const signal = classifyCorrectness(c.matched, c.timedOut);
      assert.strictEqual(isMatched(signal), c.expectMatched);
      assert.strictEqual(isTimedOut(signal), c.expectTimedOut);
    });
  }
});