// src/services/analytics/ClassStatsService.ts
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, increment } from 'firebase/firestore';
import { db } from '../../firebase';

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
  students: Record<string, StudentSummary>;
  wordErrors: Record<string, WordErrorStat>;
  lastUpdated: string;
}

export interface RecordAttemptParams {
  className: string;
  studentId: string;
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

  // 學生作答時呼叫（失敗不影響主流程）
  async recordAttempt(params: RecordAttemptParams): Promise<void> {
    const { className, studentId, wordId, isCorrect } = params;

    // 班級為空時跳過（無法歸類）
    if (!className || !className.trim()) return;

    const ref = this.getDocRef(className);
    const now = new Date().toISOString();

    try {
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        // 首次建立文件
        const initial: ClassStats = {
          className,
          totalAttempts: 1,
          totalCorrect: isCorrect ? 1 : 0,
          students: {
            [studentId]: {
              name: studentId,
              attempts: 1,
              correct: isCorrect ? 1 : 0,
            },
          },
          wordErrors: {
            [wordId]: {
              errorCount: isCorrect ? 0 : 1,
              totalCount: 1,
            },
          },
          lastUpdated: now,
        };
        await setDoc(ref, initial);
        return;
      }

      // 已有文件：用 dot notation + increment 原子更新
      await updateDoc(ref, {
        [`students.${studentId}.name`]: studentId,
        [`students.${studentId}.attempts`]: increment(1),
        [`students.${studentId}.correct`]: increment(isCorrect ? 1 : 0),
        [`wordErrors.${wordId}.errorCount`]: increment(isCorrect ? 0 : 1),
        [`wordErrors.${wordId}.totalCount`]: increment(1),
        totalAttempts: increment(1),
        totalCorrect: increment(isCorrect ? 1 : 0),
        lastUpdated: now,
      });
    } catch (error) {
      console.warn('⚠️ [ClassStatsService] 更新班級統計失敗（不影響主流程）:', error);
    }
  }
}