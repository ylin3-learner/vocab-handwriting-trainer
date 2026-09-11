// src/services/progression/StudentStateService.ts
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  StudentLearningState,
  LevelHistoryEntry,
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
      // 欄位不存在（舊資料）→ 回傳初始狀態，但不寫入
      return createInitialLearningState(1);
    }

    // 防禦：確保欄位完整性
    return {
      currentLevel: state.currentLevel ?? 1,
      totalAttempts: state.totalAttempts ?? 0,
      levelLockedUntilTotalAttempts: state.levelLockedUntilTotalAttempts ?? 0,
      lastEvaluatedAtTotalAttempts: state.lastEvaluatedAtTotalAttempts ?? 0,
      levelHistory: state.levelHistory ?? [],
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
    await setDoc(
      ref,
      { learningState: createInitialLearningState(startLevel) },
      { merge: true }
    );
    console.log(`🌱 [StudentStateService] 已初始化 ${studentId} 的 learningState`);
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
}