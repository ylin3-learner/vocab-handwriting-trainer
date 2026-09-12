// src/services/progression/PerformanceTracker.ts
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { AttemptRecord } from '../storage/ProgressStore';
import { Word } from '../../types/word';
import { FirestoreWordRepository } from '../wordRepository/FirestoreWordRepository';
import { calculateMetrics } from '../../domain/progression/metricsCalculator';
import { PerformanceMetrics } from '../../types/progression';

/**
 * 職責：從 Firestore 撈取學生的作答紀錄，聚合成策略需要的指標
 *
 * 設計原則：
 * - 不決定「要不要升級」（這是策略的職責）
 * - 不碰 UI
 * - 只做「資料獲取 + 委派純函式計算」
 */
/**
 * 職責：從 Firestore 撈取學生的作答紀錄，聚合成策略需要的指標
 *
 * 🔥 Key 改為 displayId：
 *   attempts 文件同時存有 studentId（uid）和 studentDisplayId，
 *   查詢時用 studentDisplayId 才能跨 UID 追蹤同一位學生。
 */
export class PerformanceTracker {
  private wordRepository = new FirestoreWordRepository();

  /** 滑動視窗大小（最近 N 題） */
  private static readonly WINDOW_SIZE = 30;

  /**
   * 取得學生近期的表現指標
   *
   * @param displayId Firebase UID
   * @param currentLevel 當前等級（用於計算 attemptsInCurrentLevel）
   */
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
      where('displayId', '==', displayId),
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
    const wordLevelMap = new Map<string, string>();
    for (const w of words) {
      wordLevelMap.set(w.id, w.level ?? '1');
    }

    // ============================================================
    // 步驟 3：計算 attemptsInCurrentLevel
    // ============================================================
    const attemptsInCurrentLevel = attempts.filter(
      (a) => Number(wordLevelMap.get(a.wordId)) === currentLevel
    ).length;

    // ============================================================
    // 步驟 4：委派純函式計算指標
    // ============================================================
    return calculateMetrics(attempts, attemptsInCurrentLevel);
  }

  // ============================================================
  // 邊界情境：完全沒有作答紀錄
  // ============================================================
  private emptyMetrics(): PerformanceMetrics {
    return {
      recentAttempts: 0,
      correctRate: 0,
      avgResponseTimeMs: 0,
      timeoutRate: 0,
      attemptsInCurrentLevel: 0,
      consecutiveCorrect: 0,
      consecutiveWrong: 0,
    };
  }
}