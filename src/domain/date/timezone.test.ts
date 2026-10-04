import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getLocalDateString, getLocalDateStringFromISO } from './timezone';

describe('getLocalDateString', () => {
  test('UTC 白天 → 台北同日', () => {
    // UTC 2026-10-03 08:00 → 台北 2026-10-03 16:00
    const d = new Date('2026-10-03T08:00:00Z');
    assert.strictEqual(getLocalDateString(d, 'Asia/Taipei'), '2026-10-03');
  });

  test('UTC 16:00 → 台北跨日', () => {
    // UTC 2026-10-03 16:00 → 台北 2026-10-04 00:00
    const d = new Date('2026-10-03T16:00:00Z');
    assert.strictEqual(getLocalDateString(d, 'Asia/Taipei'), '2026-10-04');
  });

  test('UTC 15:59 → 台北同日', () => {
    const d = new Date('2026-10-03T15:59:00Z');
    assert.strictEqual(getLocalDateString(d, 'Asia/Taipei'), '2026-10-03');
  });

  test('夏令時：美國東岸', () => {
    // 美國東岸夏天是 UTC-4
    const summer = new Date('2026-07-15T02:00:00Z');
    assert.strictEqual(getLocalDateString(summer, 'America/New_York'), '2026-07-14');

    // 美國東岸冬天是 UTC-5
    const winter = new Date('2026-01-15T02:00:00Z');
    assert.strictEqual(getLocalDateString(winter, 'America/New_York'), '2026-01-14');
  });

  test('無效時區 → fallback 到 +8 小時', () => {
    const d = new Date('2026-10-03T16:00:00Z');
    assert.strictEqual(getLocalDateString(d, 'Invalid/Zone'), '2026-10-04');
  });
});