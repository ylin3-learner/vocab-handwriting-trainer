// scripts/fixStudentStates.mjs
//
// 用途：
//   1. 為所有 studentStates 文件補上遺漏的欄位（無參數時）
//   2. 批次設定學生等級（--set-level N）
//   3. 僅針對特定學生（--display-id XXX）
//
// 使用方式：
//   node scripts/fixStudentStates.mjs                                    # 預覽（補欄位）
//   node scripts/fixStudentStates.mjs --apply                            # 實際寫入
//   node scripts/fixStudentStates.mjs --set-level 3                      # 預覽（設等級）
//   node scripts/fixStudentStates.mjs --set-level 3 --display-id 802_16_劉展成
//   node scripts/fixStudentStates.mjs --set-level 3 --apply              # 實際寫入
//
// 前置：
//   - 專案根目錄有 serviceAccountKey.json
//   - npm install firebase-admin 已安裝

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// ============================================================
// 命令列參數解析
// ============================================================
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

const SET_LEVEL_INDEX = args.indexOf('--set-level');
const SET_LEVEL =
  SET_LEVEL_INDEX >= 0 ? parseInt(args[SET_LEVEL_INDEX + 1], 10) : null;

const DISPLAY_ID_INDEX = args.indexOf('--display-id');
const TARGET_DISPLAY_ID =
  DISPLAY_ID_INDEX >= 0 ? args[DISPLAY_ID_INDEX + 1] : null;

if (SET_LEVEL !== null && (isNaN(SET_LEVEL) || SET_LEVEL < 1 || SET_LEVEL > 6)) {
  console.error('❌ --set-level 必須是 1~6 之間的整數');
  process.exit(1);
}

const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf-8')
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 模式 A：批次設定等級
// ============================================================
async function setLevelMode() {
  console.log(`\n🏁 設定等級模式`);
  console.log(`   目標等級：L${SET_LEVEL}`);
  console.log(`   目標學生：${TARGET_DISPLAY_ID ?? '所有學生'}`);
  console.log(`   模式：${APPLY ? '🔥 實際寫入' : '👀 預覽（不寫入）'}\n`);

  let targetRefs;

  if (TARGET_DISPLAY_ID) {
    const ref = db.doc(`studentStates/${TARGET_DISPLAY_ID}`);
    const snap = await ref.get();
    if (!snap.exists) {
      console.error(`❌ 找不到 studentStates/${TARGET_DISPLAY_ID}`);
      process.exit(1);
    }
    targetRefs = [ref];
  } else {
    const snap = await db.collection('studentStates').get();
    targetRefs = snap.docs.map(d => d.ref);
  }

  console.log(`   找到 ${targetRefs.length} 位學生\n`);
  console.log(`${'═'.repeat(60)}`);

  for (const ref of targetRefs) {
    const snap = await ref.get();
    if (!snap.exists) continue;

    const data = snap.data();
    const oldLevel = data.currentLevel ?? 1;

    const update = {
      currentLevel: SET_LEVEL,
      levelHistory: [
        ...(data.levelHistory || []),
        {
          level: SET_LEVEL,
          changedAt: new Date().toISOString(),
          reason: `手動設定為 L${SET_LEVEL}（賽前衝刺）`,
          triggeredBy: 'manual',
        },
      ],
    };

    console.log(`\n📦 ${ref.id}`);
    console.log(`   L${oldLevel} → L${SET_LEVEL}`);

    if (APPLY) {
      await ref.set(update, { merge: true });
      console.log(`   ✅ 已寫入`);
    } else {
      console.log(`   👀 預覽（不寫入）`);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  if (APPLY) {
    console.log(`🎉 完成！已更新 ${targetRefs.length} 位學生`);
    console.log(`   提醒：凍結由作業層級的 competitionMode 處理，`);
    console.log(`   作業過期後系統會自動恢復自適應評估。\n`);
  } else {
    console.log(`⚠️ 預覽模式，沒有實際寫入。`);
    console.log(`   確認無誤後執行：`);
    console.log(`   node scripts/fixStudentStates.mjs --set-level ${SET_LEVEL}${TARGET_DISPLAY_ID ? ` --display-id ${TARGET_DISPLAY_ID}` : ''} --apply\n`);
  }
}

// ============================================================
// 模式 B：補欄位（原有行為）
// ============================================================
async function fixOne(displayId, data) {
  const attemptsSnap = await db
    .collection('attempts')
    .where('studentDisplayId', '==', displayId)
    .count()
    .get();
  const actualTotalAttempts = attemptsSnap.data().count;

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

async function fixFieldsMode() {
  console.log(`\n🎯 修補 studentStates 遺漏欄位`);
  console.log(`   模式：${APPLY ? '🔥 實際寫入' : '👀 預覽（不寫入）'}\n`);

  const snap = await db.collection('studentStates').get();
  console.log(`   找到 ${snap.docs.length} 筆 studentStates\n`);

  if (snap.docs.length === 0) {
    console.log('✅ 沒有需要處理的文件');
    return;
  }

  const results = [];
  for (const doc of snap.docs) {
    const result = await fixOne(doc.id, doc.data());
    results.push(result);
  }

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
  console.log(`${'═'.repeat(60)}\n`);

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
  console.log('🎉 全部完成！\n');
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  if (SET_LEVEL !== null) {
    await setLevelMode();
  } else {
    await fixFieldsMode();
  }
}

main().catch((err) => {
  console.error('\n❌ 執行失敗:', err);
  process.exit(1);
});