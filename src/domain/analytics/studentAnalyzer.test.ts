// src/domain/analytics/studentAnalyzer.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { analyzeStudent } from './studentAnalyzer';
import { AttemptRecord } from '../../services/storage/ProgressStore';
import { Word } from '../../types/word';

// ============================================================
// 測試工具
// ============================================================

function makeAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    studentId: 'test-student',
    wordId: 'apple',
    timestamp: new Date().toISOString(),
    recognizedText: 'apple',
    isCorrect: true,
    responseTimeMs: 2000,
    editDistance: 0,
    similarity: 1,
    snapshotEaseFactor: 2.5,
    snapshotInterval: 1,
    ...overrides,
  };
}

const mockWordMap = new Map<string, Word>([
  ['apple', { id: 'apple', word: 'apple', meaning: '蘋果', sentence: 'I eat an apple.' }],
  ['banana', { id: 'banana', word: 'banana', meaning: '香蕉', sentence: 'I eat a banana.' }],
]);

const testProfile = {
  studentId: 'test-student',
  name: '測試學生',
  className: '701',
};

// ============================================================
// 測試案例
// ============================================================

describe('analyzeStudent', () => {
  test('空陣列：回傳 insufficient-data 且所有數字為 0', () => {
    const result = analyzeStudent([], testProfile, mockWordMap);

    assert.strictEqual(result.totalAttempts, 0);
    assert.strictEqual(result.correctRate, 0);
    assert.strictEqual(result.learningStyle, 'insufficient-data');
    assert.deepStrictEqual(result.weakestWords, []);
    assert.deepStrictEqual(result.errorBreakdown, {
      spelling: 0,
      completelyWrong: 0,
      timeout: 0,
    });
  });

  test('全對：correctRate = 100%', () => {
    const attempts = [
      makeAttempt({ isCorrect: true, responseTimeMs: 1000 }),
      makeAttempt({ isCorrect: true, responseTimeMs: 2000 }),
      makeAttempt({ isCorrect: true, responseTimeMs: 3000 }),
      makeAttempt({ isCorrect: true, responseTimeMs: 4000 }),
      makeAttempt({ isCorrect: true, responseTimeMs: 5000 }),
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.correctCount, 5);
    assert.strictEqual(result.correctRate, 100);
    assert.strictEqual(result.errorBreakdown.spelling, 0);
    assert.strictEqual(result.errorBreakdown.completelyWrong, 0);
    assert.strictEqual(result.errorBreakdown.timeout, 0);
  });

  test('5 題錯 2 題：correctRate = 60%', () => {
    const attempts = [
      makeAttempt({ isCorrect: true }),
      makeAttempt({ isCorrect: true }),
      makeAttempt({ isCorrect: true }),
      makeAttempt({ isCorrect: false, editDistance: 1, similarity: 0.9 }),
      makeAttempt({ isCorrect: false, editDistance: 2, similarity: 0.7 }),
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.correctCount, 3);
    assert.strictEqual(result.correctRate, 60);
  });

  test('拼字小錯：editDistance 1~3 且 similarity >= 0.5', () => {
    const attempts = [
      makeAttempt({ isCorrect: false, editDistance: 1, similarity: 0.9, responseTimeMs: 2000 }),
      makeAttempt({ isCorrect: false, editDistance: 2, similarity: 0.7, responseTimeMs: 2000 }),
      makeAttempt({ isCorrect: false, editDistance: 3, similarity: 0.6, responseTimeMs: 2000 }),
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.errorBreakdown.spelling, 3);
    assert.strictEqual(result.errorBreakdown.completelyWrong, 0);
  });

  test('完全不會：similarity < 0.3 或空字串', () => {
    const attempts = [
      makeAttempt({ isCorrect: false, similarity: 0.1, recognizedText: 'xyz', responseTimeMs: 2000 }),
      makeAttempt({ isCorrect: false, similarity: 0, recognizedText: '', responseTimeMs: 2000 }),
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.errorBreakdown.completelyWrong, 2);
    assert.strictEqual(result.errorBreakdown.spelling, 0);
  });

  test('超時：responseTimeMs > 8000 優先歸類為 timeout', () => {
    const attempts = [
      makeAttempt({ isCorrect: false, responseTimeMs: 9000, editDistance: 1, similarity: 0.9 }),
      makeAttempt({ isCorrect: false, responseTimeMs: 16414, similarity: 0, recognizedText: '' }),
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.errorBreakdown.timeout, 2);
    assert.strictEqual(result.errorBreakdown.spelling, 0);
    assert.strictEqual(result.errorBreakdown.completelyWrong, 0);
  });

  test('反應時間分佈：fast / normal / slow', () => {
    const attempts = [
      makeAttempt({ responseTimeMs: 1000 }),  // fast
      makeAttempt({ responseTimeMs: 2500 }),  // fast
      makeAttempt({ responseTimeMs: 5000 }),  // normal
      makeAttempt({ responseTimeMs: 8000 }),  // normal
      makeAttempt({ responseTimeMs: 12000 }), // slow
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.responseTimeDistribution.fast, 2);
    assert.strictEqual(result.responseTimeDistribution.normal, 2);
    assert.strictEqual(result.responseTimeDistribution.slow, 1);
  });

  test('弱點單字：只列出錯過的字，按 wrongCount 降序', () => {
    const attempts = [
      makeAttempt({ wordId: 'apple', isCorrect: false }),
      makeAttempt({ wordId: 'apple', isCorrect: false }),
      makeAttempt({ wordId: 'apple', isCorrect: true }),
      makeAttempt({ wordId: 'banana', isCorrect: false }),
      makeAttempt({ wordId: 'banana', isCorrect: true }),
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    // 使用 ! 斷言，告訴 TypeScript「我保證這裡一定有值」
    assert.strictEqual(result.weakestWords[0]!.wordId, 'apple');
    assert.strictEqual(result.weakestWords[0]!.word, 'apple');
    assert.strictEqual(result.weakestWords[0]!.wrongCount, 2);
    assert.strictEqual(result.weakestWords[1]!.wordId, 'banana');
    assert.strictEqual(result.weakestWords[1]!.wrongCount, 1);
  });

  test('學習風格：快又準 (fast-accurate)', () => {
    const attempts = Array.from({ length: 10 }, () =>
      makeAttempt({ isCorrect: true, responseTimeMs: 1500 })
    );
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.learningStyle, 'fast-accurate');
  });

  test('學習風格：慢又錯 (slow-inaccurate)', () => {
    const attempts = Array.from({ length: 10 }, () =>
      makeAttempt({ isCorrect: false, responseTimeMs: 6000, editDistance: 3, similarity: 0.6 })
    );
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.learningStyle, 'slow-inaccurate');
  });

  test('學習風格：樣本 < 5 題 → insufficient-data', () => {
    const attempts = [
      makeAttempt({ isCorrect: true, responseTimeMs: 1000 }),
      makeAttempt({ isCorrect: true, responseTimeMs: 1000 }),
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.learningStyle, 'insufficient-data');
  });

  test('找不到 wordMap 中的單字時，fallback 顯示 wordId', () => {
    const attempts = [
      makeAttempt({ wordId: 'unknown-word', isCorrect: false }),
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.weakestWords[0]!.word, 'unknown-word');
  });

  test('近 7 天活躍天數：同一天多筆只算一天', () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const attempts = [
      makeAttempt({ timestamp: today }),
      makeAttempt({ timestamp: today }),
      makeAttempt({ timestamp: yesterday }),
      makeAttempt({ timestamp: longAgo }), // 超過 7 天，不算
    ];
    const result = analyzeStudent(attempts, testProfile, mockWordMap);

    assert.strictEqual(result.activeDaysLast7, 2);
  });
});