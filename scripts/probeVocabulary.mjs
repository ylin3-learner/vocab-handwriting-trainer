// scripts/probeVocabulary.mjs
//
// 用途：探測 vocabulary 集合的真實結構。
//
// 使用方式：
//   node scripts/probeVocabulary.mjs

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  // ============================================================
  // 1. 列出 vocabulary 集合頂層的所有 doc id
  // ============================================================
  console.log(`\n🔬 探測 vocabulary 集合...\n`);

  const topSnap = await db.collection('vocabulary').limit(50).get();
  console.log(`   頂層 doc 數量（前 50 筆）：${topSnap.size}`);
  console.log(`   Doc IDs:`);
  for (const doc of topSnap.docs) {
    console.log(`     - ${doc.id}`);
  }

  // ============================================================
  // 2. 檢查是否有子集合
  // ============================================================
  console.log(`\n🔬 檢查子集合...\n`);
  for (const doc of topSnap.docs.slice(0, 5)) {
    const subs = await doc.ref.listCollections();
    if (subs.length > 0) {
      console.log(`   ${doc.id} 的子集合：`);
      for (const sub of subs) {
        console.log(`     - ${sub.id}`);
        const subSnap = await sub.limit(3).get();
        console.log(`       前 3 個 doc：${subSnap.docs.map(d => d.id).join(', ')}`);
      }
    }
  }

  // ============================================================
  // 3. 列出所有集合
  // ============================================================
  console.log(`\n🔬 列出所有頂層集合...\n`);
  const collections = await db.listCollections();
  for (const col of collections) {
    console.log(`   - ${col.id}`);
  }

  // ============================================================
  // 4. 對每個可能的集合，抽樣看結構
  // ============================================================
  console.log(`\n🔬 抽樣各集合的第一筆文件：\n`);
  for (const col of collections) {
    try {
      const snap = await col.limit(1).get();
      if (snap.size > 0) {
        const doc = snap.docs[0];
        console.log(`   【${col.id}】doc.id = "${doc.id}"`);
        const data = doc.data();
        console.log(`   欄位：${Object.keys(data).join(', ')}`);
        // 顯示部分內容
        const preview = JSON.stringify(data).slice(0, 200);
        console.log(`   內容：${preview}...`);
        console.log(`   ---`);
      }
    } catch (e) {
      // 忽略錯誤
    }
  }
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});