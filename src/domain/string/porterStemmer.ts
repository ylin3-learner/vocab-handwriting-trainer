// src/domain/string/porterStemmer.ts

/**
 * Porter Stemmer 演算法。
 *
 * 出處：Martin Porter, "An algorithm for suffix stripping",
 *      Program, Vol. 14 No. 3, pp. 130-137, July 1980.
 *
 * 為什麼需要？
 *   英語的屈折變化（-s / -ed / -ing / -er / -est）會讓同一個單字
 *   以不同形式出現。例如目標詞 "recite" 在例句中可能以
 *   "recited" / "recites" / "reciting" 出現。
 *   嚴格匹配會漏掉這些，導致學生仍可從例句看到答案線索。
 *
 * 為什麼用 Porter 而不是 Lemmatization？
 *   - Lemmatization 需要詞典（WordNet / spaCy），對前端是巨大依賴
 *   - 目標場景是「遮罩例句中的目標單字」，不需要精確詞性判斷
 *   - Porter 只處理屈折，保守且夠用
 *
 * 為什麼不用簡單的正則後綴去除？
 *   簡單正則會誤判：例如 "art" 與 "artist" 都去掉後綴後無法區分，
 *   或 "run" 與 "running" 需要處理重複子音（n → nning）。
 *   Porter 有完整的規則與測量函式（m、cvc），避免這類錯誤。
 *
 * 設計原則：
 *   - 純函式，無副作用、無外部依賴
 *   - 輸入任意英文單字，輸出詞幹（可能是原字）
 *   - 演算法步驟完整實作（Step 1a ~ 5b）
 */

const STEP2_SUFFIXES: ReadonlyArray<[string, string]> = [
  ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'],
  ['anci', 'ance'], ['izer', 'ize'], ['bli', 'ble'],
  ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'],
  ['ousli', 'ous'], ['ization', 'ize'], ['ation', 'ate'],
  ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'],
  ['fulness', 'ful'], ['ousness', 'ous'], ['aliti', 'al'],
  ['iviti', 'ive'], ['biliti', 'ble'], ['logi', 'log'],
];

const STEP3_SUFFIXES: ReadonlyArray<[string, string]> = [
  ['icate', 'ic'], ['ative', ''], ['alize', 'al'],
  ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', ''],
];

const STEP4_SUFFIXES: ReadonlyArray<string> = [
  'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant',
  'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti',
  'ous', 'ive', 'ize',
];

function isConsonant(word: string, i: number): boolean {
  const ch = word[i];
  if (ch === undefined) return false;
  if ('aeiou'.includes(ch)) return false;
  if (ch === 'y') return i === 0 ? true : !isConsonant(word, i - 1);
  return true;
}

/** 計算 m 值：VC 序列的個數（Porter 的術語） */
function measure(word: string): number {
  let count = 0;
  let prevIsVowel = false;
  for (let i = 0; i < word.length; i++) {
    const isC = isConsonant(word, i);
    if (!isC) {
      prevIsVowel = true;
    } else if (prevIsVowel) {
      count++;
      prevIsVowel = false;
    }
  }
  return count;
}

function containsVowel(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i)) return true;
  }
  return false;
}

function endsWithDoubleConsonant(word: string): boolean {
  if (word.length < 2) return false;
  const last = word[word.length - 1];
  const prev = word[word.length - 2];
  return last === prev && isConsonant(word, word.length - 1);
}

function cvc(word: string): boolean {
  if (word.length < 3) return false;
  const i = word.length - 1;
  if (!isConsonant(word, i) || isConsonant(word, i - 1) || !isConsonant(word, i - 2)) {
    return false;
  }
  return !['w', 'x', 'y'].includes(word[i]!);
}

/**
 * 對輸入的英文單字做詞幹提取。
 *
 * @example
 *   stem('apple')   // → 'appl'
 *   stem('apples')  // → 'appl'
 *   stem('recite')  // → 'recit'
 *   stem('recited') // → 'recit'
 *   stem('reciting')// → 'recit'
 *   stem('running') // → 'run'
 *   stem('artist')  // → 'artist'（不做派生）
 */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length < 3) return w;

  // ---- Step 1a ----
  if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ies')) w = w.slice(0, -2);
  else if (w.endsWith('ss')) { /* keep */ }
  else if (w.endsWith('s')) w = w.slice(0, -1);

  // ---- Step 1b ----
  let step1bFlag = false;
  if (w.endsWith('eed')) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else if (w.endsWith('ed')) {
    if (containsVowel(w.slice(0, -2))) { w = w.slice(0, -2); step1bFlag = true; }
  } else if (w.endsWith('ing')) {
    if (containsVowel(w.slice(0, -3))) { w = w.slice(0, -3); step1bFlag = true; }
  }
  if (step1bFlag) {
    if (w.endsWith('at') || w.endsWith('bl') || w.endsWith('iz')) {
      w += 'e';
    } else if (endsWithDoubleConsonant(w) && !['l', 's', 'z'].includes(w[w.length - 1]!)) {
      w = w.slice(0, -1);
    } else if (measure(w) === 1 && cvc(w)) {
      w += 'e';
    }
  }

  // ---- Step 1c ----
  if (w.endsWith('y') && containsVowel(w.slice(0, -1))) {
    w = w.slice(0, -1) + 'i';
  }

  // ---- Step 2 ----
  for (const [suffix, replacement] of STEP2_SUFFIXES) {
    if (w.endsWith(suffix) && measure(w.slice(0, -suffix.length)) > 0) {
      w = w.slice(0, -suffix.length) + replacement;
      break;
    }
  }

  // ---- Step 3 ----
  for (const [suffix, replacement] of STEP3_SUFFIXES) {
    if (w.endsWith(suffix) && measure(w.slice(0, -suffix.length)) > 0) {
      w = w.slice(0, -suffix.length) + replacement;
      break;
    }
  }

  // ---- Step 4 ----
  for (const suffix of STEP4_SUFFIXES) {
    if (w.endsWith(suffix)) {
      const stemPart = w.slice(0, -suffix.length);
      if (suffix === 'ion' && (stemPart.length === 0 || !['s', 't'].includes(stemPart[stemPart.length - 1]!))) {
        continue;
      }
      if (measure(stemPart) > 1) {
        w = stemPart;
        break;
      }
    }
  }

  // ---- Step 5a ----
  if (w.endsWith('e')) {
    const stemPart = w.slice(0, -1);
    const m = measure(stemPart);
    if (m > 1 || (m === 1 && !cvc(stemPart))) {
      w = stemPart;
    }
  }

  // ---- Step 5b ----
  if (w.endsWith('ll') && measure(w) > 1) {
    w = w.slice(0, -1);
  }

  return w;
}