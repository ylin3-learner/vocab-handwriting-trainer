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

const NOW = new Date('2026-09-14T12:00:00Z');

function makeParams(
  currentState: ReviewState,
  overrides: {
    recognizedText?: string;
    elapsedMs?: number;
    timedOut?: boolean;
  } = {}
) {
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
    now: NOW,
  };
}

const processor = new AnswerProcessor();

// ============================================================
// correctStreak 與 everWrong 生命週期
// ============================================================

describe('AnswerProcessor - everWrong 生命週期', () => {
  test('首次答對 → everWrong 保持 undefined/false，correctStreak=1', () => {
    const initial = createInitialReviewState();
    const result = processor.process(makeParams(initial));
    assert.notStrictEqual(result.nextState.everWrong, true);
    assert.strictEqual(result.nextState.correctStreak, 1);
  });

  test('首次答錯 → everWrong=true，correctStreak=0', () => {
    const initial = createInitialReviewState();
    const result = processor.process(
      makeParams(initial, { recognizedText: 'wrong' })
    );
    assert.strictEqual(result.nextState.everWrong, true);
    assert.strictEqual(result.nextState.correctStreak, 0);
  });

  test('everWrong=true，連續答對 4 次 → 仍為 true，correctStreak=4', () => {
    let state: ReviewState = {
      ...createInitialReviewState(),
      everWrong: true,
    };

    for (let i = 0; i < 4; i++) {
      const result = processor.process(makeParams(state));
      state = result.nextState;
    }

    assert.strictEqual(state.everWrong, true);
    assert.strictEqual(state.correctStreak, 4);
  });

  test('everWrong=true，連續答對 5 次 → 清除為 false，correctStreak 歸零', () => {
    let state: ReviewState = {
      ...createInitialReviewState(),
      everWrong: true,
    };

    for (let i = 0; i < 5; i++) {
      const result = processor.process(makeParams(state));
      state = result.nextState;
    }

    assert.strictEqual(state.everWrong, false);
    assert.strictEqual(state.correctStreak, 0);
  });

  test('連續答對 4 次後答錯 → everWrong 保持 true，correctStreak 歸零', () => {
    let state: ReviewState = {
      ...createInitialReviewState(),
      everWrong: true,
    };

    for (let i = 0; i < 4; i++) {
      const result = processor.process(makeParams(state));
      state = result.nextState;
    }
    assert.strictEqual(state.correctStreak, 4);

    const result = processor.process(
      makeParams(state, { recognizedText: 'wrong' })
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

  test('從未答錯的字，連續答對多次也不會變成 everWrong=true', () => {
    let state = createInitialReviewState();

    for (let i = 0; i < 5; i++) {
      const result = processor.process(makeParams(state));
      state = result.nextState;
    }

    assert.notStrictEqual(state.everWrong, true);
  });

  test('correctStreak 不受 sm2.ts 的 MASTERY_STREAK 歸零影響', () => {
    // 這個測試確保 correctStreak 是獨立計數器。
    // sm2.ts 的 consecutiveCorrect 在答對 3 次後歸零，
    // 但 correctStreak 應該繼續累積。
    let state = createInitialReviewState();

    for (let i = 0; i < 3; i++) {
      const result = processor.process(makeParams(state));
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