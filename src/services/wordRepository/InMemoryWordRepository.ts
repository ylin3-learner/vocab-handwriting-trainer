// src/services/wordRepository/InMemoryWordRepository.ts
import { Word } from '../../types/word';
import { WordRepository } from './WordRepository';

export class InMemoryWordRepository implements WordRepository {
  constructor(private words: Word[]) {}

  async getAll(): Promise<Word[]> {
    return this.words;
  }

  async getWordsByIds(ids: string[]): Promise<Word[]> {
    const idSet = new Set(ids);
    return this.words.filter(w => idSet.has(w.id));
  }

  async getNewWords(excludeIds: Set<string>, limit: number): Promise<Word[]> {
    return this.words.filter(w => !excludeIds.has(w.id)).slice(0, limit);
  }

  async getNewWordsByLevels(
    excludeIds: Set<string>,
    levels: number[],
    limit: number
  ): Promise<Word[]> {
    const levelSet = new Set(levels.map((l) => String(l)));
    return this.words
      .filter((w) => !excludeIds.has(w.id))
      .filter((w) => w.level && levelSet.has(w.level))
      .slice(0, limit);
  }
}