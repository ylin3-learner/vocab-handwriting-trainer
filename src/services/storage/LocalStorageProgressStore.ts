// src/services/storage/LocalStorageProgressStore.ts
import { ReviewState, createInitialReviewState } from '../../types/word';
import { ProgressStore, AttemptRecord } from './ProgressStore';

export class LocalStorageProgressStore implements ProgressStore {
  private getStateKey(studentId: string, wordId: string): string {
    return `progress_${studentId}_${wordId}`;
  }

  private getAttemptsKey(studentId: string): string {
    return `attempts_${studentId}`;
  }

  async getState(studentId: string, wordId: string): Promise<ReviewState> {
    const key = this.getStateKey(studentId, wordId);
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return createInitialReviewState();
      }
    }
    return createInitialReviewState();
  }

  async getAllStates(studentId: string): Promise<Map<string, ReviewState>> {
    const result = new Map<string, ReviewState>();
    // localStorage 沒有高效的「前綴查詢」，只能遍歷所有 key
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`progress_${studentId}_`)) {
        const wordId = key.substring(`progress_${studentId}_`.length);
        const stored = localStorage.getItem(key);
        if (stored) {
          try {
            result.set(wordId, JSON.parse(stored));
          } catch {
            // 忽略無效資料
          }
        }
      }
    }
    return result;
  }

  async saveState(studentId: string, wordId: string, state: ReviewState): Promise<void> {
    const key = this.getStateKey(studentId, wordId);
    localStorage.setItem(key, JSON.stringify(state));
  }

  async recordAttempt(attempt: AttemptRecord): Promise<void> {
    const key = this.getAttemptsKey(attempt.studentId);
    const stored = localStorage.getItem(key);
    const attempts: AttemptRecord[] = stored ? JSON.parse(stored) : [];
    attempts.push(attempt);
    localStorage.setItem(key, JSON.stringify(attempts));
  }

  // 測試用：取得某學生的所有 attempt
  getAllAttempts(studentId: string): AttemptRecord[] {
    const key = this.getAttemptsKey(studentId);
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  }
}