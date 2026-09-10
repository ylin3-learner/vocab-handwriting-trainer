// src/services/profile/ProfileService.ts
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export interface StudentProfile {
  name: string;
  class: string;
  createdAt?: string;
  updatedAt?: string;
}

export class ProfileService {
  async saveProfile(uid: string, name: string, className: string): Promise<void> {
    const ref = doc(db, 'students', uid);
    const snap = await getDoc(ref);
    const now = new Date().toISOString();

    if (snap.exists()) {
      await setDoc(ref, {
        name,
        class: className,
        updatedAt: now,
      }, { merge: true });
    } else {
      await setDoc(ref, {
        name,
        class: className,
        createdAt: now,
      });
    }
  }

  async getProfile(uid: string): Promise<StudentProfile | null> {
    const ref = doc(db, 'students', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as StudentProfile;
  }
}