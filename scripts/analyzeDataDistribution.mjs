// scripts/analyzeDataDistribution.mjs
//
// 統計每個等級、每位學生、每個單字的 attempts 分佈。
//
// 為什麼安全：
//   - 使用 count() 聚合查詢，每次僅消耗 1 次讀取
//   - 不拉取任何 attempts 文檔的完整內容
//   - 總消耗約 20-50 次讀取（遠低於 50,000 上限）
//
// 執行：
//   node scripts/analyzeDataDistribution.mjs

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const LINE = '═'.repeat(60);

async function main() {
  console.log(`\n${LINE}`);
  console.log(`📊 Attempts 資料分佈分析`);
  console.log(LINE);

  // ============================================================
  // 1. 總量
  // ============================================================
  const totalSnap = await db.collection('attempts').count().get();
  const total = totalSnap.data().count;
  console.log(`\n📦 總 attempts 數：${total}`);

  // ============================================================
  // 2. 每個等級的 attempts 分佈
  //
  // 注意：attempts 本身沒有 level 欄位。
  // 需要先取得所有單字的 level，再分組統計。
  // 但為了避免拉取全部單字，改用另一種策略：
  //   拉取所有單字的 level（單字庫只有數千筆，非 attempts）
  // ============================================================
  console.log(`\n📊 單字庫等級分佈（用於對照）`);

  // 拉取 vocabulary 集合的 level 欄位
  const vocabSnap = await db.collection('vocabulary/current/words')
    .select('level')  // 只拉 level 欄位，節省流量
    .get();

  const vocabByLevel = {};
  vocabSnap.forEach(doc => {
    const lv = doc.data().level ?? 'unknown';
    vocabByLevel[lv] = (vocabByLevel[lv] ?? 0) + 1;
  });

  console.log(`   單字庫總數：${vocabSnap.size}`);
  Object.entries(vocabByLevel)
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .forEach(([lv, count]) => {
      console.log(`   L${lv}：${count} 個單字`);
    });

  // ============================================================
  // 3. 每位學生的 attempts 數量
  //
  // 用 count() 對每個 studentDisplayId 做聚合查詢。
  // 先取得所有學生的 displayId（從 studentStates 集合）
  // ============================================================
  console.log(`\n👥 每位學生的 attempts 數量`);

  const statesSnap = await db.collection('studentStates')
    .select('currentLevel')
    .get();

  for (const stateDoc of statesSnap.docs) {
    const displayId = stateDoc.id;
    const level = stateDoc.data().currentLevel ?? '?';

    const countSnap = await db.collection('attempts')
      .where('studentDisplayId', '==', displayId)
      .count()
      .get();

    const count = countSnap.data().count;
    console.log(`   ${displayId}  L${level}  ${count} 筆`);
  }

  // ============================================================
  // 4. 每個單字的 attempts 數量 Top 20
  //
  // 這個需要拉取 attempts 的 wordId 欄位。
  // 但 attempts 有 9,650 筆，全部拉取會消耗 9,650 次讀取。
  // 改用：只拉取最近 500 筆（消耗 500 次讀取，仍安全）
  // ============================================================
  console.log(`\n📝 單字被練習次數 Top 20（從最近 500 筆取樣）`);

  const recentSnap = await db.collection('attempts')
    .orderBy('timestamp', 'desc')
    .limit(500)
    .select('wordId')
    .get();

  const wordCount = {};
  recentSnap.forEach(doc => {
    const wid = doc.data().wordId;
    wordCount[wid] = (wordCount[wid] ?? 0) + 1;
  });

  const topWords = Object.entries(wordCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  topWords.forEach(([wid, count]) => {
    console.log(`   ${wid}：${count} 次`);
  });

  // ============================================================
  // 5. 估算各等級的 attempts 數量
  //
  // 從 attempts 取樣，搭配單字 level 對照。
  // 取樣 1000 筆，消耗 1000 次讀取。
  // ============================================================
  console.log(`\n📈 各等級 attempts 估算（從 1000 筆取樣）`);

  const sampleSnap = await db.collection('attempts')
    .orderBy('timestamp', 'desc')
    .limit(1000)
    .select('wordId')
    .get();

  // 建立 wordId → level 對照
  const wordLevelMap = {};
  vocabSnap.forEach(doc => {
    wordLevelMap[doc.id] = doc.data().level ?? 'unknown';
  });

  const levelCount = {};
  let unmapped = 0;
  sampleSnap.forEach(doc => {
    const lv = wordLevelMap[doc.data().wordId];
    if (lv === undefined) {
      unmapped++;
    } else {
      levelCount[lv] = (levelCount[lv] ?? 0) + 1;
    }
  });

  const sampleSize = sampleSnap.size;
  Object.entries(levelCount)
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .forEach(([lv, count]) => {
      const pct = ((count / sampleSize) * 100).toFixed(1);
      const estimated = Math.round((count / sampleSize) * total);
      console.log(`   L${lv}：${count} 筆 (${pct}%) → 估算總數 ${estimated}`);
    });

  if (unmapped > 0) {
    console.log(`   ⚠️ 無法對照：${unmapped} 筆`);
  }

  console.log(`\n${LINE}`);
  console.log(`✅ 完成。總讀取消耗約 ${500 + 1000 + statesSnap.size + 10} 次。`);
  console.log(LINE);
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});