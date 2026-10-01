// src/features/dashboard/hooks/useStudentDetail.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { AnalyticsService } from '../../../services/analytics/AnalyticsService';
import { StudentAnalytics } from '../../../types/analytics';

// ============================================================
// 模組級快取（所有元件共享，網頁重新整理才清空）
//
// 🔥 加入時間戳，5 分鐘 TTL，避免看到過期資料。
//   工業界推薦的「Stale-While-Revalidate」策略：
//   - 快取新鮮（< 5 min）：直接用，不 fetch
//   - 快取過期（≥ 5 min）：先顯示舊資料，背景更新
//   - 無快取：顯示 loading，fetch
// ============================================================
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedEntry {
  data: StudentAnalytics;
  timestamp: number;
}

const cache = new Map<string, CachedEntry>();

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
  /** 資料最後抓取的時間（毫秒 timestamp）。null 表示尚未抓取過。 */
  lastFetchedAt: number | null;
}

export function useStudentDetail(studentId: string | null): UseStudentDetailResult {
  const [data, setData] = useState<StudentAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

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
  //
  // @param showLoading true 時顯示 loading 狀態。
  //                    背景更新時傳 false（不打擾使用者）。
  // ============================================================
  const fetchAndSet = useCallback(async (id: string, showLoading: boolean = true) => {
    // 1. 併發去重：若已有正在進行的請求，直接沿用
    let promise = inflightRequests.get(id);
    if (!promise) {
      promise = analyticsService.getStudentDetail(id).finally(() => {
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
  //
  // 三段邏輯：
  //   1. 無 studentId → 清空
  //   2. 有快取 → 立即顯示（不管新舊）
  //      - 新鮮（< 5 min）→ 不 fetch
  //      - 過期（≥ 5 min）→ 背景 fetch（不顯示 loading）
  //   3. 無快取 → fetch（顯示 loading）
  // ============================================================
  useEffect(() => {
    // 情境 A：沒有選中學生 → 清空狀態
    if (!studentId) {
      setData(null);
      setError(null);
      setLoading(false);
      setLastFetchedAt(null);
      return;
    }

    // 情境 B：快取存在 → 立即顯示（Stale-While-Revalidate）
    const cached = cache.get(studentId);
    if (cached) {
      setData(cached.data);
      setLastFetchedAt(cached.timestamp);
      setError(null);
      setLoading(false);

      // 判斷是否過期
      const isStale = Date.now() - cached.timestamp >= CACHE_TTL_MS;
      if (isStale) {
        // 背景更新（不顯示 loading）
        void fetchAndSet(studentId, false);
      }
      return;
    }

    // 情境 C：無快取 → fetch（顯示 loading）
    void fetchAndSet(studentId, true);
  }, [studentId, fetchAndSet]);

  // ============================================================
  // refetch：清除快取並強制重新讀取
  // ============================================================
  const refetch = useCallback(() => {
    if (!studentId) return;
    cache.delete(studentId);
    void fetchAndSet(studentId, true);
  }, [studentId, fetchAndSet]);

  return { data, loading, error, refetch, lastFetchedAt };
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