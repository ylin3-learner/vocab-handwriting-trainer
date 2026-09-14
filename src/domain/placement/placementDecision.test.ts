// src/domain/placement/placementDecision.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { decidePlacementStep } from './placementDecision';

describe('decidePlacementStep', () => {
  // ============================================================
  // 升級情境（對 ≥ 2 題）
  // ============================================================
  test('L3 對 3 題 → 升 L4', () => {
    const r = decidePlacementStep(3, 3);
    assert.strictEqual(r.newLevel, 4);
    assert.strictEqual(r.isFinal, false);
    assert.strictEqual(r.action, 'promote');
  });

  test('L3 對 2 題（門檻）→ 升 L4', () => {
    const r = decidePlacementStep(3, 2);
    assert.strictEqual(r.newLevel, 4);
    assert.strictEqual(r.isFinal, false);
    assert.strictEqual(r.action, 'promote');
  });

  test('L5 對 3 題 → 升 L6', () => {
    const r = decidePlacementStep(5, 3);
    assert.strictEqual(r.newLevel, 6);
    assert.strictEqual(r.isFinal, false);
    assert.strictEqual(r.action, 'promote');
  });

  // ============================================================
  // 降級情境（對 ≤ 1 題）
  // ============================================================
  test('L3 對 1 題 → 降 L2', () => {
    const r = decidePlacementStep(3, 1);
    assert.strictEqual(r.newLevel, 2);
    assert.strictEqual(r.isFinal, false);
    assert.strictEqual(r.action, 'demote');
  });

  test('L3 對 0 題 → 降 L2', () => {
    const r = decidePlacementStep(3, 0);
    assert.strictEqual(r.newLevel, 2);
    assert.strictEqual(r.isFinal, false);
    assert.strictEqual(r.action, 'demote');
  });

  test('L2 對 1 題 → 降 L1', () => {
    const r = decidePlacementStep(2, 1);
    assert.strictEqual(r.newLevel, 1);
    assert.strictEqual(r.isFinal, false);
    assert.strictEqual(r.action, 'demote');
  });

  // ============================================================
  // 天花板：L6
  // ============================================================
  test('L6 對 3 題 → 停 L6（不能升 L7）', () => {
    const r = decidePlacementStep(6, 3);
    assert.strictEqual(r.newLevel, 6);
    assert.strictEqual(r.isFinal, true);
    assert.strictEqual(r.action, 'stop');
  });

  test('L6 對 2 題 → 停 L6', () => {
    const r = decidePlacementStep(6, 2);
    assert.strictEqual(r.newLevel, 6);
    assert.strictEqual(r.isFinal, true);
    assert.strictEqual(r.action, 'stop');
  });

  test('L6 對 1 題 → 降 L5（不是停）', () => {
    const r = decidePlacementStep(6, 1);
    assert.strictEqual(r.newLevel, 5);
    assert.strictEqual(r.isFinal, false);
    assert.strictEqual(r.action, 'demote');
  });

  // ============================================================
  // 地板：L1
  // ============================================================
  test('L1 對 0 題 → 停 L1（不能降 L0）', () => {
    const r = decidePlacementStep(1, 0);
    assert.strictEqual(r.newLevel, 1);
    assert.strictEqual(r.isFinal, true);
    assert.strictEqual(r.action, 'stop');
  });

  test('L1 對 1 題 → 停 L1', () => {
    const r = decidePlacementStep(1, 1);
    assert.strictEqual(r.newLevel, 1);
    assert.strictEqual(r.isFinal, true);
    assert.strictEqual(r.action, 'stop');
  });

  test('L1 對 2 題 → 升 L2（不是停）', () => {
    const r = decidePlacementStep(1, 2);
    assert.strictEqual(r.newLevel, 2);
    assert.strictEqual(r.isFinal, false);
    assert.strictEqual(r.action, 'promote');
  });

  // ============================================================
  // 純函式性質
  // ============================================================
  test('純函式：相同輸入必定相同輸出', () => {
    const r1 = decidePlacementStep(3, 2);
    const r2 = decidePlacementStep(3, 2);
    const r3 = decidePlacementStep(3, 2);
    assert.deepStrictEqual(r1, r2);
    assert.deepStrictEqual(r2, r3);
  });
});