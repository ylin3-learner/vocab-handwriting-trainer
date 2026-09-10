// src/features/admin/AdminPanel.tsx
import React, { useState, useCallback } from 'react';
import * as ExcelJS from 'exceljs';
import { collection, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import { Word } from '../../types/word';

const REQUIRED_FIELDS = ['word', 'meaning', 'sentence'];
const OPTIONAL_FIELDS = ['root', 'root_meaning', 'hint', 'level'];
const ALLOWED_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

interface ValidationError {
    row: number;
    field: string;
    message: string;
}

// 🔥 安全化 docId：Firestore 不允許 `/`，且長度限制 1500 bytes
function sanitizeDocId(word: string): string {
    return word.trim().replace(/\//g, '_');
}

export const AdminPanel: React.FC = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [password, setPassword] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [previewData, setPreviewData] = useState<Word[]>([]);
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [publishStatus, setPublishStatus] = useState<string>('');

    const ADMIN_PASSWORD = 'admin456';

    const handleLogin = () => {
        if (password === ADMIN_PASSWORD) {
            setIsAuthenticated(true);
            setPassword('');
        } else {
            alert('❌ 管理員密碼錯誤');
        }
    };

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
            if (header && ALLOWED_FIELDS.includes(header)) {
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
                if (REQUIRED_FIELDS.includes(field) && !value) {
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

        if (!window.confirm(`確定要發布 ${previewData.length} 筆單字到資料庫嗎？`)) {
            return;
        }

        setIsLoading(true);
        setPublishStatus(`⏳ 準備寫入 ${previewData.length} 筆資料...`);

        try {
            const BATCH_SIZE = 500;
            const allWords = previewData.map(word =>
                Object.fromEntries(
                    Object.entries(word).filter(([_, value]) => value !== undefined)
                )
            );

            let totalCommitted = 0;

            for (let i = 0; i < allWords.length; i += BATCH_SIZE) {
                const batch = writeBatch(db);
                const chunk = allWords.slice(i, i + BATCH_SIZE);

                for (const word of chunk) {
                    // 🔥 關鍵修正：用 word 欄位當作 document ID
                    const wordId = sanitizeDocId(String(word.word || ''));
                    if (!wordId) continue;

                    const draftDocRef = doc(db, 'vocabulary', 'draft', 'words', wordId);
                    const currentDocRef = doc(db, 'vocabulary', 'current', 'words', wordId);
                    batch.set(draftDocRef, word);
                    batch.set(currentDocRef, word);
                }

                await batch.commit();
                totalCommitted += chunk.length;
                setPublishStatus(`✅ 已寫入 ${totalCommitted}/${allWords.length} 筆`);
            }

            const version = new Date().toISOString().slice(0, 10);
            await setDoc(doc(db, 'vocabulary', 'metadata'), {
                currentVersion: version,
                lastUpdated: new Date().toISOString(),
                wordCount: allWords.length,
            });

            setPublishStatus(`✅ 成功發布 ${allWords.length} 筆單字 (版本 ${version})`);
            setPreviewData([]);
            setFile(null);
        } catch (error) {
            console.error('發布失敗:', error);
            setPublishStatus('❌ 發布失敗，請查看控制台錯誤訊息');
        } finally {
            setIsLoading(false);
        }
    };

    if (!isAuthenticated) {
        return (
            <div style={{ maxWidth: '400px', margin: '4rem auto', padding: '2rem', background: '#f8f9fa', borderRadius: '8px' }}>
                <h2>🔐 管理員專用</h2>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                    <input
                        type="password"
                        placeholder="請輸入管理員密碼"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                        style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                    <button onClick={handleLogin} style={{ padding: '0.5rem 1.5rem', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                        進入
                    </button>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#6c757d', marginTop: '1rem' }}>
                    * 此密碼與教師後台密碼不同
                </p>
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
                    {isLoading ? '解析中...' : '支援 .xlsx, .xls, .csv 格式'}
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
                            {isLoading ? '處理中...' : '🚀 發布至資料庫'}
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