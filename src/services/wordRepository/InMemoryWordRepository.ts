import { Word } from '../../types/word';
import { WordRepository } from './WordRepository';

export class InMemoryWordRepository implements WordRepository {
  constructor(private words: Word[]) {}

  async getAll(): Promise<Word[]> {
    return this.words;
  }
}
