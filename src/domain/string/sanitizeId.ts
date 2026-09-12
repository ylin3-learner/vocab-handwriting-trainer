// src/domain/string/sanitizeId.ts

/**
 * 將業務 ID 轉換成 Firestore field path 安全的字串。
 *
 * 背景：
 *   Firestore 的「文件 ID」只禁止 `/`，所以 `Mrs.` 可以當 docId。
 *   但「field path」禁止 `.`、`[`、`]`、`*`、`` ` ``，
 *   所以 `wordErrors.Mrs..errorCount` 會被解析成 ["Mrs", "", "errorCount"] 而報錯。
 *
 * 這個函式把這些字元統一換成 `_`，確保 dot notation 安全。
 *
 * ⚠️ 注意：這只用於「field path 的 key」，不用於「文件 ID」。
 *    文件 ID 用的是 AdminPanel 的 sanitizeDocId（只換 `/`）。
 */
export function sanitizeFirestoreId(rawId: string): string {
  return rawId
    .trim()
    .replace(/[/\\.~*[\]()`]/g, '_');
}