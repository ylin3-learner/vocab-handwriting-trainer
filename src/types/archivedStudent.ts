// src/types/archivedStudent.ts

export interface ArchivedStudent {
  /** 複合識別碼（例如 "709_1_林佑綸"）*/
  displayId: string;
  /** 學生姓名 */
  studentName: string;
  /** 班級 */
  className: string;
  /** 歸檔時間（ISO）*/
  archivedAt: string;
  /** 歸檔者 email 或 uid */
  archivedBy: string;
}