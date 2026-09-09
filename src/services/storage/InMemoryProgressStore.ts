// src/services/storage/InMemoryProgressStore.ts
import { ReviewState, createInitialReviewState } from '../../types/word';
import { ProgressStore, AttemptRecord } from './ProgressStore';

export class InMemoryProgressStore implements ProgressStore {
  private states = new Map<string, ReviewState>();
  private attempts: AttemptRecord[] = [];

  async getState(studentId: string, wordId: string): Promise<ReviewState> {
    const key = `${studentId}|${wordId}`;
    const existing = this.states.get(key);
    if (existing) {
      return { ...existing };
    }
    return createInitialReviewState();
  }

  async saveState(studentId: string, wordId: string, state: ReviewState): Promise<void> {
    const key = `${studentId}|${wordId}`;
    this.states.set(key, { ...state });
  }

  async recordAttempt(attempt: AttemptRecord): Promise<void> {
    this.attempts.push({ ...attempt });
  }

  getAllAttempts(): AttemptRecord[] {
    return this.attempts;
  }

  // ✅ 新增 getAllStates 方法，實作 ProgressStore 介面
  async getAllStates(studentId: string): Promise<Map<string, ReviewState>> {
    const result = new Map<string, ReviewState>();
    for (const [key, state] of this.states) {
      if (key.startsWith(studentId + '|')) {
        const wordId = key.substring(studentId.length + 1);
        result.set(wordId, { ...state });
      }
    }
    return result;
  }
}