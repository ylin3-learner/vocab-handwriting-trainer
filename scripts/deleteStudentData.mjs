// scripts/deleteStudentData.mjs
//
// 用途：刪除指定 displayId 的所有資料（attempts + students）。
//
// 使用方式：
//   node scripts/deleteStudentData.mjs                    # 預覽（不刪除）
//   node scripts/deleteStudentData.mjs --apply            # 實際執行
//
// 前置：
//   - 專案根目錄有 serviceAccountKey.json
//   - npm install firebase-admin 已安裝

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');

// ============================================================
// 🔥 設定要刪除的學生
// ============================================================
const TARGET_DISPLAY_ID = '709_1_L'; // 這裡改成要刪除的學生 displayId

// ============================================================
// 初始化
// ============================================================
const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf-8')
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 通用函式：查詢 + 預覽 + 刪除
// ============================================================
async function processCollection(collectionName, fieldName) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📦 集合：${collectionName}`);
  console.log(`   條件：${fieldName} == "${TARGET_DISPLAY_ID}"`);
  console.log('═'.repeat(60));

  const snap = await db
    .collection(collectionName)
    .where(fieldName, '==', TARGET_DISPLAY_ID)
    .get();

  console.log(`   找到 ${snap.docs.length} 筆\n`);

  if (snap.docs.length === 0) {
    console.log('   ✅ 沒有符合條件的文件，跳過');
    return { found: 0, deleted: 0 };
  }

  // 預覽前 10 筆
  console.log('📋 預覽（前 10 筆）：');
  snap.docs.slice(0, 10).forEach((doc, i) => {
    const data = doc.data();
    const summary =
      collectionName === 'attempts'
        ? `wordId=${data.wordId} | ${data.timestamp} | ${data.isCorrect ? '✅' : '❌'}`
        : `name=${data.name} | class=${data.class} | ${data.createdAt}`;
    console.log(`   ${i + 1}. ${doc.id}`);
    console.log(`      ${summary}`);
  });
  if (snap.docs.length > 10) {
    console.log(`   ...（還有 ${snap.docs.length - 10} 筆）`);
  }

  if (!APPLY) {
    return { found: snap.docs.length, deleted: 0 };
  }

  // 批次刪除（每批 500 筆）
  console.log('\n🗑️ 開始刪除...');
  const BATCH_SIZE = 500;
  let deleted = 0;

  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = snap.docs.slice(i, i + BATCH_SIZE);
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += chunk.length;
    console.log(`   ✅ 已刪除 ${deleted}/${snap.docs.length}`);
  }

  console.log(`   🎉 完成，共刪除 ${snap.docs.length} 筆`);
  return { found: snap.docs.length, deleted };
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log(`\n🎯 目標學生：${TARGET_DISPLAY_ID}`);
  console.log(`   模式：${APPLY ? '🔥 實際刪除' : '👀 預覽（不刪除）'}`);

  const attemptsResult = await processCollection('attempts', 'studentDisplayId');
  const studentsResult = await processCollection('students', 'displayId');

  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 總結');
  console.log('═'.repeat(60));
  console.log(`   attempts：找到 ${attemptsResult.found} 筆，刪除 ${attemptsResult.deleted} 筆`);
  console.log(`   students：找到 ${studentsResult.found} 筆，刪除 ${studentsResult.deleted} 筆`);

  if (!APPLY) {
    console.log('\n⚠️ 這是預覽模式，沒有實際刪除任何資料。');
    console.log('   確認清單無誤後，重新執行：');
    console.log('   node scripts/deleteStudentData.mjs --apply');
  } else {
    console.log('\n🎉 全部完成！');
  }
}

main().catch((err) => {
  console.error('\n❌ 執行失敗:', err);
  process.exit(1);
});