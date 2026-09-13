// src/services/storage/FirestoreProgressStore.ts
import {
  doc, getDoc, setDoc, collection, addDoc,
  query, where, getDocs, writeBatch, deleteDoc,
  runTransaction
} from 'firebase/firestore';
import { db } from '../../firebase';
import { ReviewState, createInitialReviewState } from '../../types/word';
import { ProgressStore, AttemptRecord } from './ProgressStore';

/**
 * Firestore 進度儲存。
 *
 * 🔥 重要：SM-2 進度存在 studentStates/{displayId}/words/{wordId}
 *   （不是 students/{uid}/words/{wordId}）
 *
 * 原因：跨 UID 追蹤學生，換裝置或重新登入時進度不遺失。
 *
 * 參數 studentId 名義上保留，但實際傳入的是 displayId。
 */
export class FirestoreProgressStore implements ProgressStore {
  // ----- 學生用：讀寫單字進度 -----
  async getState(studentId: string, wordId: string): Promise<ReviewState> {
    const docRef = doc(db, 'studentStates', studentId, 'words', wordId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as ReviewState;
    }
    return createInitialReviewState();
  }

  async getAllStates(studentId: string): Promise<Map<string, ReviewState>> {
    const wordsRef = collection(db, 'studentStates', studentId, 'words');
    const snap = await getDocs(wordsRef);
    const map = new Map<string, ReviewState>();
    snap.docs.forEach(doc => {
      map.set(doc.id, doc.data() as ReviewState);
    });
    return map;
  }

  async saveState(studentId: string, wordId: string, state: ReviewState): Promise<void> {
    const docRef = doc(db, 'studentStates', studentId, 'words', wordId);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (snap.exists()) {
        const existing = snap.data() as ReviewState;
        if (existing.totalReviews > state.totalReviews) {
          return;
        }
      }
      transaction.set(docRef, state);
    });
  }

  async recordAttempt(attempt: AttemptRecord): Promise<void> {
    const safeAttempt = {
      studentId: attempt.studentId,
      studentDisplayId: attempt.studentDisplayId ?? null,
      wordId: attempt.wordId,
      timestamp: attempt.timestamp,
      recognizedText: attempt.recognizedText || '',
      isCorrect: attempt.isCorrect ?? false,
      responseTimeMs: attempt.responseTimeMs ?? 0,
      snapshotImageUrl: attempt.snapshotImageUrl || '',
      editDistance: attempt.editDistance ?? -1,
      similarity: attempt.similarity ?? 0,
      snapshotEaseFactor: attempt.snapshotEaseFactor ?? 2.5,
      snapshotInterval: attempt.snapshotInterval ?? 0,
      vocabVersion: attempt.vocabVersion ?? null,
    };

    try {
      await addDoc(collection(db, 'attempts'), safeAttempt);
    } catch (error) {
      console.warn('⚠️ Firestore recordAttempt 失敗，但本地已儲存:', error);
    }
  }

  // ----- 教師專用 -----
  async getAllStudents(): Promise<{ id: string; name?: string; class?: string }[]> {
    try {
      const studentsRef = collection(db, 'students');
      const snap = await getDocs(studentsRef);
      return snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch {
      return [];
    }
  }

  async getStudentStats(studentId: string): Promise<{ total: number; correct: number }> {
    try {
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
    } catch {
      return { total: 0, correct: 0 };
    }
  }

  async clearStudentData(studentId: string): Promise<void> {
    try {
      const wordsRef = collection(db, 'studentStates', studentId, 'words');
      const wordsSnap = await getDocs(wordsRef);
      const batch = writeBatch(db);
      wordsSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      const attemptsRef = collection(db, 'attempts');
      const q = query(attemptsRef, where('studentId', '==', studentId));
      const attemptsSnap = await getDocs(q);
      const batch2 = writeBatch(db);
      attemptsSnap.docs.forEach(doc => batch2.delete(doc.ref));
      await batch2.commit();

      const studentDoc = doc(db, 'students', studentId);
      await deleteDoc(studentDoc);
    } catch (error) {
      console.warn('清除學生數據失敗:', error);
    }
  }

  async clearAllStudents(): Promise<void> {
    try {
      const studentsRef = collection(db, 'students');
      const snap = await getDocs(studentsRef);
      for (const docSnap of snap.docs) {
        await this.clearStudentData(docSnap.id);
      }
      const attemptsRef = collection(db, 'attempts');
      const attemptsSnap = await getDocs(attemptsRef);
      const batch = writeBatch(db);
      attemptsSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (error) {
      console.warn('清除所有學生數據失敗:', error);
    }
  }
}