// src/features/quiz/QuizSessionApi.ts
import { QuizQuestion, AnswerSubmission, SubmitAnswerResult } from './QuizOrchestrator';
import { ActiveAssignment } from '../../services/assignment/AssignmentService';

/**
 * QuizScreen 需要的介面。
 *
 * 為什麼需要這個介面？
 *   QuizOrchestrator 用於日常練習，PlacementOrchestrator 用於程度鑑定。
 *   兩者的 UI 完全相同（手寫、IME、計時、判分），
 *   差別只在「選字策略」與「升級邏輯」。
 *
 * 讓 QuizScreen 依賴這個介面，就能同時服務兩種模式，
 * 避免重複 90% 的程式碼。
 */
export interface QuizSessionApi {
  /** 初始化（載入單字池、讀取狀態） */
  init(): Promise<void>;

  /** 取得下一題 */
  nextQuestion(): Promise<QuizQuestion | null>;

  /** 提交答案 */
  submitAnswer(
    wordId: string,
    submission: AnswerSubmission
  ): Promise<SubmitAnswerResult>;

  /** 取得作業資訊（供 UI 顯示） */
  getActiveAssignment(): ActiveAssignment | null;

  /** 取得每日進度（供 UI 顯示） */
  getDailyProgress(): { answered: number; max: number };

  /**
   * 取得 UI 顯示資訊。
   *
   * 普通模式：📋 作業名稱 ・ 進度 5/30
   * 鑑定模式：🎯 程度鑑定 ・ 進度 3/12
   */
  getDisplayInfo(): SessionDisplayInfo;

  /**
   * 結束 session 時呼叫（可選）。
   *
   * QuizOrchestrator：無需實作（每次答題都已寫入）
   * PlacementOrchestrator：在此時執行原子性寫入
   */
  finalizeSession?(): Promise<void>;
}

export interface SessionDisplayInfo {
  mode: 'normal' | 'placement';
  /** 標題，例如「每日練習」或「程度鑑定」 */
  title: string;
  /** 副標題，例如作業名稱或引導文字 */
  subtitle: string;
  /** 當前進度 */
  progressCurrent: number;
  /** 總進度（普通模式是每日配額，鑑定模式是 12） */
  progressTotal: number;
  /** 進度標籤，例如「進度」或「鑑定進度」 */
  progressLabel: string;
  /** 是否顯示進度條 */
  showProgress: boolean;
}