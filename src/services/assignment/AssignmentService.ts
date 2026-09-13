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
  where,
  orderBy,
  startAt,
  endAt,
  documentId,
} from 'firebase/firestore';
import { db } from '../../firebase';

export type ReviewFocus = 'strict' | 'balanced' | 'explore';

export interface Assignment {
  id: string;
  name: string;
  className: string | null;
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

export interface StudentOption {
  displayId: string;
  seatNumber: string;
  name: string;
}

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
   * 🔥 修復（問題 7）：加入 where('isActive', '==', true) 減少讀取量。
   *   原本全撈所有作業（含停用、過期），作業累積後會浪費讀取配額。
   *   時間範圍（startDate/endDate）無法加進 query，因為 Firestore
   *   不允許對多個欄位同時做 range 查詢，仍在客戶端過濾。
   *
   * @param className 班級（例如 "709"）
   * @param displayId 學生的複合識別碼（例如 "709_1_林佑綸"）
   */
  async getActiveAssignment(
    className: string,
    displayId?: string
  ): Promise<ActiveAssignment | null> {
    const assignmentsRef = collection(db, 'assignments');
    const q = query(assignmentsRef, where('isActive', '==', true));
    const snapshot = await getDocs(q);
    const now = new Date().toISOString();

    const all = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    } as Assignment));

    // 時間範圍過濾（無法放進 query）
    const validAssignments = all.filter(a => {
      if (a.startDate > now) return false;
      if (a.endDate < now) return false;
      return true;
    });

    // 優先序查找：個人 → 班級 → 全校
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