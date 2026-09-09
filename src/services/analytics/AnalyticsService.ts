// src/services/analytics/AnalyticsService.ts
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { AttemptRecord } from '../storage/ProgressStore';

// 定義學生統計資料結構
export interface StudentStat {
  id: string;               // 學生 ID
  name: string;             // 姓名 (從 students 文件取得)
  class: string;            // 班級
  totalAttempts: number;    // 總作答題數
  correctCount: number;     // 答對題數
  correctRate: number;      // 正確率 (0~1)
  avgResponseTime: number;  // 平均作答秒數
  riskLevel: 'low' | 'medium' | 'high'; // 風險等級
}

export interface WeakWord {
  wordId: string;
  wordText: string;         // 單字內容 (需從 attempt 或 word repo 對應)
  errorCount: number;       // 錯誤次數
  totalAttempts: number;    // 總出現次數
  errorRate: number;        // 錯誤率
}

export class AnalyticsService {
  // 1. 取得所有學生的完整統計資料（對應 6.2 & 6.3 & 6.5）
  async getAllStudentsStats(): Promise<StudentStat[]> {
    // 1.1 取得所有學生列表
    const studentsSnap = await getDocs(collection(db, 'students'));
    const students = studentsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as { id: string; name?: string; class?: string }[];

    // 1.2 取得所有作答紀錄
    const attemptsSnap = await getDocs(collection(db, 'attempts'));
    const attempts = attemptsSnap.docs.map(doc => doc.data() as AttemptRecord);

    // 1.3 按學生 ID 分組計算統計數據
    const statsMap = new Map<string, StudentStat>();

    students.forEach(s => {
      statsMap.set(s.id, {
        id: s.id,
        name: s.name || s.id,
        class: s.class || '未分類',
        totalAttempts: 0,
        correctCount: 0,
        correctRate: 0,
        avgResponseTime: 0,
        riskLevel: 'low',
      });
    });

    attempts.forEach(a => {
      const stat = statsMap.get(a.studentId);
      if (!stat) return;
      stat.totalAttempts += 1;
      if (a.isCorrect) stat.correctCount += 1;
      // 計算平均時間 (累加，最後再除)
      stat.avgResponseTime += a.responseTimeMs;
    });

    // 1.4 計算最終數值
    const result: StudentStat[] = [];
    statsMap.forEach(stat => {
      if (stat.totalAttempts === 0) {
        // 從未練習的學生，風險標記為 low，但沒有數據
        result.push({ ...stat, avgResponseTime: 0, correctRate: 0, riskLevel: 'low' });
        return;
      }
      const avgTime = stat.avgResponseTime / stat.totalAttempts;
      const rate = stat.correctCount / stat.totalAttempts;
      
      // 風險判斷：正確率 < 60% 為高風險，60%~80% 為中風險
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      if (rate < 0.6) riskLevel = 'high';
      else if (rate < 0.8) riskLevel = 'medium';

      result.push({
        ...stat,
        avgResponseTime: Math.round(avgTime / 1000), // 轉換為秒數
        correctRate: Math.round(rate * 100), // 轉換為百分比
        riskLevel,
      });
    });

    return result;
  }

  // 2. Top-K 弱點分析（6.4）：找出錯誤率最高的前 K 個單字
  async getTopWeakWords(limit: number = 5): Promise<WeakWord[]> {
    const attemptsSnap = await getDocs(collection(db, 'attempts'));
    const attempts = attemptsSnap.docs.map(doc => doc.data() as AttemptRecord);

    // 統計每個 wordId 的總出現次數與錯誤次數
    const wordMap = new Map<string, { errorCount: number; total: number }>();
    
    attempts.forEach(a => {
      const data = wordMap.get(a.wordId);
      if (!data) {
        wordMap.set(a.wordId, { errorCount: a.isCorrect ? 0 : 1, total: 1 });
      } else {
        data.total += 1;
        if (!a.isCorrect) data.errorCount += 1;
      }
    });

    // 計算錯誤率並排序
    const weakWords: WeakWord[] = [];
    wordMap.forEach((value, wordId) => {
      // 為了顯示 wordText，我們需要從某處取得單字名稱。
      // 暫時先用 wordId 代替，未來可擴充從 vocabulary 集合查詢。
      weakWords.push({
        wordId,
        wordText: wordId, // 優化點：可從 Firestore vocabulary 集合對應名稱
        errorCount: value.errorCount,
        totalAttempts: value.total,
        errorRate: Math.round((value.errorCount / value.total) * 100),
      });
    });

    // 依錯誤率由高到低排序，取出前 K 名
    weakWords.sort((a, b) => b.errorRate - a.errorRate);
    return weakWords.slice(0, limit);
  }

  // 3. 獲取整體班級摘要（給儀表板頂部使用）
  async getClassSummary() {
    const stats = await this.getAllStudentsStats();
    const totalStudents = stats.length;
    const totalQuestions = stats.reduce((sum, s) => sum + s.totalAttempts, 0);
    const totalCorrect = stats.reduce((sum, s) => sum + s.correctCount, 0);
    const highRiskCount = stats.filter(s => s.riskLevel === 'high').length;

    return {
      totalStudents,
      totalQuestions,
      totalCorrect,
      avgCorrectRate: totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
      highRiskCount,
    };
  }
}