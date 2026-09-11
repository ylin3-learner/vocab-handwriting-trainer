// src/features/dashboard/hooks/useStudentDetail.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { AnalyticsService } from '../../../services/analytics/AnalyticsService';
import { StudentAnalytics } from '../../../types/analytics';

// ============================================================
// 模組級快取（所有元件共享，網頁重新整理才清空）
// ============================================================
const cache = new Map<string, StudentAnalytics>();

// 追蹤「正在進行中」的請求，避免併發重複讀取
const inflightRequests = new Map<string, Promise<StudentAnalytics>>();

// 共用一個 AnalyticsService 實例（它是無狀態的）
const analyticsService = new AnalyticsService();

// ============================================================
// Hook 本體
// ============================================================

export interface UseStudentDetailResult {
  data: StudentAnalytics | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useStudentDetail(studentId: string | null): UseStudentDetailResult {
  const [data, setData] = useState<StudentAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 追蹤元件是否已卸載，避免在卸載後 setState
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ============================================================
  // 內部：觸發 fetch（含併發去重）
  // ============================================================
  const fetchAndSet = useCallback(async (id: string) => {
    // 1. 併發去重：若已有正在進行的請求，直接沿用
    let promise = inflightRequests.get(id);
    if (!promise) {
      promise = analyticsService.getStudentDetail(id).finally(() => {
        inflightRequests.delete(id);
      });
      inflightRequests.set(id, promise);
    }

    setLoading(true);
    setError(null);

    try {
      const result = await promise;
      cache.set(id, result); // 寫入快取
      if (isMountedRef.current) {
        setData(result);
      }
    } catch (e) {
      console.error(`❌ [useStudentDetail] 載入學生 ${id} 失敗:`, e);
      if (isMountedRef.current) {
        setError(e instanceof Error ? e.message : '載入失敗');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // ============================================================
  // 主流程：studentId 改變時決定是否 fetch
  // ============================================================
  useEffect(() => {
    // 情境 A：沒有選中學生 → 清空狀態
    if (!studentId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    // 情境 B：快取命中 → 同步顯示，不觸發 fetch
    const cached = cache.get(studentId);
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
      return;
    }

    // 情境 C：快取未命中 → 觸發 fetch
    void fetchAndSet(studentId);
  }, [studentId, fetchAndSet]);

  // ============================================================
  // refetch：清除快取並強制重新讀取
  // ============================================================
  const refetch = useCallback(() => {
    if (!studentId) return;
    cache.delete(studentId);
    void fetchAndSet(studentId);
  }, [studentId, fetchAndSet]);

  return { data, loading, error, refetch };
}

// ============================================================
// 工具函式（給測試或管理員用）
// ============================================================

/** 清除單一學生的快取 */
export function clearStudentCache(studentId: string): void {
  cache.delete(studentId);
}

/** 清除所有快取（例如老師登出時） */
export function clearAllStudentCache(): void {
  cache.clear();
  inflightRequests.clear();
}