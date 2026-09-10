// src/services/profile/ProfileService.ts
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export interface StudentProfile {
  name: string;
  class: string;
  seatNumber: string;
  displayId: string; // `${class}_${seatNumber}_${name}`
  createdAt?: string;
  updatedAt?: string;
}

export class ProfileService {
  async saveProfile(
    uid: string,
    name: string,
    className: string,
    seatNumber: string
  ): Promise<void> {
    const ref = doc(db, 'students', uid);
    const snap = await getDoc(ref);
    const now = new Date().toISOString();
    const displayId = `${className}_${seatNumber}_${name}`;

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
}