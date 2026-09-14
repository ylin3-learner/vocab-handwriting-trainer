// src/services/progression/StudentStateService.ts
import { doc, getDoc, setDoc, updateDoc, arrayUnion, increment, deleteField } from 'firebase/firestore';
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
 * 🔥 Key 是 displayId（例如 "709_1_林佑綸"），不是 uid。
 *   跨 UID 追蹤學生，換裝置或重新登入不遺失。
 */
export class StudentStateService {
  private getDocRef(displayId: string) {
    return doc(db, 'studentStates', displayId);
  }

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

    return {
      currentLevel: state.currentLevel ?? 1,
      totalAttempts: state.totalAttempts ?? 0,
      levelLockedUntilTotalAttempts: state.levelLockedUntilTotalAttempts ?? 0,
      lastEvaluatedAtTotalAttempts: state.lastEvaluatedAtTotalAttempts ?? 0,
      levelHistory: state.levelHistory ?? [],
      placementDone: state.placementDone === true,
      placementHistory: state.placementHistory,
      customSpeechFloor: state.customSpeechFloor,
    };
  }

  async initializeIfNeeded(displayId: string, startLevel: number = 1): Promise<void> {
    const ref = this.getDocRef(displayId);
    const snap = await getDoc(ref);

    if (snap.exists()) return;

    await setDoc(ref, createInitialLearningState(startLevel, false));
    console.log(`🌱 [StudentStateService] 已初始化 ${displayId} 的 learningState`);
  }

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

  async markPlacementDone(
    displayId: string,
    finalLevel: number,
    history: PlacementHistoryEntry
  ): Promise<void> {
    const ref = this.getDocRef(displayId);
    await setDoc(
      ref,
      {
        currentLevel: finalLevel,
        placementDone: true,
        placementHistory: history,
      },
      { merge: true }
    );
    console.log(`📝 [StudentStateService] ${displayId} 鑑定完成，等級 L${finalLevel}`);
  }

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
    console.log(`📈 [StudentStateService] ${displayId} 等級 → L${newLevel}（${historyEntry.reason}）`);
  }

  async markEvaluated(displayId: string, totalAttempts: number): Promise<void> {
    const ref = this.getDocRef(displayId);
    await updateDoc(ref, {
      lastEvaluatedAtTotalAttempts: totalAttempts,
    });
  }

  async incrementTotalAttempts(displayId: string): Promise<void> {
    const ref = this.getDocRef(displayId);
    await updateDoc(ref, {
      totalAttempts: increment(1),
    });
  }

  /**
   * 🔥 更新個人語速下限
   *
   * @param value 0.5 ~ 1.0 的數字；傳 null 表示清除個人設定（回到作業/系統預設）
   */
  async updateCustomSpeechFloor(displayId: string, value: number | null): Promise<void> {
    const ref = this.getDocRef(displayId);
    if (value === null) {
      await updateDoc(ref, { customSpeechFloor: deleteField() });
      console.log(`🔊 [StudentStateService] ${displayId} 已清除個人語速下限`);
    } else {
      await updateDoc(ref, { customSpeechFloor: value });
      console.log(`🔊 [StudentStateService] ${displayId} 個人語速下限 → ${value}`);
    }
  }
}