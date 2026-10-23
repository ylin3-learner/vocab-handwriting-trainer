// src/services/analytics/AnalyticsService.ts
import {
    collection, getDocs, query, where, doc, getDoc, orderBy, limit,
    getDocsFromCache, getDocFromCache, getDocFromServer // 🔥 新增 getDocFromServer
} from 'firebase/firestore';
import { db } from '../../firebase';
import { AttemptRecord } from '../storage/ProgressStore';
import { ClassStatsService, ClassStats } from './ClassStatsService';

import { FirestoreWordRepository } from '../wordRepository/FirestoreWordRepository';
import { analyzeStudent } from '../../domain/analytics/studentAnalyzer';
import { StudentAnalytics } from '../../types/analytics';
import { Word } from '../../types/word';
import { DailySnapshot } from '../../types/dailySnapshot';
import type { LevelHistoryEntry } from '../../types/progression';
import { getLocalDateString } from '../../domain/date/timezone';
import { AssignmentService } from '../assignment/AssignmentService';

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
    private assignmentService = new AssignmentService();

    private static readonly RECENT_ATTEMPTS_LIMIT = 100; // 🔥 改回 100，因為我們不用它算了
    private static readonly RECENT_SNAPSHOTS_LIMIT = 30;

    async getAllClassStats(): Promise<ClassStats[]> {
        return this.classStatsService.getAllClassStats();
    }

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

    async getStudentDetail(
        displayId: string,
        options?: { forceServer?: boolean }
    ): Promise<StudentAnalytics> {
        const forceServer = options?.forceServer === true;

        if (forceServer) {
            console.log(`🔄 [AnalyticsService] "${displayId}" 強制更新，跳過 Layer 2 快取`);
        }

        const attemptsRef = collection(db, 'attempts');

        // 步驟 1：讀 attempts
        const q1 = query(
            attemptsRef,
            where('studentDisplayId', '==', displayId),
            orderBy('timestamp', 'desc'),
            limit(AnalyticsService.RECENT_ATTEMPTS_LIMIT)
        );

        let attempts: AttemptRecord[] = [];
        let attemptsSource: 'cache' | 'server' = 'cache';

        if (!forceServer) {
            try {
                const cachedSnap = await getDocsFromCache(q1);
                if (!cachedSnap.empty) {
                    attempts = cachedSnap.docs.map(d => d.data() as AttemptRecord);
                    console.log(`📦 [AnalyticsService] "${displayId}" 從 IndexedDB 快取讀到 ${attempts.length} 筆 attempts（0 配額）`);
                }
            } catch (e) {
                // 快取 miss
            }
        }

        if (attempts.length === 0 || forceServer) {
            attemptsSource = 'server';
            console.log(`🌐 [AnalyticsService] "${displayId}" 從伺服器讀取 attempts...`);

            const serverSnap = await getDocs(q1);
            attempts = serverSnap.docs.map(d => d.data() as AttemptRecord);

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

        // 步驟 2：讀 studentStates
        let profile = {
            studentId: displayId,
            name: displayId,
            className: '未分類',
            currentLevel: 1,
        };
        let customSpeechFloor: number | undefined;
        let studentTimeZone: string | undefined;

        const stateRef = doc(db, 'studentStates', displayId);
        let stateData: any = null;

        if (!forceServer) {
            try {
                const cachedDoc = await getDocFromCache(stateRef);
                if (cachedDoc.exists()) {
                    stateData = cachedDoc.data();
                    console.log(`📦 [AnalyticsService] "${displayId}" 從快取讀到 studentStates`);
                }
            } catch { /* 快取 miss */ }
        }

        if (!stateData || forceServer) {
            try {
                const stateDoc = forceServer ? await getDocFromServer(stateRef) : await getDoc(stateRef);
                if (stateDoc.exists()) {
                    stateData = stateDoc.data();
                }
            } catch (e) {
                if (!isAbortError(e)) {
                    console.warn('⚠️ [AnalyticsService] 讀取 studentStates 失敗:', e);
                }
            }
        }

        let levelHistory: LevelHistoryEntry[] = [];

        if (stateData) {
            profile.currentLevel = stateData.currentLevel ?? 1;
            customSpeechFloor = stateData.customSpeechFloor;
            studentTimeZone = stateData.timeZone;
            levelHistory = stateData.levelHistory ?? [];
            console.log(`✅ [AnalyticsService] 當前等級 L${profile.currentLevel}`);
        }

        // 步驟 3：從 displayId 解析姓名/班級
        const parsed = this.parseDisplayId(displayId);
        profile.className = parsed.className;
        profile.name = parsed.name;

        // 步驟 4：預分析
        const preAnalysis = analyzeStudent(attempts, profile, new Map(), {
            weakWordsWindowDays: 7,
        });
        const weakWordIds = preAnalysis.weakestWords.map(w => w.wordId);

        // 步驟 5：取得弱點單字物件
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

        // 步驟 6：讀取每日快照
        const snapshotsRef = collection(db, 'studentStates', displayId, 'dailySnapshots');
        const snapshotsQuery = query(
            snapshotsRef,
            orderBy('date', 'desc'),
            limit(AnalyticsService.RECENT_SNAPSHOTS_LIMIT)
        );

        let dailySnapshots: DailySnapshot[] = [];

        if (!forceServer) {
            try {
                const cachedSnap = await getDocsFromCache(snapshotsQuery);
                if (!cachedSnap.empty) {
                    dailySnapshots = cachedSnap.docs
                        .map(d => d.data() as DailySnapshot)
                        .sort((a, b) => a.date.localeCompare(b.date));
                }
            } catch { /* cache miss */ }
        }

        if (dailySnapshots.length === 0 || forceServer) {
            try {
                const snapshotsSnap = await getDocs(snapshotsQuery);
                dailySnapshots = snapshotsSnap.docs
                    .map(d => d.data() as DailySnapshot)
                    .sort((a, b) => a.date.localeCompare(b.date));
            } catch (e) {
                if (!isAbortError(e)) {
                    console.warn('⚠️ [AnalyticsService] 讀取每日快照失敗:', e);
                }
            }
        }

        // ============================================================
        // 🔥 終極修正：直接從 dailySnapshots 讀取該日的 totalAttempts
        // ============================================================
        let recentQuotaStats: StudentAnalytics['recentQuotaStats'] = undefined;
        try {
            let targetQuota = stateData?.currentDailyQuota ?? 0;
            let quotaDate = stateData?.quotaDate;

            // 🔥 核心修正：取得今天的字串與今天的快照
            const tz = studentTimeZone ?? 'Asia/Taipei';
            const todayStr = getLocalDateString(new Date(), tz);
            const todaySnapshot = dailySnapshots.find(s => s.date === todayStr);

            // 🔥 如果今天有練習紀錄，強制將 quotaDate 校正為今天（解決舊版程式碼未更新 quotaDate 的歷史共業）
            if (todaySnapshot && todaySnapshot.totalAttempts > 0) {
                if (quotaDate !== todayStr) {
                    console.log(`🩹 [AnalyticsService] 偵測到歷史資料污染，自動校正 quotaDate: ${quotaDate} -> ${todayStr}`);
                    quotaDate = todayStr;
                }
                // 如果 targetQuota 是 0（因為舊版沒寫入），給予一個合理的預設值
                if (targetQuota <= 0) {
                    targetQuota = 30;
                }
            }

            // 如果在今天的快照中找到了，或者原本的資料有效
            if (targetQuota > 0 && quotaDate) {
                const statsRef = doc(db, 'studentStates', displayId, 'dailyStats', quotaDate);
                let answeredCount = 0;

                // 優先使用已經拉下來的 todaySnapshot 資料，減少讀取
                if (quotaDate === todayStr && todaySnapshot) {
                    answeredCount = todaySnapshot.totalAttempts;
                } else {
                    // 如果不是今天，才去讀取歷史的 dailyStats
                    if (!forceServer) {
                        try {
                            const cachedStats = await getDocFromCache(statsRef);
                            if (cachedStats.exists()) answeredCount = cachedStats.data().answeredCount ?? 0;
                        } catch { /* miss */ }
                    }
                    if (answeredCount === 0) {
                        const serverStats = await getDoc(statsRef);
                        if (serverStats.exists()) answeredCount = serverStats.data().answeredCount ?? 0;
                    }
                }

                // 判斷狀態
                let status: 'completed' | 'incomplete' = 'incomplete';
                if (answeredCount >= targetQuota) {
                    status = 'completed';
                }

                recentQuotaStats = {
                    date: quotaDate,
                    answeredCount: answeredCount,
                    targetQuota: targetQuota,
                    status,
                };
            }
        } catch (e) {
            console.warn('⚠️ [AnalyticsService] 取得配額進度失敗:', e);
        }

        // ============================================================
        // 計算活躍天數達標率 (按比例計算)
        // ============================================================
        let attendanceStats: StudentAnalytics['attendanceStats'] = undefined;
        try {
            const activeAssign = await this.assignmentService.getActiveAssignment(profile.className, displayId);

            if (activeAssign?.assignment.minActiveDays && activeAssign?.assignment.windowSizeDays) {
                const { minActiveDays, windowSizeDays, startDate } = activeAssign.assignment;

                const tz = studentTimeZone ?? 'Asia/Taipei';
                const todayStr = getLocalDateString(new Date(), tz);
                const startStr = startDate.slice(0, 10);

                const startMs = new Date(startStr).getTime();
                const todayMs = new Date(todayStr).getTime();
                const daysSinceStart = Math.max(1, Math.floor((todayMs - startMs) / (24 * 60 * 60 * 1000)) + 1);

                let targetDays = minActiveDays;
                let isProportional = false;

                if (daysSinceStart < windowSizeDays) {
                    targetDays = Math.ceil((minActiveDays / windowSizeDays) * daysSinceStart);
                    isProportional = true;
                }

                const checkDays = Math.min(daysSinceStart, windowSizeDays);
                const cutoffMs = todayMs - (checkDays - 1) * 24 * 60 * 60 * 1000;

                const activeDaysCount = dailySnapshots.filter(s => {
                    const sMs = new Date(s.date).getTime();
                    return sMs >= cutoffMs && sMs <= todayMs && s.totalAttempts > 0;
                }).length;

                attendanceStats = {
                    activeDays: activeDaysCount,
                    targetDays,
                    windowDays: checkDays,
                    isProportional,
                    isMet: activeDaysCount >= targetDays,
                };
            }
        } catch (e) {
            console.warn('⚠️ [AnalyticsService] 計算活躍天數失敗:', e);
        }

        // 步驟 7：最終分析
        const result = analyzeStudent(attempts, profile, wordMap, {
            weakWordsWindowDays: 7,
        });
        result.dailySnapshots = dailySnapshots;
        result.levelHistory = levelHistory;
        result.customSpeechFloor = customSpeechFloor;
        result.timeZone = studentTimeZone;
        result.dataSource = attemptsSource;
        result.recentQuotaStats = recentQuotaStats;
        result.attendanceStats = attendanceStats;

        console.log(`✅ [AnalyticsService] "${displayId}" 完成（attempts 來源：${attemptsSource}）`);
        return result;
    }
}