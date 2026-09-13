// src/features/dashboard/AssignmentManager.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  AssignmentService,
  Assignment,
  ReviewFocus,
  StudentOption,
} from '../../services/assignment/AssignmentService';
import { RECOMMENDED_MIN_QUOTA } from '../../types/progression';

const service = new AssignmentService();

type AssignMode = 'class' | 'individual';

interface FormState {
  name: string;
  assignMode: AssignMode;
  classId: string;
  studentDisplayId: string; // 只在 assignMode === 'individual' 使用
  targetLevel: number | undefined;
  dailyQuota: number;
  newRatio: number;
  reviewFocus: ReviewFocus;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  assignMode: 'class',
  classId: '',
  studentDisplayId: '',
  targetLevel: undefined,
  dailyQuota: 30,
  newRatio: 0.3,
  reviewFocus: 'balanced',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  isActive: true,
});

const FOCUS_LABEL: Record<ReviewFocus, string> = {
  strict: '🎯 精準複習',
  balanced: '⚖️ 均衡練習',
  explore: '🎲 廣泛探索',
};

/**
 * 依指派對象與等級自動生成作業名稱。
 * 格式：`{對象} · L{等級} · {MM-DD}`
 * 例如：`709 · L4 · 09-13`
 */
function generateAutoName(className: string, targetLevel?: number): string {
  const levelStr = targetLevel ? `L${targetLevel}` : '自動';
  const dateStr = new Date().toISOString().slice(5, 10); // MM-DD
  return `${className} · ${levelStr} · ${dateStr}`;
}

/**
 * 將 className 格式化為顯示用。
 * - "709"           → "709"
 * - "709_1_林佑綸"  → "709 · 1 · 林佑綸"
 */
function formatTarget(className: string | null): string {
  if (!className) return '全校';
  return className.split('_').join(' · ');
}

function isPersonal(className: string | null): boolean {
  return !!className && className.includes('_');
}

export const AssignmentManager: React.FC = () => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [status, setStatus] = useState('');

  // 下拉選單資料
  const [classes, setClasses] = useState<string[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  const loadAssignments = async () => {
    setLoading(true);
    try {
      const list = await service.getAllAssignments();
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setAssignments(list);
    } catch (e) {
      console.error('載入作業失敗:', e);
      setStatus('❌ 載入作業失敗');
    } finally {
      setLoading(false);
    }
  };

  const loadClasses = async () => {
    const list = await service.getAllClasses();
    setClasses(list);
  };

  const loadStudents = useCallback(async (className: string) => {
    if (!className) {
      setStudents([]);
      return;
    }
    setLoadingStudents(true);
    try {
      const list = await service.getStudentsByClass(className);
      setStudents(list);
    } finally {
      setLoadingStudents(false);
    }
  }, []);

  useEffect(() => {
    loadAssignments();
    loadClasses();
  }, []);

  // 當班級變動時，重新載入學生
  useEffect(() => {
    if (form.assignMode === 'individual') {
      void loadStudents(form.classId);
    }
  }, [form.classId, form.assignMode, loadStudents]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 驗證
    if (!form.classId) {
      setStatus('❌ 請選擇班級');
      return;
    }
    if (form.assignMode === 'individual' && !form.studentDisplayId) {
      setStatus('❌ 請選擇學生');
      return;
    }

    // 決定 className
    const className =
      form.assignMode === 'individual'
        ? form.studentDisplayId
        : form.classId;

    // 決定名稱（若未填則自動生成）
    const name =
      form.name.trim() || generateAutoName(className, form.targetLevel);

    const payload = {
      name,
      className,
      targetLevel: form.targetLevel,
      dailyQuota: form.dailyQuota,
      newRatio: form.newRatio,
      reviewFocus: form.reviewFocus,
      startDate: new Date(form.startDate).toISOString(),
      endDate: new Date(form.endDate).toISOString(),
      isActive: form.isActive,
    };

    try {
      if (editingId) {
        await service.updateAssignment(editingId, payload);
        setStatus(`✅ 已更新作業：${payload.name}`);
      } else {
        await service.createAssignment(payload);
        setStatus(`✅ 已建立作業：${payload.name}`);
      }
      setForm(emptyForm());
      setEditingId(null);
      await loadAssignments();
    } catch (e) {
      console.error('儲存作業失敗:', e);
      setStatus('❌ 儲存作業失敗');
    }
  };

  const handleEdit = (a: Assignment) => {
    setEditingId(a.id);

    const personal = isPersonal(a.className);
    const classId = personal
      ? a.className!.split('_')[0] ?? ''
      : (a.className ?? '');

    setForm({
      name: a.name,
      assignMode: personal ? 'individual' : 'class',
      classId,
      studentDisplayId: personal ? a.className! : '',
      targetLevel: a.targetLevel,
      dailyQuota: a.dailyQuota,
      newRatio: a.newRatio,
      reviewFocus: a.reviewFocus ?? 'balanced',
      startDate: a.startDate.slice(0, 10),
      endDate: a.endDate.slice(0, 10),
      isActive: a.isActive,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('確定要刪除此作業嗎？此操作無法復原。')) return;
    try {
      await service.deleteAssignment(id);
      setStatus('✅ 已刪除作業');
      await loadAssignments();
    } catch (e) {
      console.error('刪除失敗:', e);
      setStatus('❌ 刪除失敗');
    }
  };

  const handleToggleActive = async (a: Assignment) => {
    try {
      await service.updateAssignment(a.id, { isActive: !a.isActive });
      await loadAssignments();
    } catch (e) {
      console.error('切換啟用失敗:', e);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm());
    setStatus('');
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>載入中...</div>;

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ borderBottom: '3px solid #17a2b8', paddingBottom: '0.5rem' }}>
        📋 作業管理
      </h1>
      <p style={{ color: '#6c757d' }}>
        建立作業後，學生登入時會依「個人 → 班級 → 全校」的優先序自動讀取對應設定。
      </p>

      {status && (
        <div style={{
          padding: '0.75rem',
          margin: '1rem 0',
          background: status.startsWith('✅') ? '#d4edda' : '#f8d7da',
          borderRadius: '4px',
        }}>
          {status}
        </div>
      )}

      {/* ============================================================ */}
      {/* 表單 */}
      {/* ============================================================ */}
      <form onSubmit={handleSubmit} style={{
        background: '#f8f9fa',
        padding: '1.5rem',
        borderRadius: '8px',
        margin: '1.5rem 0',
      }}>
        <h3 style={{ marginTop: 0 }}>
          {editingId ? '✏️ 編輯作業' : '➕ 建立新作業'}
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {/* 作業名稱（選填） */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label>作業名稱（選填）</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="留空將自動生成，例如：709 · L4 · 09-13"
              style={{ width: '100%', padding: '0.5rem' }}
            />
            <small style={{ color: '#6c757d' }}>
              建議只在「同一對象同時有多個作業」時填寫，方便辨識。
            </small>
          </div>

          {/* 指派對象 */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label>指派對象</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setForm({
                  ...form,
                  assignMode: 'class',
                  studentDisplayId: '',
                })}
                style={{
                  flex: 1,
                  padding: '0.5rem 1rem',
                  background: form.assignMode === 'class' ? '#007bff' : '#e9ecef',
                  color: form.assignMode === 'class' ? 'white' : '#495057',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                🏫 全班
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, assignMode: 'individual' })}
                style={{
                  flex: 1,
                  padding: '0.5rem 1rem',
                  background: form.assignMode === 'individual' ? '#007bff' : '#e9ecef',
                  color: form.assignMode === 'individual' ? 'white' : '#495057',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                👤 個人
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: form.assignMode === 'individual' ? '1fr 1fr' : '1fr', gap: '1rem' }}>
              {/* 班級下拉 */}
              <div>
                <label style={{ fontSize: '0.9rem' }}>班級</label>
                <select
                  value={form.classId}
                  onChange={(e) => setForm({
                    ...form,
                    classId: e.target.value,
                    studentDisplayId: '', // 切換班級時重設學生
                  })}
                  style={{ width: '100%', padding: '0.5rem' }}
                >
                  <option value="">請選擇班級</option>
                  {classes.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {classes.length === 0 && (
                  <small style={{ color: '#856404' }}>
                    ⚠️ 尚無班級資料，請先讓學生登入系統
                  </small>
                )}
              </div>

              {/* 學生下拉（僅個人模式） */}
              {form.assignMode === 'individual' && (
                <div>
                  <label style={{ fontSize: '0.9rem' }}>學生</label>
                  <select
                    value={form.studentDisplayId}
                    onChange={(e) => setForm({ ...form, studentDisplayId: e.target.value })}
                    disabled={!form.classId || loadingStudents}
                    style={{ width: '100%', padding: '0.5rem' }}
                  >
                    <option value="">
                      {loadingStudents ? '載入中...' : '請選擇學生'}
                    </option>
                    {students.map(s => (
                      <option key={s.displayId} value={s.displayId}>
                        {s.seatNumber} · {s.name}
                      </option>
                    ))}
                  </select>
                  {form.classId && !loadingStudents && students.length === 0 && (
                    <small style={{ color: '#856404' }}>
                      ⚠️ 此班級尚無學生資料
                    </small>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 目標等級 */}
          <div>
            <label>目標等級</label>
            <select
              value={form.targetLevel ?? ''}
              onChange={(e) => setForm({
                ...form,
                targetLevel: e.target.value ? Number(e.target.value) : undefined,
              })}
              style={{ width: '100%', padding: '0.5rem' }}
            >
              <option value="">不指定（依學生程度自動出題）</option>
              <option value="1">L1</option>
              <option value="2">L2</option>
              <option value="3">L3</option>
              <option value="4">L4</option>
              <option value="5">L5</option>
              <option value="6">L6</option>
            </select>
            <small style={{ color: '#6c757d' }}>
              指定後，出題以該等級為主（60%），混合學生當前等級（30%）
            </small>
          </div>

          {/* 每日題數 */}
          <div>
            <label>每日練習題數</label>
            <input
              type="number"
              value={form.dailyQuota}
              onChange={(e) => setForm({ ...form, dailyQuota: Number(e.target.value) })}
              min={1}
              max={100}
              style={{ width: '100%', padding: '0.5rem' }}
            />
            <small style={{ color: '#6c757d' }}>
              複習題數 K1 = {Math.max(0, form.dailyQuota - Math.floor(form.dailyQuota * form.newRatio))}，
              新詞題數 K2 = {Math.floor(form.dailyQuota * form.newRatio)}
            </small>
            {form.dailyQuota < RECOMMENDED_MIN_QUOTA && (
              <div style={{
                color: '#856404',
                background: '#fff3cd',
                padding: '0.4rem 0.75rem',
                borderRadius: '4px',
                marginTop: '0.4rem',
                fontSize: '0.85rem',
              }}>
                ⚠️ 每日題數低於建議值 {RECOMMENDED_MIN_QUOTA} 題，學生可能無法在合理時間內看到等級變化。
              </div>
            )}
          </div>

          {/* 新字比例 */}
          <div>
            <label>
              新單字比例：{Math.round(form.newRatio * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={form.newRatio}
              onChange={(e) => setForm({ ...form, newRatio: Number(e.target.value) })}
              style={{ width: '100%' }}
            />
          </div>

          {/* 複習專注度 */}
          <div>
            <label>複習專注度</label>
            <select
              value={form.reviewFocus}
              onChange={(e) => setForm({ ...form, reviewFocus: e.target.value as ReviewFocus })}
              style={{ width: '100%', padding: '0.5rem' }}
            >
              <option value="strict">🎯 精準複習（集中打弱點）</option>
              <option value="balanced">⚖️ 均衡練習（系統預設）</option>
              <option value="explore">🎲 廣泛探索（增加變化）</option>
            </select>
            <small style={{ color: '#6c757d' }}>
              影響選題隨機性：精準 5%、均衡 10%、探索 25%
            </small>
          </div>

          {/* 起訖日期 */}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label>開始日期</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                style={{ width: '100%', padding: '0.5rem' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>結束日期</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                style={{ width: '100%', padding: '0.5rem' }}
              />
            </div>
          </div>

          {/* 立即啟用 */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <label>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                style={{ marginRight: '0.5rem' }}
              />
              立即啟用
            </label>
          </div>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button
            type="submit"
            style={{
              padding: '0.5rem 2rem',
              background: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {editingId ? '💾 儲存變更' : '➕ 建立作業'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={handleCancelEdit}
              style={{
                padding: '0.5rem 2rem',
                background: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              取消編輯
            </button>
          )}
        </div>
      </form>

      {/* ============================================================ */}
      {/* 列表 */}
      {/* ============================================================ */}
      <h3>現有作業（{assignments.length}）</h3>
      {assignments.length === 0 ? (
        <p style={{ color: '#6c757d' }}>尚無作業，請於上方建立。</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f1f3f5', textAlign: 'left' }}>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>名稱</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>指派對象</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>目標等級</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>每日題數</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>K1/K2</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>專注度</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>期間</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>狀態</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => {
              const k2 = Math.floor(a.dailyQuota * a.newRatio);
              const k1 = a.dailyQuota - k2;
              const focus = a.reviewFocus ?? 'balanced';
              const personal = isPersonal(a.className);
              return (
                <tr key={a.id} style={{ borderBottom: '1px solid #f1f3f5' }}>
                  <td style={{ padding: '10px' }}><strong>{a.name}</strong></td>
                  <td style={{ padding: '10px', fontSize: '0.85rem' }}>
                    {formatTarget(a.className)}
                    {personal && (
                      <span style={{
                        marginLeft: '0.4rem',
                        background: '#007bff',
                        color: 'white',
                        padding: '1px 6px',
                        borderRadius: '8px',
                        fontSize: '0.7rem',
                      }}>個人</span>
                    )}
                    {!a.className && (
                      <span style={{
                        marginLeft: '0.4rem',
                        background: '#6c757d',
                        color: 'white',
                        padding: '1px 6px',
                        borderRadius: '8px',
                        fontSize: '0.7rem',
                      }}>全校</span>
                    )}
                  </td>
                  <td style={{ padding: '10px' }}>
                    {a.targetLevel ? `L${a.targetLevel}` : '自動'}
                  </td>
                  <td style={{ padding: '10px' }}>{a.dailyQuota}</td>
                  <td style={{ padding: '10px' }}>K1={k1} / K2={k2}</td>
                  <td style={{ padding: '10px' }}>{FOCUS_LABEL[focus]}</td>
                  <td style={{ padding: '10px', fontSize: '0.85rem' }}>
                    {a.startDate.slice(0, 10)} ~ {a.endDate.slice(0, 10)}
                  </td>
                  <td style={{ padding: '10px' }}>
                    <button
                      onClick={() => handleToggleActive(a)}
                      style={{
                        background: a.isActive ? '#28a745' : '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '2px 10px',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      {a.isActive ? '✅ 啟用' : '❌ 停用'}
                    </button>
                  </td>
                  <td style={{ padding: '10px', display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => handleEdit(a)}
                      style={{
                        background: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 12px',
                        cursor: 'pointer',
                      }}
                    >
                      編輯
                    </button>
                    <button
                      onClick={() => handleDelete(a.id)}
                      style={{
                        background: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 12px',
                        cursor: 'pointer',
                      }}
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};