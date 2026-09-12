// src/features/placement/PlacementOrchestrator.ts
import { Word, ReviewState, createInitialReviewState } from '../../types/word';
import { WordRepository } from '../../services/wordRepository/WordRepository';
import { AttemptRecord } from '../../services/storage/ProgressStore';
import { StudentStateService } from '../../services/progression/StudentStateService';
import { AnswerProcessor } from '../quiz/AnswerProcessor';
import { QuizSessionApi, SessionDisplayInfo } from '../quiz/QuizSessionApi';
import { ActiveAssignment } from '../../services/assignment/AssignmentService';
import {
    PlacementHistoryEntry,
    PlacementStep,
    LevelHistoryEntry,
} from '../../types/progression';
import { sanitizeFirestoreId } from '../../domain/string/sanitizeId';
import {
    writeBatch,
    doc,
    collection,
    increment,
    arrayUnion,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
    AnswerSubmission,
    QuizQuestion,
    SubmitAnswerResult,
} from '../quiz/QuizOrchestrator';

// ============================================================
// 常數（依設計決策集中管理）
// ============================================================

/** 起始等級：TA 是國中生，從 L3 開始最平衡 */
const STARTING_LEVEL = 3;

/** 每個等級測試 3 題 */
const QUESTIONS_PER_LEVEL = 3;

/** 3 題中至少答對 2 題才升級 */
const PROMOTE_THRESHOLD = 2;

/** 最多 12 題（4 級 × 3 題），保證收斂 */
const MAX_TOTAL_QUESTIONS = 12;

/** 每個等級預載 5 個單字（用 3 個，留 2 個緩衝） */
const WORDS_TO_PRELOAD = 5;

// ============================================================
// 型別
// ============================================================

export interface PlacementOrchestratorDeps {
    wordRepository: WordRepository;
    timeLimitMs: number;
    studentName?: string;
    studentSeatNumber?: string;
    now?: () => Date;
}

// ============================================================
// PlacementOrchestrator
// ============================================================

/**
 * 程度鑑定流程。
 *
 * 核心設計：
 *   1. 從 L3 開始，每級 3 題，階梯式升降。
 *   2. 鑑定期間的所有寫入都緩衝在記憶體（原子性）。
 *   3. 成功完成時，一次 writeBatch 寫入所有資料。
 *   4. 中途離開 → 什麼都不寫 → 下次重新鑑定。
 *
 * 統計學依據：
 *   鑑定是「用少量題目快速定位學生的能力落點」，
 *   與日常練習的「30 題統計估計」是兩種不同的任務。
 *   因此鑑定用「二分搜尋邏輯」而非「統計估計邏輯」。
 */
export class PlacementOrchestrator implements QuizSessionApi {
    private studentId: string;
    private className: string;
    private deps: PlacementOrchestratorDeps;

    // 鑑定流程狀態
    private currentLevel: number = STARTING_LEVEL;
    private currentLevelAttempts: number = 0;
    private currentLevelCorrect: number = 0;
    private currentLevelWords: Word[] = [];
    private usedWordIds: Set<string> = new Set();
    private askedWord: Word | null = null;
    private finalLevel: number | null = null;
    private finalized: boolean = false;
    private startedAt: string;

    // 記憶體緩衝（原子性關鍵）
    private stateCache: Map<string, ReviewState> = new Map();
    private pendingAttempts: AttemptRecord[] = [];
    private placementSteps: PlacementStep[] = [];

    // 依賴
    private answerProcessor: AnswerProcessor;
    private studentStateService: StudentStateService;

    constructor(studentId: string, className: string, deps: PlacementOrchestratorDeps) {
        this.studentId = studentId;
        this.className = className;
        this.deps = deps;
        this.answerProcessor = new AnswerProcessor();
        this.studentStateService = new StudentStateService();
        this.startedAt = this.getNow().toISOString();
    }

    private getNow(): Date {
        return this.deps.now ? this.deps.now() : new Date();
    }

    // ============================================================
    // QuizSessionApi 實作
    // ============================================================

    async init(): Promise<void> {
        console.log('═══════════════════════════════════════');
        console.log(`🎯 [PlacementOrchestrator.init] 開始程度鑑定`);
        console.log(`   學生：${this.studentId}，班級：${this.className || '（未填）'}`);
        console.log(`   起始等級：L${this.currentLevel}`);
        console.log('═══════════════════════════════════════');

        await this.loadLevelWords(this.currentLevel);

        if (this.currentLevelWords.length === 0) {
            throw new Error(`L${this.currentLevel} 沒有可用的單字進行鑑定`);
        }

        console.log(`   ✅ 載入 L${this.currentLevel} 的 ${this.currentLevelWords.length} 個候選單字`);
    }

    async nextQuestion(): Promise<QuizQuestion | null> {
        // 已完成 → 回傳 null
        if (this.finalLevel !== null) {
            return null;
        }

        // 當前等級已測完 → 決定下一步
        if (this.currentLevelAttempts >= QUESTIONS_PER_LEVEL) {
            const decision = this.decideNextStep();

            // 🔥 由 newLevel 推導 action
            const stepAction: 'promote' | 'demote' | 'stop' =
                decision.isFinal
                    ? 'stop'
                    : decision.newLevel > this.currentLevel
                        ? 'promote'
                        : 'demote';

            this.recordStep(stepAction);

            if (decision.isFinal) {
                this.finalLevel = decision.newLevel;
                console.log(`🏁 [Placement] 鑑定結束，最終等級：L${decision.newLevel}`);
                return null;
            }

            console.log(
                `🔄 [Placement] L${this.currentLevel} 完成（${this.currentLevelCorrect}/${QUESTIONS_PER_LEVEL}）→ L${decision.newLevel}`
            );
            this.currentLevel = decision.newLevel;
            this.currentLevelAttempts = 0;
            this.currentLevelCorrect = 0;
            this.currentLevelWords = [];
        }


        // 12 題上限
        if (this.pendingAttempts.length >= MAX_TOTAL_QUESTIONS) {
            this.finalLevel = this.currentLevel;
            console.log(`🏁 [Placement] 達到 12 題上限，最終等級：L${this.currentLevel}`);
            return null;
        }

        // 載入單字池（若空）
        if (this.currentLevelWords.length === 0) {
            await this.loadLevelWords(this.currentLevel);
        }

        // 池子還是空的 → 提前結束
        if (this.currentLevelWords.length === 0) {
            if (this.currentLevelAttempts > 0) {
                this.recordStep('stop');
            }
            this.finalLevel = this.currentLevel;
            console.log(
                `⚠️ [Placement] L${this.currentLevel} 無可用單字，最終等級：L${this.currentLevel}`
            );
            return null;
        }

        // 取出一個單字
        const word = this.currentLevelWords.shift()!;
        this.usedWordIds.add(word.id);
        this.askedWord = word;

        console.log(
            `📌 [Placement] 選中「${word.word}」(L${this.currentLevel})，進度 ${this.pendingAttempts.length + 1}/${MAX_TOTAL_QUESTIONS}`
        );

        return {
            word,
            timeLimitMs: this.deps.timeLimitMs,
            isProbe: false,
        };
    }

    async submitAnswer(
        wordId: string,
        submission: AnswerSubmission
    ): Promise<SubmitAnswerResult> {
        // 驗證這題與 askedWord 一致
        if (!this.askedWord || this.askedWord.id !== wordId) {
            throw new Error(`Word ${wordId} does not match current question`);
        }
        const word = this.askedWord;

        const now = this.getNow();
        const currentState = this.stateCache.get(wordId) ?? createInitialReviewState();

        const studentDisplayId =
            this.className && this.deps.studentName && this.deps.studentSeatNumber
                ? `${this.className}_${this.deps.studentSeatNumber}_${this.deps.studentName}`
                : undefined;

        // 純運算
        const processed = this.answerProcessor.process({
            word,
            submission,
            currentState,
            timeLimitMs: this.deps.timeLimitMs,
            studentId: this.studentId,
            studentDisplayId,
            now,
        });

        // 緩衝寫入（不碰 Firestore）
        this.stateCache.set(wordId, processed.nextState);
        this.pendingAttempts.push(processed.attempt);
        this.currentLevelAttempts += 1;
        if (processed.grading.isCorrect) {
            this.currentLevelCorrect += 1;
        }

        console.log(
            `✍️ [Placement]「${word.word}」(L${this.currentLevel}) → ${processed.grading.isCorrect ? '✅ 正確' : '❌ 錯誤'}（本級 ${this.currentLevelCorrect}/${this.currentLevelAttempts}）`
        );

        // 清空 askedWord（下一題會重設）
        this.askedWord = null;

        return {
            grading: processed.grading,
            scheduling: processed.scheduling,
            nextState: processed.nextState,
            progressionDecision: null,
        };
    }

    getActiveAssignment(): ActiveAssignment | null {
        return null; // Placement 不使用作業
    }

    getDailyProgress(): { answered: number; max: number } {
        return {
            answered: this.pendingAttempts.length,
            max: MAX_TOTAL_QUESTIONS,
        };
    }

    getDisplayInfo(): SessionDisplayInfo {
        return {
            mode: 'placement',
            title: '程度鑑定',
            subtitle: '找到最適合你的等級',
            progressCurrent: this.pendingAttempts.length,
            progressTotal: MAX_TOTAL_QUESTIONS,
            progressLabel: '進度',
            showProgress: true,
        };
    }

    /**
     * 鑑定結束時呼叫。
     *
     * 原子性寫入：
     *   - 若成功：一次 writeBatch 寫入所有資料
     *   - 若失敗：fallback 到 markPlacementDone（至少把等級寫入）
     */
    async finalizeSession(): Promise<void> {
        if (this.finalized) return;
        this.finalized = true;

        const finalLevel = this.finalLevel ?? this.currentLevel;
        const history: PlacementHistoryEntry = {
            startedAt: this.startedAt,
            finishedAt: this.getNow().toISOString(),
            finalLevel,
            steps: this.placementSteps,
        };

        console.log(
            `💾 [Placement] 準備寫入鑑定結果：L${finalLevel}，共 ${this.pendingAttempts.length} 題`
        );

        try {
            await this.commitAll(finalLevel, history);
            console.log(`✅ [Placement] 鑑定結果已寫入 Firestore`);
        } catch (e) {
            console.error('❌ [Placement] 原子性寫入失敗，嘗試 fallback:', e);

            // Fallback：至少把關鍵狀態寫入（不用 batch）
            try {
                await this.studentStateService.markPlacementDone(
                    this.studentId,
                    finalLevel,
                    history
                );
                console.log('✅ [Placement] Fallback 寫入成功');
            } catch (fallbackError) {
                console.error(
                    '❌ [Placement] Fallback 也失敗，下次登入將重新鑑定:',
                    fallbackError
                );
                // 最後手段：什麼都不做，學生下次重新鑑定
            }
        }
    }

    // ============================================================
    // 私有方法
    // ============================================================

    /**
     * 決定下一步：
     *   - 答對 ≥ 2 → 升級（若已在 L6 則停止）
     *   - 答對 ≤ 1 → 降級（若已在 L1 則停止）
     */
    private decideNextStep(): { newLevel: number; isFinal: boolean } {
        const correct = this.currentLevelCorrect;
        const level = this.currentLevel;
        const promote = correct >= PROMOTE_THRESHOLD;

        if (promote) {
            if (level >= 6) {
                return { newLevel: 6, isFinal: true };
            }
            return { newLevel: level + 1, isFinal: false };
        } else {
            if (level <= 1) {
                return { newLevel: 1, isFinal: true };
            }
            return { newLevel: level - 1, isFinal: false };
        }
    }

    /**
     * 記錄該級別的結果。
     */
    private recordStep(action: 'promote' | 'demote' | 'stop'): void {
        this.placementSteps.push({
            level: this.currentLevel,
            correct: this.currentLevelCorrect,
            total: this.currentLevelAttempts,
            action,
        });
    }

    /**
     * 依級別載入候選單字。
     */
    private async loadLevelWords(level: number): Promise<void> {
        try {
            const words = await this.deps.wordRepository.getNewWordsByLevels(
                new Set(this.usedWordIds),
                [level],
                WORDS_TO_PRELOAD
            );
            this.currentLevelWords = words;
        } catch (e) {
            console.error(`❌ [Placement] 載入 L${level} 單字失敗:`, e);
            this.currentLevelWords = [];
        }
    }

    /**
     * 原子性寫入所有緩衝資料。
     *
     * 為什麼用 writeBatch？
     *   - 鑑定成功 = 一次「原子性事務」的完成
     *   - 所有資料要嘛全寫入，要嘛全不寫入
     *   - 避免「部分寫入」造成資料庫出現半成品狀態
     */
    private async commitAll(
        finalLevel: number,
        history: PlacementHistoryEntry
    ): Promise<void> {
        const batch = writeBatch(db);
        const now = this.getNow().toISOString();

        // ============================================================
        // 1. learningState
        // ============================================================
        const levelHistoryEntry: LevelHistoryEntry = {
            level: finalLevel,
            changedAt: now,
            reason: `程度鑑定：${this.placementSteps.map((s) => `L${s.level} ${s.correct}/${s.total}`).join(' → ')}`,
            triggeredBy: 'placement',
        };

        batch.set(
            doc(db, 'students', this.studentId),
            {
                learningState: {
                    currentLevel: finalLevel,
                    placementDone: true,
                    placementHistory: history,
                    totalAttempts: increment(this.pendingAttempts.length),
                    levelHistory: arrayUnion(levelHistoryEntry),
                },
            },
            { merge: true }
        );

        // ============================================================
        // 2. 所有作答紀錄
        // ============================================================
        for (const attempt of this.pendingAttempts) {
            batch.set(doc(collection(db, 'attempts')), attempt);
        }

        // ============================================================
        // 3. SM-2 狀態（含答對與答錯的字）
        //    答對：everWrong = false（不進複習池，但記為「已見過」）
        //    答錯：everWrong = true（進複習池）
        // ============================================================
        for (const [wordId, state] of this.stateCache) {
            batch.set(
                doc(db, 'students', this.studentId, 'words', sanitizeFirestoreId(wordId)),
                { ...state, originalWordId: wordId }
            );
        }

        // ============================================================
        // 4. classStats（若有班級）
        // ============================================================
        if (this.className && this.className.trim()) {
            const studentDisplayId =
                this.deps.studentName && this.deps.studentSeatNumber
                    ? `${this.className}_${this.deps.studentSeatNumber}_${this.deps.studentName}`
                    : this.studentId;
            const studentDisplayName = this.deps.studentName || this.studentId;
            const correctCount = this.pendingAttempts.filter((a) => a.isCorrect).length;

            // 按單字聚合錯誤統計
            const wordErrorsAgg: Record<string, { errorCount: number; totalCount: number }> = {};
            for (const attempt of this.pendingAttempts) {
                const safeId = sanitizeFirestoreId(attempt.wordId);
                if (!wordErrorsAgg[safeId]) {
                    wordErrorsAgg[safeId] = { errorCount: 0, totalCount: 0 };
                }
                wordErrorsAgg[safeId].totalCount += 1;
                if (!attempt.isCorrect) wordErrorsAgg[safeId].errorCount += 1;
            }

            const wordErrorsUpdate: Record<string, any> = {};
            for (const [safeId, counts] of Object.entries(wordErrorsAgg)) {
                wordErrorsUpdate[safeId] = {
                    errorCount: increment(counts.errorCount),
                    totalCount: increment(counts.totalCount),
                };
            }

            batch.set(
                doc(db, 'classStats', this.className),
                {
                    className: this.className,
                    students: {
                        [studentDisplayId]: {
                            name: studentDisplayName,
                            attempts: increment(this.pendingAttempts.length),
                            correct: increment(correctCount),
                        },
                    },
                    wordErrors: wordErrorsUpdate,
                    totalAttempts: increment(this.pendingAttempts.length),
                    totalCorrect: increment(correctCount),
                    lastUpdated: now,
                },
                { merge: true }
            );
        }

        await batch.commit();
    }
}