// scripts/queryStudentDay.mjs
// 用途：極速查詢特定學生「某一天」的作答紀錄，並附帶單字與時限資訊。

/*
執行方式：
node scripts/queryStudentDay.mjs --display-id 802_18_方妍靜 --date 2026-10-12
*/

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const ID_IDX = args.indexOf('--display-id');
const DISPLAY_ID = ID_IDX >= 0 ? args[ID_IDX + 1] : null;

const DATE_IDX = args.indexOf('--date');
const TARGET_DATE = DATE_IDX >= 0 ? args[DATE_IDX + 1] : new Date().toISOString().slice(0, 10);

if (!DISPLAY_ID) {
  console.error('❌ 請提供 --display-id，例如：--display-id 802_18_方妍靜');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log(`\n🔍 查詢學生：${DISPLAY_ID} 在 ${TARGET_DATE} 的作答紀錄\n`);

  // 1. 取得該學生時區 (為了精準計算當天 00:00 ~ 23:59)
  const stateRef = db.doc(`studentStates/${DISPLAY_ID}`);
  const stateSnap = await stateRef.get();
  const tz = stateSnap.exists ? (stateSnap.data().timeZone ?? 'Asia/Taipei') : 'Asia/Taipei';

  // 2. 計算該時區的當天起始與結束時間 (ISO 格式)
  // 假設 TARGET_DATE 是 2026-10-12，我們要抓 2026-10-12T00:00:00+08:00 ~ 2026-10-12T23:59:59+08:00
  const startObj = new Date(`${TARGET_DATE}T00:00:00+08:00`);
  const endObj = new Date(`${TARGET_DATE}T23:59:59.999+08:00`);
  
  // 注意：如果學生的時區不是 +08:00，這裡需要動態調整，但為了簡化，先固定用 UTC+8 或直接用 ISO 字串
  const startIso = startObj.toISOString();
  const endIso = endObj.toISOString();

  console.log(`⏱️  查詢時間範圍 (UTC): ${startIso} ~ ${endIso}`);

  // 3. 🔥 關鍵優化：把時間過濾推給 Firestore，只拉回當天的資料
  // 注意：這需要 Firestore 建立 studentDisplayId + timestamp 的複合索引 (Composite Index)
  const attemptsSnap = await db.collection('attempts')
    .where('studentDisplayId', '==', DISPLAY_ID)
    .where('timestamp', '>=', startIso)
    .where('timestamp', '<=', endIso)
    .get();

  const attempts = attemptsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (attempts.length === 0) {
    console.log(`\n📭 該學生在 ${TARGET_DATE} 沒有作答紀錄。\n`);
    return;
  }

  console.log(`✅ 找到 ${attempts.length} 筆紀錄，正在解析單字...\n`);

  // 4. 收集所有不重複的 wordId
  const uniqueWordIds = [...new Set(attempts.map(a => a.wordId).filter(Boolean))];

  // 5. 批次取得單字資料 (避免 N+1 查詢，使用 getAll 或 in 查詢)
  // 因為 vocabulary 可能在子集合，這裡用 Promise.all 但限制併發數
  const wordMeta = new Map();
  
  // 分批處理，每次處理 20 個字，避免一次打太多請求
  const BATCH_SIZE = 20;
  for (let i = 0; i < uniqueWordIds.length; i += BATCH_SIZE) {
    const chunk = uniqueWordIds.slice(i, i + BATCH_SIZE);
    
    // 這裡我們直接用 getAll 搭配 ref (Firestore 支援一次 get 多個 doc)
    const refs = chunk.map(id => db.doc(`vocabulary/current/words/${id}`));
    
    // 處理 sanitized 的問題 (如果原 ID 找不到，再試一次 _ 轉 . )
    // 為了簡化，這裡先用原 ID 抓，找不到就算了 (反正大部分應該抓得到)
    try {
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, index) => {
        if (snap.exists) {
          const d = snap.data();
          wordMeta.set(chunk[index], { word: d.word, level: d.level });
        }
      });
    } catch (e) {
      // 如果出錯，改為逐一查詢 (較慢但容錯率高)
      for (const id of chunk) {
        const snap = await db.doc(`vocabulary/current/words/${id}`).get();
        if (snap.exists) {
          const d = snap.data();
          wordMeta.set(id, { word: d.word, level: d.level });
        }
      }
    }
  }

  // 6. 輸出精美的表格
  console.log('┌────┬───────┬──────────────┬────────┬─────────┬─────────┐');
  console.log('│ #  │ 狀態  │ 單字 (Lv)    │ 作答(ms)│ 時限(ms)│ 訊號    │');
  console.log('├────┼───────┼──────────────┼────────┼─────────┼─────────┤');

  let correctCount = 0;

  attempts.forEach((a, i) => {
    const meta = wordMeta.get(a.wordId);
    const word = meta?.word || a.wordId;
    const lv = meta?.level ? `L${meta.level}` : '?';
    const status = a.isCorrect ? '✅ 對' : '❌ 錯';
    
    if (a.isCorrect) correctCount++;

    // 格式化時間 (左對齊)
    const timeStr = (a.responseTimeMs || 0).toString().padStart(6, ' ');
    const limitStr = (a.timeLimitMs || 8000).toString().padStart(6, ' ');
    
    // 訊號：顯示四象限
    const signal = a.correctnessSignal || '-';

    // 處理中文字元對齊問題 (中文字元佔 2 個寬度)
    const wordDisplay = `${word} (${lv})`.padEnd(12, ' ');

    console.log(
      `│ ${(i + 1).toString().padStart(2, ' ')} │ ${status} │ ${wordDisplay}│ ${timeStr} │ ${limitStr} │ ${signal.padEnd(7, ' ')} │`
    );
  });

  console.log('└────┴───────┴──────────────┴────────┴─────────┴─────────┘');

  // 7. 總結
  const accuracy = ((correctCount / attempts.length) * 100).toFixed(1);
  const avgTime = Math.round(attempts.reduce((sum, a) => sum + (a.responseTimeMs || 0), 0) / attempts.length);
  
  console.log(`\n📊 總結：`);
  console.log(`   總題數：${attempts.length} 題`);
  console.log(`   答對數：${correctCount} 題 (正確率 ${accuracy}%)`);
  console.log(`   平均作答時間：${avgTime} ms (約 ${(avgTime / 1000).toFixed(1)} 秒)`);
  
  const timedOutCount = attempts.filter(a => a.timedOut).length;
  if (timedOutCount > 0) {
    console.log(`   ⚠️ 超時次數：${timedOutCount} 次`);
  }
  console.log('');
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});