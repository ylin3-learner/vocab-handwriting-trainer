// src/services/status/quotaMonitor.ts

/**
 * Firestore 配額監控。
 *
 * 兩種偵測方式：
 *   1. Monkey patch window.fetch：自動偵測 429 回應
 *   2. notifyQuotaExceeded()：供業務層主動通知（例如熔斷器）
 *
 * 一旦偵測到，會通知所有訂閱者，UI 層可顯示全域提示。
 */

type Listener = (isExceeded: boolean) => void;

const listeners = new Set<Listener>();
let exceeded = false;

function notify(isExceeded: boolean): void {
  if (exceeded === isExceeded) return;
  exceeded = isExceeded;
  listeners.forEach((fn) => {
    try {
      fn(isExceeded);
    } catch (e) {
      console.warn('[quotaMonitor] listener error:', e);
    }
  });
}

/** 主動通知：配額耗盡 */
export function notifyQuotaExceeded(): void {
  notify(true);
}

/** 重置狀態（例如：管理員手動解除） */
export function resetQuotaStatus(): void {
  notify(false);
}

/** 訂閱配額狀態，回傳取消訂閱函式 */
export function subscribeQuotaStatus(fn: Listener): () => void {
  listeners.add(fn);
  fn(exceeded); // 立即回報當前狀態
  return () => {
    listeners.delete(fn);
  };
}

/** 目前是否處於配額耗盡狀態 */
export function isQuotaExceeded(): boolean {
  return exceeded;
}

// ============================================================
// 自動偵測：Monkey patch window.fetch
// ============================================================
(function patchFetch() {
  if (typeof window === 'undefined') return;
  if ((window as any).__quotaMonitorPatched) return;
  (window as any).__quotaMonitorPatched = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);

    // 429 = Too Many Requests（Firestore 配額耗盡）
    // 503 = Service Unavailable（暫時不可用，也可視為同類問題）
    if (response.status === 429 || response.status === 503) {
      notify(true);
    }

    return response;
  };

  console.log('🔍 [quotaMonitor] fetch 監控已啟用');
})();