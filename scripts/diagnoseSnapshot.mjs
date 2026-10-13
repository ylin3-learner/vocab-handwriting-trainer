// scripts/diagnoseSnapshot.mjs
//
// 用途：診斷 dailySnapshot 的實際內容，看快照有沒有被正確更新。
//
// 使用方式：
//   node scripts/diagnoseSnapshot.mjs --display-id 802_25_林家萱 --date 2026-10-12

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const ID_IDX = args.indexOf('--display-id');
const DISPLAY_ID = ID_IDX >= 0 ? args[ID_IDX + 1] : null;
const DATE_IDX = args.indexOf('--date');
const TARGET_DATE = DATE_IDX >= 0 ? args[DATE_IDX + 1] : null;

if (!DISPLAY_ID) {
  console.error('❌ 請提供 --display-id');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log(`\n🔍 診斷 dailySnapshot：${DISPLAY_ID}\n`);

  // ============================================================
  // 1. 列出所有可能的 dailySnapshot 路徑
  // ============================================================
  const stateRef = db.doc(`studentStates/${DISPLAY_ID}`);

  // 路徑 1: studentStates/{id}/dailySnapshots
  console.log('📂 檢查 studentStates/{id}/dailySnapshots...');
  try {
    const sub1 = stateRef.collection('dailySnapshots');
    const snap1 = await sub1.get();
    console.log(`   共 ${snap1.size} 筆`);
    for (const doc of snap1.docs.slice(-10)) {
      console.log(`   - ${doc.id}: ${JSON.stringify(doc.data())}`);
    }
  } catch (e) {
    console.log(`   錯誤：${e.message}`);
  }

  // 路徑 2: dailySnapshots/{displayId}/dates
  console.log('\n📂 檢查 dailySnapshots 集合...');
  try {
    const snap2 = await db.collection('dailySnapshots')
      .where('displayId', '==', DISPLAY_ID)
      .get();
    console.log(`   共 ${snap2.size} 筆`);
    for (const doc of snap2.docs.slice(-10)) {
      console.log(`   - ${doc.id}: ${JSON.stringify(doc.data())}`);
    }
  } catch (e) {
    console.log(`   錯誤：${e.message}`);
  }

  // 路徑 3: studentStates 內嵌
  console.log('\n📂 檢查 studentStates/{id} 的內嵌欄位...');
  const stateSnap = await stateRef.get();
  if (stateSnap.exists) {
    const state = stateSnap.data();
    console.log(`   欄位：${Object.keys(state).join(', ')}`);
    if (state.dailySnapshots) {
      console.log(`   dailySnapshots: ${JSON.stringify(state.dailySnapshots)}`);
    }
  }

  // ============================================================
  // 2. 列出所有集合
  // ============================================================
  console.log('\n📂 列出所有頂層集合...');
  const collections = await db.listCollections();
  for (const col of collections) {
    console.log(`   - ${col.id}`);
    // 檢查子集合
    const snap = await col.limit(1).get();
    for (const doc of snap.docs) {
      const subs = await doc.ref.listCollections();
      for (const sub of subs) {
        console.log(`     └── ${doc.id}/${sub.id}`);
      }
    }
  }
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});