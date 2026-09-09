import React, { useState } from 'react';
import { InMemoryWordRepository } from '../../services/wordRepository/InMemoryWordRepository';
import { InMemoryProgressStore } from '../../services/storage/InMemoryProgressStore';
import { QuizOrchestrator } from '../quiz/QuizOrchestrator';
import type { Word } from '../../types/word';

interface StudentLoginProps {
  words: Word[];
  onStart: (orchestrator: QuizOrchestrator) => void;
}

export const StudentLogin: React.FC<StudentLoginProps> = ({ words, onStart }) => {
  const [studentId, setStudentId] = useState('');
  const [className, setClassName] = useState('');

  // 解鎖 Web Speech API（尤其針對 iOS Safari）
  const unlockSpeech = () => {
    if (window.speechSynthesis) {
      try {
        const utterance = new SpeechSynthesisUtterance(' ');
        utterance.volume = 0; // 靜音
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.cancel(); // 立即取消，不留痕跡
        console.log('✅ 語音引擎已解鎖');
      } catch (e) {
        // 某些瀏覽器可能不支援，忽略
        console.log('語音功能不可用，但文字仍會顯示');
      }
    }
  };

  const handleStart = () => {
    if (!studentId.trim()) {
      alert('請輸入姓名或座號');
      return;
    }

    // 1. 解鎖語音（必須在點擊事件中執行）
    unlockSpeech();

    // 2. 建立測驗流程
    const repo = new InMemoryWordRepository(words);
    const store = new InMemoryProgressStore();
    const orchestrator = new QuizOrchestrator(studentId.trim(), {
      wordRepository: repo,
      progressStore: store,
      timeLimitMs: 15000,
      dailyMaxQuota: 10,
      dailyNewQuota: 3,
    });

    orchestrator.init().then(() => {
      onStart(orchestrator);
    });
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
        />
      </div>
      <button
        onClick={handleStart}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1.2rem',
          background: '#28a745',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
        }}
      >
        開始練習
      </button>
    </div>
  );
};