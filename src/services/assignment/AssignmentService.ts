// src/services/assignment/AssignmentService.ts
import {
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  query,
  orderBy,
  startAt,
  endAt,
  documentId,
} from 'firebase/firestore';
import { db } from '../../firebase';

export type ReviewFocus = 'strict' | 'balanced' | 'explore';

export interface Assignment {
  id: string;
  /**
   * 作業名稱。
   * - 老師有填 → 用老師填的
   * - 未填 → 建立時由 UI 自動生成（例如 "709 · L4 · 09-13"）
   */
  name: string;
  /**
   * 指派對象識別碼。
   * - "709"           → 班級作業
   * - "709_1_林佑綸"  → 個人作業（displayId）
   * - null            → 全校作業
   */
  className: string | null;
  /**
   * 目標等級（1~6），選填。
   * - 有設定：出題以該等級為主（加權出題）
   * - 未設定：出題依學生當前 DDA 等級
   */
  targetLevel?: number;
  dailyQuota: number;
  newRatio: number;
  reviewFocus?: ReviewFocus;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: string;
}

export interface ActiveAssignment {
  assignment: Assignment;
  newWordCount: number;
  reviewWordCount: number;
  explorationRate: number;
}

/**
 * 學生選項（供 UI 下拉選單使用）。
 */
export interface StudentOption {
  /** 完整的 displayId（例如 "709_1_林佑綸"） */
  displayId: string;
  /** 座號（例如 "1"） */
  seatNumber: string;
  /** 姓名（例如 "林佑綸"） */
  name: string;
}

// 將「複習專注度」換算為探索率 ε
function focusToExplorationRate(focus: ReviewFocus | undefined): number {
  switch (focus) {
    case 'strict':   return 0.05;
    case 'explore':  return 0.25;
    case 'balanced':
    default:         return 0.10;
  }
}

export class AssignmentService {
  // ============================================================
  // 學生端：取得當前生效作業
  // ============================================================

  /**
   * 學生端：取得當前生效作業
   *
   * 查找優先順序（hierarchy）：
   *   1. 個人作業（className === displayId）
   *   2. 班級作業（className === className）
   *   3. 全校作業（className === null）
   *
   * @param className 班級（例如 "709"）
   * @param displayId 學生的複合識別碼（例如 "709_1_林佑綸"）
   */
  async getActiveAssignment(
    className: string,
    displayId?: string
  ): Promise<ActiveAssignment | null> {
    const assignmentsRef = collection(db, 'assignments');
    const snapshot = await getDocs(assignmentsRef);
    const now = new Date().toISOString();

    const all = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    } as Assignment));

    // 1. 篩選：啟用中 + 時間範圍內
    const validAssignments = all.filter(a => {
      if (!a.isActive) return false;
      if (a.startDate > now) return false;
      if (a.endDate < now) return false;
      return true;
    });

    // 2. 優先序查找：個人 → 班級 → 全校
    let target: Assignment | undefined;

    if (displayId) {
      target = validAssignments.find(a => a.className === displayId);
      if (target) {
        console.log(`👤 [AssignmentService] 找到個人作業「${target.name}」`);
      }
    }

    if (!target) {
      target = validAssignments.find(a => a.className === className);
      if (target) {
        console.log(`🏫 [AssignmentService] 找到班級作業「${target.name}」`);
      }
    }

    if (!target) {
      target = validAssignments.find(a => a.className === null);
      if (target) {
        console.log(`🌐 [AssignmentService] 找到全校作業「${target.name}」`);
      }
    }

    if (!target) return null;

    const newWordCount = Math.floor(target.dailyQuota * target.newRatio);
    const explorationRate = focusToExplorationRate(target.reviewFocus);

    console.log(
      `📋 [AssignmentService] 作業「${target.name}」→ 專注度=${target.reviewFocus ?? 'balanced(預設)'}, ε=${explorationRate}, targetLevel=${target.targetLevel ?? '未指定'}`
    );

    return {
      assignment: target,
      newWordCount,
      reviewWordCount: target.dailyQuota - newWordCount,
      explorationRate,
    };
  }

  // ============================================================
  // 教師端：取得下拉選單資料
  // ============================================================

  /**
   * 取得所有「有學生使用過」的班級列表。
   *
   * 資料來源：classStats collection（document ID 即 className）。
   * 這代表「有學生答過題的班級」，符合「只派作業給用過系統的學生」原則。
   */
  async getAllClasses(): Promise<string[]> {
    try {
      const snap = await getDocs(collection(db, 'classStats'));
      return snap.docs
        .map(d => d.id)
        .sort((a, b) => a.localeCompare(b));
    } catch (e) {
      console.error('❌ [AssignmentService] 取得班級列表失敗:', e);
      return [];
    }
  }

  /**
   * 取得某班級的所有學生（供 UI 下拉選單使用）。
   *
   * 用 documentId() 做範圍查詢：
   *   startAt("709_") / endAt("709_\uf8ff")
   *
   * 只會撈到 displayId 以 "709_" 開頭的文件，效率高。
   * 結果按座號升序排序。
   */
  async getStudentsByClass(className: string): Promise<StudentOption[]> {
    if (!className || !className.trim()) return [];

    try {
      const q = query(
        collection(db, 'studentStates'),
        orderBy(documentId()),
        startAt(`${className}_`),
        endAt(`${className}_\uf8ff`)
      );
      const snap = await getDocs(q);

      return snap.docs
        .map(d => {
          const parts = d.id.split('_');
          return {
            displayId: d.id,
            seatNumber: parts[1] ?? '',
            name: parts.slice(2).join('_') || d.id,
          };
        })
        .sort((a, b) => {
          const na = parseInt(a.seatNumber, 10);
          const nb = parseInt(b.seatNumber, 10);
          if (isNaN(na) && isNaN(nb)) return a.seatNumber.localeCompare(b.seatNumber);
          if (isNaN(na)) return 1;
          if (isNaN(nb)) return -1;
          return na - nb;
        });
    } catch (e) {
      console.error(`❌ [AssignmentService] 取得 ${className} 學生列表失敗:`, e);
      return [];
    }
  }

  // ============================================================
  // 教師端：CRUD
  // ============================================================

  async getAllAssignments(): Promise<Assignment[]> {
    const assignmentsRef = collection(db, 'assignments');
    const snapshot = await getDocs(assignmentsRef);
    return snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    } as Assignment));
  }

  async getAssignment(id: string): Promise<Assignment | null> {
    const docRef = doc(db, 'assignments', id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Assignment;
  }

  async createAssignment(assignment: Omit<Assignment, 'id' | 'createdAt'>): Promise<string> {
    const assignmentsRef = collection(db, 'assignments');
    const docRef = await addDoc(assignmentsRef, {
      ...assignment,
      createdAt: new Date().toISOString(),
    });
    return docRef.id;
  }

  async updateAssignment(
    id: string,
    assignment: Partial<Omit<Assignment, 'id' | 'createdAt'>>
  ): Promise<void> {
    const docRef = doc(db, 'assignments', id);
    await updateDoc(docRef, assignment);
  }

  async deleteAssignment(id: string): Promise<void> {
    const docRef = doc(db, 'assignments', id);
    await deleteDoc(docRef);
  }
}