import React, { useState } from 'react';
import { StudentLogin } from './features/login/StudentLogin';
import { QuizScreen } from './features/quiz/QuizScreen';
import { QuizOrchestrator } from './features/quiz/QuizOrchestrator';
import { Word } from './types/word';

// 暫時內建測試單字（符合 words.schema.json）
const SAMPLE_WORDS: Word[] = [
  {
    id: 'apple',
    word: 'apple',
    meaning: '蘋果',
    sentence: 'I eat an apple every day.',
    level: 'A1',
  },
  {
    id: 'book',
    word: 'book',
    meaning: '書',
    sentence: 'This is my book.',
    level: 'A1',
  },
  {
    id: 'cat',
    word: 'cat',
    meaning: '貓',
    sentence: 'The cat is sleeping.',
    level: 'A1',
  },
  {
    id: 'dog',
    word: 'dog',
    meaning: '狗',
    sentence: 'The dog runs fast.',
    level: 'A1',
  },
  {
    id: 'elephant',
    word: 'elephant',
    meaning: '大象',
    sentence: 'The elephant is huge.',
    level: 'A2',
  },
];

export const App: React.FC = () => {
  const [orchestrator, setOrchestrator] = useState<QuizOrchestrator | null>(null);

  if (orchestrator) {
    return <QuizScreen orchestrator={orchestrator} onSessionEnd={() => setOrchestrator(null)} />;
  }

  return <StudentLogin words={SAMPLE_WORDS} onStart={(o) => setOrchestrator(o)} />;
};