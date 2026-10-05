// src/features/dashboard/hooks/useStudentDetail.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { AnalyticsService } from '../../../services/analytics/AnalyticsService';
import { StudentAnalytics } from '../../../types/analytics';

// ============================================================
// 模組級快取（所有元件共享，網頁重新整理才清空）
// ============================================================
const CACHE_TTL_MS = 5 * 60 * 1000;

// 🔥 手動重新整理時，spinner 的最短顯示時間。
//
// 為什麼需要最短顯示時間：
//   快取命中時，請求可能在 50ms 內完成。若 spinner 一閃而過，
//   使用者會感覺「剛剛到底有沒有更新」。設定最短 600ms，讓
//   使用者能「感知到」更新動作。
//
// 為什麼選 600ms：
//   - 尼爾森 100ms 門檻：低於此使用者感覺「沒反應」
//   - 1 秒門檻：超過此使用者開始感覺「卡頓」
//   - 600ms 是兩者之間的安全值
const REFRESH_MIN_SPINNER_MS = 600;

interface CachedEntry {
  data: StudentAnalytics;
  timestamp: number;
}

const cache = new Map<string, CachedEntry>();
const inflightRequests = new Map<string, Promise<StudentAnalytics>>();
const analyticsService = new AnalyticsService();

export interface UseStudentDetailResult {
  data: StudentAnalytics | null;
  loading: boolean;
  /** 手動重新整理中。用於顯示按鈕的 spinner。 */
  isRefreshing: boolean;
  error: string | null;
  refetch: () => void;
  lastFetchedAt: number | null;
}

export function useStudentDetail(studentId: string | null): UseStudentDetailResult {
  const [data, setData] = useState<StudentAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ============================================================
  // 內部：觸發 fetch
  //
  // @param showLoading  是否顯示全域 loading（初次載入 / 切換學生時 true）
  // @param forceServer  是否跳過 Layer 2 快取（手動重新整理時 true）
  // ============================================================
  const fetchAndSet = useCallback(async (
    id: string,
    showLoading: boolean = true,
    forceServer: boolean = false
  ) => {
    // 併發去重：若已有正在進行的請求且「不是強制更新」，直接沿用
    let promise = inflightRequests.get(id);
    if (!promise || forceServer) {
      promise = analyticsService.getStudentDetail(id, { forceServer }).finally(() => {
        inflightRequests.delete(id);
      });
      inflightRequests.set(id, promise);
    }

    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await promise;
      const now = Date.now();
      cache.set(id, { data: result, timestamp: now });
      if (isMountedRef.current) {
        setData(result);
        setLastFetchedAt(now);
      }
    } catch (e) {
      console.error(`❌ [useStudentDetail] 載入學生 ${id} 失敗:`, e);
      if (isMountedRef.current) {
        setError(e instanceof Error ? e.message : '載入失敗');
      }
    } finally {
      if (isMountedRef.current && showLoading) {
        setLoading(false);
      }
    }
  }, []);

  // ============================================================
  // 主流程：studentId 改變時決定是否 fetch
  // ============================================================
  useEffect(() => {
    if (!studentId) {
      setData(null);
      setError(null);
      setLoading(false);
      setLastFetchedAt(null);
      return;
    }

    const cached = cache.get(studentId);
    if (cached) {
      setData(cached.data);
      setLastFetchedAt(cached.timestamp);
      setError(null);
      setLoading(false);

      const isStale = Date.now() - cached.timestamp >= CACHE_TTL_MS;
      if (isStale) {
        void fetchAndSet(studentId, false);
      }
      return;
    }

    void fetchAndSet(studentId, true);
  }, [studentId, fetchAndSet]);

  // ============================================================
  // refetch：手動重新整理（強制走伺服器 + 最短 spinner 時間）
  // ============================================================
  const refetch = useCallback(async () => {
    if (!studentId) return;

    cache.delete(studentId);
    setIsRefreshing(true);

    try {
      // 🔥 並行等待「fetch 完成」與「最短顯示時間經過」
      await Promise.all([
        fetchAndSet(studentId, false, true),  // showLoading=false, forceServer=true
        new Promise(resolve => setTimeout(resolve, REFRESH_MIN_SPINNER_MS)),
      ]);
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [studentId, fetchAndSet]);

  return { data, loading, isRefreshing, error, refetch, lastFetchedAt };
}

// ============================================================
// 工具函式
// ============================================================

export function clearStudentCache(studentId: string): void {
  cache.delete(studentId);
}

export function clearAllStudentCache(): void {
  cache.clear();
  inflightRequests.clear();
}