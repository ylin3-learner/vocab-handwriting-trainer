// src/features/dashboard/AssignmentManager.tsx
import React, { useState, useEffect } from 'react';
import { AssignmentService, Assignment, ReviewFocus } from '../../services/assignment/AssignmentService';

const service = new AssignmentService();

interface FormState {
  name: string;
  className: string;
  wordScope: string;
  dailyQuota: number;
  newRatio: number;
  reviewFocus: ReviewFocus;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  className: '',
  wordScope: '全部',
  dailyQuota: 30,
  newRatio: 0.3,
  reviewFocus: 'balanced', // 👈 修正：原本漏掉這個欄位
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  isActive: true,
});

// 專注度對應的顯示文字
const FOCUS_LABEL: Record<ReviewFocus, string> = {
  strict: '🎯 精準複習',
  balanced: '⚖️ 均衡練習',
  explore: '🎲 廣泛探索',
};

export const AssignmentManager: React.FC = () => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [status, setStatus] = useState('');

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

  useEffect(() => {
    loadAssignments();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setStatus('❌ 請輸入作業名稱');
      return;
    }

    const payload = {
      name: form.name.trim(),
      className: form.className.trim() || null,
      wordScope: form.wordScope,
      dailyQuota: form.dailyQuota,
      newRatio: form.newRatio,
      reviewFocus: form.reviewFocus, // 👈 新增
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
    setForm({
      name: a.name,
      className: a.className || '',
      wordScope: a.wordScope,
      dailyQuota: a.dailyQuota,
      newRatio: a.newRatio,
      reviewFocus: a.reviewFocus ?? 'balanced', // 👈 新增（舊資料預設 balanced）
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
        建立作業後，學生登入時會依班級自動讀取對應的配額與新舊字比例。
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

      {/* 表單 */}
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
          <div>
            <label>作業名稱 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="例如：Unit 1 基礎單字"
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>

          <div>
            <label>班級（留空 = 全校通用）</label>
            <input
              type="text"
              value={form.className}
              onChange={(e) => setForm({ ...form, className: e.target.value })}
              placeholder="例如：701"
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>

          <div>
            <label>單字範圍</label>
            <select
              value={form.wordScope}
              onChange={(e) => setForm({ ...form, wordScope: e.target.value })}
              style={{ width: '100%', padding: '0.5rem' }}
            >
              <option value="全部">全部單字</option>
              <option value="level:A1">A1 等級</option>
              <option value="level:A2">A2 等級</option>
              <option value="category:Food">食物類</option>
              <option value="category:People">人物類</option>
            </select>
          </div>

          <div>
            <label>每日練習題數（dailyQuota）</label>
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
          </div>

          <div>
            <label>
              新單字比例（newRatio）：{Math.round(form.newRatio * 100)}%
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

          {/* 👇 新增：複習專注度 */}
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

      {/* 列表 */}
      <h3>現有作業（{assignments.length}）</h3>
      {assignments.length === 0 ? (
        <p style={{ color: '#6c757d' }}>尚無作業，請於上方建立。</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f1f3f5', textAlign: 'left' }}>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>名稱</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>班級</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>每日題數</th>
              <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>新字比例</th>
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
              return (
                <tr key={a.id} style={{ borderBottom: '1px solid #f1f3f5' }}>
                  <td style={{ padding: '10px' }}><strong>{a.name}</strong></td>
                  <td style={{ padding: '10px' }}>{a.className || '全校'}</td>
                  <td style={{ padding: '10px' }}>{a.dailyQuota}</td>
                  <td style={{ padding: '10px' }}>{Math.round(a.newRatio * 100)}%</td>
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