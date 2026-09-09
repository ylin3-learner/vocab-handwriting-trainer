// src/services/storage/FirestoreProgressStore.ts
import { 
  doc, getDoc, setDoc, collection, addDoc, 
  query, where, getDocs, writeBatch, deleteDoc 
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

  async saveState(studentId: string, wordId: string, state: ReviewState): Promise<void> {
    const docRef = doc(db, 'students', studentId, 'words', wordId);
    await setDoc(docRef, state);
  }

  async recordAttempt(attempt: AttemptRecord): Promise<void> {
    await addDoc(collection(db, 'attempts'), {
      ...attempt,
      // timestamp 已經是 ISO 字串，直接存
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