// src/services/storage/ProgressStore.ts
import { ReviewState } from '../../types/word';
import type { CorrectnessSignal } from '../../domain/grading/correctnessSignal';

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

  // 🔥 新增：把「事實」與「解讀」都持久化
  //
  // timedOut：原始事實，之前沒存，導致訓練資料無法區分
  //           「寫對但超時」與「寫錯且沒超時」
  // correctnessSignal：派生視圖，用於查詢與分流
  //                    （反正 isCorrect 也存了，這是同類設計）
  timedOut?: boolean;
  correctnessSignal?: CorrectnessSignal;

  // 🔥 新增：IME 辨識的品質訊號
  //
  // forcedMatch：系統是否主動選中了目標字
  //   false（或 undefined，舊資料）→ 高信賴度
  //   true → 中信賴度（IME 候選中有目標字，但不確定學生是否真的寫對）
  //
  // candidatesSnapshot：IME 回傳的前 5 個候選字
  //   訓練後可用於分析辨識信心分佈
  forcedMatch?: boolean;
  candidatesSnapshot?: string[];
}

export interface ProgressStore {
  getState(studentId: string, wordId: string): Promise<ReviewState>;
  getAllStates(studentId: string): Promise<Map<string, ReviewState>>;
  saveState(studentId: string, wordId: string, state: ReviewState): Promise<void>;
  recordAttempt(attempt: AttemptRecord): Promise<void>;
}