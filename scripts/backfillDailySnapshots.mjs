// scripts/backfillDailySnapshots.mjs
//
// 用途：從 dailyStats 重新聚合出每日快照，覆寫錯誤的 dailySnapshots。
//
// 修正重點：
//   - 不讀 attempts（省下 11,400 次讀取）
//   - 改讀 dailyStats（每個學生每天 1 筆，總計約 200 筆）
//   - 只讀 studentStates 補 level 資訊（7 筆）
//   - 總讀取量約 200 次，可在配額內完成
//
// 前提：
//   - dailyStats 已經回填完成（backfillDailyStats.mjs 已跑過）
//   - 若 dailyStats 缺資料，本腳本會跳過該日期
//
// 使用方式：
//   node scripts/backfillDailySnapshots.mjs              # 預覽
//   node scripts/backfillDailySnapshots.mjs --apply      # 實際寫入

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log(`\n🔧 回填 dailySnapshots 文件（從 dailyStats）`);
  console.log(`   模式：${APPLY ? '🔥 實際寫入' : '👀 預覽（不寫入）'}\n`);

  // ============================================================
  // 步驟 1：載入 studentStates（7 筆）——補 level
  // ============================================================
  console.log('📖 [1/2] 讀取 studentStates...');
  const statesSnap = await db.collection('studentStates').get();
  const stateMap = new Map();
  for (const doc of statesSnap.docs) {
    stateMap.set(doc.id, doc.data());
  }
  console.log(`        共 ${statesSnap.size} 筆`);

  // ============================================================
  // 步驟 2：用 collectionGroup 一次讀取所有 dailyStats（~200 筆）
  // ============================================================
  console.log('📖 [2/2] 讀取所有 dailyStats（collectionGroup）...');
  const statsSnap = await db.collectionGroup('dailyStats').get();
  console.log(`        共 ${statsSnap.size} 筆`);

  if (statsSnap.size === 0) {
    console.log('\n⚠️  沒有任何 dailyStats 資料。');
    console.log('   請先執行 backfillDailyStats.mjs：');
    console.log('   node scripts/backfillDailyStats.mjs --apply\n');
    return;
  }

  // ============================================================
  // 步驟 3：轉換成 dailySnapshot 格式
  // ============================================================
  console.log('\n🧮 轉換 dailyStats → dailySnapshots...');

  const toWrite = [];

  for (const doc of statsSnap.docs) {
    // path: studentStates/{displayId}/dailyStats/{date}
    const parts = doc.ref.path.split('/');
    if (parts.length < 4) continue;

    const displayId = parts[1];
    const date = parts[3];
    const stats = doc.data();

    const answeredCount = stats.answeredCount ?? 0;
    if (answeredCount === 0) continue;  // 跳過空資料

    const correctCount = stats.correctCount ?? 0;
    const totalResponseTimeMs = stats.totalResponseTimeMs ?? 0;

    const correctRate = answeredCount > 0
      ? Math.round((correctCount / answeredCount) * 100)
      : 0;

    const avgResponseTimeMs = answeredCount > 0
      ? Math.round(totalResponseTimeMs / answeredCount)
      : 0;

    // 從 studentStates 拿 level
    const state = stateMap.get(displayId);
    const level = state?.currentLevel ?? 1;

    toWrite.push({
      displayId,
      date,
      totalAttempts: answeredCount,
      correctCount,
      correctRate,
      avgResponseTimeMs,
      level,
      capturedAt: stats.lastUpdated ?? new Date().toISOString(),
    });
  }

  console.log(`   轉換完成：${toWrite.length} 筆`);

  // ============================================================
  // 步驟 4：預覽
  // ============================================================
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📋 預覽（依日期排序，前 30 筆）`);
  console.log(`${'═'.repeat(60)}`);

  const sortedPreview = [...toWrite].sort((a, b) =>
    a.date.localeCompare(b.date) || a.displayId.localeCompare(b.displayId)
  );

  for (const item of sortedPreview.slice(0, 30)) {
    console.log(
      `   ${item.date} ${item.displayId}: ` +
      `${item.totalAttempts} 題, ${item.correctCount} 答對, ` +
      `${item.correctRate}%, L${item.level}`
    );
  }
  if (sortedPreview.length > 30) {
    console.log(`   ...（還有 ${sortedPreview.length - 30} 筆）`);
  }

  // ============================================================
  // 步驟 5：寫入
  // ============================================================
  if (!APPLY) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚠️  這是預覽模式，沒有寫入。`);
    console.log(`   確認無誤後執行：`);
    console.log(`   node scripts/backfillDailySnapshots.mjs --apply`);
    console.log(`${'═'.repeat(60)}\n`);
    return;
  }

  if (toWrite.length === 0) {
    console.log('\n✅ 沒有需要寫入的快照\n');
    return;
  }

  console.log(`\n🗑️  開始寫入 ${toWrite.length} 筆（每批 ${BATCH_SIZE} 筆）...`);

  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
    const chunk = toWrite.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const item of chunk) {
      const ref = db.doc(
        `studentStates/${item.displayId}/dailySnapshots/${item.date}`
      );
      batch.set(ref, {
        date: item.date,
        totalAttempts: item.totalAttempts,
        correctCount: item.correctCount,
        correctRate: item.correctRate,
        avgResponseTimeMs: item.avgResponseTimeMs,
        level: item.level,
        capturedAt: item.capturedAt,
        backfilled: true,
      });
    }

    await batch.commit();
    written += chunk.length;

    const pct = ((written / toWrite.length) * 100).toFixed(1);
    console.log(`   已寫入 ${written} / ${toWrite.length}（${pct}%）`);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🎉 完成！共寫入 ${written} 筆`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌ 執行失敗:', err);
  console.error('\n💡 提示：若錯誤為 RESOURCE_EXHAUSTED，');
  console.error('   請等太平洋時間午夜（台北下午 3 點）配額重置後再試。\n');
  process.exit(1);
});