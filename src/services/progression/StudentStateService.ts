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
 * 職責：管理 studentStates/{displayId} 的讀寫
 *
 * 🔥 重要：Key 是 displayId（例如 "709_1_林佑綸"），不是 uid。
 *
 * 為什麼用 displayId？
 *   Firebase 匿名登入每次產生新 UID，若用 uid 當 key，
 *   學生換裝置或重新登入就會遺失學習狀態。
 *   用 displayId 才能跨 UID 持續追蹤同一位學生。
 *
 * 文件結構：
 *   studentStates/{displayId}
 *   ├── currentLevel
 *   ├── totalAttempts
 *   ├── levelLockedUntilTotalAttempts
 *   ├── lastEvaluatedAtTotalAttempts
 *   ├── levelHistory[]
 *   ├── placementDone
 *   └── placementHistory
 *
 * 設計原則：
 * - 只做 CRUD，不決定何時升級
 * - 提供原子更新的方法，避免併發問題
 * - 找不到文件時回傳初始狀態（不拋錯）
 */
export class StudentStateService {
  private getDocRef(displayId: string) {
    // 🔥 路徑改為 studentStates（原本誤用 students）
    return doc(db, 'studentStates', displayId);
  }

  /**
   * 讀取學生的學習狀態
   * 若文件不存在，回傳初始狀態
   */
  async getState(displayId: string): Promise<StudentLearningState> {
    const ref = this.getDocRef(displayId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      return createInitialLearningState(1);
    }

    const state = snap.data() as Partial<StudentLearningState> | undefined;

    if (!state) {
      return createInitialLearningState(1);
    }

    // 防禦：確保欄位完整性
    return {
      currentLevel: state.currentLevel ?? 1,
      totalAttempts: state.totalAttempts ?? 0,
      levelLockedUntilTotalAttempts: state.levelLockedUntilTotalAttempts ?? 0,
      lastEvaluatedAtTotalAttempts: state.lastEvaluatedAtTotalAttempts ?? 0,
      levelHistory: state.levelHistory ?? [],
      placementDone: state.placementDone === true,
      placementHistory: state.placementHistory,
    };
  }

  /**
   * 初始化學習狀態（若不存在才寫入）
   * 通常在學生首次登入時呼叫
   */
  async initializeIfNeeded(displayId: string, startLevel: number = 1): Promise<void> {
    const ref = this.getDocRef(displayId);
    const snap = await getDoc(ref);

    if (snap.exists()) return;

    // 🔥 文件本身就是 state，沒有 learningState 外層
    await setDoc(
      ref,
      createInitialLearningState(startLevel, false)
    );
    console.log(`🌱 [StudentStateService] 已初始化 ${displayId} 的 learningState`);
  }

  /**
   * 查詢鑑定狀態
   */
  async getPlacementStatus(displayId: string): Promise<{
    needsPlacement: boolean;
    currentLevel: number;
  }> {
    const state = await this.getState(displayId);
    return {
      needsPlacement: state.placementDone !== true,
      currentLevel: state.currentLevel,
    };
  }

  /**
   * 標記鑑定完成（用於 fallback）
   *
   * ⚠️ 這是「獨立寫入」，不是原子性操作。
   *
   * 主要用途：
   *   PlacementOrchestrator.finalize() 會用 writeBatch 一次寫入所有東西。
   *   但若 batch 失敗（例如配額耗盡），可用這個方法至少把關鍵狀態寫入，
   *   避免學生下次登入又要重新鑑定。
   */
  async markPlacementDone(
    displayId: string,
    finalLevel: number,
    history: PlacementHistoryEntry
  ): Promise<void> {
    const ref = this.getDocRef(displayId);
    // 🔥 直接寫入頂層欄位（沒有 learningState 外層）
    await setDoc(
      ref,
      {
        currentLevel: finalLevel,
        placementDone: true,
        placementHistory: history,
      },
      { merge: true }
    );
    console.log(
      `📝 [StudentStateService] ${displayId} 鑑定完成，等級 L${finalLevel}`
    );
  }

  /**
   * 更新等級（升級 / 降級）
   * 使用 arrayUnion 原子追加歷史紀錄，避免覆蓋
   */
  async updateLevel(
    displayId: string,
    newLevel: number,
    historyEntry: LevelHistoryEntry,
    lockUntil: number,
    totalAttempts: number
  ): Promise<void> {
    const ref = this.getDocRef(displayId);
    await updateDoc(ref, {
      currentLevel: newLevel,
      levelLockedUntilTotalAttempts: lockUntil,
      lastEvaluatedAtTotalAttempts: totalAttempts,
      levelHistory: arrayUnion(historyEntry),
    });
    console.log(
      `📈 [StudentStateService] ${displayId} 等級 → L${newLevel}（${historyEntry.reason}）`
    );
  }

  /**
   * 更新評估時間（但不改變等級）
   */
  async markEvaluated(displayId: string, totalAttempts: number): Promise<void> {
    const ref = this.getDocRef(displayId);
    await updateDoc(ref, {
      lastEvaluatedAtTotalAttempts: totalAttempts,
    });
  }

  /**
   * 學生答題後累加總題數。
   */
  async incrementTotalAttempts(displayId: string): Promise<void> {
    const ref = this.getDocRef(displayId);
    await updateDoc(ref, {
      totalAttempts: increment(1),
    });
  }
}