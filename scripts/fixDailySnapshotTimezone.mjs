// scripts/fixDailySnapshotTimezone.mjs
//
// 用途：修正 dailySnapshots 的 date 欄位時區錯誤。
//
// 執行：
//   node scripts/fixDailySnapshotTimezone.mjs          # 預覽
//   node scripts/fixDailySnapshotTimezone.mjs --apply  # 實際寫入
//
// 策略：
//   對每一筆 dailySnapshot，用 capturedAt（準確 UTC）反推正確的台北日期。
//   若與現有 date 不同，則：
//     - 若目標日期沒有其他快照 → 搬移
//     - 若目標日期已有快照 → 標記衝突，跳過（需人工處理）

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function getTaipeiDateString(utcDateString) {
  const ms = new Date(utcDateString).getTime() + TAIPEI_OFFSET_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

async function main() {
  console.log(`\n🔧 修正 dailySnapshots 時區`);
  console.log(`   模式：${APPLY ? '🔥 實際寫入' : '👀 預覽'}\n`);

  const statesSnap = await db.collection('studentStates').get();
  console.log(`   找到 ${statesSnap.docs.length} 位學生\n`);

  const conflicts = [];
  const toFix = [];

  for (const stateDoc of statesSnap.docs) {
    const displayId = stateDoc.id;
    const snapshotsSnap = await db
      .collection('studentStates', displayId, 'dailySnapshots')
      .get();

    if (snapshotsSnap.empty) continue;

    for (const snapDoc of snapshotsSnap.docs) {
      const data = snapDoc.data();
      const currentDate = data.date;
      const capturedAt = data.capturedAt;

      if (!capturedAt) continue;

      const correctDate = getTaipeiDateString(capturedAt);

      if (correctDate === currentDate) continue;

      // 檢查目標日期是否已有快照
      const targetExists = snapshotsSnap.docs.find(
        d => d.data().date === correctDate
      );

      if (targetExists) {
        conflicts.push({
          displayId,
          currentDate,
          correctDate,
          capturedAt,
        });
      } else {
        toFix.push({
          displayId,
          docId: snapDoc.id,
          currentDate,
          correctDate,
          capturedAt,
          data,
        });
      }
    }
  }

  console.log(`📋 可自動修正：${toFix.length} 筆`);
  console.log(`⚠️  衝突（需人工處理）：${conflicts.length} 筆\n`);

  if (toFix.length > 0) {
    console.log('修正清單：');
    toFix.slice(0, 20).forEach(f => {
      console.log(`  ${f.displayId}  ${f.currentDate} → ${f.correctDate}  (capturedAt: ${f.capturedAt})`);
    });
    if (toFix.length > 20) console.log(`  ...還有 ${toFix.length - 20} 筆`);
  }

  if (conflicts.length > 0) {
    console.log('\n衝突清單（需人工判斷）：');
    conflicts.forEach(c => {
      console.log(`  ${c.displayId}  現有 ${c.currentDate} → 應為 ${c.correctDate}  (但該日已有快照)`);
    });
  }

  if (!APPLY) {
    console.log('\n⚠️ 預覽模式，未寫入。確認後執行 --apply\n');
    return;
  }

  if (toFix.length === 0) {
    console.log('\n✅ 無需修正\n');
    return;
  }

  console.log(`\n🔥 開始寫入 ${toFix.length} 筆...`);
  let batch = db.batch();
  let count = 0;

  for (const f of toFix) {
    // 刪除舊文件
    const oldRef = db.doc(`studentStates/${f.displayId}/dailySnapshots/${f.docId}`);
    batch.delete(oldRef);

    // 建立新文件（用正確日期當 docId）
    const newRef = db.doc(`studentStates/${f.displayId}/dailySnapshots/${f.correctDate}`);
    batch.set(newRef, {
      ...f.data,
      date: f.correctDate,
    });

    count += 2; // delete + set
    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log(`✅ 已修正 ${toFix.length} 筆\n`);
  console.log('⚠️ 以下衝突未處理，需人工判斷：');
  conflicts.forEach(c => {
    console.log(`  ${c.displayId}  ${c.currentDate} → ${c.correctDate}`);
  });
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});