// scripts/diagnoseDDA.mjs
// 用途：診斷 DDA（等級評估）為何沒有觸發
//
// 執行：node scripts/diagnoseDDA.mjs <displayId1> [displayId2] ...
//
// 輸出：
//   1. studentStates 完整內容
//   2. 該學生在 Firestore 中的所有 attempts（按時間排序）
//   3. 用 count() 聚合的真實 attempts 數 vs totalAttempts 欄位
//   4. 時間軸缺口分析
//   5. classStats 快照
//   6. dailySnapshots
//
// 前置：專案根目錄有 serviceAccountKey.json

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const displayIds = process.argv.slice(2);
if (displayIds.length === 0) {
  console.error('用法：node scripts/diagnoseDDA.mjs <displayId1> [displayId2] ...');
  process.exit(1);
}

const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf-8')
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const LINE = '═'.repeat(72);
const SUB  = '─'.repeat(72);

function fmt(ts) {
  if (!ts) return '(無)';
  // Firestore Timestamp 或 ISO 字串
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

async function diagnoseOne(displayId) {
  console.log(`\n${LINE}`);
  console.log(`🎯 診斷：${displayId}`);
  console.log(LINE);

  // ============================================================
  // 1. studentStates 主文檔
  // ============================================================
  const stateRef = db.doc(`studentStates/${displayId}`);
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) {
    console.log('❌ studentStates 不存在');
    return;
  }
  const state = stateSnap.data();

  console.log('\n📦 studentStates 主文檔');
  console.log(SUB);
  const fields = [
    'currentLevel',
    'totalAttempts',
    'levelLockedUntilTotalAttempts',
    'lastEvaluatedAtTotalAttempts',
    'placementDone',
  ];
  for (const f of fields) {
    console.log(`   ${f.padEnd(36)} = ${JSON.stringify(state[f])}`);
  }

  // 計算 DDA 狀態
  const total = state.totalAttempts ?? 0;
  const lastEval = state.lastEvaluatedAtTotalAttempts ?? 0;
  const lockedUntil = state.levelLockedUntilTotalAttempts ?? 0;
  const sinceEval = total - lastEval;
  const MIN = 10;

  console.log('\n🔍 DDA 評估觸發分析');
  console.log(SUB);
  console.log(`   距上次評估：${sinceEval} 題（門檻 ≥ ${MIN}）`);
  console.log(`   鎖定至：${lockedUntil}（當前 ${total}）`);
  if (total < lockedUntil) {
    console.log(`   ⚠️ 鎖定中，還需 ${lockedUntil - total} 題`);
  } else if (sinceEval < MIN) {
    console.log(`   ⚠️ 還要 ${MIN - sinceEval} 題才會評估`);
  } else {
    console.log(`   ✅ 應該要評估了！`);
  }

  // ============================================================
  // 2. levelHistory
  // ============================================================
  console.log('\n📜 levelHistory');
  console.log(SUB);
  const hist = state.levelHistory ?? [];
  if (hist.length === 0) {
    console.log('   (空)');
  } else {
    for (const h of hist) {
      console.log(`   L${h.level}  ${h.changedAt}  (${h.triggeredBy})`);
      console.log(`        ${h.reason}`);
    }
  }

  // ============================================================
  // 3. attempts：全部撈出來（只撈時間戳與關鍵欄位）
  // ============================================================
  console.log('\n📝 attempts（Firestore 實際紀錄）');
  console.log(SUB);

  // 用 count() 聚合
  const countSnap = await db
    .collection('attempts')
    .where('studentDisplayId', '==', displayId)
    .count()
    .get();
  const realTotal = countSnap.data().count;
  console.log(`   真實 attempts 數（count）：${realTotal}`);
  console.log(`   studentStates.totalAttempts：${total}`);
  console.log(`   差異：${realTotal - total} 題`);
  if (realTotal !== total) {
    console.log(`   ⚠️ 不一致！差 ${Math.abs(realTotal - total)} 題`);
  } else {
    console.log(`   ✅ 一致`);
  }

  // 撈最近 200 筆 attempts
  const attemptsSnap = await db
    .collection('attempts')
    .where('studentDisplayId', '==', displayId)
    .orderBy('timestamp', 'desc')
    .limit(200)
    .get();

  console.log(`\n   最近 ${attemptsSnap.docs.length} 筆 attempts 時間軸（desc）`);
  console.log(SUB);

  // 依照日期分組統計
  const byDate = {};
  for (const doc of attemptsSnap.docs) {
    const a = doc.data();
    const date = (a.timestamp ?? '').slice(0, 10);
    if (!byDate[date]) byDate[date] = { count: 0, correct: 0, first: null, last: null };
    byDate[date].count++;
    if (a.isCorrect) byDate[date].correct++;
    if (!byDate[date].first || a.timestamp < byDate[date].first) byDate[date].first = a.timestamp;
    if (!byDate[date].last || a.timestamp > byDate[date].last) byDate[date].last = a.timestamp;
  }

  console.log('   日期       題數   答對   正確率   首筆時間              末筆時間');
  console.log('   ' + '─'.repeat(70));
  const sortedDates = Object.keys(byDate).sort();
  for (const d of sortedDates) {
    const s = byDate[d];
    const rate = s.count > 0 ? Math.round((s.correct / s.count) * 100) : 0;
    console.log(
      `   ${d}   ${String(s.count).padStart(4)}   ${String(s.correct).padStart(4)}   ${String(rate).padStart(3)}%   ${fmt(s.first)}   ${fmt(s.last)}`
    );
  }

  // 檢查 10/1-10/2 是否有缺口
  const recent = attemptsSnap.docs.slice(0, 30).map(d => d.data());
  console.log('\n   最近 30 筆 attempts 的 time gap 分析：');
  console.log(SUB);
  let prevTs = null;
  let gapCount = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const ts = recent[i].timestamp;
    if (prevTs) {
      const gap = (new Date(ts) - new Date(prevTs)) / 1000;
      if (gap > 300) {  // 超過 5 分鐘
        console.log(`   ⚠️ 缺口 ${gap.toFixed(0)}s  ${fmt(prevTs)} → ${fmt(ts)}`);
        gapCount++;
      }
    }
    prevTs = ts;
  }
  if (gapCount === 0) console.log('   ✅ 無 > 5 分鐘的缺口');

  // 檢查每筆 attempts 的 studentDisplayId 是否正確
  const wrongDisplay = attemptsSnap.docs.filter(d => {
    const a = d.data();
    return a.studentDisplayId !== displayId;
  });
  if (wrongDisplay.length > 0) {
    console.log(`\n   ⚠️ 有 ${wrongDisplay.length} 筆 attempts 的 studentDisplayId 不等於 ${displayId}`);
    wrongDisplay.slice(0, 3).forEach(d => {
      const a = d.data();
      console.log(`      docId=${d.id}  studentDisplayId=${a.studentDisplayId}`);
    });
  }

  // ============================================================
  // 4. dailySnapshots
  // ============================================================
  console.log('\n📸 dailySnapshots');
  console.log(SUB);
  const snapsSnap = await db
    .collection(`studentStates/${displayId}/dailySnapshots`)
    .orderBy('date', 'desc')
    .limit(15)
    .get();

  if (snapsSnap.empty) {
    console.log('   (空)');
  } else {
    console.log('   日期         題數   答對   正確率   等級   平均秒數');
    console.log('   ' + '─'.repeat(60));
    for (const doc of snapsSnap.docs) {
      const s = doc.data();
      const avgSec = (s.avgResponseTimeMs / 1000).toFixed(1);
      console.log(
        `   ${s.date}   ${String(s.totalAttempts).padStart(4)}   ${String(s.correctCount).padStart(4)}   ${String(s.correctRate).padStart(3)}%   L${s.level}   ${avgSec}s`
      );
    }
  }

  // ============================================================
  // 5. classStats 快照
  // ============================================================
  const className = displayId.split('_')[0];
  console.log(`\n📊 classStats/${className}（該學生的條目）`);
  console.log(SUB);
  const classSnap = await db.doc(`classStats/${className}`).get();
  if (!classSnap.exists) {
    console.log('   ❌ classStats 不存在');
  } else {
    const classData = classSnap.data();
    const studentEntry = classData.students?.[displayId];
    if (studentEntry) {
      console.log(`   學生條目：`);
      console.log(`      name:     ${studentEntry.name}`);
      console.log(`      attempts: ${studentEntry.attempts}`);
      console.log(`      correct:  ${studentEntry.correct}`);
    } else {
      console.log(`   ⚠️ classStats.students 中沒有 ${displayId} 的條目`);
      console.log(`   現有 students keys：${Object.keys(classData.students ?? {}).slice(0, 10).join(', ')}`);
    }
    console.log(`   classStats.totalAttempts: ${classData.totalAttempts}`);
    console.log(`   classStats.lastUpdated:   ${classData.lastUpdated}`);
  }
}

async function main() {
  console.log(`\n${LINE}`);
  console.log(`🔬 DDA 診斷工具`);
  console.log(`   對象：${displayIds.join(', ')}`);
  console.log(LINE);

  for (const id of displayIds) {
    try {
      await diagnoseOne(id);
    } catch (err) {
      console.error(`\n❌ 診斷 ${id} 失敗：`, err.message);
    }
  }

  console.log(`\n${LINE}`);
  console.log(`✅ 診斷完成`);
  console.log(LINE);
}

main().catch(err => {
  console.error('\n❌ 執行失敗:', err);
  process.exit(1);
});