// src/services/analytics/AnalyticsService.ts
import { collection, getDocs, query, where, doc, getDoc, orderBy, limit } from 'firebase/firestore';
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

    // ============================================================
    // 🔥 有界查詢常數
    //
    // 為什麼要 limit：
    //   attempts 是無界成長的集合（每次答題 +1）。
    //   儀表板只需要「近期表現」，不是「完整歷史」。
    //   不加 limit 會隨時間線性惡化：
    //     9/24  每位學生  ~30 筆
    //     10/03 每位學生 ~1000 筆
    //     10/31 每位學生 ~3000 筆
    //   加 limit(100) 後，永遠固定 100 筆。
    //
    // 100 的理由：
    //   - 滑動窗口是 30 題 → 100 提供 3x 緩衝
    //   - 弱點分析（7 天窗口）需要足夠樣本
    //   - 歷史成長曲線走另一條路徑（dailySnapshots），不受影響
    // ============================================================
    private static readonly RECENT_ATTEMPTS_LIMIT = 100;
    private static readonly RECENT_SNAPSHOTS_LIMIT = 30;

    async getAllClassStats(): Promise<ClassStats[]> {
        return this.classStatsService.getAllClassStats();
    }

    async getAllStudentsStats(): Promise<StudentStat[]> {
        const studentsSnap = await getDocs(collection(db, 'students'));
        const students = studentsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as {
            id: string;
            name?: string;
            class?: string;
            displayId?: string;
            createdAt?: string;
            updatedAt?: string;
        }[];

        const attemptsSnap = await getDocs(collection(db, 'attempts'));
        const attempts = attemptsSnap.docs.map(doc => doc.data() as AttemptRecord);

        const statsMap = new Map<string, StudentStat>();
        const displayIdToUids = new Map<string, Set<string>>();
        const keyToLatestUpdatedAt = new Map<string, string>();

        students.forEach(s => {
            const key = s.displayId || s.id;
            const updatedAt = s.updatedAt || s.createdAt || '';

            if (!displayIdToUids.has(key)) {
                displayIdToUids.set(key, new Set());
            }
            displayIdToUids.get(key)!.add(s.id);

            const existingUpdatedAt = keyToLatestUpdatedAt.get(key);
            if (existingUpdatedAt !== undefined && existingUpdatedAt >= updatedAt) {
                return;
            }

            keyToLatestUpdatedAt.set(key, updatedAt);
            statsMap.set(key, {
                id: key,
                name: s.name || key,
                class: s.class || '未分類',
                totalAttempts: 0,
                correctCount: 0,
                correctRate: 0,
                avgResponseTime: 0,
                riskLevel: 'low',
            });
        });

        attempts.forEach(a => {
            let stat: StudentStat | undefined;

            if (a.studentDisplayId) {
                stat = statsMap.get(a.studentDisplayId);
            }

            if (!stat) {
                for (const [displayId, uids] of displayIdToUids.entries()) {
                    if (uids.has(a.studentId)) {
                        stat = statsMap.get(displayId);
                        break;
                    }
                }
            }

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

    async getTopWeakWords(limitCount: number = 5): Promise<WeakWord[]> {
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
        return snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    }

    /**
     * 從 displayId 解析出姓名與班級。
     *
     * displayId 格式：{class}_{seat}_{name}
     * 例：804_18_李芷柔 → { className: "804", name: "李芷柔" }
     *
     * 為什麼不用 getAllClassStats：
     *   getStudentDetail 每次呼叫都撈全部班級文件（4 筆），
     *   只為了反查姓名。改為純字串解析 → 0 筆讀取。
     */
    private parseDisplayId(displayId: string): { className: string; name: string } {
        const parts = displayId.split('_');

        if (parts.length >= 3) {
            // 顯式取得再檢查，避開 noUncheckedIndexedAccess 的 string | undefined
            const className = parts[0];
            const name = parts.slice(2).join('_');

            if (className && name) {
                return { className, name };
            }
        }

        return { className: '未分類', name: displayId };
    }

    /**
     * 取得單一學生的完整個人化分析。
     *
     * 🔥 效能設計（2026-10 修正）：
     *   - attempts 只撈最近 100 筆（而非全部）
     *   - 姓名/班級從 displayId 解析（而非 getAllClassStats）
     *   - dailySnapshots 只撈最近 30 天
     *
     *   修正前：每次點學生 ~1000-1500 筆讀取
     *   修正後：每次點學生 ~110 筆讀取（↓ 90%）
     */
    async getStudentDetail(displayId: string): Promise<StudentAnalytics> {
        // ============================================================
        // 步驟 1：只撈最近 N 筆 attempts（而非全部）
        //
        // 複合索引：attempts (studentDisplayId ASC, timestamp DESC)
        //         已存在（Firebase Console → Indexes 確認）
        // ============================================================
        const attemptsRef = collection(db, 'attempts');
        let attempts: AttemptRecord[] = [];

        console.log(`🔍 [AnalyticsService] 撈 "${displayId}" 最近 ${AnalyticsService.RECENT_ATTEMPTS_LIMIT} 筆 attempts...`);

        const q1 = query(
            attemptsRef,
            where('studentDisplayId', '==', displayId),
            orderBy('timestamp', 'desc'),
            limit(AnalyticsService.RECENT_ATTEMPTS_LIMIT)
        );
        const snap1 = await getDocs(q1);
        attempts = snap1.docs.map(d => d.data() as AttemptRecord);

        // Fallback：若 displayId 查不到（理論上不該發生），改用 UID 查
        if (attempts.length === 0) {
            console.log(`🔍 [AnalyticsService] displayId 查不到，改用 UID 查詢...`);
            const q2 = query(
                attemptsRef,
                where('studentId', '==', displayId),
                orderBy('timestamp', 'desc'),
                limit(AnalyticsService.RECENT_ATTEMPTS_LIMIT)
            );
            const snap2 = await getDocs(q2);
            attempts = snap2.docs.map(d => d.data() as AttemptRecord);
        }

        console.log(`📊 [AnalyticsService] "${displayId}" → 撈到 ${attempts.length} 筆（上限 ${AnalyticsService.RECENT_ATTEMPTS_LIMIT}）`);

        // ============================================================
        // 步驟 2：讀 studentStates/{displayId}（1 筆）
        //
        // 這裡只拿 currentLevel 與 customSpeechFloor。
        // 姓名/班級從 displayId 解析（見下方步驟 3）。
        // ============================================================
        let profile = {
            studentId: displayId,
            name: displayId,
            className: '未分類',
            currentLevel: 1,
        };
        let customSpeechFloor: number | undefined;

        try {
            const stateDoc = await getDoc(doc(db, 'studentStates', displayId));
            if (stateDoc.exists()) {
                const data = stateDoc.data();
                profile.currentLevel = data.currentLevel ?? 1;
                customSpeechFloor = data.customSpeechFloor;
                console.log(`✅ [AnalyticsService] 從 studentStates 讀到 L${profile.currentLevel}`);
            }
        } catch (e) {
            if (!isAbortError(e)) {
                console.warn('⚠️ [AnalyticsService] 讀取 studentStates 失敗:', e);
            }
        }

        // ============================================================
        // 步驟 3：🔥 從 displayId 解析姓名/班級（0 筆讀取）
        //
        // 舊做法：getAllClassStats() → 讀取全部班級文件（4 筆）
        // 新做法：字串解析 → 0 筆
        // ============================================================
        const parsed = this.parseDisplayId(displayId);
        profile.className = parsed.className;
        profile.name = parsed.name;
        console.log(`👤 [AnalyticsService] 解析 displayId → ${parsed.className} / ${parsed.name}`);

        // ============================================================
        // 步驟 4：先做一次「不帶 word 的」分析，取得弱點單字 ID 清單
        // ============================================================
        const preAnalysis = analyzeStudent(attempts, profile, new Map(), {
            weakWordsWindowDays: 7,
        });
        const weakWordIds = preAnalysis.weakestWords.map(w => w.wordId);

        // ============================================================
        // 步驟 5：批次取得弱點單字的 Word 物件（最多 5 個）
        // ============================================================
        let wordMap = new Map<string, Word>();
        if (weakWordIds.length > 0) {
            try {
                const words = await this.wordRepository.getWordsByIds(weakWordIds);
                wordMap = new Map(words.map(w => [w.id, w]));
            } catch (e) {
                if (!isAbortError(e)) {
                    console.warn('⚠️ [AnalyticsService] 取得弱點單字失敗，使用 wordId 顯示:', e);
                }
            }
        }

        // ============================================================
        // 步驟 6：讀取每日快照（限制最近 30 天）
        //
        // 修正前：無 limit，一年後會讀到 365 筆
        // 修正後：固定最多 30 筆
        // ============================================================
        let dailySnapshots: DailySnapshot[] = [];
        try {
            const snapshotsRef = collection(db, 'studentStates', displayId, 'dailySnapshots');
            const snapshotsQuery = query(
                snapshotsRef,
                orderBy('date', 'desc'),
                limit(AnalyticsService.RECENT_SNAPSHOTS_LIMIT)
            );
            const snapshotsSnap = await getDocs(snapshotsQuery);
            dailySnapshots = snapshotsSnap.docs
                .map(d => d.data() as DailySnapshot)
                .sort((a, b) => a.date.localeCompare(b.date));  // 時間升序給圖表用
            console.log(`📸 [AnalyticsService] 讀取 ${dailySnapshots.length} 筆每日快照（最近 30 天）`);
        } catch (e) {
            if (!isAbortError(e)) {
                console.warn('⚠️ [AnalyticsService] 讀取每日快照失敗（可能尚未建立）:', e);
            }
        }

        // ============================================================
        // 步驟 7：用完整的 wordMap 重新分析
        // ============================================================
        const result = analyzeStudent(attempts, profile, wordMap, {
            weakWordsWindowDays: 7,
        });
        result.dailySnapshots = dailySnapshots;
        result.customSpeechFloor = customSpeechFloor;
        return result;
    }
}