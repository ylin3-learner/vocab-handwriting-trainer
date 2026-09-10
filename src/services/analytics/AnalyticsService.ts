// src/services/analytics/AnalyticsService.ts
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { AttemptRecord } from '../storage/ProgressStore';
import { ClassStatsService, ClassStats } from './ClassStatsService';

// 定義學生統計資料結構
export interface StudentStat {
    id: string;
    name: string;
    class: string;
    totalAttempts: number;
    correctCount: number;
    correctRate: number;
    avgResponseTime: number;
    riskLevel: 'low' | 'medium' | 'high';
}

export interface WeakWord {
    wordId: string;
    wordText: string;
    errorCount: number;
    totalAttempts: number;
    errorRate: number;
}

export class AnalyticsService {
    private classStatsService = new ClassStatsService();

    // 新增：取得所有班級預聚合統計（推薦使用）
    async getAllClassStats(): Promise<ClassStats[]> {
        return this.classStatsService.getAllClassStats();
    }

    // 保留：取得所有學生的完整統計資料（fallback 用，較慢）
    async getAllStudentsStats(): Promise<StudentStat[]> {
        const studentsSnap = await getDocs(collection(db, 'students'));
        const students = studentsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as { id: string; name?: string; class?: string }[];

        const attemptsSnap = await getDocs(collection(db, 'attempts'));
        const attempts = attemptsSnap.docs.map(doc => doc.data() as AttemptRecord);

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
            stat.avgResponseTime += a.responseTimeMs;
        });

        const result: StudentStat[] = [];
        statsMap.forEach(stat => {
            if (stat.totalAttempts === 0) {
                result.push({ ...stat, avgResponseTime: 0, correctRate: 0, riskLevel: 'low' });
                return;
            }
            const avgTime = stat.avgResponseTime / stat.totalAttempts;
            const rate = stat.correctCount / stat.totalAttempts;

            let riskLevel: 'low' | 'medium' | 'high' = 'low';
            if (rate < 0.6) riskLevel = 'high';
            else if (rate < 0.8) riskLevel = 'medium';

            result.push({
                ...stat,
                avgResponseTime: Math.round(avgTime / 1000),
                correctRate: Math.round(rate * 100),
                riskLevel,
            });
        });

        return result;
    }

    // 保留：Top-K 弱點分析（fallback 用）
    async getTopWeakWords(limit: number = 5): Promise<WeakWord[]> {
        const attemptsSnap = await getDocs(collection(db, 'attempts'));
        const attempts = attemptsSnap.docs.map(doc => doc.data() as AttemptRecord);

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

        const weakWords: WeakWord[] = [];
        wordMap.forEach((value, wordId) => {
            weakWords.push({
                wordId,
                wordText: wordId,
                errorCount: value.errorCount,
                totalAttempts: value.total,
                errorRate: Math.round((value.errorCount / value.total) * 100),
            });
        });

        weakWords.sort((a, b) => b.errorRate - a.errorRate);
        return weakWords.slice(0, limit);
    }

    // 保留：取得整體班級摘要（fallback 用）
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

    async getAllStudents(): Promise<{ id: string; name?: string; class?: string }[]> {
        const studentsRef = collection(db, 'students');
        const snap = await getDocs(studentsRef);
        return snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    }
}