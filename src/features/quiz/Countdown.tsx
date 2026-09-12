// src/features/quiz/Countdown.tsx
import React, { useEffect, useRef, useState } from 'react';

interface CountdownProps {
  durationMs: number;
  onTimeout: () => void;
  onTick?: (remainingMs: number) => void;
}

export const Countdown: React.FC<CountdownProps> = ({
  durationMs,
  onTimeout,
  onTick,
}) => {
  const [remaining, setRemaining] = useState(durationMs);

  // 用 ref 保存最新的 callback，避免父元件 re-render 時重建 interval
  const onTimeoutRef = useRef(onTimeout);
  const onTickRef = useRef(onTick);
  const hasTimedOutRef = useRef(false);

  // 每次 render 後同步最新的 callback 到 ref（不觸發任何 setState）
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
    onTickRef.current = onTick;
  });

  // ============================================================
  // 倒數計時：每個 durationMs 只建立一次 interval
  // ============================================================
  useEffect(() => {
    hasTimedOutRef.current = false;
    setRemaining(durationMs);

    const startTime = Date.now();
    const interval = setInterval(() => {
      // 🔥 用「實際經過時間」計算，避免累積誤差
      const next = Math.max(0, durationMs - (Date.now() - startTime));
      setRemaining(next);

      if (next <= 0) {
        clearInterval(interval);
        // 🔥 在 interval callback 中呼叫（非 render 期間），不會觸發 React 警告
        if (!hasTimedOutRef.current) {
          hasTimedOutRef.current = true;
          onTimeoutRef.current();
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [durationMs]);

  // ============================================================
  // onTick：改由 effect 統一通知，不在 render 期間呼叫
  // ============================================================
  useEffect(() => {
    if (onTickRef.current) {
      onTickRef.current(remaining);
    }
  }, [remaining]);

  const seconds = Math.ceil(remaining / 1000);
  return (
    <div
      style={{
        fontSize: '2rem',
        fontWeight: 'bold',
        color: remaining < 3000 ? 'red' : 'black',
      }}
    >
      ⏱️ {seconds}s
    </div>
  );
};