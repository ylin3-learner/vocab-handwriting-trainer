// src/domain/analytics/resolveLevelOnDate.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveLevelOnDate } from './resolveLevelOnDate';
import type { LevelHistoryEntry } from '../../types/progression';

const TZ = 'Asia/Taipei';

function entry(
  level: number,
  changedAt: string,
  triggeredBy: LevelHistoryEntry['triggeredBy'] = 'promotion'
): LevelHistoryEntry {
  return { level, changedAt, reason: 'test', triggeredBy };
}

describe('resolveLevelOnDate', () => {
  // ============================================================
  // 邊界：空歷史
  // ============================================================
  test('空 levelHistory → fallback 到 L1', () => {
    assert.strictEqual(resolveLevelOnDate('2026-10-15', [], TZ), 1);
  });

  // ============================================================
  // 邊界：目標日期早於所有歷史
  // ============================================================
  test('目標日期早於所有歷史 → fallback 到 L1', () => {
    const history = [
      entry(3, '2026-10-10T00:00:00.000Z'),
    ];
    assert.strictEqual(resolveLevelOnDate('2026-10-05', history, TZ), 1);
  });

  // ============================================================
  // 邊界：單筆歷史，目標日期之後
  // ============================================================
  test('單筆歷史且日期在其後 → 回傳該等級', () => {
    const history = [
      entry(3, '2026-10-01T00:00:00.000Z'),
    ];
    assert.strictEqual(resolveLevelOnDate('2026-10-05', history, TZ), 3);
  });

  // ============================================================
  // 主邏輯：多筆歷史，取最新一筆 <= 目標日期
  // ============================================================
  test('多筆歷史 → 取最新一筆 <= 目標日期', () => {
    const history = [
      entry(1, '2026-09-24T00:00:00.000Z', 'initial'),
      entry(3, '2026-10-03T00:00:00.000Z'),
      entry(5, '2026-10-04T00:00:00.000Z'),
      entry(4, '2026-10-06T00:00:00.000Z', 'demotion'),
    ];

    // 10/02：還沒升到 L3 → L1
    assert.strictEqual(resolveLevelOnDate('2026-10-02', history, TZ), 1);
    // 10/03：升到 L3
    assert.strictEqual(resolveLevelOnDate('2026-10-03', history, TZ), 3);
    // 10/05：升到 L5
    assert.strictEqual(resolveLevelOnDate('2026-10-05', history, TZ), 5);
    // 10/07：降回 L4
    assert.strictEqual(resolveLevelOnDate('2026-10-07', history, TZ), 4);
  });

  // ============================================================
  // 時區邊界：UTC 深夜 = 台北隔天
  // ============================================================
  test('跨日邊界：UTC 23:00 → 台北隔天', () => {
    // 台北時間 10/05 07:00 = UTC 10/04 23:00
    const history = [
      entry(3, '2026-10-04T23:00:00.000Z'),
    ];
    // 台北 10/05 已經看到這個變更
    assert.strictEqual(resolveLevelOnDate('2026-10-05', history, TZ), 3);
    // 台北 10/04 還沒
    assert.strictEqual(resolveLevelOnDate('2026-10-04', history, TZ), 1);
  });
});