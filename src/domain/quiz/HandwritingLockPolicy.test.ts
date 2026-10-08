// src/domain/quiz/HandwritingLockPolicy.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { HandwritingLockPolicy } from './HandwritingLockPolicy';

describe('HandwritingLockPolicy', () => {
  const policy = new HandwritingLockPolicy();

  // ============================================================
  // 三層優先序：學生個人 > 作業設定 > 系統預設
  // ============================================================
  describe('resolve - 三層優先序', () => {
    test('學生個人覆蓋優先於作業設定', () => {
      const r = policy.resolve({
        studentCustomMode: 'locked',
        assignmentMode: 'normal',
      });
      assert.strictEqual(r, 'locked');
    });

    test('作業設定優先於系統預設', () => {
      const r = policy.resolve({ assignmentMode: 'locked' });
      assert.strictEqual(r, 'locked');
    });

    test('都未設定時 fallback 到系統預設 normal', () => {
      const r = policy.resolve({});
      assert.strictEqual(r, 'normal');
    });

    test('只有學生個人覆蓋時使用學生設定', () => {
      const r = policy.resolve({ studentCustomMode: 'locked' });
      assert.strictEqual(r, 'locked');
    });

    test('作業設定為 normal 時不鎖定', () => {
      const r = policy.resolve({ assignmentMode: 'normal' });
      assert.strictEqual(r, 'normal');
    });

    test('學生個人覆蓋為 normal，作業設定為 locked → 學生優先', () => {
      const r = policy.resolve({
        studentCustomMode: 'normal',
        assignmentMode: 'locked',
      });
      assert.strictEqual(r, 'normal');
    });
  });

  // ============================================================
  // isValid
  // ============================================================
  describe('isValid', () => {
    test('合法值回傳 true', () => {
      assert.strictEqual(policy.isValid('normal'), true);
      assert.strictEqual(policy.isValid('locked'), true);
    });

    test('非法字串回傳 false', () => {
      assert.strictEqual(policy.isValid('invalid'), false);
      assert.strictEqual(policy.isValid(''), false);
    });

    test('undefined / null 回傳 false', () => {
      assert.strictEqual(policy.isValid(undefined), false);
      assert.strictEqual(policy.isValid(null), false);
    });

    test('非字串型別回傳 false', () => {
      assert.strictEqual(policy.isValid(123), false);
      assert.strictEqual(policy.isValid({}), false);
      assert.strictEqual(policy.isValid([]), false);
      assert.strictEqual(policy.isValid(true), false);
    });
  });

  // ============================================================
  // 邊界：無效值透過 resolve 也應該被 normalize
  // ============================================================
  describe('resolve - 無效值防護', () => {
    test('作業設定為無效字串 → fallback 到 normal', () => {
      const r = policy.resolve({
        assignmentMode: 'INVALID' as unknown as 'locked',
      });
      assert.strictEqual(r, 'normal');
    });

    test('學生個人覆蓋為無效值 → fallback 到 normal', () => {
      const r = policy.resolve({
        studentCustomMode: undefined,
        assignmentMode: 'locked',
      });
      assert.strictEqual(r, 'locked');
    });
  });

  // ============================================================
  // 向後相容
  // ============================================================
  describe('向後相容', () => {
    test('系統預設為 normal（舊作業缺少此欄位時行為不變）', () => {
      assert.strictEqual(HandwritingLockPolicy.DEFAULT_MODE, 'normal');
    });

    test('空 context 的解析結果等於 DEFAULT_MODE', () => {
      const r = policy.resolve({});
      assert.strictEqual(r, HandwritingLockPolicy.DEFAULT_MODE);
    });
  });

  // ============================================================
  // 純函式性質
  // ============================================================
  describe('純函式性質', () => {
    test('相同輸入必定相同輸出', () => {
      const ctx = { assignmentMode: 'locked' as const };
      const r1 = policy.resolve(ctx);
      const r2 = policy.resolve(ctx);
      assert.strictEqual(r1, r2);
    });

    test('resolve 不修改傳入的 context 物件', () => {
      const ctx = { assignmentMode: 'locked' as const };
      const ctxCopy = { ...ctx };
      policy.resolve(ctx);
      assert.deepStrictEqual(ctx, ctxCopy);
    });
  });
});