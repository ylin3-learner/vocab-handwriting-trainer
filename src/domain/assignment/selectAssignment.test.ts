// src/domain/assignment/selectAssignment.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { selectActiveAssignment, AssignmentCandidate } from './selectAssignment';

const NOW = '2026-09-14T12:00:00.000Z';

function makeAssignment(
  overrides: Partial<AssignmentCandidate> = {}
): AssignmentCandidate {
  return {
    id: 'a1',
    className: '709',
    isActive: true,
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('selectActiveAssignment', () => {
  // ============================================================
  // 邊界：空 / 全無效
  // ============================================================
  test('空陣列 → null', () => {
    const r = selectActiveAssignment([], '709', undefined, NOW);
    assert.strictEqual(r, null);
  });

  test('全部停用 → null', () => {
    const list = [
      makeAssignment({ id: 'a', isActive: false }),
      makeAssignment({ id: 'b', isActive: false }),
    ];
    const r = selectActiveAssignment(list, '709', undefined, NOW);
    assert.strictEqual(r, null);
  });

  test('全部過期（endDate < now）→ null', () => {
    const list = [
      makeAssignment({ id: 'a', endDate: '2026-09-13T00:00:00.000Z' }),
    ];
    const r = selectActiveAssignment(list, '709', undefined, NOW);
    assert.strictEqual(r, null);
  });

  test('全部未開始（startDate > now）→ null', () => {
    const list = [
      makeAssignment({ id: 'a', startDate: '2026-09-15T00:00:00.000Z' }),
    ];
    const r = selectActiveAssignment(list, '709', undefined, NOW);
    assert.strictEqual(r, null);
  });

  // ============================================================
  // 優先序：個人 > 班級 > 全校
  // ============================================================
  test('個人作業優先於班級與全校', () => {
    const list = [
      makeAssignment({ id: 'school', className: null }),
      makeAssignment({ id: 'class', className: '709' }),
      makeAssignment({ id: 'personal', className: '709_1_林佑綸' }),
    ];
    const r = selectActiveAssignment(list, '709', '709_1_林佑綸', NOW);
    assert.strictEqual(r?.assignment.id, 'personal');
    assert.strictEqual(r?.matchType, 'personal');
  });

  test('無個人作業 → 用班級作業', () => {
    const list = [
      makeAssignment({ id: 'school', className: null }),
      makeAssignment({ id: 'class', className: '709' }),
    ];
    const r = selectActiveAssignment(list, '709', '709_1_林佑綸', NOW);
    assert.strictEqual(r?.assignment.id, 'class');
    assert.strictEqual(r?.matchType, 'class');
  });

  test('無個人與班級 → 用全校作業', () => {
    const list = [makeAssignment({ id: 'school', className: null })];
    const r = selectActiveAssignment(list, '709', '709_1_林佑綸', NOW);
    assert.strictEqual(r?.assignment.id, 'school');
    assert.strictEqual(r?.matchType, 'school');
  });

  test('displayId 為 undefined → 跳過個人作業查找', () => {
    const list = [
      makeAssignment({ id: 'personal', className: '709_1_林佑綸' }),
      makeAssignment({ id: 'class', className: '709' }),
    ];
    const r = selectActiveAssignment(list, '709', undefined, NOW);
    assert.strictEqual(r?.assignment.id, 'class');
    assert.strictEqual(r?.matchType, 'class');
  });

  // ============================================================
  // 同類型多個：取 createdAt 最新的
  // ============================================================
  test('同班級有多個作業 → 取 createdAt 最新的', () => {
    const list = [
      makeAssignment({ id: 'old', className: '709', createdAt: '2026-09-01T00:00:00.000Z' }),
      makeAssignment({ id: 'new', className: '709', createdAt: '2026-09-10T00:00:00.000Z' }),
      makeAssignment({ id: 'mid', className: '709', createdAt: '2026-09-05T00:00:00.000Z' }),
    ];
    const r = selectActiveAssignment(list, '709', undefined, NOW);
    assert.strictEqual(r?.assignment.id, 'new');
  });

  test('同個人有多個作業 → 取最新的', () => {
    const list = [
      makeAssignment({ id: 'old', className: '709_1_林佑綸', createdAt: '2026-09-01T00:00:00.000Z' }),
      makeAssignment({ id: 'new', className: '709_1_林佑綸', createdAt: '2026-09-10T00:00:00.000Z' }),
    ];
    const r = selectActiveAssignment(list, '709', '709_1_林佑綸', NOW);
    assert.strictEqual(r?.assignment.id, 'new');
  });

  // ============================================================
  // 無效作業不影響查找
  // ============================================================
  test('個人作業已停用 → 退回班級作業', () => {
    const list = [
      makeAssignment({ id: 'personal', className: '709_1_林佑綸', isActive: false }),
      makeAssignment({ id: 'class', className: '709' }),
    ];
    const r = selectActiveAssignment(list, '709', '709_1_林佑綸', NOW);
    assert.strictEqual(r?.assignment.id, 'class');
    assert.strictEqual(r?.matchType, 'class');
  });

  test('班級作業已過期 → 退回全校作業', () => {
    const list = [
      makeAssignment({ id: 'class', className: '709', endDate: '2026-09-13T00:00:00.000Z' }),
      makeAssignment({ id: 'school', className: null }),
    ];
    const r = selectActiveAssignment(list, '709', undefined, NOW);
    assert.strictEqual(r?.assignment.id, 'school');
    assert.strictEqual(r?.matchType, 'school');
  });

  test('班級作業未開始 → 退回全校作業', () => {
    const list = [
      makeAssignment({ id: 'class', className: '709', startDate: '2026-09-15T00:00:00.000Z' }),
      makeAssignment({ id: 'school', className: null }),
    ];
    const r = selectActiveAssignment(list, '709', undefined, NOW);
    assert.strictEqual(r?.assignment.id, 'school');
  });

  // ============================================================
  // 邊界：日期剛好等於 now
  // ============================================================
  test('startDate 剛好等於 now → 視為生效', () => {
    const list = [makeAssignment({ id: 'a', startDate: NOW })];
    const r = selectActiveAssignment(list, '709', undefined, NOW);
    assert.strictEqual(r?.assignment.id, 'a');
  });

  test('endDate 剛好等於 now → 視為生效', () => {
    const list = [makeAssignment({ id: 'a', endDate: NOW })];
    const r = selectActiveAssignment(list, '709', undefined, NOW);
    assert.strictEqual(r?.assignment.id, 'a');
  });

  // ============================================================
  // 純函式性質
  // ============================================================
  test('純函式：相同輸入必定相同輸出', () => {
    const list = [
      makeAssignment({ id: 'a', className: '709' }),
      makeAssignment({ id: 'b', className: null }),
    ];
    const r1 = selectActiveAssignment(list, '709', undefined, NOW);
    const r2 = selectActiveAssignment(list, '709', undefined, NOW);
    assert.deepStrictEqual(r1, r2);
  });
});