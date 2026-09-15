// scripts/cleanupAnonymousProfiles.mjs
//
// 用途：清理 students 集合中，同一個 displayId 的重複 profile。
//       只保留 updatedAt 最新的一筆，其餘刪除。
//
// 使用方式：
//   node scripts/cleanupAnonymousProfiles.mjs          # 預覽（不刪除）
//   node scripts/cleanupAnonymousProfiles.mjs --apply  # 實際執行刪除
//
// 前置：
//   - 專案根目錄有 serviceAccountKey.json
//   - npm install firebase-admin 已安裝

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');

// ============================================================
// 初始化
// ============================================================
const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf-8')
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 主流程
// ============================================================
async function cleanup() {
  console.log('🔍 讀取 students 集合...');
  const snap = await db.collection('students').get();
  console.log(`   共 ${snap.docs.length} 筆文件\n`);

  // 按 displayId 分組（沒有 displayId 的用 uid）
  const groups = new Map();
  snap.docs.forEach((doc) => {
    const data = doc.data();
    const key = data.displayId || doc.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: doc.id, data });
  });

  // 找出需要刪除的
  const toDelete = [];
  console.log('📊 分組結果：');
  for (const [displayId, list] of groups.entries()) {
    if (list.length <= 1) continue;

    // 按 updatedAt / createdAt 由新到舊排序
    list.sort((a, b) => {
      const aTime = a.data.updatedAt || a.data.createdAt || '';
      const bTime = b.data.updatedAt || b.data.createdAt || '';
      return bTime.localeCompare(aTime);
    });

    const keep = list[0];
    const remove = list.slice(1);

    console.log(`   📦 ${displayId}`);
    console.log(`      ✅ 保留：${keep.id}（${keep.data.updatedAt || keep.data.createdAt}）`);
    remove.forEach((r) => {
      console.log(`      ❌ 刪除：${r.id}（${r.data.updatedAt || r.data.createdAt}）`);
      toDelete.push(r.id);
    });
  }

  if (toDelete.length === 0) {
    console.log('\n🎉 沒有重複的 profile，不需要清理');
    return;
  }

  console.log(`\n📋 總共要刪除 ${toDelete.length} 筆重複 profile`);

  if (!APPLY) {
    console.log('\n⚠️ 這是預覽模式，沒有實際刪除任何資料。');
    console.log('   確認清單無誤後，重新執行：');
    console.log('   node scripts/cleanupAnonymousProfiles.mjs --apply');
    return;
  }

  // ============================================================
  // 批次刪除（每批 500 筆）
  // ============================================================
  console.log('\n🗑️ 開始刪除...');
  const BATCH_SIZE = 500;
  let deleted = 0;

  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toDelete.slice(i, i + BATCH_SIZE);
    chunk.forEach((id) => batch.delete(db.collection('students').doc(id)));
    await batch.commit();
    deleted += chunk.length;
    console.log(`   ✅ 已刪除 ${deleted}/${toDelete.length}`);
  }

  console.log(`\n🎉 清理完成，共刪除 ${toDelete.length} 筆 profile`);
}

cleanup().catch((err) => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});