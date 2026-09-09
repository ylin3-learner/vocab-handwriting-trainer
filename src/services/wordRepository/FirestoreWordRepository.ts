// src/services/wordRepository/FirestoreWordRepository.ts
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { Word } from '../../types/word';
import { WordRepository } from './WordRepository';

export class FirestoreWordRepository implements WordRepository {
  async getAll(): Promise<Word[]> {
    try {
      const wordsRef = collection(db, 'vocabulary', 'current', 'words');
      const snapshot = await getDocs(wordsRef);
      const words: Word[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        // 確保欄位符合 Word 型別
        words.push({
          id: data.id || data.word || doc.id,
          word: data.word || '',
          meaning: data.meaning || '',
          sentence: data.sentence || '',
          root: data.root,
          rootMeaning: data.rootMeaning,
          hint: data.hint,
          level: data.level,
        });
      });
      
      console.log(`✅ 從 Firestore 載入 ${words.length} 個單字`);
      return words;
    } catch (error) {
      console.error('❌ 從 Firestore 載入單字失敗:', error);
      // 若失敗則回傳空陣列，讓呼叫端決定是否 fallback
      return [];
    }
  }
}