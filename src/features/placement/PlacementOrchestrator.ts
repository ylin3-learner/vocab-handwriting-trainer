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
import { buildDisplayId } from '../../domain/string/displayId';
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
// 常數
// ============================================================

const STARTING_LEVEL = 3;
const QUESTIONS_PER_LEVEL = 3;
const PROMOTE_THRESHOLD = 2;
const MAX_TOTAL_QUESTIONS = 12;
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

/**
 * 鑑定階段（問題 8：顯式狀態機）
 *
 * - ASKING：正在出題或等待答題
 * - FINISHED：鑑定完成，最終等級已寫入 finalLevel
 */
type PlacementPhase = 'asking' | 'finished';

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
 */
export class PlacementOrchestrator implements QuizSessionApi {
    private studentId: string;
    private className: string;
    private deps: PlacementOrchestratorDeps;

    // 鑑定流程狀態
    private phase: PlacementPhase = 'asking';
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

    private getDisplayId(): string {
        return buildDisplayId(
            this.className,
            this.deps.studentSeatNumber,
            this.deps.studentName,
            this.studentId
        );
    }

    // ============================================================
    // QuizSessionApi 實作
    // ============================================================

    async init(): Promise<void> {
        console.log('═══════════════════════════════════════');
        console.log(`🎯 [PlacementOrchestrator.init] 開始程度鑑定`);
        console.log(`   學生：${this.studentId}，班級：${this.className || '（未填）'}`);
        console.log(`   displayId：${this.getDisplayId()}`);
        console.log(`   起始等級：L${this.currentLevel}`);
        console.log('═══════════════════════════════════════');

        await this.loadLevelWords(this.currentLevel);

        if (this.currentLevelWords.length === 0) {
            throw new Error(`L${this.currentLevel} 沒有可用的單字進行鑑定`);
        }

        console.log(`   ✅ 載入 L${this.currentLevel} 的 ${this.currentLevelWords.length} 個候選單字`);
    }

    /**
     * 取得下一題。
     *
     * 狀態機流程（問題 8 重構）：
     *   FINISHED → null
     *   ASKING   → 檢查本級完成 → 檢查題數上限 → 載入單字 → 出題
     *
     * 每個 return null 的路徑都對應明確的結束原因，
     * 避免「五個 if-else return null 但沒人知道為什麼」的壞味道。
     */
    async nextQuestion(): Promise<QuizQuestion | null> {
        // 狀態 1：已完成
        if (this.phase === 'finished') {
            return null;
        }

        // 狀態 2：本級完成 → 決策（升 / 降 / 停）
        if (this.isCurrentLevelComplete()) {
            const canContinue = this.advanceToNextLevel();
            if (!canContinue) {
                this.phase = 'finished';
                return null;
            }
        }

        // 狀態 3：達到題數上限
        if (this.pendingAttempts.length >= MAX_TOTAL_QUESTIONS) {
            return this.finalizeAtCurrentLevel(
                `達到 ${MAX_TOTAL_QUESTIONS} 題上限`,
                false
            );
        }

        // 狀態 4：確保單字池已載入
        await this.ensureWordsLoaded();

        // 狀態 5：單字池為空 → 提前結束
        if (this.currentLevelWords.length === 0) {
            return this.finalizeAtCurrentLevel(
                `L${this.currentLevel} 無可用單字`,
                true
            );
        }

        // 狀態 6：正常出題
        return this.pickQuestion();
    }

    async submitAnswer(
        wordId: string,
        submission: AnswerSubmission
    ): Promise<SubmitAnswerResult> {
        if (!this.askedWord || this.askedWord.id !== wordId) {
            throw new Error(`Word ${wordId} does not match current question`);
        }
        const word = this.askedWord;

        const now = this.getNow();
        const currentState = this.stateCache.get(wordId) ?? createInitialReviewState();

        const displayId = this.getDisplayId();
        const studentDisplayId = displayId !== this.studentId ? displayId : undefined;

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

        this.askedWord = null;

        return {
            grading: processed.grading,
            scheduling: processed.scheduling,
            nextState: processed.nextState,
            progressionDecision: null,
        };
    }

    getActiveAssignment(): ActiveAssignment | null {
        return null;
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
     * 鑑定模式的播放語速固定為 1.0（標準英語）。
     * 鑑定要測「真實反應」，不允許學生調整。
     */
    getSpeechRate(): number {
        return 1.0;
    }

    /**
     * 鑑定模式不提供慢速重聽。
     */
    getSpeechFloorRate(): number | null {
        return null;
    }

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

            try {
                await this.studentStateService.markPlacementDone(
                    this.getDisplayId(),
                    finalLevel,
                    history
                );
                console.log('✅ [Placement] Fallback 寫入成功');
            } catch (fallbackError) {
                console.error(
                    '❌ [Placement] Fallback 也失敗，下次登入將重新鑑定:',
                    fallbackError
                );
            }
        }
    }

    // ============================================================
    // 私有方法：狀態機
    // ============================================================

    private isCurrentLevelComplete(): boolean {
        return this.currentLevelAttempts >= QUESTIONS_PER_LEVEL;
    }

    /**
     * 本級完成後，決定是否要繼續。
     *
     * @returns true = 繼續下一級；false = 鑑定結束（finalLevel 已設定）
     */
    private advanceToNextLevel(): boolean {
        const decision = this.decideNextStep();

        const stepAction: 'promote' | 'demote' | 'stop' = decision.isFinal
            ? 'stop'
            : decision.newLevel > this.currentLevel
                ? 'promote'
                : 'demote';

        this.recordStep(stepAction);

        if (decision.isFinal) {
            this.finalLevel = decision.newLevel;
            console.log(`🏁 [Placement] 鑑定結束，最終等級：L${decision.newLevel}`);
            return false;
        }

        console.log(
            `🔄 [Placement] L${this.currentLevel} 完成（${this.currentLevelCorrect}/${QUESTIONS_PER_LEVEL}）→ L${decision.newLevel}`
        );
        this.currentLevel = decision.newLevel;
        this.currentLevelAttempts = 0;
        this.currentLevelCorrect = 0;
        this.currentLevelWords = [];
        return true;
    }

    /**
     * 在當前等級結束鑑定。
     *
     * @param reason 結束原因（用於 log）
     * @param recordStop 是否要補記錄一步 'stop'（當本級未滿 3 題就結束時）
     */
    private finalizeAtCurrentLevel(reason: string, recordStop: boolean): null {
        if (recordStop && this.currentLevelAttempts > 0) {
            this.recordStep('stop');
        }
        this.finalLevel = this.currentLevel;
        this.phase = 'finished';
        console.log(`🏁 [Placement] ${reason}，最終等級：L${this.currentLevel}`);
        return null;
    }

    private async ensureWordsLoaded(): Promise<void> {
        if (this.currentLevelWords.length > 0) return;
        await this.loadLevelWords(this.currentLevel);
    }

    private pickQuestion(): QuizQuestion {
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

    // ============================================================
    // 私有方法：核心邏輯
    // ============================================================

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

    private recordStep(action: 'promote' | 'demote' | 'stop'): void {
        this.placementSteps.push({
            level: this.currentLevel,
            correct: this.currentLevelCorrect,
            total: this.currentLevelAttempts,
            action,
        });
    }

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

    // ============================================================
    // 私有方法：原子性寫入
    // ============================================================

    private async commitAll(
        finalLevel: number,
        history: PlacementHistoryEntry
    ): Promise<void> {
        const batch = writeBatch(db);
        const now = this.getNow().toISOString();
        const displayId = this.getDisplayId();

        // 1. learningState → studentStates/{displayId}
        const levelHistoryEntry: LevelHistoryEntry = {
            level: finalLevel,
            changedAt: now,
            reason: `程度鑑定：${this.placementSteps.map((s) => `L${s.level} ${s.correct}/${s.total}`).join(' → ')}`,
            triggeredBy: 'placement',
        };

        batch.set(
            doc(db, 'studentStates', displayId),
            {
                currentLevel: finalLevel,
                placementDone: true,
                placementHistory: history,
                totalAttempts: increment(this.pendingAttempts.length),
                levelHistory: arrayUnion(levelHistoryEntry),
            },
            { merge: true }
        );

        // 2. 所有作答紀錄
        for (const attempt of this.pendingAttempts) {
            batch.set(doc(collection(db, 'attempts')), attempt);
        }

        // 3. SM-2 狀態 → studentStates/{displayId}/words/{wordId}
        for (const [wordId, state] of this.stateCache) {
            batch.set(
                doc(db, 'studentStates', displayId, 'words', sanitizeFirestoreId(wordId)),
                { ...state, originalWordId: wordId }
            );
        }

        // 4. classStats
        if (this.className && this.className.trim()) {
            const studentDisplayId =
                this.deps.studentName && this.deps.studentSeatNumber
                    ? `${this.className}_${this.deps.studentSeatNumber}_${this.deps.studentName}`
                    : this.studentId;
            const studentDisplayName = this.deps.studentName || this.studentId;
            const correctCount = this.pendingAttempts.filter((a) => a.isCorrect).length;

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