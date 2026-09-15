// src/services/profile/ProfileCleanupTracker.ts

/**
 * 職責：追蹤「每個 displayId 用過哪些 uid」，用於清理舊 profile。
 *
 * 設計原理：
 *   - displayId 是穩定識別碼（班級_座號_姓名）
 *   - uid 每次匿名登入都會變
 *   - localStorage 記錄「這個 displayId 的所有 uid」，
 *     下次登入時直接取舊清單刪除，無需查 Firestore
 *
 * 為什麼不用 Firestore 查詢？
 *   - 每次登入都 query 一次，30 個學生 = 30 次/天 額外讀取
 *   - localStorage 方案在正常使用下零 Firestore 讀取
 *   - 極端情況（換裝置、清快取）靠手動腳本兜底
 *
 * 不碰 Firestore，不碰業務邏輯，職責單一。
 */
export class ProfileCleanupTracker {
  private static getKey(displayId: string): string {
    return `__vocab_known_uids_${displayId}`;
  }

  /**
   * 讀取該 displayId 之前用過的所有 uid。
   */
  getKnownUids(displayId: string): string[] {
    try {
      const raw = localStorage.getItem(ProfileCleanupTracker.getKey(displayId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * 註冊當前 uid，並回傳「需要清理的舊 uid 清單」。
   *
   * 副作用：
   *   - 更新 localStorage，只保留當前 uid
   *   - 回傳值是需要刪除的 uid（呼叫方負責執行 delete）
   */
  registerCurrentUid(displayId: string, currentUid: string): string[] {
    const knownUids = this.getKnownUids(displayId);
    const toDelete = knownUids.filter(id => id !== currentUid);

    try {
      localStorage.setItem(
        ProfileCleanupTracker.getKey(displayId),
        JSON.stringify([currentUid])
      );
    } catch (e) {
      console.warn('⚠️ [ProfileCleanupTracker] 無法寫入 localStorage:', e);
    }

    return toDelete;
  }

  /** 清除該 displayId 的追蹤記錄（debug 用） */
  clear(displayId: string): void {
    try {
      localStorage.removeItem(ProfileCleanupTracker.getKey(displayId));
    } catch {
      // ignore
    }
  }
}