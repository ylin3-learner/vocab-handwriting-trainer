// src/features/quiz/HandwritingCanvas.tsx
import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import type { HandwritingMode } from '../../domain/quiz/HandwritingLockPolicy';

interface HandwritingCanvasProps {
  onImageData?: (dataUrl: string) => void;
  disabled?: boolean;
  maxChars?: number;
  lockMode?: HandwritingMode;
}

// 內部使用的原始點位結構
interface RawPoint {
  x: number;
  y: number;
  t: number; // 相對於該筆畫開始的時間 (ms)
  p: number; // 壓力值 (0~1)
}

export interface HandwritingCanvasRef {
  getTrace: () => number[][][];
  // 🔥 新增：回傳結構為 [筆畫][點][x, y, time, pressure]
  getRawTrace: () => number[][][]; 
  clear: () => void;
}

export const HandwritingCanvas = forwardRef<HandwritingCanvasRef, HandwritingCanvasProps>(
  ({ onImageData, disabled = false, maxChars = 8, lockMode = 'normal' }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasContent, setHasContent] = useState(false);

    // 🔒 用 ref 鏡像 state，避免 startDraw 內的 stale closure
    const hasContentRef = useRef(false);

    // 🔥 將 strokesRef 改為儲存完整的 RawPoint，以相容 getTrace 與 getRawTrace
    const strokesRef = useRef<RawPoint[][]>([]);
    const currentStrokeRef = useRef<RawPoint[]>([]);
    // 🔥 紀錄每一筆開始的絕對時間，用於計算相對時間 t
    const strokeStartTimeRef = useRef<number>(0);

    // UI 用：是否需要顯示鎖定狀態（按鈕 disabled、顯示 🔒）
    const isLocked = lockMode === 'locked' && hasContent;

    const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.save();
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      const cols = Math.max(1, maxChars);
      const step = width / cols;
      for (let i = 1; i < cols; i++) {
        const x = i * step;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      ctx.restore();
    };

    /**
     * 清除畫布。
     */
    const clearCanvas = (force: boolean = false) => {
      if (!force && lockMode === 'locked' && hasContentRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawGrid(ctx, canvas.width, canvas.height);
      
      strokesRef.current = [];
      currentStrokeRef.current = [];

      hasContentRef.current = false;
      setHasContent(false);

      if (onImageData) onImageData('');
    };

    useImperativeHandle(ref, () => ({
      getTrace: () => {
        // 保持與 Google IME 相容的格式：[ [xs], [ys], [] ]
        const trace = strokesRef.current.map(stroke => {
          const xs = stroke.map(p => p.x);
          const ys = stroke.map(p => p.y);
          return [xs, ys, []] as number[][];
        });
        console.log('🔍 [IME] 轨迹数据 (笔画数):', trace.length);
        return trace;
      },
      
      // 🔥 新增：給 ML 訓練用的高精度資料
      getRawTrace: () => {
        // 回傳格式： [筆畫][點索引][ x, y, t, p ]
        const rawTrace = strokesRef.current.map(stroke => 
          stroke.map(p => [
            Number(p.x.toFixed(3)), 
            Number(p.y.toFixed(3)), 
            Math.round(p.t), 
            Number(p.p.toFixed(2))
          ])
        );
        return rawTrace;
      },
      
      clear: () => clearCanvas(false),
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#000000';

      clearCanvas(true);
      hasContentRef.current = false;
      setHasContent(false);
    }, [maxChars]);

    const getPos = (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      let clientX: number, clientY: number;
      if ('touches' in e) {
        const touch = e.touches[0];
        if (!touch) return { x: 0, y: 0 };
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height,
      };
    };

    // 🔥 輔助函式：獲取壓力值（觸控筆可能支援 force，滑鼠預設 0.5）
    const getPressure = (e: React.MouseEvent | React.TouchEvent): number => {
      if ('touches' in e) {
        const force = (e.touches[0] as any)?.force;
        return typeof force === 'number' && force > 0 ? force : 0.5;
      }
      return 0.5; // 滑鼠沒有壓力，給預設值
    };

    const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return;

      setIsDrawing(true);

      if (lockMode === 'locked' && !hasContentRef.current) {
        hasContentRef.current = true;
        setHasContent(true);
      }

      const { x, y } = getPos(e);
      const pressure = getPressure(e);
      
      // 🔥 記錄這筆的起始時間
      strokeStartTimeRef.current = performance.now();
      currentStrokeRef.current = [{ x, y, t: 0, p: pressure }];

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(x * canvas.width, y * canvas.height);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || disabled) return;

      const { x, y } = getPos(e);
      const pressure = getPressure(e);
      const timeOffset = performance.now() - strokeStartTimeRef.current;

      // 🔥 降採樣 (Downsampling)：節省 Firestore 空間
      // 如果距離上一個點太近（< 0.5% 畫布寬度）且時間太短（< 8ms），就忽略
      const lastPoint = currentStrokeRef.current[currentStrokeRef.current.length - 1];
      if (lastPoint) {
        const dx = x - lastPoint.x;
        const dy = y - lastPoint.y;
        const dt = timeOffset - lastPoint.t;
        // Math.hypot 計算歐幾里得距離
        if (Math.hypot(dx, dy) < 0.005 && dt < 8) return; 
      }

      currentStrokeRef.current.push({ x, y, t: timeOffset, p: pressure });

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.lineTo(x * canvas.width, y * canvas.height);
      ctx.stroke();
    };

    const endDraw = () => {
      if (!isDrawing) return;
      setIsDrawing(false);

      // 🔥 將這筆畫存入 strokesRef
      if (currentStrokeRef.current.length > 1) {
        strokesRef.current.push([...currentStrokeRef.current]);
      }
      currentStrokeRef.current = [];

      const canvas = canvasRef.current;
      if (!canvas) return;
      const dataUrl = canvas.toDataURL('image/png');
      if (onImageData) onImageData(dataUrl);
    };

    return (
      <div>
        <canvas
          ref={canvasRef}
          width={600}
          height={120}
          style={{
            border: '2px solid #ccc',
            borderRadius: '8px',
            touchAction: 'none',
            width: '100%',
            height: 'auto',
            backgroundColor: '#fff',
          }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        <button
          onClick={() => clearCanvas(false)}
          disabled={disabled || isLocked}
          style={{ marginTop: '8px' }}
        >
          {isLocked ? '🔒 已鎖定（比賽模式）' : '清除'}
        </button>
        {isLocked && (
          <div
            style={{
              marginTop: '4px',
              fontSize: '0.8rem',
              color: '#856404',
              background: '#fff3cd',
              padding: '4px 8px',
              borderRadius: '4px',
              display: 'inline-block',
            }}
          >
            🔒 比賽模式：動筆後不可塗改
          </div>
        )}
      </div>
    );
  }
);

HandwritingCanvas.displayName = 'HandwritingCanvas';