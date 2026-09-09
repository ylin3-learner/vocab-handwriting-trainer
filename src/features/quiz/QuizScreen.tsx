// src/features/quiz/QuizScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { QuizOrchestrator, QuizQuestion } from './QuizOrchestrator';
import { Countdown } from './Countdown';
import { HandwritingCanvas, HandwritingCanvasRef } from './HandwritingCanvas';

// 畫布實際尺寸（必須與 HandwritingCanvas 的 width/height 一致）
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 120;

async function callGoogleIME(trace: number[][][], language: string = 'en'): Promise<string[]> {
    // 將歸一化座標轉換為像素座標，並複製一份避免修改原始數據
    const scaledTrace = trace.map(stroke => {
        const xs = (stroke[0] || []).map(x => x * CANVAS_WIDTH);
        const ys = (stroke[1] || []).map(y => y * CANVAS_HEIGHT);
        return [xs, ys, []];
    });

    console.log('📤 發送筆跡 (像素座標), 筆畫數:', scaledTrace.length);
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
                headers: {
                    'Content-Type': 'application/json',
                },
                body: data,
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('📥 Google API 完整回應:', result);
        if (result && result.length > 1 && result[1] && result[1][0]) {
            const candidates = result[1][0][1];
            if (candidates && candidates.length > 0) {
                console.log('🏆 候選詞列表:', candidates);
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
    const startTimeRef = useRef<number>(0);
    const timedOutRef = useRef<boolean>(false);
    const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
    const canvasRef = useRef<HandwritingCanvasRef>(null);

    const loadNext = async () => {
        const q = await orchestrator.nextQuestion();
        if (!q) {
            setStatus('done');
            return;
        }
        setQuestion(q);
        setSnapshotUrl(undefined);
        setResult(null);
        setStatus('answering');
        startTimeRef.current = Date.now();
        timedOutRef.current = false;

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
        if (status !== 'answering' || !question || isSubmitting) return;

        setIsSubmitting(true);
        setStatus('submitted');

        try {
            let recognizedText = '';
            const trace = canvasRef.current?.getTrace() || [];
            // 檢查是否有有效筆畫（至少一個筆畫，且第一個筆畫的 x 座標陣列非空）
            if (trace.length > 0 && trace[0] && Array.isArray(trace[0][0]) && trace[0][0].length > 0) {
                const candidates = await callGoogleIME(trace, 'en');
                if (candidates.length > 0) {
                    // 優先選取完全匹配正確答案的候選詞（不區分大小寫）
                    const exactMatch = candidates.find(
                        (cand) => cand.toLowerCase() === question.word.word.toLowerCase()
                    );
                    recognizedText = exactMatch || candidates[0] || '';
                    console.log(`✅ 選用結果: "${recognizedText}" (候選清單: ${candidates.join(', ')})`);
                }
            }

            const elapsedMs = Date.now() - startTimeRef.current;
            const submission = {
                recognizedText,
                elapsedMs,
                timedOut: timedOutRef.current,
                snapshotImageUrl: snapshotUrl || '',
            };

            const answerResult = await orchestrator.submitAnswer(question.word.id, submission);

            let message = answerResult.grading.isCorrect
                ? `✅ 辨識為「${recognizedText || '(空白)'}」，正確！`
                : `❌ 辨識為「${recognizedText || '(空白)'}」，正確答案是 ${question.word.word}`;
            setResult({
                correct: answerResult.grading.isCorrect,
                message,
            });

            setTimeout(() => loadNext(), 1500);
        } catch (error) {
            console.error('提交錯誤:', error);
            setResult({ correct: false, message: '發生錯誤，請重試' });
            setStatus('answering');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleTimeout = () => {
        timedOutRef.current = true;
        if (question && status === 'answering') {
            handleSubmit();
        }
    };

    if (status === 'done') {
        return (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
                <h2>🎉 今日配額已完成！</h2>
                <button onClick={onSessionEnd}>返回登入</button>
            </div>
        );
    }

    if (!question) {
        return <div>載入中...</div>;
    }

    return (
        <div style={{ maxWidth: '700px', margin: '0 auto', padding: '1rem' }}>
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