// scripts/estimateStorage.mjs
// 用途：精準計算 Firestore 儲存容量，並分析各欄位的佔用比例，預估何時會達到 1 GiB 上限。

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// 輔助函數：計算字串的 UTF-8 字節數
function getStringBytes(str) {
  if (!str) return 0;
  return Buffer.byteLength(str, 'utf8');
}

// 輔助函數：遞迴計算物件或陣列的大小
function calculateValueSize(value) {
  if (value === null || value === undefined) return 1;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8; // Firestore 數字佔 8 bytes
  if (typeof value === 'string') return getStringBytes(value) + 1; // 字串 + 1 byte 結尾
  if (value instanceof Date) return 8;
  
  if (Array.isArray(value)) {
    let size = 0;
    for (const item of value) {
      size += calculateValueSize(item);
      size += 8; // 陣列每個元素的索引開銷 (Approximate)
    }
    return size + 16; // 陣列基本開銷
  }
  
  if (typeof value === 'object') {
    let size = 0;
    for (const [key, val] of Object.entries(value)) {
      size += getStringBytes(key) + 1; // 欄位名稱大小
      size += calculateValueSize(val);
    }
    return size + 16; // Map 基本開銷
  }
  return 0;
}

// 計算整份 Document 的大小
function calculateDocumentSize(docId, data) {
  let size = 48; // 每個 Document 的基本開銷
  size += getStringBytes(docId) + 1; // Document ID 大小
  size += calculateValueSize(data);
  // Firestore 會為每個單一欄位建立索引，大約每個欄位多加 32 bytes 索引開銷
  // 這裡做個保守估計，大約乘上 1.2 倍
  return Math.round(size * 1.2);
}

async function main() {
  console.log('📊 開始分析 Firestore 儲存容量...\n');

  const attemptsRef = db.collection('attempts');
  
  // 🔥 注意：為了避免消耗你的讀取配額，我們只抽樣前 100 筆
  // 如果你想要完整計算，請將 limit(100) 拿掉，但這會消耗大量讀取額度！
  const snapshot = await attemptsRef.limit(100).get();
  
  if (snapshot.empty) {
    console.log('📭 沒有找到任何資料。');
    return;
  }

  let totalSize = 0;
  let largestDoc = { id: '', size: 0, data: null };
  const fieldSizes = {}; // 統計各欄位的總大小

  snapshot.forEach(doc => {
    const data = doc.data();
    const docSize = calculateDocumentSize(doc.id, data);
    totalSize += docSize;

    if (docSize > largestDoc.size) {
      largestDoc = { id: doc.id, size: docSize, data };
    }

    for (const [key, val] of Object.entries(data)) {
      if (!fieldSizes[key]) fieldSizes[key] = 0;
      fieldSizes[key] += calculateValueSize(val);
    }
  });

  const sampleCount = snapshot.size;
  const avgDocSize = Math.round(totalSize / sampleCount);

  console.log(`✅ 抽樣分析完成（共 ${sampleCount} 筆紀錄）`);
  console.log(`📦 平均每筆紀錄大小：${avgDocSize.toLocaleString()} bytes (約 ${(avgDocSize / 1024).toFixed(2)} KB)\n`);

  console.log('🔍 各欄位容量佔用分析 (Top 5)：');
  const sortedFields = Object.entries(fieldSizes).sort((a, b) => b[1] - a[1]);
  sortedFields.slice(0, 5).forEach(([key, size]) => {
    const percentage = ((size / totalSize) * 100).toFixed(1);
    const avgSize = Math.round(size / sampleCount);
    console.log(`   - ${key}: 佔用 ${percentage}% (平均每筆 ${avgSize.toLocaleString()} bytes)`);
  });

  console.log(`\n⚠️ 最大的一筆 Document ID: ${largestDoc.id} (大小: ${largestDoc.size.toLocaleString()} bytes)`);
  console.log(`   如果單筆超過 1,048,576 bytes (1 MiB)，Firestore 會直接報錯拒絕寫入！\n`);

  // 預估達到上限的時間
  const TOTAL_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GiB
  const currentDocCount = sampleCount; // 假設你目前只有這些，請根據實際情況修改
  // 🔥 請在這裡填入你目前 Firestore 中 attempts 的「真實總筆數」
  const REAL_TOTAL_DOCS = 15836; 

  const estimatedCurrentUsage = avgDocSize * REAL_TOTAL_DOCS;
  const remainingBytes = TOTAL_LIMIT_BYTES - estimatedCurrentUsage;

  console.log('📈 容量預估：');
  console.log(`   - 假設目前系統總共有 ${REAL_TOTAL_DOCS.toLocaleString()} 筆作答紀錄`);
  console.log(`   - 預估目前已用容量：${(estimatedCurrentUsage / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - 距離 1 GiB 上限剩餘：${(remainingBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - 預估還能容納：${Math.floor(remainingBytes / avgDocSize).toLocaleString()} 筆紀錄\n`);

  // 如果加入每日練習量預估
  const DAILY_ATTEMPTS = 7 * 50; // 假設 7 人每天各寫 50 題
  const daysLeft = Math.floor((remainingBytes / avgDocSize) / DAILY_ATTEMPTS);
  console.log(`⏳ 如果每天新增約 ${DAILY_ATTEMPTS} 筆紀錄，大約還可以用 ${daysLeft} 天。`);
}

main().catch(console.error);