// src/services/storage/HybridProgressStore.ts
import { ReviewState, createInitialReviewState } from '../../types/word';
import { ProgressStore, AttemptRecord } from './ProgressStore';
import { FirestoreProgressStore } from './FirestoreProgressStore';
import { LocalStorageProgressStore } from './LocalStorageProgressStore';

// 待同步操作類型
type SyncOperation =
    | { type: 'saveState'; studentId: string; wordId: string; state: ReviewState; timestamp: number }
    | { type: 'recordAttempt'; attempt: AttemptRecord; timestamp: number };

export class HybridProgressStore implements ProgressStore {
    private cloud: FirestoreProgressStore;
    private local: LocalStorageProgressStore;
    private syncQueueKey: string;
    private syncInterval: number | null = null;

    constructor(private studentId: string) {
        this.cloud = new FirestoreProgressStore();
        this.local = new LocalStorageProgressStore();
        this.syncQueueKey = `syncQueue_${studentId}`;
        // 啟動自動同步（每 30 秒）
        this.startAutoSync(30000);
    }

    // ----- 讀取：優先從本地，再從雲端（但這裡我們統一從本地讀取，因為本地一定有最新資料） -----
    async getState(studentId: string, wordId: string): Promise<ReviewState> {
        // 1. 先嘗試從本地讀取
        try {
            const localState = await this.local.getState(studentId, wordId);
            // 如果本地有資料且不是初始狀態，直接返回（最快）
            if (localState.totalReviews > 0 || localState.lastReviewed) {
                return localState;
            }
        } catch (e) {
            // 忽略
        }

        // 2. 如果本地沒有，從雲端讀取並存入本地
        try {
            const cloudState = await this.cloud.getState(studentId, wordId);
            // 存入本地備份
            await this.local.saveState(studentId, wordId, cloudState);
            return cloudState;
        } catch (e) {
            // 雲端失敗，回傳初始狀態
            return createInitialReviewState();
        }
    }

    async getAllStates(studentId: string): Promise<Map<string, ReviewState>> {
        // 直接從本地讀取所有狀態（更快，且不會觸發雲端配額）
        return this.local.getAllStates(studentId);
    }

    // ----- 寫入：本地先寫，雲端嘗試寫入，失敗則排隊 -----
    async saveState(studentId: string, wordId: string, state: ReviewState): Promise<void> {
        // 1. 無論如何先寫入本地（確保資料不遺失）
        await this.local.saveState(studentId, wordId, state);

        // 2. 嘗試寫入雲端
        try {
            await this.cloud.saveState(studentId, wordId, state);
            // 如果成功，從同步佇列中移除該操作（如果有）
            await this.removeFromSyncQueue('saveState', studentId, wordId);
        } catch (error) {
            // 雲端失敗，將此操作加入同步佇列
            console.warn('⚠️ 雲端儲存失敗，加入同步佇列:', error);
            await this.addToSyncQueue({
                type: 'saveState',
                studentId,
                wordId,
                state,
                timestamp: Date.now()
            });
        }
    }

    // HybridProgressStore.ts 中的 recordAttempt 方法
    async recordAttempt(attempt: AttemptRecord): Promise<void> {
        // 1. 先寫入本地
        await this.local.recordAttempt(attempt);

        // 2. 嘗試寫入雲端（但失敗不影響本地）
        try {
            await this.cloud.recordAttempt(attempt);
            await this.removeFromSyncQueue('recordAttempt', attempt.studentId, attempt.wordId);
        } catch (error) {
            console.warn('⚠️ 雲端記錄作答失敗，加入同步佇列:', error);
            await this.addToSyncQueue({
                type: 'recordAttempt',
                attempt,
                timestamp: Date.now()
            });
        }
    }

    // ----- 同步佇列管理 -----
    private async getSyncQueue(): Promise<SyncOperation[]> {
        const stored = localStorage.getItem(this.syncQueueKey);
        if (!stored) return [];
        try {
            return JSON.parse(stored);
        } catch {
            return [];
        }
    }

    private async saveSyncQueue(queue: SyncOperation[]): Promise<void> {
        localStorage.setItem(this.syncQueueKey, JSON.stringify(queue));
    }

    private async addToSyncQueue(operation: SyncOperation): Promise<void> {
        const queue = await this.getSyncQueue();
        // 避免重複加入（若已有相同操作則更新）
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
        if (existingIndex >= 0) {
            queue[existingIndex] = operation; // 更新
        } else {
            queue.push(operation);
        }
        await this.saveSyncQueue(queue);
    }

    private async removeFromSyncQueue(
        type: 'saveState' | 'recordAttempt',
        studentId: string,
        wordId?: string
    ): Promise<void> {
        const queue = await this.getSyncQueue();
        const filtered = queue.filter(op => {
            if (type === 'saveState' && op.type === 'saveState') {
                return !(op.studentId === studentId && op.wordId === wordId);
            }
            if (type === 'recordAttempt' && op.type === 'recordAttempt') {
                return !(op.attempt.studentId === studentId && op.attempt.wordId === wordId);
            }
            return true;
        });
        await this.saveSyncQueue(filtered);
    }

    // ----- 自動同步背景任務 -----
    private startAutoSync(intervalMs: number): void {
        if (this.syncInterval !== null) {
            clearInterval(this.syncInterval);
        }
        this.syncInterval = window.setInterval(() => {
            this.syncNow().catch(err => console.warn('背景同步失敗:', err));
        }, intervalMs);
    }

    // 停止自動同步（可選）
    stopAutoSync(): void {
        if (this.syncInterval !== null) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    // 手動觸發同步（可以綁定到按鈕，讓教師手動觸發）
    async syncNow(): Promise<void> {
        const queue = await this.getSyncQueue();
        if (queue.length === 0) return;

        console.log(`🔄 開始同步 ${queue.length} 筆待處理操作...`);
        const failed: SyncOperation[] = [];

        for (const op of queue) {
            try {
                if (op.type === 'saveState') {
                    await this.cloud.saveState(op.studentId, op.wordId, op.state);
                } else if (op.type === 'recordAttempt') {
                    await this.cloud.recordAttempt(op.attempt);
                }
                // 成功後從佇列移除（但我們會在最後統一清理）
            } catch (err) {
                console.warn('同步操作失敗，保留:', err);
                failed.push(op);
            }
        }

        // 更新佇列（只保留失敗的）
        await this.saveSyncQueue(failed);
        console.log(`✅ 同步完成，${failed.length} 筆仍待處理`);
    }

    // ----- 取得佇列長度（用於 UI 顯示） -----
    async getPendingCount(): Promise<number> {
        return (await this.getSyncQueue()).length;
    }
}