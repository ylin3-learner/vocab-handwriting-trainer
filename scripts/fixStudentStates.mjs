// scripts/fixStudentStates.mjs
//
// 用途：為所有 studentStates 文件補上遺漏的欄位。
//
// 背景：
//   PlacementOrchestrator.commitAll 用 writeBatch 寫入 studentStates，
//   但若 batch 失敗走 fallback（markPlacementDone），只會寫入
//   currentLevel / placementDone / placementHistory 三個欄位。
//   導致 totalAttempts / levelLockedUntilTotalAttempts /
//   lastEvaluatedAtTotalAttempts / levelHistory 遺漏，
//   等級評估機制因此永遠跳過（永遠不評估、不降級）。
//
// 使用方式：
//   node scripts/fixStudentStates.mjs          # 預覽（不寫入）
//   node scripts/fixStudentStates.mjs --apply  # 實際寫入
//
// 前置：
//   - 專案根目錄有 serviceAccountKey.json
//   - npm install firebase-admin 已安裝

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');

const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf-8')
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 對單一 studentStates 文件補欄位
// ============================================================
async function fixOne(displayId, data) {
  // 計算該學生實際的 attempts 總數
  const attemptsSnap = await db
    .collection('attempts')
    .where('studentDisplayId', '==', displayId)
    .count()
    .get();
  const actualTotalAttempts = attemptsSnap.data().count;

  // 檢查缺哪些欄位
  const missing = [];
  const updatePayload = {};

  if (typeof data.totalAttempts !== 'number') {
    missing.push('totalAttempts');
    updatePayload.totalAttempts = actualTotalAttempts;
  }

  if (typeof data.levelLockedUntilTotalAttempts !== 'number') {
    missing.push('levelLockedUntilTotalAttempts');
    updatePayload.levelLockedUntilTotalAttempts = 0;
  }

  if (typeof data.lastEvaluatedAtTotalAttempts !== 'number') {
    missing.push('lastEvaluatedAtTotalAttempts');
    updatePayload.lastEvaluatedAtTotalAttempts = 0;
  }

  if (!Array.isArray(data.levelHistory)) {
    missing.push('levelHistory');
    updatePayload.levelHistory = [
      {
        level: data.currentLevel ?? 1,
        changedAt: new Date().toISOString(),
        reason: '自動修補：補上遺漏的 levelHistory',
        triggeredBy: 'manual',
      },
    ];
  }

  return {
    displayId,
    currentLevel: data.currentLevel,
    actualTotalAttempts,
    missing,
    updatePayload,
  };
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log(`\n🎯 修補 studentStates 遺漏欄位`);
  console.log(`   模式：${APPLY ? '🔥 實際寫入' : '👀 預覽（不寫入）'}\n`);

  // 讀取所有 studentStates
  const snap = await db.collection('studentStates').get();
  console.log(`   找到 ${snap.docs.length} 筆 studentStates\n`);

  if (snap.docs.length === 0) {
    console.log('✅ 沒有需要處理的文件');
    return;
  }

  // 逐一處理
  const results = [];
  for (const doc of snap.docs) {
    const result = await fixOne(doc.id, doc.data());
    results.push(result);
  }

  // 顯示結果
  const needFix = results.filter(r => r.missing.length > 0);
  const ok = results.filter(r => r.missing.length === 0);

  console.log(`${'═'.repeat(60)}`);
  console.log(`📋 需要修補的文件：${needFix.length} 筆`);
  console.log(`${'═'.repeat(60)}`);

  if (needFix.length === 0) {
    console.log('   ✅ 所有文件的欄位都完整，無需修補');
  } else {
    for (const r of needFix) {
      console.log(`\n📦 ${r.displayId}`);
      console.log(`   currentLevel: ${r.currentLevel}`);
      console.log(`   實際 attempts 總數：${r.actualTotalAttempts}`);
      console.log(`   缺少欄位：${r.missing.join(', ')}`);
      console.log(`   將補上：`);
      for (const [k, v] of Object.entries(r.updatePayload)) {
        console.log(`      ${k} = ${JSON.stringify(v)}`);
      }
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ 已完整（跳過）：${ok.length} 筆`);
  if (ok.length > 0 && ok.length <= 10) {
    ok.forEach(r => console.log(`   - ${r.displayId}`));
  } else if (ok.length > 10) {
    ok.slice(0, 10).forEach(r => console.log(`   - ${r.displayId}`));
    console.log(`   ...（還有 ${ok.length - 10} 筆）`);
  }
  console.log(`${'═'.repeat(60)}\n`);

  // 寫入
  if (!APPLY) {
    console.log('⚠️ 這是預覽模式，沒有實際寫入。');
    console.log('   確認清單無誤後，重新執行：');
    console.log('   node scripts/fixStudentStates.mjs --apply\n');
    return;
  }

  if (needFix.length === 0) {
    console.log('✅ 沒有需要修補的文件\n');
    return;
  }

  console.log(`\n🗑️ 開始寫入 ${needFix.length} 筆...`);
  const batch = db.batch();
  for (const r of needFix) {
    const ref = db.doc(`studentStates/${r.displayId}`);
    batch.set(ref, r.updatePayload, { merge: true });
  }
  await batch.commit();
  console.log(`✅ 已寫入 ${needFix.length} 筆\n`);

  console.log('🎉 全部完成！');
  console.log('   學生下次登入答滿 10 題後，等級評估應開始運作。\n');
}

main().catch((err) => {
  console.error('\n❌ 執行失敗:', err);
  process.exit(1);
});