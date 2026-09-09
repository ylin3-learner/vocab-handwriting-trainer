import { ReviewState } from '../../types/word';

export interface AttemptRecord {
  studentId: string;
  wordId: string;
  timestamp: string; // ISO
  recognizedText: string;
  isCorrect: boolean;
  responseTimeMs: number;
  snapshotImageUrl?: string;
}

export interface ProgressStore {
  getState(studentId: string, wordId: string): Promise<ReviewState>;
  saveState(studentId: string, wordId: string, state: ReviewState): Promise<void>;
  recordAttempt(attempt: AttemptRecord): Promise<void>;
}