// scripts/inspectStudent.mjs
//
// 用途：匯出指定學生的完整資料（studentStates + dailySnapshots），
//       用於分析 DDA 行為、追蹤等級變化、檢查快照正確率。
//
// 使用方式：
//   node scripts/inspectStudent.mjs                            # 用預設 TARGET_DISPLAY_ID
//   node scripts/inspectStudent.mjs 804_18_李芷柔                # 指定學生
//   node scripts/inspectStudent.mjs 804_18_李芷柔 --json        # 同時輸出 JSON 檔
//
// 前置：
//   - 專案根目錄有 serviceAccountKey.json
//   - npm install firebase-admin 已安裝

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'fs';

// ============================================================
// 🔥 預設學生（沒帶參數時使用）
// ============================================================
const DEFAULT_DISPLAY_ID = '804_18_李芷柔';

// ============================================================
// 解析參數
// ============================================================
const args = process.argv.slice(2);
const OUTPUT_JSON = args.includes('--json');
const TARGET_DISPLAY_ID = args.find(a => !a.startsWith('--')) || DEFAULT_DISPLAY_ID;

// ============================================================
// 初始化
// ============================================================
const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf-8')
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 工具函式
// ============================================================
function formatTimestamp(iso) {
  if (!iso) return '(無)';
  const d = new Date(iso);
  const tw = d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  return `${tw} (${iso.slice(0, 10)})`;
}

function printLine(char = '─', len = 70) {
  console.log(char.repeat(len));
}

// ============================================================
// 1. studentStates 主文件
// ============================================================
async function printStudentStates() {
  printLine('═');
  console.log(`📦 studentStates/${TARGET_DISPLAY_ID}`);
  printLine('═');

  const ref = db.doc(`studentStates/${TARGET_DISPLAY_ID}`);
  const snap = await ref.get();

  if (!snap.exists) {
    console.log('   ❌ 文件不存在');
    return null;
  }

  const data = snap.data() || {};

  console.log('\n【基本狀態】');
  console.log(`   currentLevel:                ${data.currentLevel ?? '(未設定)'}`);
  console.log(`   totalAttempts:               ${data.totalAttempts ?? '(未設定)'}`);
  console.log(`   levelLockedUntilTotalAttempts: ${data.levelLockedUntilTotalAttempts ?? '(未設定)'}`);
  console.log(`   lastEvaluatedAtTotalAttempts:  ${data.lastEvaluatedAtTotalAttempts ?? '(未設定)'}`);
  console.log(`   placementDone:               ${data.placementDone}`);
  console.log(`   customSpeechFloor:           ${data.customSpeechFloor ?? '(未設定)'}`);

  // 距離下次評估還差幾題
  if (typeof data.totalAttempts === 'number' && typeof data.lastEvaluatedAtTotalAttempts === 'number') {
    const sinceLastEval = data.totalAttempts - data.lastEvaluatedAtTotalAttempts;
    console.log(`\n【評估觸發分析】`);
    console.log(`   距上次評估: ${sinceLastEval} 題（門檻：≥ 10）`);
    console.log(`   ${sinceLastEval >= 10 ? '✅ 樣本足夠，會評估' : `⚠️ 還要 ${10 - sinceLastEval} 題才會評估`}`);

    if (typeof data.levelLockedUntilTotalAttempts === 'number') {
      const lockedRemaining = data.levelLockedUntilTotalAttempts - data.totalAttempts;
      if (lockedRemaining > 0) {
        console.log(`   🔒 仍在鎖定期，還要 ${lockedRemaining} 題才解除`);
      } else {
        console.log(`   ✅ 無鎖定期`);
      }
    }
  }

  // levelHistory
  console.log('\n【levelHistory 歷史】');
  const history = data.levelHistory || [];
  if (history.length === 0) {
    console.log('   (空)');
  } else {
    history.forEach((h, i) => {
      const level = h.level ?? '?';
      const changedAt = formatTimestamp(h.changedAt);
      const triggeredBy = h.triggeredBy ?? '?';
      const reason = h.reason ?? '(無說明)';
      console.log(`   [${i}] L${level}  ${changedAt}  (${triggeredBy})`);
      console.log(`       ${reason}`);
    });
  }

  return data;
}

// ============================================================
// 2. dailySnapshots 子集合
// ============================================================
async function printDailySnapshots() {
  printLine('═');
  console.log(`📸 studentStates/${TARGET_DISPLAY_ID}/dailySnapshots`);
  printLine('═');

  const ref = db.collection(`studentStates/${TARGET_DISPLAY_ID}/dailySnapshots`);
  const snap = await ref.get();

  if (snap.empty) {
    console.log('   (無快照)');
    return [];
  }

  // 按日期排序
  const snapshots = snap.docs
    .map(d => ({ date: d.id, ...d.data() }))
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`   共 ${snapshots.length} 筆\n`);

  // 表格式輸出（易讀）
  console.log('   ┌────────────┬──────┬────────┬──────┬─────────┬──────────┐');
  console.log('   │   日期     │ 等級 │ 答題數 │ 答對 │ 正確率  │ 平均秒數 │');
  console.log('   ├────────────┼──────┼────────┼──────┼─────────┼──────────┤');
  snapshots.forEach(s => {
    const date = String(s.date ?? '').padEnd(10);
    const level = `L${s.level ?? '?'}`.padEnd(4);
    const total = String(s.totalAttempts ?? '?').padStart(6);
    const correct = String(s.correctCount ?? '?').padStart(4);
    const rate = `${s.correctRate ?? '?'}%`.padStart(7);
    const avgSec = `${((s.avgResponseTimeMs ?? 0) / 1000).toFixed(1)}s`.padStart(8);
    console.log(`   │ ${date} │ ${level} │ ${total} │ ${correct} │ ${rate} │ ${avgSec} │`);
  });
  console.log('   └────────────┴──────┴────────┴──────┴─────────┴──────────┘');

  return snapshots;
}

// ============================================================
// 3. 最近 30 筆 attempts（供 DDA 分析用）
// ============================================================
async function printRecentAttempts() {
  printLine('═');
  console.log(`📝 最近 30 筆 attempts（DDA 滑窗來源）`);
  printLine('═');

  const ref = db.collection('attempts');
  const snap = await ref
    .where('studentDisplayId', '==', TARGET_DISPLAY_ID)
    .orderBy('timestamp', 'desc')
    .limit(30)
    .get();

  if (snap.empty) {
    console.log('   (無作答紀錄)');
    return [];
  }

  const attempts = snap.docs.map(d => d.data());

  // 統計
  const total = attempts.length;
  const correct = attempts.filter(a => a.isCorrect).length;
  const rate = Math.round((correct / total) * 100);
  const validAttempts = attempts.filter(a => (a.responseTimeMs || 0) <= 8000);
  const avgMs = validAttempts.length > 0
    ? Math.round(validAttempts.reduce((s, a) => s + (a.responseTimeMs || 0), 0) / validAttempts.length)
    : 0;

  console.log(`   總數：${total} 筆`);
  console.log(`   答對：${correct} 筆（${rate}%）`);
  console.log(`   平均：${(avgMs / 1000).toFixed(1)} 秒`);

  console.log('\n【最近 10 筆】');
  attempts.slice(0, 10).forEach((a, i) => {
    const time = a.timestamp?.slice(11, 19) ?? '?';
    const word = a.wordId ?? '?';
    const correct = a.isCorrect ? '✅' : '❌';
    const responseMs = a.responseTimeMs ?? 0;
    const sec = (responseMs / 1000).toFixed(1);
    console.log(`   ${String(i + 1).padStart(2)}. [${time}] ${word.padEnd(20)} ${correct} ${sec}s`);
  });

  return attempts;
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log(`\n🎯 檢查學生：${TARGET_DISPLAY_ID}\n`);

  const stateData = await printStudentStates();
  const snapshots = await printDailySnapshots();
  const attempts = await printRecentAttempts();

  // 如果帶 --json，輸出 JSON 檔
  if (OUTPUT_JSON) {
    const output = {
      displayId: TARGET_DISPLAY_ID,
      studentStates: stateData,
      dailySnapshots: snapshots,
      recentAttempts: attempts,
      exportedAt: new Date().toISOString(),
    };
    const filename = `inspect_${TARGET_DISPLAY_ID.replace(/[^\w]/g, '_')}.json`;
    writeFileSync(filename, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`\n📄 已輸出 JSON 檔：${filename}`);
  }

  printLine('═');
  console.log('✅ 完成');
  printLine('═');
}

main().catch((err) => {
  console.error('\n❌ 執行失敗:', err);
  process.exit(1);
});