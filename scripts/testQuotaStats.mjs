// scripts/testQuotaStats.mjs
// 用途：測試學生的「最後一次配額進度」邏輯是否正確

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const ID_IDX = args.indexOf('--display-id');
const DISPLAY_ID = ID_IDX >= 0 ? args[ID_IDX + 1] : null;

if (!DISPLAY_ID) {
  console.error('❌ 請提供 --display-id，例如：--display-id 805_11_黃彥鈞');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log(`\n🧪 測試配額邏輯：${DISPLAY_ID}\n`);

  // 1. 讀取 studentStates
  const stateRef = db.doc(`studentStates/${DISPLAY_ID}`);
  const stateSnap = await stateRef.get();

  if (!stateSnap.exists) {
    console.error(`❌ 找不到 studentStates/${DISPLAY_ID}`);
    process.exit(1);
  }

  const stateData = stateSnap.data();
  const targetQuota = stateData.currentDailyQuota ?? 0;
  const quotaDate = stateData.quotaDate;

  console.log(`📋 從 studentStates 讀取：`);
  console.log(`   currentDailyQuota: ${targetQuota}`);
  console.log(`   quotaDate: ${quotaDate}`);

  if (targetQuota === 0 || !quotaDate) {
    console.log(`\n⚠️ 該學生沒有 currentDailyQuota 或 quotaDate，UI 不會顯示紅旗。`);
    return;
  }

  // 2. 模擬 AnalyticsService 去讀取 dailyStats
  const statsRef = db.doc(`studentStates/${DISPLAY_ID}/dailyStats/${quotaDate}`);
  const statsSnap = await statsRef.get();
  
  let answeredCount = 0;
  if (statsSnap.exists) {
    answeredCount = statsSnap.data().answeredCount ?? 0;
  } else {
    console.log(`\n⚠️ 找不到 ${quotaDate} 的 dailyStats 文件！`);
  }

  console.log(`\n📊 從 dailyStats/${quotaDate} 讀取：`);
  console.log(`   answeredCount: ${answeredCount}`);

  // 3. 模擬判斷邏輯
  let status = 'incomplete';
  if (answeredCount >= targetQuota) {
    status = 'completed';
  }

  console.log(`\n🎯 邏輯判定結果：`);
  console.log(`   status: ${status}`);
  
  if (status === 'incomplete') {
    console.log(`\n✅ 預期 UI 顯示：`);
    console.log(`   ${quotaDate.slice(5)} 配額：${answeredCount} / ${targetQuota} 題 🚩 未完成`);
  } else {
    console.log(`\n✅ 預期 UI 顯示：`);
    console.log(`   ${quotaDate.slice(5)} 配額：${answeredCount} / ${targetQuota} 題（無紅旗）`);
  }
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});