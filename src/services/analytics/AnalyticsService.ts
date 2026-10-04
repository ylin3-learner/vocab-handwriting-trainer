// src/services/analytics/AnalyticsService.ts
import { collection, getDocs, query, where, doc, getDoc, orderBy, limit,
         getDocsFromCache, getDocFromCache } from 'firebase/firestore';
import { db } from '../../firebase';
import { AttemptRecord } from '../storage/ProgressStore';
import { ClassStatsService, ClassStats } from './ClassStatsService';

import { FirestoreWordRepository } from '../wordRepository/FirestoreWordRepository';
import { analyzeStudent } from '../../domain/analytics/studentAnalyzer';
import { StudentAnalytics } from '../../types/analytics';
import { Word } from '../../types/word';
import { DailySnapshot } from '../../types/dailySnapshot';

function isAbortError(e: unknown): boolean {
    return (e as Error)?.name === 'AbortError';
}

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

    private static readonly RECENT_ATTEMPTS_LIMIT = 100;
    private static readonly RECENT_SNAPSHOTS_LIMIT = 30;

    async getAllClassStats(): Promise<ClassStats[]> {
        return this.classStatsService.getAllClassStats();
    }

    /**
     * 🔥 修改（2026-10）：改從 classStats 讀取，不再全表掃描 attempts
     */
    async getAllStudentsStats(): Promise<StudentStat[]> {
        const classStats = await this.getAllClassStats();
        const studentMap = new Map<string, StudentStat>();

        for (const cs of classStats) {
            if (!cs.students) continue;
            for (const [displayId, s] of Object.entries(cs.students)) {
                const existing = studentMap.get(displayId);
                if (existing) {
                    existing.totalAttempts += s.attempts;
                    existing.correctCount += s.correct;
                } else {
                    studentMap.set(displayId, {
                        id: displayId,
                        name: s.name || displayId,
                        class: cs.className,
                        totalAttempts: s.attempts,
                        correctCount: s.correct,
                        correctRate: 0,
                        avgResponseTime: 0,
                        riskLevel: 'low',
                    });
                }
            }
        }

        const result: StudentStat[] = [];
        studentMap.forEach(s => {
            const rate = s.totalAttempts > 0 ? s.correctCount / s.totalAttempts : 0;
            let risk: 'low' | 'medium' | 'high' = 'low';
            if (rate < 0.6) risk = 'high';
            else if (rate < 0.8) risk = 'medium';

            result.push({ ...s, correctRate: Math.round(rate * 100), riskLevel: risk });
        });

        return result;
    }

    /**
     * 🔥 修改（2026-10）：改從 classStats.wordErrors 讀取，不再全表掃描
     */
    async getTopWeakWords(limitCount: number = 5): Promise<WeakWord[]> {
        const classStats = await this.getAllClassStats();
        const wordErrorMap = new Map<string, { errorCount: number; totalCount: number }>();

        for (const cs of classStats) {
            if (!cs.wordErrors) continue;
            for (const [wordId, w] of Object.entries(cs.wordErrors)) {
                const existing = wordErrorMap.get(wordId);
                if (existing) {
                    existing.errorCount += w.errorCount;
                    existing.totalCount += w.totalCount;
                } else {
                    wordErrorMap.set(wordId, {
                        errorCount: w.errorCount,
                        totalCount: w.totalCount,
                    });
                }
            }
        }

        const weakWords: WeakWord[] = [];
        wordErrorMap.forEach((value, wordId) => {
            if (value.totalCount === 0) return;
            weakWords.push({
                wordId,
                wordText: wordId,
                errorCount: value.errorCount,
                totalAttempts: value.totalCount,
                errorRate: Math.round((value.errorCount / value.totalCount) * 100),
            });
        });

        weakWords.sort((a, b) => b.errorRate - a.errorRate);
        return weakWords.slice(0, limitCount);
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
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    private parseDisplayId(displayId: string): { className: string; name: string } {
        const parts = displayId.split('_');
        if (parts.length >= 3) {
            const className = parts[0];
            const name = parts.slice(2).join('_');
            if (className && name) return { className, name };
        }
        return { className: '未分類', name: displayId };
    }

    /**
     * ============================================================
     * 🔥 方案 1：快取優先策略（2026-10）
     * ============================================================
     *
     * 三層快取階層：
     *
     *   Layer 1: useStudentDetail 的 module-level Map
     *            → 同一個 session 內切換學生，0 延遲、0 配額
     *
     *   Layer 2: Firestore IndexedDB 快取
     *            → 頁面刷新後仍在（persistentLocalCache）
     *            → 由 getDocsFromCache() / getDocFromCache() 讀取
     *            → 不消耗 Firestore 讀取配額
     *
     *   Layer 3: Firestore 伺服器
     *            → 只有 Layer 1 + Layer 2 都 miss 才呼叫
     *            → 消耗配額
     *
     * 為什麼有效：
     *   - 老師連點學生：Layer 1 命中，0 配額
     *   - 老師刷新頁面：Layer 2 命中，0 配額（原本會消耗 120 筆/學生）
     *   - 老師隔天早上再看：Layer 3，正常消耗
     *
     * 代價：
     *   - 老師看到的資料可能是 N 分鐘前的（IndexedDB 快取的版本）
     *   - 「重新整理」按鈕會強制走 Layer 3
     * ============================================================
     */
    async getStudentDetail(displayId: string): Promise<StudentAnalytics> {
        const attemptsRef = collection(db, 'attempts');

        // ============================================================
        // 步驟 1：讀 attempts（快取優先）
        // ============================================================
        const q1 = query(
            attemptsRef,
            where('studentDisplayId', '==', displayId),
            orderBy('timestamp', 'desc'),
            limit(AnalyticsService.RECENT_ATTEMPTS_LIMIT)
        );

        let attempts: AttemptRecord[] = [];
        let attemptsSource: 'cache' | 'server' = 'cache';

        // Layer 2: 嘗試從 IndexedDB 快取讀取
        try {
            const cachedSnap = await getDocsFromCache(q1);
            if (!cachedSnap.empty) {
                attempts = cachedSnap.docs.map(d => d.data() as AttemptRecord);
                console.log(`📦 [AnalyticsService] "${displayId}" 從 IndexedDB 快取讀到 ${attempts.length} 筆 attempts（0 配額）`);
            }
        } catch (e) {
            // 快取不存在或查詢未執行過 → 正常，繼續往下走
        }

        // Layer 3: 快取未命中 → 走伺服器
        if (attempts.length === 0) {
            attemptsSource = 'server';
            console.log(`🌐 [AnalyticsService] "${displayId}" 快取未命中，從伺服器讀取 attempts...`);

            const serverSnap = await getDocs(q1);
            attempts = serverSnap.docs.map(d => d.data() as AttemptRecord);

            // Fallback：若 displayId 查不到，改用 UID 查
            if (attempts.length === 0) {
                const q2 = query(
                    attemptsRef,
                    where('studentId', '==', displayId),
                    orderBy('timestamp', 'desc'),
                    limit(AnalyticsService.RECENT_ATTEMPTS_LIMIT)
                );
                const snap2 = await getDocs(q2);
                attempts = snap2.docs.map(d => d.data() as AttemptRecord);
            }

            console.log(`📊 [AnalyticsService] "${displayId}" → 從伺服器讀到 ${attempts.length} 筆`);
        }

        // ============================================================
        // 步驟 2：讀 studentStates（快取優先）
        // ============================================================
        let profile = {
            studentId: displayId,
            name: displayId,
            className: '未分類',
            currentLevel: 1,
        };
        let customSpeechFloor: number | undefined;
        let studentTimeZone: string | undefined;  // 新增

        const stateRef = doc(db, 'studentStates', displayId);
        let stateData: any = null;

        // Layer 2
        try {
            const cachedDoc = await getDocFromCache(stateRef);
            if (cachedDoc.exists()) {
                stateData = cachedDoc.data();
                console.log(`📦 [AnalyticsService] "${displayId}" 從快取讀到 studentStates`);
            }
        } catch { /* 快取 miss */ }

        // Layer 3
        if (!stateData) {
            try {
                const stateDoc = await getDoc(stateRef);
                if (stateDoc.exists()) {
                    stateData = stateDoc.data();
                }
            } catch (e) {
                if (!isAbortError(e)) {
                    console.warn('⚠️ [AnalyticsService] 讀取 studentStates 失敗:', e);
                }
            }
        }

        if (stateData) {
            profile.currentLevel = stateData.currentLevel ?? 1;
            customSpeechFloor = stateData.customSpeechFloor;
            studentTimeZone = stateData.timeZone;  // 新增
            console.log(`✅ [AnalyticsService] 當前等級 L${profile.currentLevel}`);
        }

        // ============================================================
        // 步驟 3：從 displayId 解析姓名/班級（0 筆讀取）
        // ============================================================
        const parsed = this.parseDisplayId(displayId);
        profile.className = parsed.className;
        profile.name = parsed.name;

        // ============================================================
        // 步驟 4：預分析，取得弱點單字 ID
        // ============================================================
        const preAnalysis = analyzeStudent(attempts, profile, new Map(), {
            weakWordsWindowDays: 7,
        });
        const weakWordIds = preAnalysis.weakestWords.map(w => w.wordId);

        // ============================================================
        // 步驟 5：取得弱點單字物件（最多 5 個）
        // ============================================================
        let wordMap = new Map<string, Word>();
        if (weakWordIds.length > 0) {
            try {
                const words = await this.wordRepository.getWordsByIds(weakWordIds);
                wordMap = new Map(words.map(w => [w.id, w]));
            } catch (e) {
                if (!isAbortError(e)) {
                    console.warn('⚠️ [AnalyticsService] 取得弱點單字失敗:', e);
                }
            }
        }

        // ============================================================
        // 步驟 6：讀取每日快照（快取優先）
        // ============================================================
        const snapshotsRef = collection(db, 'studentStates', displayId, 'dailySnapshots');
        const snapshotsQuery = query(
            snapshotsRef,
            orderBy('date', 'desc'),
            limit(AnalyticsService.RECENT_SNAPSHOTS_LIMIT)
        );

        let dailySnapshots: DailySnapshot[] = [];

        // Layer 2
        try {
            const cachedSnap = await getDocsFromCache(snapshotsQuery);
            if (!cachedSnap.empty) {
                dailySnapshots = cachedSnap.docs
                    .map(d => d.data() as DailySnapshot)
                    .sort((a, b) => a.date.localeCompare(b.date));
                console.log(`📦 [AnalyticsService] "${displayId}" 從快取讀到 ${dailySnapshots.length} 筆快照`);
            }
        } catch { /* cache miss */ }

        // Layer 3
        if (dailySnapshots.length === 0) {
            try {
                const snapshotsSnap = await getDocs(snapshotsQuery);
                dailySnapshots = snapshotsSnap.docs
                    .map(d => d.data() as DailySnapshot)
                    .sort((a, b) => a.date.localeCompare(b.date));
                console.log(`📸 [AnalyticsService] "${displayId}" 從伺服器讀到 ${dailySnapshots.length} 筆快照`);
            } catch (e) {
                if (!isAbortError(e)) {
                    console.warn('⚠️ [AnalyticsService] 讀取每日快照失敗:', e);
                }
            }
        }

        // ============================================================
        // 步驟 7：最終分析
        // ============================================================
        const result = analyzeStudent(attempts, profile, wordMap, {
            weakWordsWindowDays: 7,
        });
        result.dailySnapshots = dailySnapshots;
        result.customSpeechFloor = customSpeechFloor;
        result.timeZone = studentTimeZone;  // 新增

        console.log(`✅ [AnalyticsService] "${displayId}" 完成（attempts 來源：${attemptsSource}）`);

        return result;
    }
}