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
  deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { selectActiveAssignment } from '../../domain/assignment/selectAssignment';
import type { QuotaExceededBehavior } from '../../domain/quiz/SessionQuotaPolicy';
import type { HandwritingMode } from '../../domain/quiz/HandwritingLockPolicy';
import { removeUndefined } from '../../domain/firestore/removeUndefined';

export type ReviewFocus = 'strict' | 'balanced' | 'explore';

export const DEFAULT_SPEECH_RATE = 1.0;
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
  speechRate?: number;
  speechFloorRate?: number;
  quotaExceededBehavior?: QuotaExceededBehavior;
  timeLimitMs?: number;
  handwritingMode?: HandwritingMode;
  /**
   * 🔥 比賽模式：凍結 DDA 並強制從目標等級出題。
   *
   * 生命週期由 endDate 控制——作業過期後 selectActiveAssignment
   * 自動排除，QuizOrchestrator 回到一般模式，DDA 自然恢復。
   */
  competitionMode?: boolean;
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

    const all = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    } as Assignment));

    const now = new Date().toISOString();
    const selected = selectActiveAssignment(all, className, displayId, now);

    if (!selected) return null;

    const target = selected.assignment;
    const matchLabel =
      selected.matchType === 'personal' ? '👤 個人' :
      selected.matchType === 'class'    ? '🏫 班級' :
                                          '🌐 全校';

    const modeLabel = target.competitionMode ? ' 🏁 比賽模式' : '';
    console.log(
      `${matchLabel} [AssignmentService] 作業「${target.name}」→ targetLevel=${target.targetLevel ?? '未指定'}${modeLabel}`
    );

    const newWordCount = Math.floor(target.dailyQuota * target.newRatio);
    const explorationRate = focusToExplorationRate(target.reviewFocus);

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
      ...removeUndefined(assignment as Record<string, unknown>),
      createdAt: new Date().toISOString(),
    });
    return docRef.id;
  }

  async updateAssignment(
    id: string,
    assignment: Partial<Omit<Assignment, 'id' | 'createdAt'>>
  ): Promise<void> {
    const docRef = doc(db, 'assignments', id);

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(assignment)) {
      if (value === undefined) {
        payload[key] = deleteField();
      } else {
        payload[key] = value;
      }
    }

    await updateDoc(docRef, payload);
  }

  async deleteAssignment(id: string): Promise<void> {
    const docRef = doc(db, 'assignments', id);
    await deleteDoc(docRef);
  }
}