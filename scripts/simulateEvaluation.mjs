// scripts/simulateEvaluation.mjs
// 用途：用真實 attempts 資料模擬 RuleBasedStrategy 的評估結果
//
// 執行：node scripts/simulateEvaluation.mjs 802_16_劉展成 1

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const displayId = process.argv[2];
const currentLevel = Number(process.argv[3] ?? '1');

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// 模擬 RuleBasedStrategy 的門檻（改動前 vs 改動後）
const OLD = {
  PROMOTE_MIN_CORRECT_RATE: 0.85,
  PROMOTE_MAX_AVG_TIME_MS: 5000,
  PROMOTE_MIN_ATTEMPTS_IN_LEVEL: 30,
  PROMOTE_MIN_RECENT_ATTEMPTS: 15,
};
const NEW = {
  PROMOTE_MIN_CORRECT_RATE: 0.85,
  PROMOTE_MAX_AVG_TIME_MS: 7000,
  PROMOTE_MIN_ATTEMPTS_IN_LEVEL: 20,
  PROMOTE_MIN_RECENT_ATTEMPTS: 15,
};

async function main() {
  // 1. 撈最近 30 筆 attempts
  const snap = await db
    .collection('attempts')
    .where('studentDisplayId', '==', displayId)
    .orderBy('timestamp', 'desc')
    .limit(30)
    .get();

  const attempts = snap.docs.map(d => d.data());
  if (attempts.length === 0) {
    console.log('無 attempts');
    return;
  }

  // 2. 算基本指標
  const correctCount = attempts.filter(a => a.isCorrect).length;
  const correctRate = correctCount / attempts.length;
  const avgTime = attempts.reduce((s, a) => s + (a.responseTimeMs || 0), 0) / attempts.length;

  // 3. 算 consecutiveCorrect
  const sorted = [...attempts].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
  let consecutiveCorrect = 0;
  for (const a of sorted) {
    if (a.isCorrect) consecutiveCorrect++;
    else break;
  }

  // 4. 撈 word levels
  const wordIds = [...new Set(attempts.map(a => a.wordId))];
  const wordSnaps = await Promise.all(
    wordIds.map(id => db.collection('vocabulary').doc(id).get())
  );
  const wordLevelMap = new Map();
  for (const ws of wordSnaps) {
    if (ws.exists) {
      wordLevelMap.set(ws.id, Number(ws.data().level ?? '1'));
    }
  }

  // 5. 算 attemptsInCurrentLevel（兩種算法）
  const oldAttemptsInLevel = attempts.filter(
    a => wordLevelMap.get(a.wordId) === currentLevel
  ).length;
  const newAttemptsInLevel = attempts.filter(a => {
    const lv = wordLevelMap.get(a.wordId);
    if (lv === undefined) return true;
    return lv <= currentLevel;
  }).length;

  console.log(`\n📊 模擬評估：${displayId}（currentLevel = L${currentLevel}）`);
  console.log('─'.repeat(60));
  console.log(`  窗口大小：${attempts.length} 筆`);
  console.log(`  正確率：${(correctRate * 100).toFixed(1)}%`);
  console.log(`  平均時間：${(avgTime / 1000).toFixed(1)}s`);
  console.log(`  連續答對：${consecutiveCorrect}`);
  console.log(`  attemptsInLevel（舊算法 ==）：${oldAttemptsInLevel}`);
  console.log(`  attemptsInLevel（新算法 <=）：${newAttemptsInLevel}`);

  // 6. 用舊門檻判斷
  console.log(`\n🔴 舊門檻（5000ms, 30 題）`);
  console.log('─'.repeat(60));
  const oldRateOK =
    correctRate >= OLD.PROMOTE_MIN_CORRECT_RATE &&
    avgTime < OLD.PROMOTE_MAX_AVG_TIME_MS &&
    oldAttemptsInLevel >= OLD.PROMOTE_MIN_ATTEMPTS_IN_LEVEL;
  const oldStreakOK =
    consecutiveCorrect >= 5 &&
    oldAttemptsInLevel >= OLD.PROMOTE_MIN_ATTEMPTS_IN_LEVEL;
  console.log(`  canPromoteByRate:  ${oldRateOK ? '✅' : '❌'}`);
  console.log(`  canPromoteByStreak: ${oldStreakOK ? '✅' : '❌'}`);
  console.log(`  結果：${oldRateOK || oldStreakOK ? '升級' : 'hold'}`);

  // 7. 用新門檻判斷
  console.log(`\n🟢 新門檻（7000ms, 20 題, <= currentLevel）`);
  console.log('─'.repeat(60));
  const newRateOK =
    correctRate >= NEW.PROMOTE_MIN_CORRECT_RATE &&
    avgTime < NEW.PROMOTE_MAX_AVG_TIME_MS &&
    newAttemptsInLevel >= NEW.PROMOTE_MIN_ATTEMPTS_IN_LEVEL;
  const newStreakOK =
    consecutiveCorrect >= 5 &&
    newAttemptsInLevel >= NEW.PROMOTE_MIN_ATTEMPTS_IN_LEVEL;
  console.log(`  canPromoteByRate:  ${newRateOK ? '✅' : '❌'}`);
  console.log(`  canPromoteByStreak: ${newStreakOK ? '✅' : '❌'}`);
  console.log(`  結果：${newRateOK || newStreakOK ? '升級' : 'hold'}`);
}

main().catch(err => { console.error(err); process.exit(1); });