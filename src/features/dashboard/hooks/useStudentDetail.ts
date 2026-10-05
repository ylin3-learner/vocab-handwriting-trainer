// src/features/dashboard/hooks/useStudentDetail.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { AnalyticsService } from '../../../services/analytics/AnalyticsService';
import { StudentAnalytics } from '../../../types/analytics';

const CACHE_TTL_MS = 5 * 60 * 1000;
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
  isRefreshing: boolean;
  error: string | null;
  refetch: () => void;
  lastFetchedAt: number | null;
  /**
   * 🔥 前端最後一次「從 server 成功讀取」此學生的時間。
   *
   * 與 lastFetchedAt 的差別：
   *   lastFetchedAt：每次 fetch 都更新（含 cache 命中）
   *   lastServerFetchedAt：只有 dataSource === 'server' 時更新
   *
   * 用途：UI 判斷資料新鮮度。若資料來自 cache 而 lastServerFetchedAt
   *      超過 30 分鐘，則顯示「資料可能已過期」警告。
   */
  lastServerFetchedAt: number | null;
}

export function useStudentDetail(studentId: string | null): UseStudentDetailResult {
  const [data, setData] = useState<StudentAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  // 🔥 新增：追蹤每個學生的最後 server fetch 時間
  const [serverFetchTimes, setServerFetchTimes] = useState<Map<string, number>>(new Map());

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchAndSet = useCallback(async (
    id: string,
    showLoading: boolean = true,
    forceServer: boolean = false
  ) => {
    let promise = inflightRequests.get(id);
    if (!promise || forceServer) {
      promise = analyticsService.getStudentDetail(id, { forceServer }).finally(() => {
        inflightRequests.delete(id);
      });
      inflightRequests.set(id, promise);
    }

    if (showLoading) setLoading(true);
    setError(null);

    try {
      const result = await promise;
      const now = Date.now();
      cache.set(id, { data: result, timestamp: now });

      if (isMountedRef.current) {
        setData(result);
        setLastFetchedAt(now);

        // 🔥 只有 server 來源才更新 serverFetchTimes
        if (result.dataSource === 'server') {
          setServerFetchTimes(prev => {
            const next = new Map(prev);
            next.set(id, now);
            return next;
          });
        }
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

  const refetch = useCallback(async () => {
    if (!studentId) return;

    cache.delete(studentId);
    setIsRefreshing(true);

    try {
      await Promise.all([
        fetchAndSet(studentId, false, true),
        new Promise(resolve => setTimeout(resolve, REFRESH_MIN_SPINNER_MS)),
      ]);
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [studentId, fetchAndSet]);

  const lastServerFetchedAt = studentId
    ? serverFetchTimes.get(studentId) ?? null
    : null;

  return {
    data,
    loading,
    isRefreshing,
    error,
    refetch,
    lastFetchedAt,
    lastServerFetchedAt,  // 🔥 新增
  };
}

export function clearStudentCache(studentId: string): void {
  cache.delete(studentId);
}

export function clearAllStudentCache(): void {
  cache.clear();
  inflightRequests.clear();
}