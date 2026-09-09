import React, { useEffect, useState } from 'react';

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

  useEffect(() => {
    if (remaining <= 0) {
      onTimeout();
      return;
    }
    const interval = setInterval(() => {
      setRemaining((prev) => {
        const next = Math.max(0, prev - 100);
        if (onTick) onTick(next);
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [remaining, onTimeout, onTick]);

  const seconds = Math.ceil(remaining / 1000);
  return (
    <div style={{ fontSize: '2rem', fontWeight: 'bold', color: remaining < 3000 ? 'red' : 'black' }}>
      ⏱️ {seconds}s
    </div>
  );
};