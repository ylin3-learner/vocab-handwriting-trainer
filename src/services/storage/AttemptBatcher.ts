// src/services/storage/AttemptBatcher.ts
import { writeBatch, doc, collection, increment } from 'firebase/firestore';
import { db } from '../../firebase';
import { ReviewState } from '../../types/word';
import { AttemptRecord } from './ProgressStore';
import { sanitizeFirestoreId } from '../../domain/string/sanitizeId';
import { DailySnapshot } from '../../types/dailySnapshot';

export interface AttemptBatchParams {
  studentId: string;         // uid（用於 attempts 的 studentId 欄位）
  studentDisplayId?: string; // displayId（用於 studentStates、dailySnapshots）
  className: string;
  wordId: string;
  nextState: ReviewState;
  attempt: AttemptRecord;
  isCorrect: boolean;
  studentName?: string;
  studentSeatNumber?: string;
  dailySnapshot?: DailySnapshot;
}

/**
 * 將一次作答的所有 Firestore 寫入合併為單一原子批次。
 *
 * 合併前（4~5 次網路請求）：
 *   1. studentStates/{displayId}/words/{wordId}  ← SM-2 進度
 *   2. studentStates/{displayId}                 ← totalAttempts 累加
 *   3. attempts/{autoId}                          ← 作答紀錄
 *   4. classStats/{className}                     ← 班級統計
 *   5. studentStates/{displayId}/dailySnapshots/{date} ← 每日快照
 *
 * 合併後（1 次網路請求）：writeBatch.commit()
 *
 * 🔥 所有學生狀態（SM-2、totalAttempts、快照）統一存在 studentStates/{displayId}，
 *   跨 UID 追蹤，換裝置或重新登入不遺失。
 */
export class AttemptBatcher {
  async commit(params: AttemptBatchParams): Promise<void> {
    const {
      studentId,
      studentDisplayId,
      className,
      wordId,
      nextState,
      attempt,
      isCorrect,
      studentName,
      studentSeatNumber,
      dailySnapshot,
    } = params;

    const batch = writeBatch(db);
    const safeWordId = sanitizeFirestoreId(wordId);
    const now = new Date().toISOString();

    // 🔥 統一使用 displayId（若無則 fallback uid）
    const stateKey = studentDisplayId ?? studentId;

    // ============================================================
    // 1. SM-2 進度：studentStates/{displayId}/words/{wordId}
    // ============================================================
    batch.set(
      doc(db, 'studentStates', stateKey, 'words', safeWordId),
      { ...nextState, originalWordId: wordId }
    );

    // ============================================================
    // 2. totalAttempts 累加：studentStates/{displayId}
    // ============================================================
    batch.set(
      doc(db, 'studentStates', stateKey),
      { totalAttempts: increment(1) },
      { merge: true }
    );

    // ============================================================
    // 3. 作答紀錄：attempts/{autoId}
    // ============================================================
    batch.set(doc(collection(db, 'attempts')), attempt);

    // ============================================================
    // 4. 班級統計（嵌套物件）
    // ============================================================
    if (className && className.trim()) {
      const studentDisplayIdLocal = studentName && studentSeatNumber
        ? `${className}_${studentSeatNumber}_${studentName}`
        : studentId;
      const studentDisplayName = studentName || studentId;

      batch.set(
        doc(db, 'classStats', className),
        {
          className,
          students: {
            [studentDisplayIdLocal]: {
              name: studentDisplayName,
              attempts: increment(1),
              correct: increment(isCorrect ? 1 : 0),
            },
          },
          wordErrors: {
            [safeWordId]: {
              errorCount: increment(isCorrect ? 0 : 1),
              totalCount: increment(1),
            },
          },
          totalAttempts: increment(1),
          totalCorrect: increment(isCorrect ? 1 : 0),
          lastUpdated: now,
        },
        { merge: true }
      );
    }

    // ============================================================
    // 5. 每日快照：studentStates/{displayId}/dailySnapshots/{date}
    // ============================================================
    if (dailySnapshot) {
      batch.set(
        doc(db, 'studentStates', stateKey, 'dailySnapshots', dailySnapshot.date),
        dailySnapshot
      );
    }

    await batch.commit();
  }
}