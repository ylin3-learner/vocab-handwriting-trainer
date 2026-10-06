// src/services/progression/PerformanceTracker.ts
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { AttemptRecord } from '../storage/ProgressStore';
import { Word } from '../../types/word';
import { FirestoreWordRepository } from '../wordRepository/FirestoreWordRepository';
import { calculateMetrics } from '../../domain/progression/metricsCalculator';
import { PerformanceMetrics } from '../../types/progression';

export class PerformanceTracker {
  private wordRepository = new FirestoreWordRepository();

  /** 滑動窗口大小（最近 N 題） */
  private static readonly WINDOW_SIZE = 30;

  async getRecentMetrics(
    displayId: string,
    currentLevel: number
  ): Promise<PerformanceMetrics> {
    // ============================================================
    // 步驟 1：取得最近 N 筆 attempts
    // ============================================================
    const attemptsRef = collection(db, 'attempts');
    const q = query(
      attemptsRef,
      where('studentDisplayId', '==', displayId),
      orderBy('timestamp', 'desc'),
      limit(PerformanceTracker.WINDOW_SIZE)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      return this.emptyMetrics();
    }

    const attempts: AttemptRecord[] = snap.docs.map(
      (d) => d.data() as AttemptRecord
    );

    // ============================================================
    // 步驟 2：取得這些 attempts 對應的單字等級
    // ============================================================
    const wordIds = Array.from(new Set(attempts.map((a) => a.wordId)));
    let words: Word[] = [];
    try {
      words = await this.wordRepository.getWordsByIds(wordIds);
    } catch (e) {
      console.warn('⚠️ [PerformanceTracker] 無法取得單字等級，使用保守估計:', e);
    }
    const wordLevelMap = new Map<string, number>();
    for (const w of words) {
      const lv = Number(w.level ?? '1');
      if (!isNaN(lv)) wordLevelMap.set(w.id, lv);
    }

    // ============================================================
    // 🔥 步驟 3：拆解 attemptsInCurrentLevel
    // ============================================================
    let attemptsAtLevel = 0;
    let attemptsBelowLevel = 0;
    let attemptsAboveLevel = 0;
    let probeCorrectCount = 0;

    for (const a of attempts) {
      const lv = wordLevelMap.get(a.wordId);
      if (lv === undefined) {
        // 查不到等級 → 保守算入 atLevel
        attemptsAtLevel++;
        continue;
      }
      if (lv === currentLevel) {
        attemptsAtLevel++;
      } else if (lv < currentLevel) {
        attemptsBelowLevel++;
      } else {
        attemptsAboveLevel++;
        if (a.isCorrect) probeCorrectCount++;
      }
    }

    const attemptsInCurrentLevel = attemptsAtLevel + attemptsBelowLevel;
    const probeCorrectRate =
      attemptsAboveLevel > 0 ? probeCorrectCount / attemptsAboveLevel : 0;

    // ============================================================
    // 步驟 4：委派純函式計算指標
    // ============================================================
    return calculateMetrics(attempts, attemptsInCurrentLevel, {
      attemptsAtLevel,
      attemptsBelowLevel,
      attemptsAboveLevel,
      probeCorrectRate,
    });
  }

  private emptyMetrics(): PerformanceMetrics {
    return {
      recentAttempts: 0,
      correctRate: 0,
      avgResponseTimeMs: 0,
      timeoutRate: 0,
      attemptsInCurrentLevel: 0,
      attemptsAtLevel: 0,
      attemptsBelowLevel: 0,
      attemptsAboveLevel: 0,
      probeCorrectRate: 0,
      earlyCorrectRate: 0,
      lateCorrectRate: 0,
      trend: 0,
      consecutiveCorrect: 0,
      consecutiveWrong: 0,
    };
  }
}