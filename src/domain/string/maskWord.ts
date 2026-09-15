// src/domain/string/maskWord.ts
import { stem } from './porterStemmer';

/**
 * 在句子中遮罩指定單字及其屈折變化。
 *
 * 演算法：
 *   1. 對目標單字做詞幹提取（Porter Stemmer）
 *   2. 對句子中的每個詞也做詞幹提取
 *   3. 詞幹相同 + 長度相近 → 視為同一單字 → 遮罩
 *
 * 為什麼不直接比較詞幹就好，還要看長度？
 *   防止極端情況：某些短詞的詞幹可能與長詞意外相同。
 *   加入長度限制是「安全網」，不是主要判斷邏輯。
 *
 * 為什麼保留原詞長度的下底線？
 *   教學設計：讓學生知道答案有幾個字母。
 *   例如 "recited" → "_______"，學生知道要寫 7 個字母。
 *
 * @example
 *   maskWordInSentence("I eat an apple every day.", "apple")
 *   // → "I eat an _____ every day."
 *
 *   maskWordInSentence("The child recited a poem.", "recite")
 *   // → "The child _______ a poem."
 *
 *   maskWordInSentence("An APPLE a day.", "apple")
 *   // → "An _____ a day."
 */
export function maskWordInSentence(sentence: string, word: string): string {
  if (!sentence || !word) return sentence;

  const targetStem = stem(word);
  if (targetStem.length === 0) return sentence;

  // 🔥 長度上限：允許的屈折後綴最大長度
  //    -ed (2), -ing (3), -est (3), -ness (4)
  const MAX_INFLECTION_LENGTH = 4;

  // 用 regex 切出「字母詞」與「非字母詞」，保留原本的空白與標點
  const tokens = sentence.split(/(\b)/);

  const masked = tokens.map((token) => {
    // 只處理純字母
    if (!/^[a-zA-Z]+$/.test(token)) return token;

    const tokenStem = stem(token);
    if (tokenStem !== targetStem) return token;

    // 🔥 安全網：長度差距過大就不是屈折變化
    //    例如目標 "art"，候選 "article"（兩者詞幹雖同為 'art'，但語意不同）
    const lengthDiff = Math.abs(token.length - word.length);
    if (lengthDiff > MAX_INFLECTION_LENGTH) return token;

    return '_'.repeat(token.length);
  });

  return masked.join('');
}