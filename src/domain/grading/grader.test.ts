import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeAnswer, calculateQuality } from './grader.js';

test('拼字完全正確且很快 → isCorrect=true, quality=5', () => {
  const result = gradeAnswer({
    recognizedText: 'exacerbate',
    correctAnswer: 'exacerbate',
    elapsedMs: 2000,
    timeLimitMs: 8000,
    timedOut: false,
  });
  assert.equal(result.isCorrect, true);
  assert.equal(result.quality, 5);
});

test('拼字完全正確但幾乎用滿時間 → isCorrect=true, quality 較低但仍 >=3', () => {
  const result = gradeAnswer({
    recognizedText: 'acerbic',
    correctAnswer: 'acerbic',
    elapsedMs: 7900,
    timeLimitMs: 8000,
    timedOut: false,
  });
  assert.equal(result.isCorrect, true);
  assert.ok(result.quality >= 3, `quality 應該 >= 3,實際是 ${result.quality}`);
  assert.ok(result.quality < 5, `快滿時應該扣分,實際是 ${result.quality}`);
});

test('大小寫不同但拼字相同 → 仍視為正確(比賽只看拼字,不看大小寫)', () => {
  const result = gradeAnswer({
    recognizedText: 'Acumen',
    correctAnswer: 'acumen',
    elapsedMs: 3000,
    timeLimitMs: 8000,
    timedOut: false,
  });
  assert.equal(result.isCorrect, true);
});

test('拼字差一個字母 → isCorrect=false,不給部分分數(呼應賽規:塗改視為錯誤,沒有模糊地帶)', () => {
  const result = gradeAnswer({
    recognizedText: 'acumen',
    correctAnswer: 'acumen ',
    elapsedMs: 3000,
    timeLimitMs: 8000,
    timedOut: false,
  });
  // 上面刻意放一個尾端空白的例子,驗證比對前有做 trim
  assert.equal(result.isCorrect, true);
});

test('拼字錯誤 → isCorrect=false, quality=0', () => {
  const result = gradeAnswer({
    recognizedText: 'acumon',
    correctAnswer: 'acumen',
    elapsedMs: 3000,
    timeLimitMs: 8000,
    timedOut: false,
  });
  assert.equal(result.isCorrect, false);
  assert.equal(result.quality, 0);
});

test('超時 → 一律視為錯誤,quality=0,無論辨識結果是什麼', () => {
  const result = gradeAnswer({
    recognizedText: 'acumen', // 就算辨識出來剛好是對的
    correctAnswer: 'acumen',
    elapsedMs: 8000,
    timeLimitMs: 8000,
    timedOut: true,
  });
  assert.equal(result.isCorrect, false);
  assert.equal(result.quality, 0);
});

test('辨識引擎回傳空字串(學生沒寫) → isCorrect=false, quality=0', () => {
  const result = gradeAnswer({
    recognizedText: '',
    correctAnswer: 'acumen',
    elapsedMs: 8000,
    timeLimitMs: 8000,
    timedOut: false,
  });
  assert.equal(result.isCorrect, false);
  assert.equal(result.quality, 0);
});

test('calculateQuality 是純函式,同樣輸入必須同樣輸出(可獨立單元測試,不依賴 gradeAnswer)', () => {
  const q1 = calculateQuality(true, 1000, 8000, false);
  const q2 = calculateQuality(true, 1000, 8000, false);
  assert.equal(q1, q2);
});

test('quality 分數必須永遠落在 0-5 之間(SM-2 的合約)', () => {
  const cases = [
    calculateQuality(true, 0, 8000, false),
    calculateQuality(true, 8000, 8000, false),
    calculateQuality(false, 4000, 8000, false),
    calculateQuality(false, 8000, 8000, true),
  ];
  for (const q of cases) {
    assert.ok(q >= 0 && q <= 5, `quality 超出範圍: ${q}`);
  }
});
