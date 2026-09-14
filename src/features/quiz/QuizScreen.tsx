// src/features/quiz/QuizScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { QuizSessionApi } from './QuizSessionApi';
import { QuizQuestion } from './QuizOrchestrator';
import { Countdown } from './Countdown';
import { HandwritingCanvas, HandwritingCanvasRef } from './HandwritingCanvas';

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 120;

/**
 * cancel() 後等待的毫秒數。
 * Chrome 的 speechSynthesis.cancel() 是非同步的，
 * 立刻 speak() 可能被忽略或排在舊語音之後，造成殘留。
 */
const SPEECH_CANCEL_DELAY_MS = 100;

async function callGoogleIME(trace: number[][][], language: string = 'en'): Promise<string[]> {
  const scaledTrace = trace.map(stroke => {
    const xs = (stroke[0] || []).map(x => x * CANVAS_WIDTH);
    const ys = (stroke[1] || []).map(y => y * CANVAS_HEIGHT);
    return [xs, ys, []];
  });

  const data = JSON.stringify({
    options: 'enable_pre_space',
    requests: [
      {
        writing_guide: {
          writing_area_width: CANVAS_WIDTH,
          writing_area_height: CANVAS_HEIGHT,
        },
        ink: scaledTrace,
        language: language,
      },
    ],
  });

  try {
    const response = await fetch(
      'https://www.google.com.tw/inputtools/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (result && result.length > 1 && result[1] && result[1][0]) {
      const candidates = result[1][0][1];
      if (candidates && candidates.length > 0) {
        return candidates;
      }
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

export const QuizScreen: React.FC<QuizScreenProps> = ({
  orchestrator,
  onSessionEnd,
}) => {
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'answering' | 'submitted' | 'done'>('idle');
  const [result, setResult] = useState<{ correct: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [storageError, setStorageError] = useState<boolean>(false);
  const [dailyProgress, setDailyProgress] = useState<{ answered: number; max: number }>({ answered: 0, max: 0 });
  const startTimeRef = useRef<number>(0);
  const timedOutRef = useRef<boolean>(false);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const canvasRef = useRef<HandwritingCanvasRef>(null);
  const submitLockRef = useRef<boolean>(false);

  // 🔥 防止 React StrictMode 在 dev 模式觸發 useEffect 兩次
  const hasInitializedRef = useRef<boolean>(false);

  // 🔥 防止過期的 speakWord 呼叫仍在播放語音
  const speechIdRef = useRef<number>(0);

  /** 取消所有語音播放（同步呼叫） */
  const cancelSpeech = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  /**
   * 播放單字 + 英文例句。
   *
   * 修復點：
   *   1. 純英文格式（en-US），避免中文標點被英文引擎誤讀
   *   2. cancel() 後等 SPEECH_CANCEL_DELAY_MS 讓 queue 真的清空
   *   3. 用 speechIdRef 檢查：如果已經有更新的呼叫，跳過
   */
  const speakWord = async (word: string, sentence: string) => {
    const myId = ++speechIdRef.current;

    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    await new Promise(resolve => setTimeout(resolve, SPEECH_CANCEL_DELAY_MS));

    // 若有更新的呼叫進來，跳過（避免過期語音繼續播放）
    if (myId !== speechIdRef.current) {
      console.log(`🔇 [speakWord] 跳過過期語音：${word}`);
      return;
    }
    if (!window.speechSynthesis) return;

    // 純英文格式：單字 + 句號停頓 + 例句
    const text = `${word}. ${sentence}`;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;

    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') {
        console.warn('🔇 語音播放錯誤:', e.error);
      }
    };

    console.log(`🔊 [speakWord] 播放：${word}`);
    speechRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const loadNext = async () => {
    // 先停掉上一題的語音
    cancelSpeech();

    const q = await orchestrator.nextQuestion();
    setDailyProgress(orchestrator.getDailyProgress());

    if (!q) {
      if (orchestrator.finalizeSession) {
        try {
          await orchestrator.finalizeSession();
        } catch (e) {
          console.warn('⚠️ finalizeSession 失敗:', e);
        }
      }
      setStatus('done');
      return;
    }

    setQuestion(q);
    setSnapshotUrl(undefined);
    setResult(null);
    setStorageError(false);
    setStatus('answering');
    startTimeRef.current = Date.now();
    timedOutRef.current = false;
    submitLockRef.current = false;

    // 播放語音
    await speakWord(q.word.word, q.word.sentence);
  };

  useEffect(() => {
    // 🔥 防止 StrictMode 雙重觸發
    if (hasInitializedRef.current) {
      console.log('⚠️ [QuizScreen] useEffect 被觸發第二次，跳過');
      return;
    }
    hasInitializedRef.current = true;

    loadNext();

    return () => {
      cancelSpeech();
    };
  }, []);

  const handleSubmit = async () => {
    if (submitLockRef.current) return;
    if (status !== 'answering' || !question) return;

    submitLockRef.current = true;
    setIsSubmitting(true);
    setStatus('submitted');

    try {
      let recognizedText = '';
      const trace = canvasRef.current?.getTrace() || [];
      if (trace.length > 0 && trace[0] && Array.isArray(trace[0][0]) && trace[0][0].length > 0) {
        const candidates = await callGoogleIME(trace, 'en');
        console.log('🔍 [IME] 候選字：', candidates);
        if (candidates.length > 0) {
          const exactMatch = candidates.find(
            (cand) => cand.toLowerCase() === question.word.word.toLowerCase()
          );
          recognizedText = exactMatch || candidates[0] || '';
        }
      }

      const elapsedMs = Date.now() - startTimeRef.current;
      console.log('🔍 [TIMING]', {
        word: question.word.word,
        recognizedText,
        elapsedMs,
        timedOut: timedOutRef.current,
        startTime: new Date(startTimeRef.current).toISOString(),
        now: new Date().toISOString(),
      });
      const submission = {
        recognizedText,
        elapsedMs,
        timedOut: timedOutRef.current,
        snapshotImageUrl: snapshotUrl || '',
      };

      let isCorrect = false;
      let saveFailed = false;
      try {
        const answerResult = await orchestrator.submitAnswer(question.word.id, submission);
        isCorrect = answerResult.grading.isCorrect;
      } catch (saveError) {
        console.warn('⚠️ 提交答案儲存失敗，但辨識成功:', saveError);
        saveFailed = true;
        isCorrect = recognizedText.toLowerCase() === question.word.word.toLowerCase();
        setStorageError(true);
      }

      const message = isCorrect
        ? `✅ 辨識為「${recognizedText || '(空白)'}」${saveFailed ? '（儲存失敗，但辨識正確）' : '，正確！'}`
        : `❌ 辨識為「${recognizedText || '(空白)'}」，正確答案是 ${question.word.word}${saveFailed ? '（儲存失敗）' : ''}`;

      setResult({ correct: isCorrect, message });

      setTimeout(() => loadNext(), 1200);
    } catch (error) {
      console.error('提交錯誤:', error);
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
    if (question && status === 'answering') {
      handleSubmit();
    }
  };

  if (status === 'done') {
    const displayInfo = orchestrator.getDisplayInfo();
    const doneMessage = displayInfo.mode === 'placement'
      ? '🎉 程度鑑定完成！'
      : '🎉 今日配額已完成！';

    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <h2>{doneMessage}</h2>
        {storageError && (
          <p style={{ color: '#ffc107' }}>⚠️ 部分資料儲存失敗，但已保留在本地，將自動同步</p>
        )}
        <button onClick={onSessionEnd} style={{ padding: '0.5rem 2rem', fontSize: '1rem', cursor: 'pointer' }}>
          返回登入
        </button>
      </div>
    );
  }

  if (!question) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>載入中...</div>;
  }

  const displayInfo = orchestrator.getDisplayInfo();

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '1rem' }}>
      {/* 🔥 iOS 靜音開關提示：只在 iOS 裝置顯示 */}
      {/iPad|iPhone|iPod/.test(navigator.userAgent) && (
        <div style={{
          background: '#fff3cd',
          border: '1px solid #ffeeba',
          color: '#856404',
          padding: '8px 12px',
          borderRadius: '4px',
          marginBottom: '12px',
          fontSize: '0.85rem',
          textAlign: 'center',
        }}>
          🔔 若聽不到聲音，請確認裝置側邊的靜音開關（或控制中心的鈴鐺圖示）已關閉
        </div>
      )}
      {displayInfo.showProgress && (
        <div style={{
          padding: '0.5rem 1rem',
          background: displayInfo.mode === 'placement' ? '#fff3cd' : '#e7f3ff',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.9rem',
          border: displayInfo.mode === 'placement' ? '1px solid #ffeeba' : '1px solid #b8daff',
        }}>
          <span>
            {displayInfo.mode === 'placement' ? '🎯' : '📋'} <strong>{displayInfo.title}</strong>
            {displayInfo.subtitle && (
              <span style={{ marginLeft: '0.5rem', color: '#6c757d', fontWeight: 'normal' }}>
                {displayInfo.subtitle}
              </span>
            )}
          </span>
          <span style={{ color: '#6c757d' }}>
            {displayInfo.progressLabel}：{displayInfo.progressCurrent} / {displayInfo.progressTotal} 題
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{question.word.meaning}</h2>
        <Countdown
          key={question.word.id}
          durationMs={question.timeLimitMs}
          onTimeout={handleTimeout}
        />
      </div>

      <p style={{ color: '#666' }}>例句：{question.word.sentence}</p>

      <div style={{ margin: '1rem 0' }}>
        <label>✍️ 請在手寫區寫下單字</label>
        <HandwritingCanvas
          ref={canvasRef}
          key={question.word.id}
          maxChars={question.word.word.length + 2}
          onImageData={(data) => setSnapshotUrl(data)}
          disabled={status !== 'answering'}
        />
      </div>

      {storageError && (
        <div style={{ padding: '0.5rem', marginBottom: '0.5rem', background: '#fff3cd', borderRadius: '4px' }}>
          <span style={{ color: '#856404' }}>⚠️ 雲端儲存暫時不可用，資料已保存在本地</span>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={status !== 'answering' || isSubmitting}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1.2rem',
          background: (status === 'answering' && !isSubmitting) ? '#007bff' : '#ccc',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: (status === 'answering' && !isSubmitting) ? 'pointer' : 'default',
        }}
      >
        {isSubmitting ? '辨識中...' : '提交答案'}
      </button>

      {result && (
        <div
          style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: result.correct ? '#d4edda' : '#f8d7da',
            borderRadius: '6px',
            fontSize: '1.2rem',
          }}
        >
          {result.message}
        </div>
      )}
    </div>
  );
};