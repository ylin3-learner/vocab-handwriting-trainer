import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';

interface HandwritingCanvasProps {
  onImageData?: (dataUrl: string) => void;
  disabled?: boolean;
  maxChars?: number;
}

export interface HandwritingCanvasRef {
  getTrace: () => number[][][];
  clear: () => void;
}

export const HandwritingCanvas = forwardRef<HandwritingCanvasRef, HandwritingCanvasProps>(
  ({ onImageData, disabled = false, maxChars = 8 }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const strokesRef = useRef<{ x: number; y: number }[][]>([]);
    const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);

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

    const clearCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawGrid(ctx, canvas.width, canvas.height);
      strokesRef.current = [];
      currentStrokeRef.current = [];
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
      clear: clearCanvas,
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
      clearCanvas();
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
      e.preventDefault();
      setIsDrawing(true);
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
        <button onClick={clearCanvas} disabled={disabled} style={{ marginTop: '8px' }}>
          清除
        </button>
      </div>
    );
  }
);

HandwritingCanvas.displayName = 'HandwritingCanvas';