// src/services/storage/ProgressStore.ts
import { ReviewState } from '../../types/word';
import type { CorrectnessSignal } from '../../domain/grading/correctnessSignal';

// 新增：學生退出課後練習的理由
export type SessionExitReason =
  | 'mastered'      // 已掌握
  | 'fatigue'       // 認知超載/疲勞
  | 'time_limit'    // 時間不夠
  | 'other';        // 其他

export interface AttemptRecord {
  // ... (略，保持原本的 AttemptRecord 不變)
  studentId: string;
  wordId: string;
  timestamp: string;
  recognizedText: string;
  isCorrect: boolean;
  responseTimeMs: number;
  timeLimitMs?: number;
  snapshotImageUrl?: string;
  editDistance: number;
  similarity: number;
  studentDisplayId?: string;
  snapshotEaseFactor: number;
  snapshotInterval: number;
  vocabVersion?: string;
  timedOut?: boolean;
  correctnessSignal?: CorrectnessSignal;
  forcedMatch?: boolean;
  candidatesSnapshot?: string[];
  rawStrokeData?: string;
  // 新增：是否為探針題（供未來 ML 分析與錯題池隔離使用）
  isProbe?: boolean;
}

export interface ProgressStore {
  getState(studentId: string, wordId: string): Promise<ReviewState>;
  getAllStates(studentId: string): Promise<Map<string, ReviewState>>;
  saveState(studentId: string, wordId: string, state: ReviewState): Promise<void>;
  recordAttempt(attempt: AttemptRecord): Promise<void>;
}