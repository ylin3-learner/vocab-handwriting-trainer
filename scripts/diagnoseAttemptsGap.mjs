// scripts/diagnoseAttemptsGap.mjs
// 用途：找出 studentStates.totalAttempts 與 attempts 實際筆數的落差來源
//
// 執行：node scripts/diagnoseAttemptsGap.mjs <displayId>
//   例如：node scripts/diagnoseAttemptsGap.mjs 802_16_劉展成
//
// 策略：
//   1. 用 displayId 查 count
//   2. 從 students 集合找出所有對應此 displayId 的 profile，拿到所有 uid
//   3. 對每個 uid 查 attempts count
//   4. 加總對比，找出落差
//   5. 列出所有不符預期的 attempts（studentDisplayId 不匹配的）

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const displayId = process.argv[2];
if (!displayId) {
  console.error('用法：node scripts/diagnoseAttemptsGap.mjs <displayId>');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const LINE = '═'.repeat(72);
const SUB  = '─'.repeat(72);

async function main() {
  console.log(`\n${LINE}`);
  console.log(`🔬 診斷 attempts 落差：${displayId}`);
  console.log(LINE);

  // ============================================================
  // 1. studentStates 的 totalAttempts
  // ============================================================
  const stateSnap = await db.doc(`studentStates/${displayId}`).get();
  if (!stateSnap.exists) {
    console.log('❌ studentStates 不存在');
    return;
  }
  const state = stateSnap.data();
  const claimedTotal = state.totalAttempts ?? 0;

  console.log(`\n📦 studentStates`);
  console.log(SUB);
  console.log(`   totalAttempts = ${claimedTotal}`);

  // ============================================================
  // 2. 用 displayId 查 attempts count
  // ============================================================
  const byDisplayCount = await db
    .collection('attempts')
    .where('studentDisplayId', '==', displayId)
    .count()
    .get();
  const byDisplayTotal = byDisplayCount.data().count;

  console.log(`\n📝 attempts 查詢`);
  console.log(SUB);
  console.log(`   by studentDisplayId == "${displayId}": ${byDisplayTotal}`);

  // ============================================================
  // 3. 從 students 集合找出此 displayId 的所有 uid
  // ============================================================
  console.log(`\n👤 students 集合中對應的 uid`);
  console.log(SUB);

  const studentsSnap = await db
    .collection('students')
    .where('displayId', '==', displayId)
    .get();

  const uids = studentsSnap.docs.map(d => d.id);
  if (uids.length === 0) {
    console.log('   ⚠️ students 集合中找不到此 displayId 的 profile');
    console.log('   （可能是舊資料已清理，或 profile 從未建立）');
  } else {
    for (const uid of uids) {
      const profile = studentsSnap.docs.find(d => d.id === uid)?.data();
      console.log(`   ${uid}  name=${profile?.name}  class=${profile?.class}  seat=${profile?.seatNumber}`);
    }
  }

  // ============================================================
  // 4. 對每個 uid 查 attempts count
  // ============================================================
  console.log(`\n📝 各 uid 的 attempts 總數`);
  console.log(SUB);

  let byUidTotal = 0;
  const uidCounts = {};
  for (const uid of uids) {
    const c = await db.collection('attempts').where('studentId', '==', uid).count().get();
    const n = c.data().count;
    uidCounts[uid] = n;
    byUidTotal += n;
    console.log(`   ${uid}: ${n}`);
  }
  console.log(`   ─────`);
  console.log(`   加總：${byUidTotal}`);

  // ============================================================
  // 5. 落差分析
  // ============================================================
  console.log(`\n🔍 落差分析`);
  console.log(SUB);
  console.log(`   studentStates.totalAttempts:              ${claimedTotal}`);
  console.log(`   attempts by displayId:                    ${byDisplayTotal}`);
  console.log(`   attempts by uid（所有歷史 uid 加總）:      ${byUidTotal}`);

  const gap1 = claimedTotal - byDisplayTotal;
  const gap2 = claimedTotal - byUidTotal;
  const gap3 = byUidTotal - byDisplayTotal;

  console.log(`\n   落差 1（claimed - byDisplay）: ${gap1}`);
  console.log(`   落差 2（claimed - byUid）:     ${gap2}`);
  console.log(`   落差 3（byUid - byDisplay）:   ${gap3}`);

  // ============================================================
  // 6. 判斷
  // ============================================================
  console.log(`\n💡 判讀`);
  console.log(SUB);

  if (gap1 === 0) {
    console.log('   ✅ totalAttempts 與 attempts 完全一致，無落差');
  } else if (gap3 > 0 && gap1 === gap3) {
    console.log(`   🔴 有 ${gap3} 筆 attempts 的 studentDisplayId 不是 "${displayId}"`);
    console.log(`       （但 studentId 是此學生的 uid，所以 byUid 對得上）`);
    console.log(`       可能原因：寫入時 displayId 計算錯誤，或學生改名/換座號`);
  } else if (gap2 > 0 && gap1 === 0) {
    console.log(`   🟡 totalAttempts 與 byUid 差 ${gap2}，但 byDisplay 對得上`);
    console.log(`       可能原因：totalAttempts 被多加，或是有 attempts 已被刪除`);
  } else if (gap2 > 0 && gap3 === 0) {
    console.log(`   🟡 totalAttempts 比實際 attempts 多 ${gap2} 筆`);
    console.log(`       可能原因：9/24 修補腳本用了錯誤的 count`);
  } else {
    console.log('   ⚠️ 多重落差，需進一步分析');
  }

  // ============================================================
  // 7. 抽樣：列出最近 50 筆 attempts 的關鍵欄位
  // ============================================================
  console.log(`\n📋 最近 50 筆 attempts 抽樣（by studentId 查全部 uid）`);
  console.log(SUB);

  // 用 displayId 排序撈最近 50 筆（不需索引，因為只有一個 where + orderBy）
  try {
    const recentSnap = await db
      .collection('attempts')
      .where('studentDisplayId', '==', displayId)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    console.log(`   撈到 ${recentSnap.docs.length} 筆`);
    console.log('   timestamp                studentId(前8)     studentDisplayId');
    console.log('   ' + '─'.repeat(68));
    for (const doc of recentSnap.docs) {
      const a = doc.data();
      const sid = (a.studentId ?? '(無)').slice(0, 8);
      const sdid = a.studentDisplayId ?? '(無)';
      const ts = (a.timestamp ?? '').slice(0, 19);
      console.log(`   ${ts.padEnd(22)} ${sid.padEnd(16)} ${sdid}`);
    }
  } catch (e) {
    console.log(`   ⚠️ 撈取失敗（可能需要索引）: ${e.message}`);
  }

  console.log(`\n${LINE}`);
  console.log('✅ 診斷完成');
  console.log(LINE);
}

main().catch(err => {
  console.error('\n❌ 執行失敗:', err);
  process.exit(1);
});