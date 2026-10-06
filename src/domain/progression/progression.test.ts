// src/domain/progression/progression.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RuleBasedStrategy, RULE_BASED_THRESHOLDS as T } from './RuleBasedStrategy';
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
    attemptsAtLevel: 30,          // 🔥 新增
    attemptsBelowLevel: 20,       // 🔥 新增
    attemptsAboveLevel: 0,        // 🔥 新增
    probeCorrectRate: 0,          // 🔥 新增
    earlyCorrectRate: 0.7,        // 🔥 新增
    lateCorrectRate: 0.7,         // 🔥 新增
    trend: 0,                     // 🔥 新增
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
  // ============================================================
  // 基本行為
  // ============================================================
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

  test('低正確率 + 慢反應 → demote', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: 0.4,
        avgResponseTimeMs: 6000,  // 🔥 需 ≥ DEMOTE_MIN_AVG_TIME_MS (5000)
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'demote');
    assert.strictEqual(result.newLevel, 2);
  });

  test('正確率高但反應慢 → hold（差一個條件）', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: 0.9,
        avgResponseTimeMs: T.PROMOTE_MAX_AVG_TIME_MS,  // 剛好等於門檻 → 不算快
      }),
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

  // ============================================================
  // 等級上下界
  // ============================================================
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

  test('L1 + 正確率 70% + 連續答錯 5 題 → hold（不能降 L0）', () => {
    const input = makeInput({
      currentLevel: 1,
      metrics: makeMetrics({
        correctRate: 0.7,
        consecutiveWrong: 5,
        attemptsInCurrentLevel: 50,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
    assert.strictEqual(result.newLevel, 1);
    assert.ok(result.reason.includes('最低等級'));
  });

  test('L1 + 正確率 30% + 連續答錯 10 題 → hold（雙重降級條件仍不能降）', () => {
    const input = makeInput({
      currentLevel: 1,
      metrics: makeMetrics({
        correctRate: 0.3,
        consecutiveWrong: 10,
        attemptsInCurrentLevel: 50,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
    assert.strictEqual(result.newLevel, 1);
  });

  // ============================================================
  // 樣本數門檻
  // ============================================================
  test('在當前 level 累計題數不足 → hold（即使表現好）', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: 0.95,
        avgResponseTimeMs: 2500,
        attemptsInCurrentLevel: T.PROMOTE_MIN_ATTEMPTS_IN_LEVEL - 1,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
  });

  test('邊界：attemptsInCurrentLevel = PROMOTE_MIN_ATTEMPTS_IN_LEVEL → promote', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: 0.9,
        avgResponseTimeMs: 3000,
        attemptsInCurrentLevel: T.PROMOTE_MIN_ATTEMPTS_IN_LEVEL,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'promote');
  });

  // ============================================================
  // 邊界值（相對 THRESHOLDS）
  // ============================================================
  test('邊界：正確率剛好 = PROMOTE_MIN_CORRECT_RATE → promote', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: T.PROMOTE_MIN_CORRECT_RATE,
        avgResponseTimeMs: 4000,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'promote');
  });

  test('邊界：反應時間剛好 = PROMOTE_MAX_AVG_TIME_MS → hold（不算快）', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: T.PROMOTE_MIN_CORRECT_RATE,
        avgResponseTimeMs: T.PROMOTE_MAX_AVG_TIME_MS,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
  });

  test('邊界：反應時間 = PROMOTE_MAX_AVG_TIME_MS - 1 → promote', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: T.PROMOTE_MIN_CORRECT_RATE,
        avgResponseTimeMs: T.PROMOTE_MAX_AVG_TIME_MS - 1,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'promote');
  });

  test('邊界：正確率 = DEMOTE_MAX_CORRECT_RATE → 不降級（嚴格 < 才降）', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: T.DEMOTE_MAX_CORRECT_RATE,
        attemptsInCurrentLevel: 50,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
  });

  // ============================================================
  // 純函式性質
  // ============================================================
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

  // ============================================================
  // 🔥 新增的行為測試（v2）
  // ============================================================
  test('降級需平均時間 ≥ 5 秒（快速猜錯不降級）', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.4, avgResponseTimeMs: 3000 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
  });

  test('趨勢保護：進步中不降級', () => {
    const input = makeInput({
      metrics: makeMetrics({ correctRate: 0.4, avgResponseTimeMs: 6000, trend: 0.3 }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'hold');
  });

  test('Probe 表現好可升級', () => {
    const input = makeInput({
      metrics: makeMetrics({
        correctRate: 0.7,
        attemptsAboveLevel: 5,
        probeCorrectRate: 0.8,
        attemptsAtLevel: 15,
      }),
    });
    const result = strategy.evaluate(input);
    assert.strictEqual(result.action, 'promote');
  });
});

