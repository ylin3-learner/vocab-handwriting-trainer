// src/features/quiz/QuizScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { QuizSessionApi } from './QuizSessionApi';
import { QuizQuestion } from './QuizOrchestrator';
import { Countdown } from './Countdown';
import { HandwritingCanvas, HandwritingCanvasRef } from './HandwritingCanvas';
import { maskWordInSentence } from '../../domain/string/maskWord';
import type { SessionExitReason } from '../../services/storage/ProgressStore';

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 120;
const SPEECH_CANCEL_DELAY_MS = 100;
const SPEECH_FALLBACK_TIMEOUT_MS = 8000;
const AUTO_ADVANCE_DELAY_MS = 1200;

async function callGoogleIME(trace: number[][][], language: string = 'en'): Promise<string[]> {
  const scaledTrace = trace.map(stroke => {
    const xs = (stroke[0] || []).map(x => x * CANVAS_WIDTH);
    const ys = (stroke[1] || []).map(y => y * CANVAS_HEIGHT);
    return [xs, ys, []];
  });
  const data = JSON.stringify({
    options: 'enable_pre_space',
    requests: [{ writing_guide: { writing_area_width: CANVAS_WIDTH, writing_area_height: CANVAS_HEIGHT }, ink: scaledTrace, language }],
  });
  try {
    const response = await fetch('https://www.google.com.tw/inputtools/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data,
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const result = await response.json();
    if (result && result.length > 1 && result[1] && result[1][0]) {
      return result[1][0][1] || [];
    }
    return [];
  } catch (error) {
    console.error('❌ Google IME API 呼叫失敗:', error);
    return [];
  }
}

interface QuizScreenProps {
  orchestrator: QuizSessionApi;
  onSessionEnd: () => void;
}

export const QuizScreen: React.FC<QuizScreenProps> = ({ orchestrator, onSessionEnd }) => {
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'answering' | 'submitted' | 'done'>('idle');
  const [result, setResult] = useState<{ correct: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [storageError, setStorageError] = useState<boolean>(false);
  const [dailyProgress, setDailyProgress] = useState<{ answered: number; max: number }>({ answered: 0, max: 0 });
  const [countdownStarted, setCountdownStarted] = useState(false);
  const [waitingForNext, setWaitingForNext] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);

  const startTimeRef = useRef<number>(0);
  const timedOutRef = useRef<boolean>(false);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const canvasRef = useRef<HandwritingCanvasRef>(null);
  const submitLockRef = useRef<boolean>(false);
  const hasInitializedRef = useRef<boolean>(false);
  const speechIdRef = useRef<number>(0);
  const countdownStartedRef = useRef<boolean>(false);
  const speechFallbackTimerRef = useRef<number | null>(null);

  // 🔥 新增：訂閱即時進度（工業級做法 B）
  useEffect(() => {
    if (orchestrator.subscribeToProgress) {
      const unsubscribe = orchestrator.subscribeToProgress((answered, max) => {
        // 這裡的 answered 就是從 dailySnapshots.totalAttempts 來的，絕對精準
        setDailyProgress({ answered, max });
      });
      return () => unsubscribe();
    }
  }, [orchestrator]);

  const cancelSpeech = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (speechFallbackTimerRef.current !== null) {
      window.clearTimeout(speechFallbackTimerRef.current);
      speechFallbackTimerRef.current = null;
    }
  };

  const startCountdown = () => {
    if (countdownStartedRef.current) return;
    countdownStartedRef.current = true;
    setCountdownStarted(true);
  };

  const speakWord = async (word: string, sentence: string, rate: number, onEnd?: () => void) => {
    const myId = ++speechIdRef.current;
    if (!window.speechSynthesis) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    await new Promise(resolve => setTimeout(resolve, SPEECH_CANCEL_DELAY_MS));
    if (myId !== speechIdRef.current) return;
    if (!window.speechSynthesis) { onEnd?.(); return; }

    const utterance = new SpeechSynthesisUtterance(`${word}. ${sentence}`);
    utterance.lang = 'en-US';
    utterance.rate = rate;

    utterance.onend = () => {
      if (myId !== speechIdRef.current) return;
      if (speechFallbackTimerRef.current !== null) { window.clearTimeout(speechFallbackTimerRef.current); speechFallbackTimerRef.current = null; }
      onEnd?.();
    };

    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') console.warn('🔇 語音播放錯誤:', e.error);
      if (myId !== speechIdRef.current) return;
      if (e.error === 'interrupted') return;
      if (speechFallbackTimerRef.current !== null) { window.clearTimeout(speechFallbackTimerRef.current); speechFallbackTimerRef.current = null; }
      onEnd?.();
    };

    speechRef.current = utterance;
    window.speechSynthesis.speak(utterance);

    if (onEnd) {
      if (speechFallbackTimerRef.current !== null) window.clearTimeout(speechFallbackTimerRef.current);
      speechFallbackTimerRef.current = window.setTimeout(() => {
        speechFallbackTimerRef.current = null;
        onEnd();
      }, SPEECH_FALLBACK_TIMEOUT_MS);
    }
  };

  const loadNext = async () => {
    cancelSpeech();
    setWaitingForNext(false);
    const q = await orchestrator.nextQuestion();

    if (!q) {
      if (orchestrator.finalizeSession) {
        try { await orchestrator.finalizeSession(); } catch (e) { console.warn('⚠️ finalizeSession 失敗:', e); }
      }
      setStatus('done');
      return;
    }

    setQuestion(q);
    setSnapshotUrl(undefined);
    setResult(null);
    setStorageError(false);
    setStatus('answering');
    countdownStartedRef.current = false;
    setCountdownStarted(false);
    startTimeRef.current = Date.now();
    timedOutRef.current = false;
    submitLockRef.current = false;

    await speakWord(q.word.word, q.word.sentence, orchestrator.getSpeechRate(), () => startCountdown());
  };

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const isUnfinished = dailyProgress.max > 0 && dailyProgress.answered < dailyProgress.max && status !== 'done';
      if (isUnfinished) {
        e.preventDefault();
        e.returnValue = '您尚未完成今日的練習額度，確定要離開嗎？';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dailyProgress, status]);

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    loadNext();
    return () => cancelSpeech();
  }, []);

  const handleReplaySlow = () => {
    if (!question || status !== 'answering') return;
    const floorRate = orchestrator.getSpeechFloorRate();
    if (floorRate === null) return;
    void speakWord(question.word.word, question.word.sentence, floorRate);
  };

  const handleNextAfterWrong = () => {
    if (!waitingForNext) return;
    setWaitingForNext(false);
    void loadNext();
  };

  const handleExitClick = () => {
    setShowExitModal(true);
    cancelSpeech();
  };

  const handleConfirmExit = async (reason: SessionExitReason) => {
    setIsEndingSession(true);
    try {
      if (orchestrator.endContinueSession) {
        await orchestrator.endContinueSession(reason);
      }
      setShowExitModal(false);
      setStatus('done');
    } catch (e) {
      console.error('結束練習失敗:', e);
      alert('結束失敗，請重試');
    } finally {
      setIsEndingSession(false);
    }
  };

  const handleCancelExit = () => {
    setShowExitModal(false);
    if (question && status === 'answering') {
      void speakWord(question.word.word, question.word.sentence, orchestrator.getSpeechRate(), () => startCountdown());
    }
  };

  const handleSubmit = async () => {
    if (submitLockRef.current) return;
    if (status !== 'answering' || !question) return;

    submitLockRef.current = true;
    setIsSubmitting(true);
    setStatus('submitted');

    try {
      let recognizedText = '';
      let forcedMatch = false;
      let candidatesSnapshot: string[] = [];

      const trace = canvasRef.current?.getTrace() || [];
      const rawTrace = canvasRef.current?.getRawTrace() || [];

      if (trace.length > 0 && trace[0] && Array.isArray(trace[0][0]) && trace[0][0].length > 0) {
        const candidates = await callGoogleIME(trace, 'en');
        if (candidates.length > 0) {
          const exactMatch = candidates.find((cand) => cand.toLowerCase() === question.word.word.toLowerCase());
          recognizedText = exactMatch || candidates[0] || '';
          forcedMatch = exactMatch !== undefined;
          candidatesSnapshot = candidates.slice(0, 5);
        }
      }

      const elapsedMs = Date.now() - startTimeRef.current;
      const submission = {
        recognizedText, elapsedMs, timedOut: timedOutRef.current,
        snapshotImageUrl: snapshotUrl || '', forcedMatch, candidatesSnapshot,
        rawStrokeData: rawTrace.length > 0 ? rawTrace : undefined,
      };

      let isCorrect = false;
      let saveFailed = false;
      try {
        const answerResult = await orchestrator.submitAnswer(question.word.id, submission);
        isCorrect = answerResult.grading.isCorrect;
      } catch (saveError) {
        saveFailed = true;
        isCorrect = recognizedText.toLowerCase() === question.word.word.toLowerCase();
        setStorageError(true);
      }

      const message = isCorrect
        ? `✅ 辨識為「${recognizedText || '(空白)'}」${saveFailed ? '（儲存失敗，但辨識正確）' : '，正確！'}`
        : `❌ 辨識為「${recognizedText || '(空白)'}」，正確答案是 ${question.word.word}${saveFailed ? '（儲存失敗）' : ''}`;

      setResult({ correct: isCorrect, message });

      const isPlacementMode = orchestrator.getDisplayInfo().mode === 'placement';
      if (!isCorrect && !isPlacementMode) {
        setWaitingForNext(true);
      } else {
        setTimeout(() => loadNext(), AUTO_ADVANCE_DELAY_MS);
      }
    } catch (error) {
      setResult({ correct: false, message: '發生錯誤，請重試' });
      setStatus('answering');
      submitLockRef.current = false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTimeout = () => {
    if (timedOutRef.current) return;
    timedOutRef.current = true;
    if (question && status === 'answering') handleSubmit();
  };

  if (status === 'done') {
    const displayInfo = orchestrator.getDisplayInfo();
    const doneMessage = displayInfo.mode === 'placement' ? '🎉 程度鑑定完成！' : '🎉 今日配額已完成！';
    const canContinue = orchestrator.canOfferContinue?.() ?? false;

    const handleContinue = () => {
      orchestrator.continueSession?.();
      setStatus('answering');
      void loadNext();
    };

    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <h2>{doneMessage}</h2>
        {storageError && <p style={{ color: '#ffc107' }}>⚠️ 部分資料儲存失敗，但已保留在本地，將自動同步</p>}
        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          {canContinue && (
            <button onClick={handleContinue} style={{ padding: '0.75rem 2rem', fontSize: '1.1rem', background: '#28a745', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
              📚 繼續練習
            </button>
          )}
          <button onClick={onSessionEnd} style={{ padding: '0.75rem 2rem', fontSize: '1.1rem', background: canContinue ? '#6c757d' : '#007bff', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            返回登入
          </button>
        </div>
        {canContinue && <p style={{ color: '#6c757d', marginTop: '1rem', fontSize: '0.9rem' }}>已達建議題數。想多練一些可以按「繼續練習」。</p>}
      </div>
    );
  }

  if (!question) return <div style={{ padding: '2rem', textAlign: 'center' }}>載入中...</div>;

  const displayInfo = orchestrator.getDisplayInfo();
  const speechRate = orchestrator.getSpeechRate();
  const speechFloorRate = orchestrator.getSpeechFloorRate();
  const showReplayButton = speechFloorRate !== null && speechFloorRate < speechRate;
  const isContinueMode = displayInfo.title.includes('課後加強');

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '1rem' }}>
      {/iPad|iPhone|iPod/.test(navigator.userAgent) && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffeeba', color: '#856404', padding: '8px 12px', borderRadius: '4px', marginBottom: '12px', fontSize: '0.85rem', textAlign: 'center' }}>
          🔔 若聽不到聲音，請確認裝置側邊的靜音開關已關閉
        </div>
      )}

      {displayInfo.showProgress && (
        <div style={{ padding: '0.5rem 1rem', background: displayInfo.mode === 'placement' ? '#fff3cd' : '#e7f3ff', borderRadius: '6px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', border: displayInfo.mode === 'placement' ? '1px solid #ffeeba' : '1px solid #b8daff' }}>
          <span>
            {displayInfo.mode === 'placement' ? '🎯' : '📋'} <strong>{displayInfo.title}</strong>
            {displayInfo.subtitle && <span style={{ marginLeft: '0.5rem', color: '#6c757d', fontWeight: 'normal' }}>{displayInfo.subtitle}</span>}
          </span>
          <span style={{ color: '#6c757d' }}>
            {displayInfo.progressLabel}：{dailyProgress.answered} / {dailyProgress.max} 題
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{question.word.meaning}</h2>
        <Countdown key={question.word.id} durationMs={question.timeLimitMs} started={countdownStarted} onTimeout={handleTimeout} />
      </div>

      <p style={{ color: '#666' }}>例句：{status === 'submitted' ? question.word.sentence : maskWordInSentence(question.word.sentence, question.word.word)}</p>

      <div style={{ margin: '1rem 0' }}>
        <label>✍️ 請在手寫區寫下單字</label>
        <HandwritingCanvas ref={canvasRef} key={question.word.id} maxChars={question.word.word.length + 2} onImageData={(data) => setSnapshotUrl(data)} disabled={status !== 'answering'} lockMode={orchestrator.getHandwritingMode()} />
      </div>

      {showReplayButton && (
        <div style={{ marginBottom: '0.75rem' }}>
          <button onClick={handleReplaySlow} disabled={status !== 'answering'} style={{ padding: '0.5rem 1.25rem', fontSize: '1rem', background: status === 'answering' ? '#17a2b8' : '#ccc', color: '#fff', border: 'none', borderRadius: '8px', cursor: status === 'answering' ? 'pointer' : 'default' }}>
            🐢 重聽一次（慢速）
          </button>
        </div>
      )}

      {storageError && (
        <div style={{ padding: '0.5rem', marginBottom: '0.5rem', background: '#fff3cd', borderRadius: '4px' }}>
          <span style={{ color: '#856404' }}>⚠️ 雲端儲存暫時不可用，資料已保存在本地</span>
        </div>
      )}

      <button onClick={handleSubmit} disabled={status !== 'answering' || isSubmitting} style={{ padding: '0.75rem 2rem', fontSize: '1.2rem', background: (status === 'answering' && !isSubmitting) ? '#007bff' : '#ccc', color: '#fff', border: 'none', borderRadius: '8px', cursor: (status === 'answering' && !isSubmitting) ? 'pointer' : 'default' }}>
        {isSubmitting ? '辨識中...' : '提交答案'}
      </button>

      {result && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: result.correct ? '#d4edda' : '#f8d7da', borderRadius: '6px', fontSize: '1.2rem' }}>
          {result.message}
        </div>
      )}

      {waitingForNext && (
        <button onClick={handleNextAfterWrong} style={{ marginTop: '1rem', padding: '0.75rem 2rem', fontSize: '1.2rem', background: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', width: '100%' }}>
          👉 下一題
        </button>
      )}

      {isContinueMode && (
        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <button onClick={handleExitClick} style={{ padding: '0.5rem 1.5rem', fontSize: '1rem', background: '#6c757d', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            🏁 結束課後練習
          </button>
        </div>
      )}

      {showExitModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', maxWidth: '400px', width: '90%', textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
            <h3 style={{ marginTop: 0, color: '#333' }}>今天的練習辛苦了！</h3>
            <p style={{ color: '#666', fontSize: '0.95rem' }}>想結束了嗎？請選擇一個原因：</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button onClick={() => handleConfirmExit('mastered')} disabled={isEndingSession} style={{ padding: '0.75rem', background: '#d4edda', color: '#155724', border: '1px solid #c3e6cb', borderRadius: '8px', cursor: isEndingSession ? 'default' : 'pointer', fontWeight: 'bold' }}>
                ✅ 我已經掌握今天的內容了
              </button>
              <button onClick={() => handleConfirmExit('fatigue')} disabled={isEndingSession} style={{ padding: '0.75rem', background: '#fff3cd', color: '#856404', border: '1px solid #ffeeba', borderRadius: '8px', cursor: isEndingSession ? 'default' : 'pointer', fontWeight: 'bold' }}>
                🧠 大腦有點累了，需要休息
              </button>
              <button onClick={() => handleConfirmExit('time_limit')} disabled={isEndingSession} style={{ padding: '0.75rem', background: '#e2e3e5', color: '#383d41', border: '1px solid #d6d8db', borderRadius: '8px', cursor: isEndingSession ? 'default' : 'pointer', fontWeight: 'bold' }}>
                ⏰ 時間不夠了，改天再練
              </button>
              <button onClick={handleCancelExit} disabled={isEndingSession} style={{ padding: '0.5rem', background: 'transparent', color: '#007bff', border: 'none', cursor: isEndingSession ? 'default' : 'pointer', marginTop: '0.5rem' }}>
                繼續練習
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};