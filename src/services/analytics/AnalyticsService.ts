// src/services/analytics/AnalyticsService.ts
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { AttemptRecord } from '../storage/ProgressStore';
import { ClassStatsService, ClassStats } from './ClassStatsService';

import { FirestoreWordRepository } from '../wordRepository/FirestoreWordRepository';
import { analyzeStudent } from '../../domain/analytics/studentAnalyzer';
import { StudentAnalytics } from '../../types/analytics';
import { Word } from '../../types/word';
import { DailySnapshot } from '../../types/dailySnapshot'; // 🔥 需求 C

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
    private wordRepository = new FirestoreWordRepository();

    async getAllClassStats(): Promise<ClassStats[]> {
        return this.classStatsService.getAllClassStats();
    }

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

    /**
     * 取得單一學生的完整個人化分析
     *
     * 讀取策略：
     *   1. 用 studentDisplayId 查 attempts（新資料）；查不到 fallback 用 studentId
     *   2. 取得 student profile（含 currentLevel）
     *   3. 批次取得弱點單字的 Word 物件
     *   4. 🔥 需求 C：讀取 dailySnapshots
     *   5. 用完整的 wordMap 重新分析
     *
     * 總計：3~4 次 Firestore 讀取（O(1)，與班級人數無關）
     */
    async getStudentDetail(studentId: string): Promise<StudentAnalytics> {
        // ============================================================
        // 步驟 1：查詢 attempts
        // ============================================================
        const attemptsRef = collection(db, 'attempts');
        let attempts: AttemptRecord[] = [];

        console.log(`🔍 [AnalyticsService] 嘗試用 displayId "${studentId}" 查詢...`);
        const q1 = query(attemptsRef, where('studentDisplayId', '==', studentId));
        const snap1 = await getDocs(q1);
        attempts = snap1.docs.map(d => d.data() as AttemptRecord);

        if (attempts.length === 0) {
            console.log(`🔍 [AnalyticsService] displayId 查不到，改用 UID 查詢...`);
            const q2 = query(attemptsRef, where('studentId', '==', studentId));
            const snap2 = await getDocs(q2);
            attempts = snap2.docs.map(d => d.data() as AttemptRecord);
        }

        console.log(`📊 [AnalyticsService] "${studentId}" → 找到 ${attempts.length} 筆 attempts`);

        // ============================================================
        // 步驟 2：取得 student profile（含 currentLevel）
        // 🔥 需求 B：順便取出 learningState.currentLevel
        // ============================================================
        let profile = {
            studentId,
            name: studentId,
            className: '未分類',
            currentLevel: 1, // 🔥
        };

        const directStudentDoc = await getDoc(doc(db, 'students', studentId));
        if (directStudentDoc.exists()) {
            const data = directStudentDoc.data();
            profile = {
                studentId,
                name: data.name || studentId,
                className: data.class || '未分類',
                currentLevel: data.learningState?.currentLevel ?? 1, // 🔥
            };
        } else {
            // Fallback：從 classStats 反查
            const classStats = await this.classStatsService.getAllClassStats();
            for (const cs of classStats) {
                if (cs.students && cs.students[studentId]) {
                    const s = cs.students[studentId];
                    profile = {
                        studentId,
                        name: s.name || studentId,
                        className: cs.className,
                        currentLevel: 1, // classStats 沒有等級，fallback
                    };
                    break;
                }
            }
        }

        // ============================================================
        // 步驟 3：先做一次「不帶 word 的」分析，取得弱點單字 ID 清單
        // ============================================================
        const preAnalysis = analyzeStudent(attempts, profile, new Map());
        const weakWordIds = preAnalysis.weakestWords.map(w => w.wordId);

        // ============================================================
        // 步驟 4：批次取得弱點單字的 Word 物件（最多 5 個）
        // ============================================================
        let wordMap = new Map<string, Word>();
        if (weakWordIds.length > 0) {
            try {
                const words = await this.wordRepository.getWordsByIds(weakWordIds);
                wordMap = new Map(words.map(w => [w.id, w]));
            } catch (e) {
                console.warn('⚠️ [AnalyticsService] 取得弱點單字失敗，使用 wordId 顯示:', e);
            }
        }

        // ============================================================
        // 步驟 5：🔥 需求 C：讀取每日快照
        // ============================================================
        let dailySnapshots: DailySnapshot[] = [];
        try {
            const snapshotsRef = collection(db, 'students', studentId, 'dailySnapshots');
            const snapshotsSnap = await getDocs(snapshotsRef);
            dailySnapshots = snapshotsSnap.docs
                .map(d => d.data() as DailySnapshot)
                .sort((a, b) => a.date.localeCompare(b.date)); // 按日期升序
            console.log(`📸 [AnalyticsService] 讀取 ${dailySnapshots.length} 筆每日快照`);
        } catch (e) {
            console.warn('⚠️ [AnalyticsService] 讀取每日快照失敗（可能尚未建立）:', e);
        }

        // ============================================================
        // 步驟 6：用完整的 wordMap 重新分析，並塞入 dailySnapshots
        // ============================================================
        const result = analyzeStudent(attempts, profile, wordMap);
        result.dailySnapshots = dailySnapshots; // 🔥
        return result;
    }
}