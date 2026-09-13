// src/services/storage/LocalStorageProgressStore.ts
import { ReviewState, createInitialReviewState } from '../../types/word';
import { ProgressStore, AttemptRecord } from './ProgressStore';

/**
 * 本地進度儲存（localStorage）。
 *
 * 🔥 參數 studentId 名義上保留，但實際傳入的是 displayId。
 * localStorage key 用 displayId，跨裝置時不共享（裝置本地就是本地）。
 */
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

  getAllAttempts(studentId: string): AttemptRecord[] {
    const key = this.getAttemptsKey(studentId);
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  }
}