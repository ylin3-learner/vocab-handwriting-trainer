// src/services/storage/HybridProgressStore.ts
import { ReviewState, createInitialReviewState } from '../../types/word';
import { ProgressStore, AttemptRecord } from './ProgressStore';
import { FirestoreProgressStore } from './FirestoreProgressStore';
import { LocalStorageProgressStore } from './LocalStorageProgressStore';
import { notifyQuotaExceeded } from '../status/quotaMonitor';

// 待同步操作類型
type SyncOperation =
    | { type: 'saveState'; studentId: string; wordId: string; state: ReviewState; timestamp: number }
    | { type: 'recordAttempt'; attempt: AttemptRecord; timestamp: number };

/**
 * 混合進度儲存：本地優先 + 雲端同步。
 *
 * 🔥 建構參數 studentKey 是 displayId，不是 uid。
 *   理由：跨 UID 追蹤學生，換裝置時同步佇列也能延續。
 */
export class HybridProgressStore implements ProgressStore {
    private cloud: FirestoreProgressStore;
    private local: LocalStorageProgressStore;
    private syncQueueKey: string;
    private syncInterval: number | null = null;

    private isSyncing = false;
    private isCircuitBroken = false;
    private circuitBreakerTimeout: number | null = null;

    constructor(private studentKey: string) {
        this.cloud = new FirestoreProgressStore();
        this.local = new LocalStorageProgressStore();
        this.syncQueueKey = `syncQueue_${studentKey}`;
        this.startAutoSync(60000);
    }

    async getState(studentId: string, wordId: string): Promise<ReviewState> {
        try {
            const localState = await this.local.getState(studentId, wordId);
            if (localState.totalReviews > 0 || localState.lastReviewed) {
                return localState;
            }
        } catch (e) { /* 忽略 */ }

        try {
            const cloudState = await this.cloud.getState(studentId, wordId);
            await this.local.saveState(studentId, wordId, cloudState);
            return cloudState;
        } catch (e) {
            return createInitialReviewState();
        }
    }

    async getAllStates(studentId: string): Promise<Map<string, ReviewState>> {
        return this.local.getAllStates(studentId);
    }

    async saveState(studentId: string, wordId: string, state: ReviewState): Promise<void> {
        await this.local.saveState(studentId, wordId, state);

        if (this.isCircuitBroken) {
            await this.addToSyncQueue({ type: 'saveState', studentId, wordId, state, timestamp: Date.now() });
            return;
        }

        try {
            await this.cloud.saveState(studentId, wordId, state);
            await this.removeFromSyncQueue('saveState', studentId, wordId);
        } catch (error) {
            console.warn('⚠️ 雲端儲存失敗，加入同步佇列:', error);
            await this.addToSyncQueue({ type: 'saveState', studentId, wordId, state, timestamp: Date.now() });
            this.checkCircuitBreaker(error);
        }
    }

    async recordAttempt(attempt: AttemptRecord): Promise<void> {
        await this.local.recordAttempt(attempt);

        if (this.isCircuitBroken) {
            await this.addToSyncQueue({ type: 'recordAttempt', attempt, timestamp: Date.now() });
            return;
        }

        try {
            await this.cloud.recordAttempt(attempt);
            await this.removeFromSyncQueue('recordAttempt', attempt.studentId, attempt.wordId);
        } catch (error) {
            console.warn('⚠️ 雲端記錄作答失敗，加入同步佇列:', error);
            await this.addToSyncQueue({ type: 'recordAttempt', attempt, timestamp: Date.now() });
            this.checkCircuitBreaker(error);
        }
    }

    /**
     * 🔥 修復：熔斷器改為「隔天太平洋午夜」重置
     *
     * 原因：Firestore 配額每天太平洋午夜重置，
     * 之前用 5 分鐘會導致「解鎖 → 撞牆 → 再熔斷」的無限迴圈。
     */
    private getNextPacificMidnightDelay(): number {
        const now = new Date();
        // 太平洋夏令時間 = UTC-7，換算為 UTC 07:00
        // 保守使用 UTC 08:00（涵蓋冬令時間 UTC-8）
        const nextReset = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1,
            8, 0, 0
        ));
        return nextReset.getTime() - now.getTime();
    }

    private checkCircuitBreaker(error: any): void {
        const errorMessage = String(error?.message || '').toLowerCase();
        const errorCode = String(error?.code || '').toLowerCase();

        if (errorMessage.includes('quota') || errorMessage.includes('429') || errorCode.includes('resource-exhausted')) {
            if (!this.isCircuitBroken) {
                const delayMs = this.getNextPacificMidnightDelay();
                const hours = (delayMs / 1000 / 60 / 60).toFixed(1);
                console.error(
                    `🚨 偵測到 Firebase 配額耗盡！啟動熔斷器，${hours} 小時後（太平洋午夜）恢復。`
                );
                notifyQuotaExceeded();
                this.isCircuitBroken = true;
                this.circuitBreakerTimeout = window.setTimeout(() => {
                    console.log('🔓 熔斷器解除，恢復雲端同步。');
                    this.isCircuitBroken = false;
                    this.circuitBreakerTimeout = null;
                }, delayMs);
            }
        }
    }

    // ----- 同步佇列管理 -----
    private async getSyncQueue(): Promise<SyncOperation[]> {
        const stored = localStorage.getItem(this.syncQueueKey);
        if (!stored) return [];
        try { return JSON.parse(stored); } catch { return []; }
    }

    private async saveSyncQueue(queue: SyncOperation[]): Promise<void> {
        localStorage.setItem(this.syncQueueKey, JSON.stringify(queue));
    }

    private async addToSyncQueue(operation: SyncOperation): Promise<void> {
        const queue = await this.getSyncQueue();
        const existingIndex = queue.findIndex(op => {
            if (op.type === 'saveState' && operation.type === 'saveState') {
                return op.studentId === operation.studentId && op.wordId === operation.wordId;
            }
            if (op.type === 'recordAttempt' && operation.type === 'recordAttempt') {
                return op.attempt.studentId === operation.attempt.studentId &&
                    op.attempt.wordId === operation.attempt.wordId &&
                    op.attempt.timestamp === operation.attempt.timestamp;
            }
            return false;
        });
        if (existingIndex >= 0) queue[existingIndex] = operation;
        else queue.push(operation);
        await this.saveSyncQueue(queue);
    }

    private async removeFromSyncQueue(type: 'saveState' | 'recordAttempt', studentId: string, wordId?: string): Promise<void> {
        const queue = await this.getSyncQueue();
        const filtered = queue.filter(op => {
            if (type === 'saveState' && op.type === 'saveState') return !(op.studentId === studentId && op.wordId === wordId);
            if (type === 'recordAttempt' && op.type === 'recordAttempt') return !(op.attempt.studentId === studentId && op.attempt.wordId === wordId);
            return true;
        });
        await this.saveSyncQueue(filtered);
    }

    private startAutoSync(intervalMs: number): void {
        if (this.syncInterval !== null) clearInterval(this.syncInterval);
        this.syncInterval = window.setInterval(() => {
            this.syncNow().catch(err => console.warn('背景同步失敗:', err));
        }, intervalMs);
    }

    stopAutoSync(): void {
        if (this.syncInterval !== null) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        if (this.circuitBreakerTimeout !== null) {
            clearTimeout(this.circuitBreakerTimeout);
        }
    }

    async syncNow(): Promise<void> {
        if (this.isSyncing || this.isCircuitBroken) return;
        const queue = await this.getSyncQueue();
        if (queue.length === 0) return;

        this.isSyncing = true;
        console.log(`🔄 開始同步 ${queue.length} 筆待處理操作...`);

        const BATCH_SIZE = 20;
        const currentBatch = queue.slice(0, BATCH_SIZE);
        const failed: SyncOperation[] = [];

        for (const op of currentBatch) {
            try {
                if (op.type === 'saveState') {
                    await this.cloud.saveState(op.studentId, op.wordId, op.state);
                } else if (op.type === 'recordAttempt') {
                    await this.cloud.recordAttempt(op.attempt);
                }
            } catch (err) {
                console.warn('同步操作失敗，保留:', err);
                failed.push(op);
                this.checkCircuitBreaker(err);
                if (this.isCircuitBroken) break;
            }
        }

        const remainingQueue = [...failed, ...queue.slice(BATCH_SIZE)];
        await this.saveSyncQueue(remainingQueue);
        this.isSyncing = false;

        console.log(`✅ 本輪同步完成，剩餘 ${remainingQueue.length} 筆待處理`);
    }

    async getPendingCount(): Promise<number> {
        return (await this.getSyncQueue()).length;
    }
}