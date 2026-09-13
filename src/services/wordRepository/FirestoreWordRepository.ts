// src/services/wordRepository/FirestoreWordRepository.ts
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  documentId,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Word } from '../../types/word';
import { WordRepository } from './WordRepository';

/** 每批讀取的單字數（用於隨機抽樣的分頁） */
const RANDOM_BATCH_SIZE = 100;

export class FirestoreWordRepository implements WordRepository {
  private readonly collectionPath = ['vocabulary', 'current', 'words'] as const;

  // 取得全部單字（僅在必要時使用，例如管理員）
  async getAll(): Promise<Word[]> {
    try {
      console.log('📚 [getAll] 開始從 Firestore 載入全部單字...');
      const wordsRef = collection(db, ...this.collectionPath);
      const snapshot = await getDocs(wordsRef);
      const words: Word[] = [];
      snapshot.forEach((d) => words.push(this.docToWord(d)));
      console.log(`✅ [getAll] 載入完成，共 ${words.length} 個單字`);
      return words;
    } catch (error) {
      console.error('❌ [getAll] 載入失敗:', error);
      return [];
    }
  }

  // 依 ID 清單批次取得單字（用於複習候選）
  async getWordsByIds(ids: string[]): Promise<Word[]> {
    if (ids.length === 0) {
      console.log('📚 [getWordsByIds] ids 為空，回傳 []');
      return [];
    }

    try {
      console.log(`📚 [getWordsByIds] 開始批次載入 ${ids.length} 個單字...`);
      const words: Word[] = [];
      const batchCount = Math.ceil(ids.length / 30);

      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        const batchIndex = Math.floor(i / 30) + 1;
        console.log(`   - 批次 ${batchIndex}/${batchCount}：${chunk.length} 個 ID`);

        const q = query(
          collection(db, ...this.collectionPath),
          where(documentId(), 'in', chunk)
        );
        const snapshot = await getDocs(q);
        snapshot.forEach((d) => words.push(this.docToWord(d)));
        console.log(`     ✅ 批次 ${batchIndex} 完成，累計 ${words.length} 個`);
      }

      console.log(`✅ [getWordsByIds] 全部完成，共載入 ${words.length} 個單字`);
      return words;
    } catch (error) {
      console.error('❌ [getWordsByIds] 批次取得單字失敗:', error);
      return [];
    }
  }

  /**
   * ⚠️ Legacy：取得新單字（無 level 過濾）。
   *
   * 保留給相容性與測試使用。日常練習已改用 getNewWordsByLevels。
   * 注意：此方法仍按 documentId 排序，可能會有「每次都抓同一批」的問題。
   */
  async getNewWords(excludeIds: Set<string>, limitCount: number): Promise<Word[]> {
    try {
      console.log(`📚 [getNewWords] 目標：${limitCount} 個，排除 ${excludeIds.size} 個已學過的單字`);

      const wordsRef = collection(db, ...this.collectionPath);
      const words: Word[] = [];
      const batchSize = Math.max(limitCount * 3, 100);
      let lastDoc: any = null;
      let iterations = 0;
      const maxIterations = 5;

      while (words.length < limitCount && iterations < maxIterations) {
        iterations++;
        const q = lastDoc
          ? query(wordsRef, orderBy(documentId()), startAfter(lastDoc), limit(batchSize))
          : query(wordsRef, orderBy(documentId()), limit(batchSize));

        const snapshot = await getDocs(q);
        if (snapshot.empty) break;

        for (const d of snapshot.docs) {
          if (excludeIds.has(d.id)) continue;
          words.push(this.docToWord(d));
          if (words.length >= limitCount) break;
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
      }

      console.log(`✅ [getNewWords] 完成，共取得 ${words.length} 個新單字`);
      return words;
    } catch (error) {
      console.error('❌ [getNewWords] 取得新單字失敗:', error);
      return [];
    }
  }

  /**
   * 🔥 依 level 清單隨機取得新單字。
   *
   * 核心演算法（隨機範圍查詢）：
   *   1. 生成隨機起點 randomStart = Math.random()
   *   2. 第一段：where('random', '>=', randomStart) 由小到大讀取
   *   3. 若不足，第二段：where('random', '<', randomStart) 補齊
   *   4. 兩段都做分頁，直到湊足 limitCount 或全部讀完
   *
   * 為什麼需要 random 欄位？
   *   若只按 'word' 字母序查詢，每次都從字母最前面抓，
   *   導致每次抽樣都拿到同一批單字。隨機欄位讓每次查詢的
   *   起點不同，達成均勻隨機抽樣。
   *
   * 為什麼分兩段？
   *   若 randomStart 很接近 1，第一段可能不足；
   *   若很接近 0，第二段幾乎不需要。兩段互補覆蓋整批資料。
   */
  async getNewWordsByLevels(
    excludeIds: Set<string>,
    levels: number[],
    limitCount: number
  ): Promise<Word[]> {
    if (levels.length === 0 || limitCount <= 0) return [];

    const levelStrings = levels.map((l) => String(l));
    const wordsRef = collection(db, ...this.collectionPath);
    const results: Word[] = [];
    const seenIds = new Set<string>();

    const tryAdd = (word: Word): void => {
      if (results.length >= limitCount) return;
      if (excludeIds.has(word.id)) return;
      if (seenIds.has(word.id)) return;
      results.push(word);
      seenIds.add(word.id);
    };

    const randomStart = Math.random();
    console.log(
      `🎲 [getNewWordsByLevels] levels=[${levelStrings.join(',')}] target=${limitCount} randomStart=${randomStart.toFixed(3)}`
    );

    // ============================================================
    // 第一段：random >= randomStart（由 random 升序，分頁讀取）
    // ============================================================
    let cursor: any = null;
    while (results.length < limitCount) {
      const baseQ = query(
        wordsRef,
        where('level', 'in', levelStrings),
        where('random', '>=', randomStart),
        orderBy('random'),
        limit(RANDOM_BATCH_SIZE)
      );
      const q = cursor ? query(baseQ, startAfter(cursor)) : baseQ;

      const snap = await getDocs(q);
      if (snap.empty) break;

      for (const d of snap.docs) {
        tryAdd({ id: d.id, ...d.data() } as Word);
      }

      if (snap.docs.length < RANDOM_BATCH_SIZE) break;
      cursor = snap.docs[snap.docs.length - 1];
    }

    // ============================================================
    // 第二段：random < randomStart（補齊不足）
    // ============================================================
    if (results.length < limitCount) {
      cursor = null;
      while (results.length < limitCount) {
        const baseQ = query(
          wordsRef,
          where('level', 'in', levelStrings),
          where('random', '<', randomStart),
          orderBy('random'),
          limit(RANDOM_BATCH_SIZE)
        );
        const q = cursor ? query(baseQ, startAfter(cursor)) : baseQ;

        const snap = await getDocs(q);
        if (snap.empty) break;

        for (const d of snap.docs) {
          tryAdd({ id: d.id, ...d.data() } as Word);
        }

        if (snap.docs.length < RANDOM_BATCH_SIZE) break;
        cursor = snap.docs[snap.docs.length - 1];
      }
    }

    console.log(`✅ [getNewWordsByLevels] 取得 ${results.length}/${limitCount} 個單字`);
    return results;
  }

  // 內部輔助函式：將 Firestore 文件轉為 Word
  private docToWord(d: any): Word {
    const data = d.data();
    return {
      id: data.id || data.word || d.id,
      word: data.word || '',
      meaning: data.meaning || '',
      sentence: data.sentence || '',
      root: data.root,
      rootMeaning: data.rootMeaning,
      hint: data.hint,
      level: data.level,
      random: data.random, // 保留 random 欄位
    };
  }
}