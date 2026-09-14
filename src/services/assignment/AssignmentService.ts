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

/** 系統預設語速（標準英語） */
export const DEFAULT_SPEECH_RATE = 1.0;
/** 系統預設語速下限（慢速重聽） */
export const DEFAULT_SPEECH_FLOOR_RATE = 0.85;

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

  // 🔥 語音設定
  /**
   * 預設播放語速（1.0 = 標準英語）。
   * 學生首次聽到題目時使用。若未設定，預設 1.0。
   */
  speechRate?: number;
  /**
   * 全班語速下限（0.5 ~ 1.0）。
   * 學生點「🐢 重聽一次（慢速）」時使用。若未設定，預設 0.85。
   */
  speechFloorRate?: number;
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

    const validAssignments = all.filter(a => {
      if (a.startDate > now) return false;
      if (a.endDate < now) return false;
      return true;
    });

    let target: Assignment | undefined;

    if (displayId) {
      target = validAssignments.find(a => a.className === displayId);
      if (target) console.log(`👤 [AssignmentService] 找到個人作業「${target.name}」`);
    }
    if (!target) {
      target = validAssignments.find(a => a.className === className);
      if (target) console.log(`🏫 [AssignmentService] 找到班級作業「${target.name}」`);
    }
    if (!target) {
      target = validAssignments.find(a => a.className === null);
      if (target) console.log(`🌐 [AssignmentService] 找到全校作業「${target.name}」`);
    }

    if (!target) return null;

    const newWordCount = Math.floor(target.dailyQuota * target.newRatio);
    const explorationRate = focusToExplorationRate(target.reviewFocus);

    console.log(
      `📋 [AssignmentService] 作業「${target.name}」→ targetLevel=${target.targetLevel ?? '未指定'}, speechRate=${target.speechRate ?? DEFAULT_SPEECH_RATE}, speechFloor=${target.speechFloorRate ?? DEFAULT_SPEECH_FLOOR_RATE}`
    );

    return {
      assignment: target,
      newWordCount,
      reviewWordCount: target.dailyQuota - newWordCount,
      explorationRate,
    };
  }

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