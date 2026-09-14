// src/domain/assignment/selectAssignment.ts

/**
 * 作業優先序查找（純函式）。
 *
 * 從 AssignmentService 抽出，讓核心決策成為可獨立測試的純函式。
 *
 * 優先序（hierarchy）：
 *   1. 個人作業（className === displayId）
 *   2. 班級作業（className === className）
 *   3. 全校作業（className === null）
 *
 * 同類型多個時：取 createdAt 最新的（老師改作業時，舊的自動失效）。
 */

export interface AssignmentCandidate {
  id: string;
  className: string | null;
  isActive: boolean;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export type AssignmentMatchType = 'personal' | 'class' | 'school';

export interface AssignmentSelectionResult<T> {
  assignment: T;
  matchType: AssignmentMatchType;
}

/**
 * 純函式：從作業清單中，按優先序選出最合適的作業。
 *
 * @param assignments 所有作業（含停用與過期）
 * @param className 班級（例如 "709"）
 * @param displayId 學生的複合識別碼（例如 "709_1_林佑綸"）；undefined 表示不查個人作業
 * @param now 當前時間（ISO 字串），由呼叫端提供以確保可測試
 * @returns 選中的作業 + 匹配類型；找不到則 null
 */
export function selectActiveAssignment<T extends AssignmentCandidate>(
  assignments: T[],
  className: string,
  displayId: string | undefined,
  now: string
): AssignmentSelectionResult<T> | null {
  // ============================================================
  // 步驟 1：過濾（啟用中 + 時間範圍內）
  // ============================================================
  const valid = assignments.filter(a => {
    if (!a.isActive) return false;
    if (a.startDate > now) return false;
    if (a.endDate < now) return false;
    return true;
  });

  // ============================================================
  // 步驟 2：從候選中取 createdAt 最新的一個
  // ============================================================
  const pickLatest = (predicate: (a: T) => boolean): T | undefined => {
    const candidates = valid.filter(predicate);
    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    )[0];
  };

  // ============================================================
  // 步驟 3：按優先序查找（個人 → 班級 → 全校）
  // ============================================================
  if (displayId) {
    const personal = pickLatest(a => a.className === displayId);
    if (personal) {
      return { assignment: personal, matchType: 'personal' };
    }
  }

  const classWide = pickLatest(a => a.className === className);
  if (classWide) {
    return { assignment: classWide, matchType: 'class' };
  }

  const schoolWide = pickLatest(a => a.className === null);
  if (schoolWide) {
    return { assignment: schoolWide, matchType: 'school' };
  }

  return null;
}