// src/features/quiz/QuizSessionApi.ts
import { QuizQuestion, AnswerSubmission, SubmitAnswerResult } from './QuizOrchestrator';
import { ActiveAssignment } from '../../services/assignment/AssignmentService';

/**
 * QuizScreen 需要的介面。
 *
 * QuizOrchestrator 用於日常練習，PlacementOrchestrator 用於程度鑑定。
 * 兩者共用 UI，差別在選字策略、升級邏輯、與是否提供慢速重聽。
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

  /** 取得 UI 顯示資訊 */
  getDisplayInfo(): SessionDisplayInfo;

  /**
   * 首次播放語速（預設 1.0）。
   * 學生第一次聽題目時使用。
   */
  getSpeechRate(): number;

  /**
   * 慢速重聽的下限語速。
   *
   * - 回傳數字：提供「🐢 重聽一次（慢速）」按鈕
   * - 回傳 null：不提供重聽（例如鑑定模式）
   */
  getSpeechFloorRate(): number | null;

  /**
   * 🔥 是否允許學生主動繼續練習（done 頁面判斷用）。
   *
   * - true：顯示「繼續練習」按鈕
   * - false：不顯示
   * - 未實作：視為 false（例如 Placement 沒有「繼續」概念）
   */
  canOfferContinue?(): boolean;

  /**
   * 🔥 學生按下「繼續練習」按鈕時呼叫。
   *
   * 效果：切換 session 進入 continue 模式，之後不再停止。
   * 幂等：多次呼叫只生效一次。
   */
  continueSession?(): void;

  /**
   * 結束 session 時呼叫（可選）。
   */
  finalizeSession?(): Promise<void>;
}

export interface SessionDisplayInfo {
  mode: 'normal' | 'placement';
  title: string;
  subtitle: string;
  progressCurrent: number;
  progressTotal: number;
  progressLabel: string;
  showProgress: boolean;
}