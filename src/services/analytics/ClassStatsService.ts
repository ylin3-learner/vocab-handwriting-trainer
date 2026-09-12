// src/services/analytics/ClassStatsService.ts
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, increment } from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeFirestoreId } from '../../domain/string/sanitizeId';

export interface StudentSummary {
  name: string;
  attempts: number;
  correct: number;
}

export interface WordErrorStat {
  errorCount: number;
  totalCount: number;
}

export interface ClassStats {
  className: string;
  totalAttempts: number;
  totalCorrect: number;
  students: Record<string, StudentSummary>; // key = displayId
  wordErrors: Record<string, WordErrorStat>;
  lastUpdated: string;
}

export interface RecordAttemptParams {
  className: string;
  studentId: string;
  studentName?: string;
  studentSeatNumber?: string;
  wordId: string;
  isCorrect: boolean;
}

export class ClassStatsService {
  private getDocRef(className: string) {
    return doc(db, 'classStats', className);
  }

  async getStats(className: string): Promise<ClassStats | null> {
    const snap = await getDoc(this.getDocRef(className));
    if (!snap.exists()) return null;
    return snap.data() as ClassStats;
  }

  async getAllClassStats(): Promise<ClassStats[]> {
    const ref = collection(db, 'classStats');
    const snap = await getDocs(ref);
    return snap.docs.map(d => d.data() as ClassStats);
  }

  async recordAttempt(params: RecordAttemptParams): Promise<void> {
    const { className, studentId, studentName, studentSeatNumber, wordId, isCorrect } = params;

    if (!className || !className.trim()) return;

    // field path 安全化（處理 Mrs.、O.K. 等含 . 的單字）
    const safeWordId = sanitizeFirestoreId(wordId);

    const studentDisplayId = studentName && studentSeatNumber
      ? `${className}_${studentSeatNumber}_${studentName}`
      : studentId;

    const studentDisplayName = studentName || studentId;

    const ref = this.getDocRef(className);
    const now = new Date().toISOString();

    try {
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        const initial: ClassStats = {
          className,
          totalAttempts: 1,
          totalCorrect: isCorrect ? 1 : 0,
          students: {
            [studentDisplayId]: {
              name: studentDisplayName,
              attempts: 1,
              correct: isCorrect ? 1 : 0,
            },
          },
          wordErrors: {
            [safeWordId]: {          // 用 safeWordId 當 key
              errorCount: isCorrect ? 0 : 1,
              totalCount: 1,
            },
          },
          lastUpdated: now,
        };
        await setDoc(ref, initial);
        return;
      }

      await updateDoc(ref, {
        [`students.${studentDisplayId}.name`]: studentDisplayName,
        [`students.${studentDisplayId}.attempts`]: increment(1),
        [`students.${studentDisplayId}.correct`]: increment(isCorrect ? 1 : 0),
        [`wordErrors.${safeWordId}.errorCount`]: increment(isCorrect ? 0 : 1),  // 🔥
        [`wordErrors.${safeWordId}.totalCount`]: increment(1),                  // 🔥
        totalAttempts: increment(1),
        totalCorrect: increment(isCorrect ? 1 : 0),
        lastUpdated: now,
      });
    } catch (error) {
      console.warn('⚠️ [ClassStatsService] 更新班級統計失敗（不影響主流程）:', error);
    }
  }
}