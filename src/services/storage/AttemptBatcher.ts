// src/services/storage/AttemptBatcher.ts
import { writeBatch, doc, collection, increment } from 'firebase/firestore';
import { db } from '../../firebase';
import { ReviewState } from '../../types/word';
import { AttemptRecord } from './ProgressStore';
import { sanitizeFirestoreId } from '../../domain/string/sanitizeId';
import { DailySnapshot } from '../../types/dailySnapshot';
import { removeUndefined } from '../../domain/firestore/removeUndefined';

export interface AttemptBatchParams {
  studentId: string;
  studentDisplayId?: string;
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
 * 合併前（6 次網路請求）：
 *   1. studentStates/{displayId}/words/{wordId}          ← SM-2 進度
 *   2. studentStates/{displayId}                          ← totalAttempts 累加
 *   3. attempts/{autoId}                                  ← 作答紀錄
 *   4. classStats/{className}                             ← 班級統計
 *   5. studentStates/{displayId}/dailySnapshots/{date}    ← 每日快照
 *   6. studentStates/{displayId}/dailyStats/{date}        ← 每日累計
 *
 * 合併後（1 次網路請求）：writeBatch.commit()
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

    const stateKey = studentDisplayId ?? studentId;

    // ============================================================
    // 1. SM-2 進度：studentStates/{displayId}/words/{wordId}
    // ============================================================
    batch.set(
      doc(db, 'studentStates', stateKey, 'words', safeWordId),
      {
        ...removeUndefined(nextState as unknown as Record<string, unknown>),
        originalWordId: wordId,
      }
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
    batch.set(
      doc(collection(db, 'attempts')),
      removeUndefined(attempt as unknown as Record<string, unknown>)
    );

    // ============================================================
    // 4. 班級統計
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
    // 5. 每日快照 + 每日累計
    //
    // 兩者一起寫入，因為它們都需要 dailySnapshot.date：
    //   - dailySnapshots: 給成長曲線用的聚合快照（每次覆寫）
    //   - dailyStats:     給 init 讀取的權威累計（用 increment 累加）
    // ============================================================
    if (dailySnapshot) {
      // 5a. 每日快照（覆寫）
      batch.set(
        doc(db, 'studentStates', stateKey, 'dailySnapshots', dailySnapshot.date),
        dailySnapshot
      );

      // 5b. 每日累計（原子遞增）
      batch.set(
        doc(db, 'studentStates', stateKey, 'dailyStats', dailySnapshot.date),
        {
          date: dailySnapshot.date,
          answeredCount: increment(1),
          correctCount: increment(isCorrect ? 1 : 0),
          totalResponseTimeMs: increment(attempt.responseTimeMs ?? 0),
          lastUpdated: now,
        },
        { merge: true }
      );
    }

    console.log('🔥 [AttemptBatcher] 準備 commit 的資料:', attempt);

    await batch.commit();
  }
}