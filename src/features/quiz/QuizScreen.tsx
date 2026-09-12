// src/features/quiz/QuizScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { QuizOrchestrator, QuizQuestion } from './QuizOrchestrator';
import { Countdown } from './Countdown';
import { HandwritingCanvas, HandwritingCanvasRef } from './HandwritingCanvas';

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 120;

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
  orchestrator: QuizOrchestrator;
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
  // 🔥 同步鎖：避免連點提交導致重複 loadNext
  const submitLockRef = useRef<boolean>(false);

  const activeAssignment = orchestrator.getActiveAssignment();

  const loadNext = async () => {
    // 🔥 關鍵：先停掉上一題的語音，避免音檔重疊
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    const q = await orchestrator.nextQuestion();
    setDailyProgress(orchestrator.getDailyProgress());

    if (!q) {
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
    submitLockRef.current = false; // 重置鎖

    if (window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(
        `${q.word.word}。例句：${q.word.sentence}`
      );
      utterance.lang = 'zh-TW';
      utterance.rate = 0.8;
      speechRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    }
  };

  useEffect(() => {
    loadNext();
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSubmit = async () => {
    // 🔥 同步鎖：立即鎖定，避免連點
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

      // 🔥 從 2000ms 縮短為 1200ms，使用者體驗更流暢
      setTimeout(() => loadNext(), 1200);
    } catch (error) {
      console.error('提交錯誤:', error);
      setResult({ correct: false, message: '發生錯誤，請重試' });
      setStatus('answering');
      submitLockRef.current = false; // 失敗時解鎖
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTimeout = () => {
    if (timedOutRef.current) return; // 避免重複觸發
    timedOutRef.current = true;
    if (question && status === 'answering') {
      handleSubmit();
    }
  };

  if (status === 'done') {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <h2>🎉 今日配額已完成！</h2>
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

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '1rem' }}>
      {dailyProgress.max > 0 && (
        <div style={{
          padding: '0.5rem 1rem',
          background: activeAssignment ? '#e7f3ff' : '#f0f0f0',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.9rem',
          border: activeAssignment ? '1px solid #b8daff' : '1px solid #d0d0d0',
        }}>
          <span>
            📋 <strong>
              {activeAssignment
                ? activeAssignment.assignment.name
                : '每日練習（預設配額）'}
            </strong>
          </span>
          <span style={{ color: '#6c757d' }}>
            進度：{dailyProgress.answered} / {dailyProgress.max} 題
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{question.word.meaning}</h2>
        <Countdown
          key={question.word.id}
          durationMs={question.timeLimitMs}
          onTimeout={handleTimeout}
          onTick={(rem) => {
            if (rem <= 0 && status === 'answering') {
              handleTimeout();
            }
          }}
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