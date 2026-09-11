// src/services/storage/ProgressStore.ts
import { ReviewState } from '../../types/word';

export interface AttemptRecord {
  // === 既有欄位 ===
  studentId: string;
  wordId: string;
  timestamp: string; // ISO
  recognizedText: string;
  isCorrect: boolean;
  responseTimeMs: number;
  snapshotImageUrl?: string;

  // === Sprint 6-B 新增：資料品質訊號 (Data Quality Signals) ===
  editDistance: number;          // Levenshtein 編輯距離
  similarity: number;            // 歸一化相似度 (0~1)

  // === Stage 2.5：教師儀表板用的複合識別碼 ===
  // 格式：`${className}_${studentSeatNumber}_${studentName}`
  // 若學生未填班級或座號，則為 undefined
  studentDisplayId?: string;
  
  // 儲存當下的 SM-2 狀態快照 (供未來記憶曲線使用)
  snapshotEaseFactor: number;
  snapshotInterval: number;
  
  // 預留給未來單字庫版本管理
  vocabVersion?: string;         // 例如 "v2026"
}

export interface ProgressStore {
  getState(studentId: string, wordId: string): Promise<ReviewState>;
  getAllStates(studentId: string): Promise<Map<string, ReviewState>>;
  saveState(studentId: string, wordId: string, state: ReviewState): Promise<void>;
  recordAttempt(attempt: AttemptRecord): Promise<void>;
}