// src/services/wordRepository/WordRepository.ts
import { Word } from '../../types/word';

export interface WordRepository {
  /** 取得全部單字（保留給管理員/教師用） */
  getAll(): Promise<Word[]>;

  /** 依據 ID 清單批次取得單字（用於複習候選） */
  getWordsByIds(ids: string[]): Promise<Word[]>;

  /** 取得尚未學過的新單字（用於新詞候選） */
  getNewWords(excludeIds: Set<string>, limit: number): Promise<Word[]>;

  /**
   * Stage 3 新增：依 level 清單取得新單字
   *
   * @param excludeIds 已學過的單字 ID（不重複出題）
   * @param levels 要包含的等級，例如 [2, 3]
   * @param limit 總筆數上限
   */
  getNewWordsByLevels(
    excludeIds: Set<string>,
    levels: number[],
    limit: number
  ): Promise<Word[]>;
}