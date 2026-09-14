// src/domain/progression/evaluationGuard.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { checkEvaluationGuard } from './evaluationGuard';

describe('checkEvaluationGuard', () => {
  // ============================================================
  // 鎖定期
  // ============================================================
  test('鎖定中（total < lockedUntil）→ 跳過，回報剩餘題數', () => {
    const r = checkEvaluationGuard({
      totalAttempts: 50,
      levelLockedUntilTotalAttempts: 80,
      lastEvaluatedAtTotalAttempts: 0,
    });
    assert.strictEqual(r.shouldEvaluate, false);
    if (!r.shouldEvaluate) {
      assert.strictEqual(r.reason, 'locked');
      if (r.reason === 'locked') {
        assert.strictEqual(r.remainingAttempts, 30);
      }
    }
  });

  test('鎖定邊界：total === lockedUntil → 不鎖定', () => {
    const r = checkEvaluationGuard({
      totalAttempts: 80,
      levelLockedUntilTotalAttempts: 80,
      lastEvaluatedAtTotalAttempts: 0,
    });
    assert.strictEqual(r.shouldEvaluate, true);
  });

  // ============================================================
  // 距上次評估太近
  // ============================================================
  test('距上次評估 5 題（< 10）→ 跳過', () => {
    const r = checkEvaluationGuard({
      totalAttempts: 15,
      levelLockedUntilTotalAttempts: 0,
      lastEvaluatedAtTotalAttempts: 10,
    });
    assert.strictEqual(r.shouldEvaluate, false);
    if (!r.shouldEvaluate && r.reason === 'too-soon') {
      assert.strictEqual(r.attemptsSinceLastEval, 5);
    }
  });

  test('距上次評估 9 題（< 10）→ 跳過', () => {
    const r = checkEvaluationGuard({
      totalAttempts: 19,
      levelLockedUntilTotalAttempts: 0,
      lastEvaluatedAtTotalAttempts: 10,
    });
    assert.strictEqual(r.shouldEvaluate, false);
  });

  test('距上次評估 10 題（= 門檻）→ 評估', () => {
    const r = checkEvaluationGuard({
      totalAttempts: 20,
      levelLockedUntilTotalAttempts: 0,
      lastEvaluatedAtTotalAttempts: 10,
    });
    assert.strictEqual(r.shouldEvaluate, true);
  });

  test('距上次評估 15 題（> 門檻）→ 評估', () => {
    const r = checkEvaluationGuard({
      totalAttempts: 25,
      levelLockedUntilTotalAttempts: 0,
      lastEvaluatedAtTotalAttempts: 10,
    });
    assert.strictEqual(r.shouldEvaluate, true);
  });

  // ============================================================
  // 首次評估
  // ============================================================
  test('新學生：total=0, lastEval=0 → 跳過（距上次評估太近）', () => {
    const r = checkEvaluationGuard({
      totalAttempts: 0,
      levelLockedUntilTotalAttempts: 0,
      lastEvaluatedAtTotalAttempts: 0,
    });
    assert.strictEqual(r.shouldEvaluate, false);
  });

  test('新學生答 10 題：total=10, lastEval=0 → 評估', () => {
    const r = checkEvaluationGuard({
      totalAttempts: 10,
      levelLockedUntilTotalAttempts: 0,
      lastEvaluatedAtTotalAttempts: 0,
    });
    assert.strictEqual(r.shouldEvaluate, true);
  });

  // ============================================================
  // 鎖定與其他條件同時滿足（鎖定優先）
  // ============================================================
  test('鎖定中且距上次評估足夠 → 仍跳過（鎖定優先）', () => {
    const r = checkEvaluationGuard({
      totalAttempts: 50,
      levelLockedUntilTotalAttempts: 80,
      lastEvaluatedAtTotalAttempts: 10,
    });
    assert.strictEqual(r.shouldEvaluate, false);
    if (!r.shouldEvaluate) {
      assert.strictEqual(r.reason, 'locked');
    }
  });

  // ============================================================
  // 純函式性質
  // ============================================================
  test('純函式：相同輸入必定相同輸出', () => {
    const input = {
      totalAttempts: 30,
      levelLockedUntilTotalAttempts: 0,
      lastEvaluatedAtTotalAttempts: 15,
    };
    const r1 = checkEvaluationGuard(input);
    const r2 = checkEvaluationGuard(input);
    const r3 = checkEvaluationGuard(input);
    assert.deepStrictEqual(r1, r2);
    assert.deepStrictEqual(r2, r3);
  });
});