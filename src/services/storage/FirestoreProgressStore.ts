// src/services/storage/FirestoreProgressStore.ts
import {
  doc, getDoc, setDoc, collection, addDoc,
  query, where, getDocs, writeBatch, deleteDoc,
  runTransaction // 新增導入
} from 'firebase/firestore';
import { db } from '../../firebase';
import { ReviewState, createInitialReviewState } from '../../types/word';
import { ProgressStore, AttemptRecord } from './ProgressStore';

export class FirestoreProgressStore implements ProgressStore {
  // ----- 學生用：讀寫單字進度 -----
  async getState(studentId: string, wordId: string): Promise<ReviewState> {
    const docRef = doc(db, 'students', studentId, 'words', wordId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as ReviewState;
    }
    return createInitialReviewState();
  }

  // ----- 新增：一次取得某學生所有單字的狀態（用於初始化快取） -----
  async getAllStates(studentId: string): Promise<Map<string, ReviewState>> {
    const wordsRef = collection(db, 'students', studentId, 'words');
    const snap = await getDocs(wordsRef);
    const map = new Map<string, ReviewState>();
    snap.docs.forEach(doc => {
      map.set(doc.id, doc.data() as ReviewState);
    });
    return map;
  }

  // 核心修改：使用 runTransaction 確保原子性，防止併發覆蓋
  async saveState(studentId: string, wordId: string, state: ReviewState): Promise<void> {
    const docRef = doc(db, 'students', studentId, 'words', wordId);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);

      if (snap.exists()) {
        const existing = snap.data() as ReviewState;
        // 樂觀鎖定檢查：如果資料庫中的 totalReviews 已經大於或等於
        // 我們要寫入的 totalReviews，代表有其他程序已經更新過了，
        // 此時放棄本次寫入 (保留較新資料)。
        // (注意：state 是已經計算完成的最新狀態)
        if (existing.totalReviews > state.totalReviews) {
          // 放棄交易，不寫入
          return;
        }
      }

      // 若無衝突或文件不存在，直接寫入
      transaction.set(docRef, state);
    });
  }

  // 記錄作答 (順應新的 AttemptRecord 結構)
  async recordAttempt(attempt: AttemptRecord): Promise<void> {
    await addDoc(collection(db, 'attempts'), {
      ...attempt,
      // 確保所有新欄位都存在 (若為 undefined 則設為 null 或預設值)
      editDistance: attempt.editDistance ?? -1,
      similarity: attempt.similarity ?? 0,
      snapshotEaseFactor: attempt.snapshotEaseFactor ?? 2.5,
      snapshotInterval: attempt.snapshotInterval ?? 0,
      vocabVersion: attempt.vocabVersion ?? null,
    });
  }


  // ----- 教師專用：查詢與清理數據 -----
  async getAllStudents(): Promise<{ id: string; name?: string; class?: string }[]> {
    const studentsRef = collection(db, 'students');
    const snap = await getDocs(studentsRef);
    return snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  async getStudentStats(studentId: string): Promise<{ total: number; correct: number }> {
    const attemptsRef = collection(db, 'attempts');
    const q = query(attemptsRef, where('studentId', '==', studentId));
    const snap = await getDocs(q);
    let total = 0, correct = 0;
    snap.docs.forEach(doc => {
      const data = doc.data() as AttemptRecord;
      total++;
      if (data.isCorrect) correct++;
    });
    return { total, correct };
  }

  // 清除特定學生的所有數據
  async clearStudentData(studentId: string): Promise<void> {
    // 1. 清除該學生的所有單字進度
    const wordsRef = collection(db, 'students', studentId, 'words');
    const wordsSnap = await getDocs(wordsRef);
    const batch = writeBatch(db);
    wordsSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // 2. 清除該學生的所有作答紀錄
    const attemptsRef = collection(db, 'attempts');
    const q = query(attemptsRef, where('studentId', '==', studentId));
    const attemptsSnap = await getDocs(q);
    const batch2 = writeBatch(db);
    attemptsSnap.docs.forEach(doc => batch2.delete(doc.ref));
    await batch2.commit();

    // 3. 刪除學生文件本身
    const studentDoc = doc(db, 'students', studentId);
    await deleteDoc(studentDoc);
  }

  // 清除所有學生數據（⚠️ 危險操作）
  async clearAllStudents(): Promise<void> {
    const studentsRef = collection(db, 'students');
    const snap = await getDocs(studentsRef);
    for (const docSnap of snap.docs) {
      await this.clearStudentData(docSnap.id);
    }
    // 額外清除所有 attempts（安全起見）
    const attemptsRef = collection(db, 'attempts');
    const attemptsSnap = await getDocs(attemptsRef);
    const batch = writeBatch(db);
    attemptsSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}