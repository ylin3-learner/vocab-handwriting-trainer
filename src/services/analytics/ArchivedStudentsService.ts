// src/services/analytics/ArchivedStudentsService.ts
import { collection, doc, setDoc, deleteDoc, getDocs, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ArchivedStudent } from '../../types/archivedStudent';

export class ArchivedStudentsService {
  private getDocRef(displayId: string) {
    return doc(db, 'archived_students', displayId);
  }

  /**
   * 歸檔學生（從教師列表隱藏）
   * - 只寫入 1 筆文件，不刪除任何原始資料
   * - 可隨時取消歸檔
   */
  async archiveStudent(
    displayId: string,
    studentName: string,
    className: string,
    archivedBy: string
  ): Promise<void> {
    const ref = this.getDocRef(displayId);
    const record: ArchivedStudent = {
      displayId,
      studentName,
      className,
      archivedAt: new Date().toISOString(),
      archivedBy,
    };
    await setDoc(ref, record);
    console.log(`📦 [ArchivedStudentsService] 已歸檔「${displayId}」`);
  }

  /**
   * 取消歸檔（把學生找回來）
   */
  async unarchiveStudent(displayId: string): Promise<void> {
    const ref = this.getDocRef(displayId);
    await deleteDoc(ref);
    console.log(`📤 [ArchivedStudentsService] 已取消歸檔「${displayId}」`);
  }

  /**
   * 檢查某學生是否已歸檔
   */
  async isArchived(displayId: string): Promise<boolean> {
    const snap = await getDoc(this.getDocRef(displayId));
    return snap.exists();
  }

  /**
   * 取得所有已歸檔學生的 ID 集合（用於快速過濾）
   */
  async getAllArchivedIds(): Promise<Set<string>> {
    const ref = collection(db, 'archived_students');
    const snap = await getDocs(ref);
    const ids = new Set<string>();
    snap.docs.forEach(d => ids.add(d.id));
    return ids;
  }

  /**
   * 取得所有已歸檔學生的完整資料（供 AdminPanel 顯示）
   */
  async getAllArchived(): Promise<ArchivedStudent[]> {
    const ref = collection(db, 'archived_students');
    const snap = await getDocs(ref);
    return snap.docs.map(d => d.data() as ArchivedStudent);
  }
}