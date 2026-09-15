// src/services/profile/ProfileService.ts
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ProfileCleanupTracker } from './ProfileCleanupTracker';

export interface StudentProfile {
  name: string;
  class: string;
  seatNumber: string;
  displayId: string;
  createdAt?: string;
  updatedAt?: string;
}

export class ProfileService {
  private cleanupTracker = new ProfileCleanupTracker();

  async saveProfile(
    uid: string,
    name: string,
    className: string,
    seatNumber: string
  ): Promise<void> {
    const displayId = `${className}_${seatNumber}_${name}`;
    const now = new Date().toISOString();

    // ============================================================
    // 步驟 1：清理舊 uid 的 profile（localStorage 判斷，零查詢）
    // ============================================================
    await this.cleanupOldProfiles(displayId, uid);

    // ============================================================
    // 步驟 2：寫入當前 profile
    // ============================================================
    const ref = doc(db, 'students', uid);
    const snap = await getDoc(ref);

    const data = {
      name,
      class: className,
      seatNumber,
      displayId,
      updatedAt: now,
    };

    if (snap.exists()) {
      await setDoc(ref, data, { merge: true });
    } else {
      await setDoc(ref, { ...data, createdAt: now });
    }
  }

  async getProfile(uid: string): Promise<StudentProfile | null> {
    const ref = doc(db, 'students', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as StudentProfile;
  }

  // ============================================================
  // 私有：清理同 displayId 的舊 uid profile
  //
  // 安全設計：
  //   - 只刪除 localStorage 明確記錄的舊 uid
  //   - 不做 Firestore 查詢（避免誤刪）
  //   - try-catch 保護，失敗不影響登入流程
  // ============================================================
  private async cleanupOldProfiles(
    displayId: string,
    currentUid: string
  ): Promise<void> {
    const oldUids = this.cleanupTracker.registerCurrentUid(displayId, currentUid);

    if (oldUids.length === 0) return;

    console.log(
      `🧹 [ProfileService] 清理 ${oldUids.length} 筆舊 profile（displayId: ${displayId}）`
    );

    try {
      await Promise.all(
        oldUids.map((id) => deleteDoc(doc(db, 'students', id)))
      );
      console.log(`✅ [ProfileService] 清理完成`);
    } catch (e) {
      // 清理失敗不影響主流程
      console.warn('⚠️ [ProfileService] 清理舊 profile 失敗:', e);
    }
  }
}