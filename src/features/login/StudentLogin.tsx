// src/features/login/StudentLogin.tsx
import React, { useState } from 'react';
import { signInAnonymously } from 'firebase/auth';
import { auth } from '../../firebase';
import { FirestoreWordRepository } from '../../services/wordRepository/FirestoreWordRepository';
import { InMemoryWordRepository } from '../../services/wordRepository/InMemoryWordRepository';
import { HybridProgressStore } from '../../services/storage/HybridProgressStore';
import { ProfileService } from '../../services/profile/ProfileService';
import { QuizOrchestrator } from '../quiz/QuizOrchestrator';
import { PlacementOrchestrator } from '../placement/PlacementOrchestrator';
import { StudentStateService } from '../../services/progression/StudentStateService';
import { QuizSessionApi } from '../quiz/QuizSessionApi';
import type { Word } from '../../types/word';
import { RECOMMENDED_MIN_QUOTA } from '../../types/progression';

const FALLBACK_WORDS: Word[] = [
  { id: 'apple', word: 'apple', meaning: '蘋果', sentence: 'I eat an apple every day.' },
  { id: 'book', word: 'book', meaning: '書', sentence: 'This is my book.' },
  { id: 'cat', word: 'cat', meaning: '貓', sentence: 'The cat is sleeping.' },
  { id: 'dog', word: 'dog', meaning: '狗', sentence: 'The dog runs fast.' },
  { id: 'elephant', word: 'elephant', meaning: '大象', sentence: 'The elephant is huge.' },
];

interface StudentLoginProps {
  onStart: (orchestrator: QuizSessionApi) => void;
}

export const StudentLogin: React.FC<StudentLoginProps> = ({ onStart }) => {
  const [studentName, setStudentName] = useState('');
  const [className, setClassName] = useState('');
  const [seatNumber, setSeatNumber] = useState('');
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
    // 🔥 三欄都必填
    if (!studentName.trim()) {
      alert('請輸入姓名');
      return;
    }
    if (!className.trim()) {
      alert('請輸入班級');
      return;
    }
    if (!seatNumber.trim()) {
      alert('請輸入座號');
      return;
    }

    unlockSpeech();
    setIsLoading(true);

    try {
      // ===== 步驟 1：匿名登入 =====
      console.log('🔐 [StudentLogin] 開始匿名登入...');
      const cred = await signInAnonymously(auth);
      const uid = cred.user.uid;
      console.log(`🔐 [StudentLogin] 匿名登入成功，UID: ${uid}`);

      // ===== 步驟 2：儲存學生 Profile（含 displayId） =====
      const profileService = new ProfileService();
      await profileService.saveProfile(
        uid,
        studentName.trim(),
        className.trim(),
        seatNumber.trim()
      );
      const displayId = `${className.trim()}_${seatNumber.trim()}_${studentName.trim()}`;
      console.log(`✅ [StudentLogin] Profile 已儲存：${displayId}`);

      // ===== 步驟 3：建立 WordRepository =====
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

      // ===== 步驟 4：讀取鑑定狀態，決定使用哪個 Orchestrator =====
      const stateService = new StudentStateService();
      const placementStatus = await stateService.getPlacementStatus(displayId);
      console.log(
        `📋 [StudentLogin] 鑑定狀態：needsPlacement=${placementStatus.needsPlacement}, currentLevel=L${placementStatus.currentLevel}`
      );

      let orchestrator: QuizSessionApi;

      if (placementStatus.needsPlacement) {
        // 🔥 Placement 模式
        console.log('🎯 [StudentLogin] 進入程度鑑定模式');
        orchestrator = new PlacementOrchestrator(uid, className.trim(), {
          wordRepository: repo,
          timeLimitMs: 8000,
          studentName: studentName.trim(),
          studentSeatNumber: seatNumber.trim(),
        });
      } else {
        // 🔥 正常練習模式
        console.log('📚 [StudentLogin] 進入正常練習模式');
        const store = new HybridProgressStore(uid);
        orchestrator = new QuizOrchestrator(uid, className.trim(), {
          wordRepository: repo,
          progressStore: store,
          timeLimitMs: 8000,
          defaultDailyMaxQuota: RECOMMENDED_MIN_QUOTA,
          defaultDailyNewQuota: 3,
          studentName: studentName.trim(),
          studentSeatNumber: seatNumber.trim(),
        });
      }

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
        <label>姓名 *</label>
        <input
          type="text"
          value={studentName}
          onChange={(e) => setStudentName(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', fontSize: '1rem' }}
          placeholder="例如：王小明"
          disabled={isLoading}
        />
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label>班級 *</label>
        <input
          type="text"
          value={className}
          onChange={(e) => setClassName(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', fontSize: '1rem' }}
          placeholder="例如：701"
          disabled={isLoading}
        />
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label>座號 *</label>
        <input
          type="text"
          value={seatNumber}
          onChange={(e) => setSeatNumber(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', fontSize: '1rem' }}
          placeholder="例如：12"
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