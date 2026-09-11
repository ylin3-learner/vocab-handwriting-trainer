// src/domain/analytics/radarMetrics.ts
import { StudentAnalytics } from '../../types/analytics';

export interface RadarMetrics {
    accuracy: number;      // 準確度
    speed: number;         // 速度
    spelling: number;      // 拼字精準
    stress: number;        // 抗壓性（不超時）
    consistency: number;   // 穩定度
}

/**
 * 純函式：將 StudentAnalytics 轉換為雷達圖的五維分數（0~100）
 */
export function calculateRadarMetrics(a: StudentAnalytics): RadarMetrics {
    // 邊界情境：沒有作答紀錄
    if (a.totalAttempts === 0) {
        return { accuracy: 0, speed: 0, spelling: 0, stress: 0, consistency: 0 };
    }

    // 1. 準確度：直接使用正確率
    const accuracy = a.correctRate;

    // 2. 速度：0ms → 100, 8000ms → 0（線性映射）
    const speed = Math.max(0, Math.min(100, 100 - (a.avgResponseTimeMs / 8000) * 100));

    // 3. 拼字精準：只計算「有寫的題目」中，拼字錯誤的比例
    //    （排除 timeout，因為超時的題目根本沒機會拼字）
    const nonTimeoutAttempts = a.totalAttempts - a.errorBreakdown.timeout;
    const spelling = nonTimeoutAttempts > 0
        ? Math.max(0, 100 - (a.errorBreakdown.spelling / nonTimeoutAttempts) * 100)
        : 0;  // 全部超時 → 拼字精準視為 0 分

    // 4. 抗壓性：沒有超時 → 100
    const stress = Math.max(0, 100 - (a.errorBreakdown.timeout / a.totalAttempts) * 100);

    // 5. 穩定度：快 + 正常的答題比例
    const consistency =
        ((a.responseTimeDistribution.fast + a.responseTimeDistribution.normal) / a.totalAttempts) * 100;

    return {
        accuracy: Math.round(accuracy),
        speed: Math.round(speed),
        spelling: Math.round(spelling),
        stress: Math.round(stress),
        consistency: Math.round(consistency),
    };
}