// scripts/deleteStudentData.mjs
//
// 用途：完整刪除指定 displayId 的所有資料。
//
// 涵蓋範圍：
//   1. attempts/{autoId}                     ← 學生的作答紀錄
//   2. students/{uid}                        ← 學生的 profile（可能多筆）
//   3. studentStates/{displayId}             ← 學習狀態（含 words 和 dailySnapshots 子集合）
//   4. classStats/{className}.students[id]   ← 班級統計中該學生的條目
//
// 使用方式：
//   node scripts/deleteStudentData.mjs          # 預覽（不刪除）
//   node scripts/deleteStudentData.mjs --apply  # 實際執行
//
// 前置：
//   - 專案根目錄有 serviceAccountKey.json
//   - npm install firebase-admin 已安裝

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');

// ============================================================
// 🔥 設定要刪除的學生
// ============================================================
const TARGET_DISPLAY_ID = '709_1_L';  // 這裡改成要刪除的學生 displayId

// ============================================================
// 初始化
// ============================================================
const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf-8')
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 工具：從 displayId 解析 className
//   displayId 格式：{class}_{seat}_{name}，例如 "709_1_L"
// ============================================================
function getClassNameFromDisplayId(displayId) {
  const parts = displayId.split('_');
  return parts[0] || '';
}

// ============================================================
// 工具：批次刪除一個集合（用於 studentStates 的子集合）
// ============================================================
async function deleteCollectionDocs(collectionRef, batchSize = 500) {
  let totalDeleted = 0;
  while (true) {
    const snap = await collectionRef.limit(batchSize).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snap.docs.length;

    if (snap.docs.length < batchSize) break;
  }
  return totalDeleted;
}

// ============================================================
// 1. attempts
// ============================================================
async function processAttempts() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📦 集合：attempts`);
  console.log(`   條件：studentDisplayId == "${TARGET_DISPLAY_ID}"`);
  console.log('═'.repeat(60));

  const snap = await db.collection('attempts')
    .where('studentDisplayId', '==', TARGET_DISPLAY_ID)
    .get();

  // 🔥 統計 isCorrect 數量
  let correctCount = 0;
  let wrongCount = 0;
  snap.docs.forEach(doc => {
    if (doc.data().isCorrect) correctCount++;
    else wrongCount++;
  });

  console.log(`   找到 ${snap.docs.length} 筆`);
  console.log(`   ✅ 答對：${correctCount} 筆`);
  console.log(`   ❌ 答錯：${wrongCount} 筆`);

  if (snap.docs.length === 0) {
    console.log('   ✅ 沒有符合條件的文件，跳過');
    return { found: 0, deleted: 0, correctCount, wrongCount };
  }

  console.log('\n📋 預覽（前 10 筆）：');
  snap.docs.slice(0, 10).forEach((doc, i) => {
    const data = doc.data();
    const summary = `wordId=${data.wordId} | ${data.timestamp} | ${data.isCorrect ? '✅' : '❌'}`;
    console.log(`   ${i + 1}. ${doc.id}`);
    console.log(`      ${summary}`);
  });
  if (snap.docs.length > 10) {
    console.log(`   ...（還有 ${snap.docs.length - 10} 筆）`);
  }

  if (!APPLY) {
    return { found: snap.docs.length, deleted: 0, correctCount, wrongCount };
  }

  console.log('\n🗑️ 開始刪除 attempts...');
  const BATCH_SIZE = 500;
  let deleted = 0;

  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = snap.docs.slice(i, i + BATCH_SIZE);
    chunk.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += chunk.length;
    console.log(`   ✅ 已刪除 ${deleted}/${snap.docs.length}`);
  }

  return { found: snap.docs.length, deleted, correctCount, wrongCount };
}

// ============================================================
// 2. students/{uid}（profile）
// ============================================================
async function processStudents() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📦 集合：students`);
  console.log(`   條件：displayId == "${TARGET_DISPLAY_ID}"`);
  console.log('═'.repeat(60));

  const snap = await db.collection('students')
    .where('displayId', '==', TARGET_DISPLAY_ID)
    .get();

  console.log(`   找到 ${snap.docs.length} 筆`);

  if (snap.docs.length === 0) {
    console.log('   ✅ 沒有符合條件的文件，跳過');
    return { found: 0, deleted: 0 };
  }

  console.log('\n📋 預覽：');
  snap.docs.forEach((doc, i) => {
    const data = doc.data();
    console.log(`   ${i + 1}. ${doc.id}`);
    console.log(`      name=${data.name} | class=${data.class} | seat=${data.seatNumber}`);
  });

  if (!APPLY) {
    return { found: snap.docs.length, deleted: 0 };
  }

  console.log('\n🗑️ 開始刪除 students...');
  const BATCH_SIZE = 500;
  let deleted = 0;

  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = snap.docs.slice(i, i + BATCH_SIZE);
    chunk.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += chunk.length;
    console.log(`   ✅ 已刪除 ${deleted}/${snap.docs.length}`);
  }

  return { found: snap.docs.length, deleted };
}

// ============================================================
// 3. studentStates/{displayId} + 子集合
// ============================================================
async function processStudentStates() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📦 文件：studentStates/${TARGET_DISPLAY_ID}`);
  console.log('═'.repeat(60));

  const docRef = db.doc(`studentStates/${TARGET_DISPLAY_ID}`);
  const snap = await docRef.get();

  if (!snap.exists) {
    console.log('   ✅ 文件不存在，跳過');
    return { found: 0, deleted: 0, wordsDeleted: 0, snapshotsDeleted: 0 };
  }

  // 檢查子集合
  const wordsSnap = await docRef.collection('words').get();
  const snapshotsSnap = await docRef.collection('dailySnapshots').get();

  console.log(`   主文件：1 筆`);
  console.log(`   子集合 words：${wordsSnap.docs.length} 筆`);
  console.log(`   子集合 dailySnapshots：${snapshotsSnap.docs.length} 筆`);

  const data = snap.data() || {};
  console.log('\n📋 主文件預覽：');
  console.log(`   currentLevel: ${data.currentLevel}`);
  console.log(`   totalAttempts: ${data.totalAttempts}`);
  console.log(`   placementDone: ${data.placementDone}`);

  if (!APPLY) {
    return {
      found: 1 + wordsSnap.docs.length + snapshotsSnap.docs.length,
      deleted: 0,
      wordsDeleted: 0,
      snapshotsDeleted: 0,
    };
  }

  console.log('\n🗑️ 開始刪除 studentStates...');

  // 先刪子集合
  const wordsDeleted = await deleteCollectionDocs(
    docRef.collection('words')
  );
  console.log(`   ✅ 已刪除 words 子集合（${wordsDeleted} 筆）`);

  const snapshotsDeleted = await deleteCollectionDocs(
    docRef.collection('dailySnapshots')
  );
  console.log(`   ✅ 已刪除 dailySnapshots 子集合（${snapshotsDeleted} 筆）`);

  // 再刪主文件
  await docRef.delete();
  console.log(`   ✅ 已刪除主文件`);

  return {
    found: 1 + wordsSnap.docs.length + snapshotsSnap.docs.length,
    deleted: 1 + wordsDeleted + snapshotsDeleted,
    wordsDeleted,
    snapshotsDeleted,
  };
}

// ============================================================
// 4. classStats/{className}.students[displayId]
// ============================================================
async function processClassStats() {
  const className = getClassNameFromDisplayId(TARGET_DISPLAY_ID);
  if (!className) {
    console.log(`\n⚠️ 無法從 displayId "${TARGET_DISPLAY_ID}" 解析班級名稱，跳過 classStats`);
    return { found: 0, updated: 0 };
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📦 文件：classStats/${className}`);
  console.log(`   動作：移除 students["${TARGET_DISPLAY_ID}"]`);
  console.log('═'.repeat(60));

  const docRef = db.doc(`classStats/${className}`);
  const snap = await docRef.get();

  if (!snap.exists) {
    console.log('   ✅ classStats 文件不存在，跳過');
    return { found: 0, updated: 0 };
  }

  const data = snap.data() || {};
  const students = data.students || {};

  if (!students[TARGET_DISPLAY_ID]) {
    console.log(`   ✅ students 中沒有 "${TARGET_DISPLAY_ID}"，跳過`);
    return { found: 0, updated: 0 };
  }

  const studentEntry = students[TARGET_DISPLAY_ID];
  console.log(`   找到 1 筆：`);
  console.log(`      name=${studentEntry.name} | attempts=${studentEntry.attempts} | correct=${studentEntry.correct}`);

  const newTotalAttempts = (data.totalAttempts || 0) - (studentEntry.attempts || 0);
  const newTotalCorrect = (data.totalCorrect || 0) - (studentEntry.correct || 0);

  console.log(`\n   移除後：`);
  console.log(`      totalAttempts: ${data.totalAttempts} → ${newTotalAttempts}`);
  console.log(`      totalCorrect:  ${data.totalCorrect} → ${newTotalCorrect}`);

  console.log(`\n   ⚠️ 注意：classStats 的 wordErrors 不會回退（無法按學生拆分）`);

  if (!APPLY) {
    return { found: 1, updated: 0 };
  }

  console.log('\n🗑️ 開始更新 classStats...');

  await docRef.update({
    [`students.${TARGET_DISPLAY_ID}`]: FieldValue.delete(),
    totalAttempts: newTotalAttempts,
    totalCorrect: newTotalCorrect,
    lastUpdated: new Date().toISOString(),
  });

  console.log(`   ✅ 已從 classStats 移除該學生，並更新總數`);
  return { found: 1, updated: 1 };
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log(`\n🎯 目標學生：${TARGET_DISPLAY_ID}`);
  console.log(`   模式：${APPLY ? '🔥 實際刪除' : '👀 預覽（不刪除）'}`);

  const attemptsResult = await processAttempts();
  const studentsResult = await processStudents();
  const studentStatesResult = await processStudentStates();
  const classStatsResult = await processClassStats();

  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 總結');
  console.log('═'.repeat(60));
  console.log(`   attempts：`);
  console.log(`      找到 ${attemptsResult.found} 筆（答對 ${attemptsResult.correctCount} / 答錯 ${attemptsResult.wrongCount}）`);
  console.log(`      刪除 ${attemptsResult.deleted} 筆`);
  console.log(`   students：`);
  console.log(`      找到 ${studentsResult.found} 筆，刪除 ${studentsResult.deleted} 筆`);
  console.log(`   studentStates：`);
  console.log(`      找到 ${studentStatesResult.found} 筆，刪除 ${studentStatesResult.deleted} 筆`);
  console.log(`   classStats：`);
  console.log(`      找到 ${classStatsResult.found} 筆，更新 ${classStatsResult.updated} 筆`);

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