// src/domain/quiz/CompetitionModePolicy.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CompetitionModePolicy } from './CompetitionModePolicy';

describe('CompetitionModePolicy', () => {
  const policy = new CompetitionModePolicy();

  // ============================================================
  // resolve - 三層優先序
  // ============================================================
  describe('resolve - 三層優先序', () => {
    test('都未設定時 fallback 到 disabled', () => {
      const r = policy.resolve({});
      assert.strictEqual(r.enabled, false);
      assert.strictEqual(r.targetLevel, 1);
    });

    test('作業設定為 true 時啟用，並保留 targetLevel', () => {
      const r = policy.resolve({ assignmentMode: true, targetLevel: 3 });
      assert.strictEqual(r.enabled, true);
      assert.strictEqual(r.targetLevel, 3);
    });

    test('學生個人覆蓋優先於作業設定（true 勝 false）', () => {
      const r = policy.resolve({
        studentOverride: true,
        assignmentMode: false,
        targetLevel: 4,
      });
      assert.strictEqual(r.enabled, true);
      assert.strictEqual(r.targetLevel, 4);
    });

    test('學生個人覆蓋優先於作業設定（false 勝 true）', () => {
      const r = policy.resolve({
        studentOverride: false,
        assignmentMode: true,
        targetLevel: 4,
      });
      assert.strictEqual(r.enabled, false);
    });
  });

  // ============================================================
  // 邊界：等級 clamp
  // ============================================================
  describe('resolve - 等級 clamp', () => {
    test('等級低於 1 → clamp 到 1', () => {
      const r = policy.resolve({ assignmentMode: true, targetLevel: 0 });
      assert.strictEqual(r.targetLevel, 1);
    });

    test('等級高於 6 → clamp 到 6', () => {
      const r = policy.resolve({ assignmentMode: true, targetLevel: 10 });
      assert.strictEqual(r.targetLevel, 6);
    });

    test('未提供 targetLevel 時 fallback 到 1', () => {
      const r = policy.resolve({ assignmentMode: true });
      assert.strictEqual(r.targetLevel, 1);
    });

    test('enabled 為 false 時忽略 targetLevel', () => {
      const r = policy.resolve({ assignmentMode: false, targetLevel: 5 });
      assert.strictEqual(r.enabled, false);
    });
  });

  // ============================================================
  // isValid
  // ============================================================
  describe('isValid', () => {
    test('合法配置回傳 true', () => {
      assert.strictEqual(
        policy.isValid({ enabled: true, targetLevel: 3 }),
        true
      );
      assert.strictEqual(
        policy.isValid({ enabled: false, targetLevel: 1 }),
        true
      );
    });

    test('等級超出範圍回傳 false', () => {
      assert.strictEqual(
        policy.isValid({ enabled: true, targetLevel: 0 }),
        false
      );
      assert.strictEqual(
        policy.isValid({ enabled: true, targetLevel: 7 }),
        false
      );
    });

    test('非數字等級回傳 false', () => {
      assert.strictEqual(
        policy.isValid({ enabled: true, targetLevel: NaN }),
        false
      );
      assert.strictEqual(
        policy.isValid({ enabled: true, targetLevel: Infinity }),
        false
      );
    });
  });

  // ============================================================
  // 向後相容
  // ============================================================
  describe('向後相容', () => {
    test('DEFAULT 為 disabled', () => {
      assert.strictEqual(CompetitionModePolicy.DEFAULT.enabled, false);
    });

    test('resolve 不修改傳入的 context 物件', () => {
      const ctx = { assignmentMode: true as const, targetLevel: 3 };
      const ctxCopy = { ...ctx };
      policy.resolve(ctx);
      assert.deepStrictEqual(ctx, ctxCopy);
    });
  });
});