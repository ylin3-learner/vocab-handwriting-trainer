// src/features/admin/AdminPanel.tsx
import React, { useState, useCallback } from 'react';
import * as ExcelJS from 'exceljs';
import { collection, doc, setDoc, writeBatch, getDocs } from 'firebase/firestore'; // 🔥 新增 getDocs
import { db } from '../../firebase';
import { Word } from '../../types/word';
import { useAuth } from '../../contexts/AuthContext';
import { REQUIRED_FIELDS, OPTIONAL_FIELDS, ALLOWED_FIELDS } from '../../domain/validation/wordSchema';

// 建立 Set 來進行快速且型別安全的檢查
const ALLOWED_FIELDS_SET = new Set<string>(ALLOWED_FIELDS);
const REQUIRED_FIELDS_SET = new Set<string>(REQUIRED_FIELDS);

interface ValidationError {
    row: number;
    field: string;
    message: string;
}

// 安全化 docId：Firestore 不允許 `/`，且長度限制 1500 bytes
function sanitizeDocId(word: string): string {
    return word.trim().replace(/\//g, '_');
}

export const AdminPanel: React.FC = () => {
    const { role, loading: authLoading } = useAuth();

    const [file, setFile] = useState<File | null>(null);
    const [previewData, setPreviewData] = useState<Word[]>([]);
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [publishStatus, setPublishStatus] = useState<string>('');

    // ===== 手動解析 CSV =====
    const parseCSV = (csvText: string): { headers: string[]; rows: string[][] } => {
        const lines = csvText.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        if (lines.length === 0) {
            throw new Error('CSV 檔案為空');
        }

        const headerLine = lines[0];
        if (!headerLine) {
            throw new Error('CSV 標題列為空');
        }
        const headers = headerLine.split(',').map(h => h.replace(/^"|"$/g, '').trim());

        const rows = lines.slice(1).map(line => {
            return line.split(',').map(cell => cell.replace(/^"|"$/g, '').trim());
        });

        return { headers, rows };
    };

    // ===== 主解析函式（支援 CSV 與 XLSX） =====
    const parseExcelFile = useCallback(async (file: File): Promise<Word[]> => {
        const buffer = await file.arrayBuffer();
        const fileExt = file.name.split('.').pop()?.toLowerCase();

        let headers: string[] = [];
        let dataRows: string[][] = [];

        if (fileExt === 'csv') {
            const decoder = new TextDecoder('utf-8');
            const csvText = decoder.decode(buffer);
            const parsed = parseCSV(csvText);
            headers = parsed.headers;
            dataRows = parsed.rows;
        } else {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.getWorksheet(1);
            if (!worksheet) {
                throw new Error('檔案中找不到工作表 (Sheet)');
            }

            const headerValues: string[] = [];
            const headerRow = worksheet.getRow(1);
            headerRow.eachCell((cell) => {
                const value = String((cell.value as any) || '').trim();
                if (value) headerValues.push(value);
            });
            headers = headerValues;

            const rowDataList: string[][] = [];
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const rowData: string[] = [];
                row.eachCell((cell) => {
                    rowData.push(String((cell.value as any) || '').trim());
                });
                if (rowData.some(cell => cell !== '')) {
                    rowDataList.push(rowData);
                }
            });
            dataRows = rowDataList;
        }

        const missingHeaders = REQUIRED_FIELDS.filter(
            field => !headers.includes(field)
        );
        if (missingHeaders.length > 0) {
            throw new Error(`缺少必填欄位: ${missingHeaders.join(', ')}`);
        }

        const columnMap: Record<string, number> = {};
        headers.forEach((header, index) => {
            if (header && ALLOWED_FIELDS_SET.has(header)) {
                columnMap[header] = index;
            }
        });

        const results: Word[] = [];
        const errors: ValidationError[] = [];

        dataRows.forEach((row, rowIndex) => {
            const rowNumber = rowIndex + 2;
            const word: Partial<Word> = {};
            let hasData = false;

            for (const [field, colIndex] of Object.entries(columnMap)) {
                const value = row[colIndex] || '';
                if (REQUIRED_FIELDS_SET.has(field) && !value) {
                    errors.push({
                        row: rowNumber,
                        field,
                        message: `第 ${rowNumber} 列缺少 "${field}" 欄位`,
                    });
                    continue;
                }

                if (value) {
                    hasData = true;
                    if (field === 'level' && !isNaN(Number(value))) {
                        (word as any)[field] = String(value);
                    } else if (field === 'root_meaning') {
                        word.rootMeaning = value;
                    } else {
                        (word as any)[field] = value;
                    }
                }
            }

            if (hasData && word.word) {
                results.push({
                    id: word.word as string,
                    word: word.word as string,
                    meaning: word.meaning as string || '',
                    sentence: word.sentence as string || '',
                    root: word.root as string | undefined,
                    rootMeaning: word.rootMeaning as string | undefined,
                    hint: word.hint as string | undefined,
                    level: word.level as string | undefined,
                });
            }
        });

        // 檢查重複單字
        const wordSet = new Set<string>();
        const duplicateWords: string[] = [];
        for (const item of results) {
            const lower = item.word.toLowerCase();
            if (wordSet.has(lower)) {
                duplicateWords.push(item.word);
            }
            wordSet.add(lower);
        }

        if (duplicateWords.length > 0) {
            errors.push({
                row: 0,
                field: 'word',
                message: `發現重複單字: ${duplicateWords.join(', ')} (請檢查)`,
            });
        }

        if (errors.length > 0) {
            setValidationErrors(errors);
            throw new Error('資料驗證失敗，請修正後重新上傳');
        }

        setValidationErrors([]);
        return results;
    }, []);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
            alert('❌ 請上傳 .xlsx, .xls 或 .csv 檔案');
            return;
        }

        setFile(file);
        setIsLoading(true);
        setPreviewData([]);
        setPublishStatus('');

        try {
            const data = await parseExcelFile(file);
            setPreviewData(data);
            setPublishStatus(`✅ 成功解析 ${data.length} 筆單字，請確認預覽資料`);
        } catch (error) {
            const message = error instanceof Error ? error.message : '解析失敗';
            setPublishStatus(`❌ ${message}`);
            setPreviewData([]);
        } finally {
            setIsLoading(false);
        }
    };

        const handlePublish = async () => {
        if (previewData.length === 0) {
            alert('沒有可發布的資料');
            return;
        }

        const oldCount = await (async () => {
            try {
                const snap = await getDocs(collection(db, 'vocabulary', 'current', 'words'));
                return snap.docs.length;
            } catch {
                return -1;
            }
        })();

        const confirmMsg = oldCount >= 0
            ? `確定要發布 ${previewData.length} 筆單字嗎？\n\n` +
              `此操作會：\n` +
              `1. 刪除現有 ${oldCount} 筆舊單字\n` +
              `2. 寫入 ${previewData.length} 筆新單字\n\n` +
              `⚠️ 為避免觸發 Firestore 配額限制，每批次之間會延遲 1 秒。\n` +
              `預估耗時：${Math.ceil((oldCount + previewData.length) / 400) * 1.5} 秒`
            : `確定要發布 ${previewData.length} 筆單字嗎？`;

        if (!window.confirm(confirmMsg)) {
            return;
        }

        setIsLoading(true);
        setPublishStatus(`⏳ 準備清理舊版單字庫...`);

        // 🔥 可調整參數
        const BATCH_SIZE = 400;             // 批次大小（Firestore 上限 500，留緩衝）
        const DELAY_MS = 1000;              // 每批次之間延遲（毫秒）
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        try {
            const allWords = previewData.map(word =>
                Object.fromEntries(
                    Object.entries(word).filter(([_, value]) => value !== undefined)
                )
            );

            // ============================================================
            // 步驟 1：批次刪除舊文件（含延遲）
            // ============================================================
            const currentWordsRef = collection(db, 'vocabulary', 'current', 'words');
            const currentSnapshot = await getDocs(currentWordsRef);

            if (!currentSnapshot.empty) {
                const totalDeleteBatches = Math.ceil(currentSnapshot.docs.length / BATCH_SIZE);
                setPublishStatus(`⏳ 正在刪除 ${currentSnapshot.docs.length} 筆舊單字（共 ${totalDeleteBatches} 批）...`);

                for (let i = 0; i < currentSnapshot.docs.length; i += BATCH_SIZE) {
                    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
                    const deleteBatch = writeBatch(db);
                    const chunk = currentSnapshot.docs.slice(i, i + BATCH_SIZE);
                    chunk.forEach((doc) => deleteBatch.delete(doc.ref));

                    try {
                        await deleteBatch.commit();
                    } catch (e) {
                        throw new Error(`刪除第 ${batchNumber}/${totalDeleteBatches} 批失敗（已刪除 ${i} 筆）: ${e instanceof Error ? e.message : '未知錯誤'}`);
                    }

                    setPublishStatus(`🗑️ 刪除進度 ${batchNumber}/${totalDeleteBatches}（${Math.min(i + BATCH_SIZE, currentSnapshot.docs.length)}/${currentSnapshot.docs.length} 筆）`);

                    // 🔥 批次之間延遲
                    if (i + BATCH_SIZE < currentSnapshot.docs.length) {
                        await sleep(DELAY_MS);
                    }
                }
                console.log(`✅ 已清空 ${currentSnapshot.docs.length} 筆舊單字`);
            } else {
                console.log('ℹ️ 舊單字庫為空，跳過刪除步驟');
            }

            // ============================================================
            // 步驟 2：批次寫入新資料（含延遲）
            // ============================================================
            const totalWriteBatches = Math.ceil(allWords.length / BATCH_SIZE);
            setPublishStatus(`⏳ 準備寫入 ${allWords.length} 筆新資料（共 ${totalWriteBatches} 批）...`);

            let totalCommitted = 0;
            for (let i = 0; i < allWords.length; i += BATCH_SIZE) {
                const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
                const batch = writeBatch(db);
                const chunk = allWords.slice(i, i + BATCH_SIZE);

                for (const word of chunk) {
                    const wordId = sanitizeDocId(String(word.word || ''));
                    if (!wordId) continue;

                    const currentDocRef = doc(db, 'vocabulary', 'current', 'words', wordId);
                    batch.set(currentDocRef, word);
                }

                try {
                    await batch.commit();
                } catch (e) {
                    throw new Error(`寫入第 ${batchNumber}/${totalWriteBatches} 批失敗（已寫入 ${totalCommitted} 筆）: ${e instanceof Error ? e.message : '未知錯誤'}`);
                }

                totalCommitted += chunk.length;
                setPublishStatus(`📝 寫入進度 ${batchNumber}/${totalWriteBatches}（${totalCommitted}/${allWords.length} 筆）`);

                // 🔥 批次之間延遲
                if (i + BATCH_SIZE < allWords.length) {
                    await sleep(DELAY_MS);
                }
            }

            // ============================================================
            // 步驟 3：更新 metadata 版本號
            // ============================================================
            setPublishStatus(`⏳ 更新版本資訊...`);
            const version = new Date().toISOString().slice(0, 10);
            await setDoc(doc(db, 'vocabulary', 'metadata'), {
                currentVersion: version,
                lastUpdated: new Date().toISOString(),
                wordCount: allWords.length,
            });

            setPublishStatus(`✅ 成功發布 ${allWords.length} 筆單字（版本 ${version}）`);
            setPreviewData([]);
            setFile(null);
        } catch (error) {
            console.error('❌ 發布失敗:', error);
            const message = error instanceof Error ? error.message : '未知錯誤';
            setPublishStatus(`❌ 發布失敗：${message}`);
            alert(`發布失敗：\n\n${message}\n\n請等待配額重置後再試，或改用 Admin SDK 腳本。`);
        } finally {
            setIsLoading(false);
        }
    };

    // 🔥 根據 AuthContext 的狀態顯示對應畫面
    if (authLoading) {
        return (
            <div style={{ textAlign: 'center', padding: '4rem' }}>
                <h2>⏳ 驗證身份中...</h2>
            </div>
        );
    }

    if (role !== 'admin') {
        return (
            <div style={{ maxWidth: '400px', margin: '4rem auto', padding: '2rem', background: '#f8f9fa', borderRadius: '8px', textAlign: 'center' }}>
                <h2>🚫 權限不足</h2>
                <p style={{ color: '#6c757d' }}>此頁面僅限管理員存取。</p>
                <p style={{ color: '#6c757d', fontSize: '0.9rem' }}>請確認您已使用管理員帳號登入。</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '2rem auto', padding: '1rem' }}>
            <h1>📂 單字庫管理</h1>
            <p style={{ color: '#6c757d' }}>上傳 Excel（.xlsx）或 CSV（.csv）檔案，系統會自動驗證欄位並提供預覽</p>

            <div style={{ border: '2px dashed #ccc', padding: '2rem', textAlign: 'center', borderRadius: '8px', margin: '1rem 0' }}>
                <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    disabled={isLoading}
                    style={{ fontSize: '1rem' }}
                />
                <p style={{ fontSize: '0.9rem', color: '#6c757d', marginTop: '0.5rem' }}>
                    {isLoading ? '處理中...' : '支援 .xlsx, .xls, .csv 格式'}
                </p>
            </div>

            {publishStatus && (
                <div style={{ padding: '1rem', margin: '1rem 0', background: publishStatus.includes('✅') ? '#d4edda' : '#f8d7da', borderRadius: '4px' }}>
                    {publishStatus}
                </div>
            )}

            {validationErrors.length > 0 && (
                <div style={{ background: '#fff3cd', padding: '1rem', borderRadius: '4px', margin: '1rem 0' }}>
                    <h4>⚠️ 資料驗證問題</h4>
                    <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                        {validationErrors.map((err, i) => (
                            <li key={i}>{err.message}</li>
                        ))}
                    </ul>
                </div>
            )}

            {previewData.length > 0 && (
                <>
                    <h3>📊 預覽 ({previewData.length} 筆)</h3>
                    <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: '4px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa' }}>
                                <tr>
                                    <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>#</th>
                                    <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>單字</th>
                                    <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>中文</th>
                                    <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>例句</th>
                                    <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>字根</th>
                                    <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>等級</th>
                                </tr>
                            </thead>
                            <tbody>
                                {previewData.map((word, index) => (
                                    <tr key={index}>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6' }}>{index + 1}</td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6' }}><strong>{word.word}</strong></td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6' }}>{word.meaning}</td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6' }}>{word.sentence}</td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6' }}>{word.root || '-'}</td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6' }}>{word.level || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ marginTop: '1rem' }}>
                        <button
                            onClick={handlePublish}
                            disabled={isLoading || validationErrors.length > 0}
                            style={{
                                padding: '0.75rem 2rem',
                                background: (isLoading || validationErrors.length > 0) ? '#6c757d' : '#28a745',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '1rem',
                                cursor: (isLoading || validationErrors.length > 0) ? 'default' : 'pointer',
                            }}
                        >
                            {isLoading ? '處理中...' : '🚀 發布至資料庫（覆蓋舊版）'}
                        </button>
                        <button
                            onClick={() => {
                                setPreviewData([]);
                                setFile(null);
                                setValidationErrors([]);
                                setPublishStatus('');
                            }}
                            style={{ marginLeft: '1rem', padding: '0.75rem 2rem', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            取消
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};