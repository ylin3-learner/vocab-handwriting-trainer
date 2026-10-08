import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import type { HandwritingMode } from '../../domain/quiz/HandwritingLockPolicy';

interface HandwritingCanvasProps {
  onImageData?: (dataUrl: string) => void;
  disabled?: boolean;
  maxChars?: number;
  lockMode?: HandwritingMode;
}

export interface HandwritingCanvasRef {
  getTrace: () => number[][][];
  clear: () => void;
}

export const HandwritingCanvas = forwardRef<HandwritingCanvasRef, HandwritingCanvasProps>(
  ({ onImageData, disabled = false, maxChars = 8, lockMode = 'normal' }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasContent, setHasContent] = useState(false);

    // 🔒 用 ref 鏡像 state，避免 startDraw 內的 stale closure
    const hasContentRef = useRef(false);

    const strokesRef = useRef<{ x: number; y: number }[][]>([]);
    const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);

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
     *
     * @param force 若為 true，跳過鎖定檢查（內部初始化用）。
     *              使用者主動清除時傳 false（預設）。
     */
    const clearCanvas = (force: boolean = false) => {
      // 🔒 鎖定模式下，拒絕使用者主動清除
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
        const trace = strokesRef.current.map(stroke => {
          const xs = stroke.map(p => p.x);
          const ys = stroke.map(p => p.y);
          return [xs, ys, []] as number[][];
        });
        console.log('🔍 轨迹数据 (笔画数):', trace.length, trace);
        return trace;
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

      // 強制清除，跳過鎖定檢查（初始化時不應被鎖定擋住）
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

    const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return;

      // 不應該阻止新筆畫（學生需要寫完整個單字）
      // if (lockMode === 'locked' && hasContentRef.current) return;

      e.preventDefault();
      setIsDrawing(true);

      // 🔒 一動筆就鎖：在 startDraw 時就標記為有內容
      //   （而非等 endDraw，防止「點一下沒拖動」繞過鎖定）
      if (lockMode === 'locked' && !hasContentRef.current) {
        hasContentRef.current = true;
        setHasContent(true);
      }

      const { x, y } = getPos(e);
      currentStrokeRef.current = [{ x, y }];
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(x * canvas.width, y * canvas.height);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || disabled) return;
      e.preventDefault();
      const { x, y } = getPos(e);
      currentStrokeRef.current.push({ x, y });
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