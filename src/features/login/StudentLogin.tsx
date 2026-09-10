// src/features/login/StudentLogin.tsx
import React, { useState } from 'react';
import { FirestoreWordRepository } from '../../services/wordRepository/FirestoreWordRepository';
import { InMemoryWordRepository } from '../../services/wordRepository/InMemoryWordRepository';
import { HybridProgressStore } from '../../services/storage/HybridProgressStore';
import { QuizOrchestrator } from '../quiz/QuizOrchestrator';
import type { Word } from '../../types/word';

const FALLBACK_WORDS: Word[] = [
  { id: 'apple', word: 'apple', meaning: '蘋果', sentence: 'I eat an apple every day.' },
  { id: 'book', word: 'book', meaning: '書', sentence: 'This is my book.' },
  { id: 'cat', word: 'cat', meaning: '貓', sentence: 'The cat is sleeping.' },
  { id: 'dog', word: 'dog', meaning: '狗', sentence: 'The dog runs fast.' },
  { id: 'elephant', word: 'elephant', meaning: '大象', sentence: 'The elephant is huge.' },
];

interface StudentLoginProps {
  onStart: (orchestrator: QuizOrchestrator) => void;
}

export const StudentLogin: React.FC<StudentLoginProps> = ({ onStart }) => {
  const [studentId, setStudentId] = useState('');
  const [className, setClassName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const unlockSpeech = () => {
    if (window.speechSynthesis) {
      try {
        const utterance = new SpeechSynthesisUtterance(' ');
        utterance.volume = 0;
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.cancel();
        console.log('✅ 語音引擎已解鎖');
      } catch (e) {
        console.log('語音功能不可用');
      }
    }
  };

  const handleStart = async () => {
    if (!studentId.trim()) {
      alert('請輸入姓名或座號');
      return;
    }

    unlockSpeech();
    setIsLoading(true);

    try {
      // 1. 建立 WordRepository
      const firestoreRepo = new FirestoreWordRepository();
      let repo;
      try {
        const testQuery = await firestoreRepo.getNewWords(new Set(), 1);
        if (testQuery.length === 0) {
          console.warn('⚠️ Firestore 無單字資料，使用備用單字庫');
          repo = new InMemoryWordRepository(FALLBACK_WORDS);
        } else {
          repo = firestoreRepo;
        }
      } catch (e) {
        console.warn('⚠️ Firestore 連線失敗，使用備用單字庫:', e);
        repo = new InMemoryWordRepository(FALLBACK_WORDS);
      }

      // 2. 建立測驗流程
      const store = new HybridProgressStore(studentId.trim());
      const orchestrator = new QuizOrchestrator(
        studentId.trim(),
        className.trim(), // 👈 傳入班級（可能為空字串）
        {
          wordRepository: repo,
          progressStore: store,
          timeLimitMs: 15000,
          defaultDailyMaxQuota: 10,  // fallback
          defaultDailyNewQuota: 3,   // fallback
        }
      );

      await orchestrator.init();
      onStart(orchestrator);
    } catch (error) {
      console.error('啟動測驗失敗:', error);
      alert('載入單字庫失敗，請確認網路連線後重試');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '2rem auto', padding: '1rem' }}>
      <h2>📚 登入練習</h2>
      <div style={{ marginBottom: '1rem' }}>
        <label>姓名 / 座號</label>
        <input
          type="text"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', fontSize: '1rem' }}
          placeholder="例如：王小明 或 12"
          disabled={isLoading}
        />
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label>班級（選填）</label>
        <input
          type="text"
          value={className}
          onChange={(e) => setClassName(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', fontSize: '1rem' }}
          placeholder="例如：701"
          disabled={isLoading}
        />
      </div>
      <button
        onClick={handleStart}
        disabled={isLoading}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1.2rem',
          background: isLoading ? '#6c757d' : '#28a745',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: isLoading ? 'default' : 'pointer',
          width: '100%',
        }}
      >
        {isLoading ? '載入中...' : '開始練習'}
      </button>
    </div>
  );
};