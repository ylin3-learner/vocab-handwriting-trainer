// src/services/assignment/AssignmentService.ts
import {
  collection, getDocs, doc, addDoc, updateDoc, deleteDoc, getDoc
} from 'firebase/firestore';
import { db } from '../../firebase';

export type ReviewFocus = 'strict' | 'balanced' | 'explore';

export interface Assignment {
  id: string;
  name: string;
  className: string | null;
  wordScope: string;
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

// 將「複習專注度」換算為探索率 ε
function focusToExplorationRate(focus: ReviewFocus | undefined): number {
  switch (focus) {
    case 'strict':   return 0.05; // 精準複習：5% 隨機
    case 'explore':  return 0.25; // 廣泛探索：25% 隨機
    case 'balanced':
    default:         return 0.10; // 均衡練習：10% 隨機（預設）
  }
}

export class AssignmentService {
  // ----- 學生端：取得當前生效作業 -----
  async getActiveAssignment(className: string): Promise<ActiveAssignment | null> {
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

    // 2. 優先找班級作業，若無則找全校作業
    let target = validAssignments.find(a => a.className === className);
    if (!target) {
      target = validAssignments.find(a => a.className === null);
    }

    if (!target) return null;

    const newWordCount = Math.floor(target.dailyQuota * target.newRatio);
    const explorationRate = focusToExplorationRate(target.reviewFocus);

    console.log(`📋 [AssignmentService] 作業「${target.name}」→ 專注度=${target.reviewFocus ?? 'balanced(預設)'}, ε=${explorationRate}`);

    return {
      assignment: target,
      newWordCount,
      reviewWordCount: target.dailyQuota - newWordCount,
      explorationRate,
    };
  }

  // ----- 教師端 CRUD -----
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

  async updateAssignment(id: string, assignment: Partial<Omit<Assignment, 'id' | 'createdAt'>>): Promise<void> {
    const docRef = doc(db, 'assignments', id);
    await updateDoc(docRef, assignment);
  }

  async deleteAssignment(id: string): Promise<void> {
    const docRef = doc(db, 'assignments', id);
    await deleteDoc(docRef);
  }
}