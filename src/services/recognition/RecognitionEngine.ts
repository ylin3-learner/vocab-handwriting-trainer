// src/services/recognition/RecognitionEngine.ts
export interface RecognitionEngine {
  recognize(imageDataUrl: string): Promise<string>;
  terminate?(): Promise<void>; // 可選的釋放資源方法
}