// src/domain/progression/progression.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RuleBasedStrategy } from './RuleBasedStrategy';
import { ProgressionInput, PerformanceMetrics } from '../../types/progression';

// ============================================================
// 測試工具
// ============================================================

function makeMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    recentAttempts: 20,
    correctRate: 0.7,
    avgResponseTimeMs: 4000,
    timeoutRate: 0.1,
    attemptsInCurrentLevel: 50,
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ProgressionInput> = {}): ProgressionInput {
  return {
    metrics: makeMetrics(),
    currentLevel: 3,
    minLevel: 1,
    maxLevel: 6,
    totalAttempts: 100,
    ...overrides,
  };
}

const strategy = new RuleBasedStrategy();

// ============================================================
// 測試案例
// ============================================================

describe('RuleBasedStrategy', () => {
  test('樣本不足 → hold', () => {
    const input = makeInput({ metrics: makeMetrics({ recentAttempts: 5 }) });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
    assert.strictEqual(result.newLevel, 3);
  });

  test('高正確率 + 快反應 → promote', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.9, avgResponseTimeMs: 3000 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'promote');
    assert.strictEqual(result.newLevel, 4);
    assert.ok(result.lockUntilAttempts > 100);
  });

  test('低正確率 → demote', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.4 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'demote');
    assert.strictEqual(result.newLevel, 2);
  });

  test('正確率高但反應慢 → hold（差一個條件）', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.9, avgResponseTimeMs: 7000 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
  });

  test('連續答對 5 題 → promote（即使正確率略低）', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.7, consecutiveCorrect: 5 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'promote');
  });

  test('連續答錯 5 題 → demote', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.7, consecutiveWrong: 5 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'demote');
  });

  test('已在最高等級 L6 → hold', () => {
    const input = makeInput({
      currentLevel: 6,
      metrics: makeMetrics({ correctRate: 0.9, avgResponseTimeMs: 3000 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
    assert.ok(result.reason.includes('最高等級'));
  });

  test('已在最低等級 L1 且表現差 → hold（不能降）', () => {
    const input = makeInput({
      currentLevel: 1,
      metrics: makeMetrics({ correctRate: 0.3 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
    assert.strictEqual(result.newLevel, 1);
  });

  test('在當前 level 累計題數不足 → hold（即使表現好）', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: 0.95,
        avgResponseTimeMs: 2500,
        attemptsInCurrentLevel: 10,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
  });

  test('純函式：相同輸入必定相同輸出', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.9, avgResponseTimeMs: 3000 }),
    });
    const r1 = strategy.evaluate(input);
    const r2 = strategy.evaluate(input);
    const r3 = strategy.evaluate(input);
    assert.deepStrictEqual(r1, r2);
    assert.deepStrictEqual(r2, r3);
  });

  test('邊界：正確率剛好 = 0.85 → promote', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.85, avgResponseTimeMs: 4000 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'promote');
  });

  test('邊界：反應時間剛好 = 5000 → hold（不算快）', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.9, avgResponseTimeMs: 5000 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
  });
});