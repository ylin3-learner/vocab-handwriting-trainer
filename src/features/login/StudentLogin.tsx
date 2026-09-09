import React, { useState } from 'react';
import { InMemoryWordRepository } from '../../services/wordRepository/InMemoryWordRepository';
import { FirestoreWordRepository } from '../../services/wordRepository/FirestoreWordRepository'; // 👈 新增
import { FirestoreProgressStore } from '../../services/storage/FirestoreProgressStore';
import { QuizOrchestrator } from '../quiz/QuizOrchestrator';
import type { Word } from '../../types/word';

// 備用單字（當 Firestore 無資料時使用，避免白畫面）
const FALLBACK_WORDS: Word[] = [
  { id: 'apple', word: 'apple', meaning: '蘋果', sentence: 'I eat an apple every day.' },
  { id: 'book', word: 'book', meaning: '書', sentence: 'This is my book.' },
  { id: 'cat', word: 'cat', meaning: '貓', sentence: 'The cat is sleeping.' },
  { id: 'dog', word: 'dog', meaning: '狗', sentence: 'The dog runs fast.' },
  { id: 'elephant', word: 'elephant', meaning: '大象', sentence: 'The elephant is huge.' },
];

interface StudentLoginProps {
  // 移除 words: Word[]（不再從外部傳入）
  onStart: (orchestrator: QuizOrchestrator) => void;
}

export const StudentLogin: React.FC<StudentLoginProps> = ({ onStart }) => { // 👈 移除 words 參數
  const [studentId, setStudentId] = useState('');
  const [className, setClassName] = useState('');
  const [isLoading, setIsLoading] = useState(false); // 新增載入狀態

  const unlockSpeech = () => {
    if (window.speechSynthesis) {
      try {
        const utterance = new SpeechSynthesisUtterance(' ');
        utterance.volume = 0;
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.cancel();
        console.log('✅ 語音引擎已解鎖');
      } catch (e) {
        console.log('語音功能不可用，但文字仍會顯示');
      }
    }
  };

  const handleStart = async () => { // 改為 async
    if (!studentId.trim()) {
      alert('請輸入姓名或座號');
      return;
    }

    unlockSpeech();
    setIsLoading(true); // 開始載入

    try {
      // 1. 從 Firestore 讀取單字
      const firestoreRepo = new FirestoreWordRepository();
      let words = await firestoreRepo.getAll();

      // 2. 若 Firestore 無資料，使用備用單字
      if (words.length === 0) {
        console.warn('⚠️ Firestore 無單字資料，使用備用單字庫');
        words = FALLBACK_WORDS;
      }

      console.log(`✅ 成功載入 ${words.length} 個單字`);

      // 3. 建立測驗流程（使用載入的單字）
      const repo = new InMemoryWordRepository(words);
      const store = new FirestoreProgressStore();
      const orchestrator = new QuizOrchestrator(studentId.trim(), {
        wordRepository: repo,
        progressStore: store,
        timeLimitMs: 15000,
        dailyMaxQuota: 10,
        dailyNewQuota: 3,
      });

      await orchestrator.init();
      onStart(orchestrator);
    } catch (error) {
      console.error('啟動測驗失敗:', error);
      alert('載入單字庫失敗，請確認網路連線後重試');
    } finally {
      setIsLoading(false); // 載入完成
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
          disabled={isLoading} // 👈 載入中禁用
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
          disabled={isLoading} // 👈 載入中禁用
        />
      </div>
      <button
        onClick={handleStart}
        disabled={isLoading} // 👈 載入中禁用
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1.2rem',
          background: isLoading ? '#6c757d' : '#28a745', // 👈 載入中變灰色
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