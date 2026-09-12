// src/services/storage/AttemptBatcher.ts
import { writeBatch, doc, collection, increment } from 'firebase/firestore';
import { db } from '../../firebase';
import { ReviewState } from '../../types/word';
import { AttemptRecord } from './ProgressStore';
import { sanitizeFirestoreId } from '../../domain/string/sanitizeId';

export interface AttemptBatchParams {
  studentId: string;
  className: string;
  wordId: string;
  nextState: ReviewState;
  attempt: AttemptRecord;
  isCorrect: boolean;
  studentName?: string;
  studentSeatNumber?: string;
}

/**
 * 將一次作答的所有 Firestore 寫入合併為單一原子批次。
 *
 * 合併前（4 次網路請求）：
 *   1. students/{uid}/words/{wordId}  ← SM-2 進度
 *   2. students/{uid}                 ← totalAttempts 累加
 *   3. attempts/{autoId}              ← 作答紀錄
 *   4. classStats/{className}         ← 班級統計
 *
 * 合併後（1 次網路請求）：writeBatch.commit()
 *
 * 原子性保證：所有寫入要嘛全成功，要嘛全失敗，
 * 避免「進度寫了但 attempt 沒寫」這種資料不一致。
 */
export class AttemptBatcher {
  async commit(params: AttemptBatchParams): Promise<void> {
    const {
      studentId,
      className,
      wordId,
      nextState,
      attempt,
      isCorrect,
      studentName,
      studentSeatNumber,
    } = params;

    const batch = writeBatch(db);
    const safeWordId = sanitizeFirestoreId(wordId);
    const now = new Date().toISOString();

    // ============================================================
    // 1. SM-2 進度：students/{uid}/words/{wordId}
    // ============================================================
    batch.set(
      doc(db, 'students', studentId, 'words', safeWordId),
      { ...nextState, originalWordId: wordId }
    );

    // ============================================================
    // 2. totalAttempts 累加：students/{uid}
    //    用 set + merge 處理「文件不存在」的邊界情況
    // ============================================================
    batch.set(
      doc(db, 'students', studentId),
      { learningState: { totalAttempts: increment(1) } },
      { merge: true }
    );

    // ============================================================
    // 3. 作答紀錄：attempts/{autoId}
    // ============================================================
    batch.set(doc(collection(db, 'attempts')), attempt);

    // ============================================================
    // 4. 班級統計：classStats/{className}（有班級才更新）
    // ============================================================
    if (className && className.trim()) {
      const studentDisplayId = studentName && studentSeatNumber
        ? `${className}_${studentSeatNumber}_${studentName}`
        : studentId;
      const studentDisplayName = studentName || studentId;

      batch.set(
        doc(db, 'classStats', className),
        {
          className,
          [`students.${studentDisplayId}.name`]: studentDisplayName,
          [`students.${studentDisplayId}.attempts`]: increment(1),
          [`students.${studentDisplayId}.correct`]: increment(isCorrect ? 1 : 0),
          [`wordErrors.${safeWordId}.errorCount`]: increment(isCorrect ? 0 : 1),
          [`wordErrors.${safeWordId}.totalCount`]: increment(1),
          totalAttempts: increment(1),
          totalCorrect: increment(isCorrect ? 1 : 0),
          lastUpdated: now,
        },
        { merge: true }
      );
    }

    await batch.commit();
  }
}