// src/services/recognition/OpenCVTfRecognitionEngine.ts
import * as tf from '@tensorflow/tfjs';
import { RecognitionEngine } from './RecognitionEngine';

declare var cv: any;

export class OpenCVTfRecognitionEngine implements RecognitionEngine {
  private model: tf.LayersModel | null = null;
  private modelLoaded = false;
  private opencvReady = false;
  private modelError = false;

  constructor() {
    this.initOpenCV();
    this.loadModel();
  }

  private initOpenCV(): void {
    if (typeof cv !== 'undefined') {
      this.opencvReady = true;
      console.log('OpenCV.js 已就緒 (載入時)');
      return;
    }
    (window as any).onOpenCvReady = () => {
      this.opencvReady = true;
      console.log('OpenCV.js 已載入 (回呼)');
    };
    const check = setInterval(() => {
      if (typeof cv !== 'undefined') {
        this.opencvReady = true;
        clearInterval(check);
        console.log('OpenCV.js 已就緒 (輪詢)');
      }
    }, 200);
  }

  private async loadModel(): Promise<void> {
    try {
      this.model = await tf.loadLayersModel('/models/handwriting/model.json');
      this.modelLoaded = true;
      if (this.model) {
        const inputShape = this.model.inputs[0]?.shape;
        const outputShape = this.model.outputs[0]?.shape;
        console.log('模型输入形状:', inputShape);
        console.log('模型输出形状:', outputShape);
      }
      console.log('✅ 手寫辨識模型載入成功');
    } catch (err) {
      this.modelError = true;
      console.error('❌ 載入模型失敗:', err);
    }
  }

  async recognize(imageDataUrl: string): Promise<string> {
    if (this.modelError) {
      console.warn('模型載入失敗，無法辨識');
      return '';
    }

    const ready = await this.waitForReadyWithTimeout(5000);
    if (!ready) {
      console.warn('OpenCV 或模型未就緒，超時');
      return '';
    }

    const img = await this.dataUrlToMat(imageDataUrl);
    if (!img) return '';

    // 1. 灰階 + 二值化
    const gray = new cv.Mat();
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);
    const binary = new cv.Mat();
    cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

    // 2. 垂直投影法斷字（計算每一列的黑點總和）
    const cols = binary.cols;
    const rows = binary.rows;
    const colSum = new Array(cols).fill(0);

    // 計算每一列的黑點數量（二值化後黑點為 255）
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const pixel = binary.data[y * cols + x];
        if (pixel === 255) colSum[x]++;
      }
    }

    // 3. 找出「完全空白」的列（用來切字）
    const minColHeight = 5; // 避免雜訊
    const segments: { start: number; end: number }[] = [];
    let inWord = false;
    let start = 0;

    for (let x = 0; x < cols; x++) {
      const isBlank = colSum[x] < minColHeight;
      if (!inWord && !isBlank) {
        inWord = true;
        start = x;
      } else if (inWord && isBlank) {
        inWord = false;
        // 寬度太小的可能是雜訊或標點，忽略
        if (x - start > 8) {
          segments.push({ start, end: x });
        }
      }
    }
    if (inWord && cols - start > 8) {
      segments.push({ start, end: cols });
    }

    // 4. 逐字辨識
    let recognized = '';
    for (const seg of segments) {
      // 抓出這個字元的 ROI（加上左右留白 2 像素避免裁切太緊）
      const pad = 2;
      const roiStartX = Math.max(0, seg.start - pad);
      const roiEndX = Math.min(cols, seg.end + pad);
      const roiWidth = roiEndX - roiStartX;
      const roiHeight = rows;

      // 從 binary 裁切
      const roi = binary.roi(new cv.Rect(roiStartX, 0, roiWidth, roiHeight));

      // 去掉上下多餘空白（水平投影）
      const trimmed = this.trimVertical(roi);
      if (!trimmed) continue;

      const char = await this.classifyChar(trimmed);
      recognized += char;
      trimmed.delete();
      roi.delete();
    }

    // 釋放記憶體
    img.delete();
    gray.delete();
    binary.delete();

    return recognized.trim();
  }

  // 新增輔助函式：裁掉上下多餘空白
  private trimVertical(mat: any): any {
    const rows = mat.rows;
    const cols = mat.cols;
    let top = 0;
    let bottom = rows - 1;

    // 找最上面的黑點
    for (let y = 0; y < rows; y++) {
      let hasBlack = false;
      for (let x = 0; x < cols; x++) {
        if (mat.data[y * cols + x] === 255) { hasBlack = true; break; }
      }
      if (hasBlack) { top = y; break; }
    }

    // 找最下面的黑點
    for (let y = rows - 1; y >= 0; y--) {
      let hasBlack = false;
      for (let x = 0; x < cols; x++) {
        if (mat.data[y * cols + x] === 255) { hasBlack = true; break; }
      }
      if (hasBlack) { bottom = y; break; }
    }

    if (top >= bottom) return mat; // 無效
    const height = bottom - top + 1;
    return mat.roi(new cv.Rect(0, top, cols, height));
  }

  private async waitForReadyWithTimeout(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (!this.opencvReady || !this.modelLoaded) {
      if (Date.now() - start > timeoutMs) {
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
  }

  private async classifyChar(roi: any): Promise<string> {
    const size = 28;
    const resized = new cv.Mat();
    cv.resize(roi, resized, new cv.Size(size, size), 0, 0, cv.INTER_AREA);

    const pixelData = new Uint8Array(resized.data);
    const values = Array.from(pixelData).map(v => v / 255.0);
    const tensor = tf.tensor4d(values, [1, size, size, 1]);

    if (!this.model) {
      resized.delete();
      return '';
    }

    const output = this.model.predict(tensor) as tf.Tensor;
    const predictions = await output.data();
    const maxIdx = predictions.indexOf(Math.max(...predictions));

    tensor.dispose();
    output.dispose();
    resized.delete();

    return this.idxToChar(maxIdx);
  }

  private idxToChar(idx: number): string {
    if (idx < 26) return String.fromCharCode(65 + idx);
    if (idx < 52) return String.fromCharCode(97 + (idx - 26));
    return String.fromCharCode(48 + (idx - 52));
  }

  private dataUrlToMat(dataUrl: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        try {
          const mat = cv.matFromImageData(imageData);
          resolve(mat);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async terminate(): Promise<void> {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
  }
}