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
}