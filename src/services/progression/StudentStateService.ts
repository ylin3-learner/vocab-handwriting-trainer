// src/services/progression/StudentStateService.ts
import { doc, getDoc, setDoc, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  StudentLearningState,
  LevelHistoryEntry,
  PlacementHistoryEntry,
  createInitialLearningState,
} from '../../types/progression';

/**
 * 職責：管理 students/{uid}.learningState 的讀寫
 *
 * 設計原則：
 * - 只做 CRUD，不決定何時升級
 * - 提供原子更新的方法，避免併發問題
 * - 找不到文件時回傳初始狀態（不拋錯）
 */
export class StudentStateService {
  private getDocRef(studentId: string) {
    return doc(db, 'students', studentId);
  }

  /**
   * 讀取學生的學習狀態
   * 若文件不存在或無 learningState 欄位，回傳初始狀態
   */
  async getState(studentId: string): Promise<StudentLearningState> {
    const ref = this.getDocRef(studentId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      return createInitialLearningState(1);
    }

    const data = snap.data();
    const state = data?.learningState as StudentLearningState | undefined;

    if (!state) {
      // 欄位不存在 → 回傳初始狀態，但不寫入
      return createInitialLearningState(1);
    }

    // 防禦：確保欄位完整性（含 Stage 2 新增的 placementDone）
    return {
      currentLevel: state.currentLevel ?? 1,
      totalAttempts: state.totalAttempts ?? 0,
      levelLockedUntilTotalAttempts: state.levelLockedUntilTotalAttempts ?? 0,
      lastEvaluatedAtTotalAttempts: state.lastEvaluatedAtTotalAttempts ?? 0,
      levelHistory: state.levelHistory ?? [],
      // 🔥 Stage 2：placementDone 若未設定，視為 false（需鑑定）
      placementDone: state.placementDone === true,
      placementHistory: state.placementHistory,
    };
  }

  /**
   * 初始化學習狀態（若不存在才寫入）
   * 通常在學生首次登入時呼叫
   */
  async initializeIfNeeded(studentId: string, startLevel: number = 1): Promise<void> {
    const ref = this.getDocRef(studentId);
    const snap = await getDoc(ref);

    if (!snap.exists()) return;

    const data = snap.data();
    if (data?.learningState) return;

    // 用 setDoc + merge 避免覆蓋其他欄位
    // 🔥 Stage 2：新學生的 placementDone = false，需要鑑定
    await setDoc(
      ref,
      { learningState: createInitialLearningState(startLevel, false) },
      { merge: true }
    );
    console.log(`🌱 [StudentStateService] 已初始化 ${studentId} 的 learningState`);
  }

  /**
   * 🔥 Stage 2 新增：查詢鑑定狀態
   *
   * @returns needsPlacement: 是否需要鑑定
   *          currentLevel: 當前等級（未鑑定時為初始值）
   */
  async getPlacementStatus(studentId: string): Promise<{
    needsPlacement: boolean;
    currentLevel: number;
  }> {
    const state = await this.getState(studentId);
    return {
      needsPlacement: state.placementDone !== true,
      currentLevel: state.currentLevel,
    };
  }

  /**
   * 🔥 Stage 2 新增：標記鑑定完成（用於 fallback）
   *
   * ⚠️ 這是「獨立寫入」，不是原子性操作。
   *
   * 主要用途：
   *   PlacementOrchestrator.finalize() 會用 writeBatch 一次寫入所有東西。
   *   但若 batch 失敗（例如配額耗盡），可用這個方法至少把關鍵狀態寫入，
   *   避免學生下次登入又要重新鑑定。
   *
   * @param finalLevel 鑑定結果的等級
   * @param history 完整鑑定紀錄
   */
  async markPlacementDone(
    studentId: string,
    finalLevel: number,
    history: PlacementHistoryEntry
  ): Promise<void> {
    const ref = this.getDocRef(studentId);
    await updateDoc(ref, {
      'learningState.currentLevel': finalLevel,
      'learningState.placementDone': true,
      'learningState.placementHistory': history,
    });
    console.log(
      `📝 [StudentStateService] ${studentId} 鑑定完成，等級 L${finalLevel}`
    );
  }

  /**
   * 更新等級（升級 / 降級）
   * 使用 arrayUnion 原子追加歷史紀錄，避免覆蓋
   */
  async updateLevel(
    studentId: string,
    newLevel: number,
    historyEntry: LevelHistoryEntry,
    lockUntil: number,
    totalAttempts: number
  ): Promise<void> {
    const ref = this.getDocRef(studentId);
    await updateDoc(ref, {
      'learningState.currentLevel': newLevel,
      'learningState.levelLockedUntilTotalAttempts': lockUntil,
      'learningState.lastEvaluatedAtTotalAttempts': totalAttempts,
      'learningState.levelHistory': arrayUnion(historyEntry),
    });
    console.log(
      `📈 [StudentStateService] ${studentId} 等級 → L${newLevel}（${historyEntry.reason}）`
    );
  }

  /**
   * 更新評估時間（但不改變等級）
   * 用於「表現穩定」時，避免每 10 題重複評估
   */
  async markEvaluated(studentId: string, totalAttempts: number): Promise<void> {
    const ref = this.getDocRef(studentId);
    await updateDoc(ref, {
      'learningState.lastEvaluatedAtTotalAttempts': totalAttempts,
    });
  }

  /**
   * 學生答題後累加總題數。
   *
   * 這應該在每次 submitAnswer 時呼叫，確保跨 session 的題數精確累計。
   * 使用 Firestore 的 `increment` 原子操作，避免併發覆蓋。
   */
  async incrementTotalAttempts(studentId: string): Promise<void> {
    const ref = this.getDocRef(studentId);
    await updateDoc(ref, {
      'learningState.totalAttempts': increment(1),
    });
  }
}