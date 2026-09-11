// src/services/wordRepository/FirestoreWordRepository.ts
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  documentId
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Word } from '../../types/word';
import { WordRepository } from './WordRepository';

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

      // Firestore 的 `in` 查詢一次最多 30 個
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

  // 取得新單字（排除已學過的）
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
        console.log(`   - 第 ${iterations}/${maxIterations} 輪，目前 ${words.length}/${limitCount} 個，讀取 ${batchSize} 筆...`);

        const q = lastDoc
          ? query(wordsRef, orderBy(documentId()), startAfter(lastDoc), limit(batchSize))
          : query(wordsRef, orderBy(documentId()), limit(batchSize));

        const snapshot = await getDocs(q);
        if (snapshot.empty) {
          console.log(`   - 已到集合尾端，停止`);
          break;
        }

        for (const d of snapshot.docs) {
          if (excludeIds.has(d.id)) continue;
          words.push(this.docToWord(d));
          if (words.length >= limitCount) break;
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
      }

      console.log(`✅ [getNewWords] 完成，共取得 ${words.length} 個新單字（讀了 ${iterations} 輪）`);
      return words;
    } catch (error) {
      console.error('❌ [getNewWords] 取得新單字失敗:', error);
      return [];
    }
  }

  /**
   * Stage 3 新增：依 level 清單取得新單字
   *
   * Firestore 的 `in` 查詢最多支援 30 個值，但 level 只有 1~6，遠低於限制。
   */
  async getNewWordsByLevels(
    excludeIds: Set<string>,
    levels: number[],
    limitCount: number
  ): Promise<Word[]> {
    if (levels.length === 0) return [];

    // Firestore 的 in 查詢要求值為字串
    const levelStrings = levels.map((l) => String(l));

    // 每次最多讀取 limitCount * 3 筆（避免一次拉太多），用分頁方式累積
    const BATCH_SIZE = Math.min(300, limitCount * 3);
    const results: Word[] = [];
    let lastDoc: any = null;

    while (results.length < limitCount) {
      const baseQuery = query(
        collection(db, 'vocabulary', 'current', 'words'),
        where('level', 'in', levelStrings),
        orderBy('word'),
        limit(BATCH_SIZE)
      );

      // 分頁游標（下一輪從這裡繼續）
      const q = lastDoc
        ? query(baseQuery, startAfter(lastDoc))
        : baseQuery;

      const snap = await getDocs(q);
      if (snap.empty) break;

      for (const docSnap of snap.docs) {
        if (results.length >= limitCount) break;
        const word = { id: docSnap.id, ...docSnap.data() } as Word;
        if (!excludeIds.has(word.id)) {
          results.push(word);
        }
      }

      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < BATCH_SIZE) break; // 資料已讀完
    }

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
    };
  }
}