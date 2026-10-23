// src/features/quiz/AnswerProcessor.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AnswerProcessor } from './AnswerProcessor';
import { Word, ReviewState, createInitialReviewState } from '../../types/word';

// ============================================================
// 測試工具
// ============================================================

const mockWord: Word = {
  id: 'apple',
  word: 'apple',
  meaning: '蘋果',
  sentence: 'I eat an apple every day.',
};

const BASE_DATE = new Date('2026-09-14T12:00:00Z').getTime();

function makeParams(
  currentState: ReviewState,
  overrides: {
    recognizedText?: string;
    elapsedMs?: number;
    timedOut?: boolean;
    dayOffset?: number; // 🔥 新增：用來模擬跨天
  } = {}
) {
  // 每次可以傳入 dayOffset，模擬過了幾天
  const now = new Date(BASE_DATE + (overrides.dayOffset ?? 0) * 24 * 60 * 60 * 1000);

  return {
    word: mockWord,
    submission: {
      recognizedText: overrides.recognizedText ?? 'apple',
      elapsedMs: overrides.elapsedMs ?? 2000,
      timedOut: overrides.timedOut ?? false,
    },
    currentState,
    timeLimitMs: 8000,
    studentId: 'test-student',
    studentDisplayId: '709_1_測試生',
    now,
    studentTimeZone: 'Asia/Taipei', // 🔥 補上傳入時區
  };
}

const processor = new AnswerProcessor();

// ============================================================
// correctStreak 與 everWrong 生命週期（雙軌解耦測試）
// ============================================================

describe('AnswerProcessor - everWrong 生命週期 (雙軌解耦)', () => {
  test('首次答對 → everWrong 保持 false，correctStreak=1，dailyStreak=1', () => {
    const initial = createInitialReviewState();
    const result = processor.process(makeParams(initial));
    assert.strictEqual(result.nextState.everWrong, false);
    assert.strictEqual(result.nextState.correctStreak, 1);
    assert.strictEqual(result.nextState.dailyStreak, 1);
  });

  test('首次答錯 → everWrong=true，correctStreak=0，dailyStreak=0', () => {
    const initial = createInitialReviewState();
    const result = processor.process(
      makeParams(initial, { recognizedText: 'wrong' })
    );
    assert.strictEqual(result.nextState.everWrong, true);
    assert.strictEqual(result.nextState.correctStreak, 0);
    assert.strictEqual(result.nextState.dailyStreak, 0);
  });

  test('everWrong=true，同一天內連續答對 4 次 → correctStreak 仍為 1，dailyStreak=4', () => {
    let state: ReviewState = {
      ...createInitialReviewState(),
      everWrong: true,
    };

    // 模擬同一天內按了 4 次提交
    for (let i = 0; i < 4; i++) {
      const result = processor.process(makeParams(state, { dayOffset: 0 }));
      state = result.nextState;
    }

    assert.strictEqual(state.everWrong, true);
    assert.strictEqual(state.correctStreak, 1); // 跨天計數器只有第一天加 1
    assert.strictEqual(state.dailyStreak, 4);   // 日內計數器加到 4
  });

  test('everWrong=true，跨 5 天皆答對 → 清除為 false，correctStreak 歸零', () => {
    let state: ReviewState = {
      ...createInitialReviewState(),
      everWrong: true,
    };

    // 模擬跨 5 天，每天答對 1 次
    for (let i = 0; i < 5; i++) {
      const result = processor.process(makeParams(state, { dayOffset: i }));
      state = result.nextState;
    }

    assert.strictEqual(state.everWrong, false);
    assert.strictEqual(state.correctStreak, 0); // 畢業後歸零
    assert.strictEqual(state.dailyStreak, 1);
  });

  test('跨天答對 4 次後，隔天答錯 → everWrong 保持 true，correctStreak 歸零', () => {
    let state: ReviewState = {
      ...createInitialReviewState(),
      everWrong: true,
    };

    for (let i = 0; i < 4; i++) {
      const result = processor.process(makeParams(state, { dayOffset: i }));
      state = result.nextState;
    }
    assert.strictEqual(state.correctStreak, 4);

    // 第 5 天答錯
    const result = processor.process(
      makeParams(state, { dayOffset: 5, recognizedText: 'wrong' })
    );
    state = result.nextState;

    assert.strictEqual(state.everWrong, true);
    assert.strictEqual(state.correctStreak, 0);
  });

  test('清除 everWrong 後答錯 → 重新標記為 true', () => {
    let state: ReviewState = {
      ...createInitialReviewState(),
      everWrong: false,
      correctStreak: 0,
    };

    const result = processor.process(
      makeParams(state, { recognizedText: 'wrong' })
    );

    assert.strictEqual(result.nextState.everWrong, true);
    assert.strictEqual(result.nextState.correctStreak, 0);
  });

  test('從未答錯的字，跨天連續答對多次也不會變成 everWrong=true', () => {
    let state = createInitialReviewState();

    for (let i = 0; i < 5; i++) {
      const result = processor.process(makeParams(state, { dayOffset: i }));
      state = result.nextState;
    }

    assert.notStrictEqual(state.everWrong, true);
  });

  test('correctStreak 不受 sm2.ts 的 MASTERY_STREAK 歸零影響', () => {
    let state = createInitialReviewState();

    for (let i = 0; i < 3; i++) {
      const result = processor.process(makeParams(state, { dayOffset: i }));
      state = result.nextState;
    }

    // 3 次後 consecutiveCorrect 應已歸零，但 correctStreak 應為 3
    assert.strictEqual(state.consecutiveCorrect, 0);
    assert.strictEqual(state.correctStreak, 3);
  });
});

// ============================================================
// 評分與排程基本行為
// ============================================================

describe('AnswerProcessor - 評分與排程', () => {
  test('答對時 isCorrect = true，attempt 有正確記錄', () => {
    const result = processor.process(makeParams(createInitialReviewState()));

    assert.strictEqual(result.grading.isCorrect, true);
    assert.strictEqual(result.attempt.wordId, 'apple');
    assert.strictEqual(result.attempt.isCorrect, true);
    assert.strictEqual(result.attempt.studentId, 'test-student');
    assert.strictEqual(result.attempt.studentDisplayId, '709_1_測試生');
  });

  test('答錯時 isCorrect = false', () => {
    const result = processor.process(
      makeParams(createInitialReviewState(), { recognizedText: 'wrong' })
    );
    assert.strictEqual(result.grading.isCorrect, false);
    assert.strictEqual(result.attempt.isCorrect, false);
  });

  test('超時提交 → 視為錯誤', () => {
    const result = processor.process(
      makeParams(createInitialReviewState(), {
        elapsedMs: 9000,
        timedOut: true,
        recognizedText: '',
      })
    );
    assert.strictEqual(result.grading.isCorrect, false);
  });

  test('純函式性質：相同輸入必定相同輸出', () => {
    const initial = createInitialReviewState();
    const r1 = processor.process(makeParams(initial));
    const r2 = processor.process(makeParams(initial));
    const r3 = processor.process(makeParams(initial));

    assert.deepStrictEqual(r1.nextState, r2.nextState);
    assert.deepStrictEqual(r2.nextState, r3.nextState);
  });
});