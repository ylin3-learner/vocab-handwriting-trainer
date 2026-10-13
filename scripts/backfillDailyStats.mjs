// scripts/backfillDailyStats.mjs
//
// 用途：為所有學生的歷史 attempts 回填 dailyStats 文件。
//
// 修正重點（相較前一版）：
//   - 迴圈外一次性載入 studentStates，迴圈內用 Map 查，避免 N 次讀取
//   - 用 collectionGroup 一次查出所有已存在的 dailyStats，避免逐筆檢查
//   - 寫入分批（每批 500 筆），避免超過 writeBatch 限制
//   - 加入進度顯示與預估讀取量
//
// 使用方式：
//   node scripts/backfillDailyStats.mjs              # 預覽（不寫入）
//   node scripts/backfillDailyStats.mjs --apply      # 實際寫入
//
// 預估讀取量：
//   - attempts 全部：約 11,400 次
//   - studentStates 全部：約 7 次
//   - 現有 dailyStats（collectionGroup）：約 200 次
//   總計約 11,600 次讀取（Spark 每日 50K 內）

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 工具函式
// ============================================================
function getLocalDate(iso, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log(`\n🔧 回填 dailyStats 文件`);
  console.log(`   模式：${APPLY ? '🔥 實際寫入' : '👀 預覽（不寫入）'}`);
  console.log(`   分批大小：${BATCH_SIZE} 筆\n`);

  // ============================================================
  // 步驟 1：一次性載入所有資料（最小化讀取次數）
  // ============================================================
  console.log('📖 載入資料（一次性）...');

  console.log('   [1/3] 讀取 studentStates...');
  const statesSnap = await db.collection('studentStates').get();
  const stateMap = new Map();
  for (const doc of statesSnap.docs) {
    stateMap.set(doc.id, doc.data());
  }
  console.log(`        共 ${statesSnap.size} 筆`);

  console.log('   [2/3] 讀取 attempts...');
  const attemptsSnap = await db.collection('attempts').get();
  console.log(`        共 ${attemptsSnap.size} 筆`);

  console.log('   [3/3] 讀取現有 dailyStats（collectionGroup）...');
  let existingSet = new Set();
  try {
    const existingSnap = await db.collectionGroup('dailyStats').get();
    for (const doc of existingSnap.docs) {
      // doc.ref.path = "studentStates/{displayId}/dailyStats/{date}"
      const parts = doc.ref.path.split('/');
      if (parts.length >= 4) {
        const displayId = parts[1];
        const date = parts[3];
        existingSet.add(`${displayId}|${date}`);
      }
    }
    console.log(`        共 ${existingSnap.size} 筆已存在`);
  } catch (e) {
    console.warn(`        ⚠️ collectionGroup 查詢失敗：${e.message}`);
    console.warn(`        將跳過「已存在檢查」，所有 dailyStats 都會重建`);
  }

  // ============================================================
  // 步驟 2：按 (displayId, date) 分組
  // ============================================================
  console.log('\n📊 按 (學生, 日期) 分組...');
  const groups = new Map();

  for (const doc of attemptsSnap.docs) {
    const a = doc.data();
    const displayId = a.studentDisplayId;
    if (!displayId) continue;

    // 從 Map 拿學生時區（不呼叫 db.doc().get()）
    const state = stateMap.get(displayId);
    const tz = state?.timeZone ?? 'Asia/Taipei';
    const date = getLocalDate(a.timestamp, tz);

    const key = `${displayId}|${date}`;
    if (!groups.has(key)) {
      groups.set(key, { displayId, date, attempts: [] });
    }
    groups.get(key).attempts.push(a);
  }

  console.log(`   共 ${groups.size} 個 (學生, 日期) 組合`);

  // ============================================================
  // 步驟 3：計算要寫入的資料
  // ============================================================
  console.log('\n🧮 計算要寫入的 dailyStats...');
  const toWrite = [];
  let skipped = 0;

  for (const [key, g] of groups) {
    if (existingSet.has(key)) {
      skipped++;
      continue;
    }

    const answeredCount = g.attempts.length;
    const correctCount = g.attempts.filter(a => a.isCorrect).length;
    const totalResponseTimeMs = g.attempts.reduce(
      (sum, a) => sum + (a.responseTimeMs ?? 0), 0
    );

    toWrite.push({
      displayId: g.displayId,
      date: g.date,
      answeredCount,
      correctCount,
      totalResponseTimeMs,
    });
  }

  console.log(`   需要新建：${toWrite.length} 筆`);
  console.log(`   已存在跳過：${skipped} 筆`);

  // ============================================================
  // 步驟 4：顯示預覽
  // ============================================================
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📋 預覽（前 20 筆）`);
  console.log(`${'═'.repeat(60)}`);

  for (const item of toWrite.slice(0, 20)) {
    console.log(
      `   ${item.displayId} / ${item.date}: ` +
      `${item.answeredCount} 題, ${item.correctCount} 答對, ` +
      `${item.totalResponseTimeMs} ms`
    );
  }
  if (toWrite.length > 20) {
    console.log(`   ...（還有 ${toWrite.length - 20} 筆）`);
  }

  // ============================================================
  // 步驟 5：寫入（分批）
  // ============================================================
  if (!APPLY) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚠️  這是預覽模式，沒有寫入。`);
    console.log(`   確認無誤後執行：`);
    console.log(`   node scripts/backfillDailyStats.mjs --apply`);
    console.log(`${'═'.repeat(60)}\n`);
    return;
  }

  if (toWrite.length === 0) {
    console.log('\n✅ 沒有需要新建的 dailyStats\n');
    return;
  }

  console.log(`\n🗑️  開始寫入 ${toWrite.length} 筆（每批 ${BATCH_SIZE} 筆）...`);

  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
    const chunk = toWrite.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const item of chunk) {
      const ref = db.doc(
        `studentStates/${item.displayId}/dailyStats/${item.date}`
      );
      batch.set(ref, {
        date: item.date,
        answeredCount: item.answeredCount,
        correctCount: item.correctCount,
        totalResponseTimeMs: item.totalResponseTimeMs,
        lastUpdated: new Date().toISOString(),
        backfilled: true,   // 標記為回填資料
      });
    }

    await batch.commit();
    written += chunk.length;

    const pct = ((written / toWrite.length) * 100).toFixed(1);
    console.log(`   已寫入 ${written} / ${toWrite.length}（${pct}%）`);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🎉 完成！`);
  console.log(`   新建：${written} 筆`);
  console.log(`   跳過（已存在）：${skipped} 筆`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌ 執行失敗:', err);
  process.exit(1);
});