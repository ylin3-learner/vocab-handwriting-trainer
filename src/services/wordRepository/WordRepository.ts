import { Word } from '../../types/word';

export interface WordRepository {
  getAll(): Promise<Word[]>;
}