// src/domain/firestore/removeUndefined.ts

/**
 * 過濾物件中所有值為 undefined 的欄位。
 *
 * 為什麼需要？
 *   Firestore 的 addDoc / setDoc / updateDoc 一律拒絕 undefined 值，
 *   會拋出「Unsupported field value: undefined」錯誤。
 *
 *   但 TypeScript 的 optional 欄位（`field?: T`）很容易產生 undefined，
 *   例如：{ targetLevel: undefined }。
 *
 *   這個函式讓呼叫方可以放心傳入含 optional 欄位的物件，
 *   由它負責在寫入前清理。
 *
 * 設計原則：
 *   - 純函式，不碰 Firestore
 *   - 保留 null（Firestore 接受 null，語意與 undefined 不同）
 *   - 保留 0、false、空字串（這些是合法值）
 *
 * @example
 *   removeUndefined({ a: 1, b: undefined, c: null, d: false })
 *   // → { a: 1, c: null, d: false }
 */
export function removeUndefined<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}