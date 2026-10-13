// scripts/diagnoseStudentPool.mjs（修正版 v3）
//
// 修正：
// 1. vocabulary 路徑：vocabulary/current/words/{wordId}
// 2. attempts 只存 wordId，用 doc ID 直接抓 vocabulary
// 3. 支援 --days N 看跨天重複
// 4. stateCache 的 wordId 可能已被 sanitize，需要嘗試兩種格式

/*

執行方式

node scripts/diagnoseStudentPool.mjs --display-id 802_18_方妍靜

node scripts/diagnoseStudentPool.mjs --display-id 802_18_方妍靜 --date 2026-10-12

*/

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const ID_IDX = args.indexOf('--display-id');
const DISPLAY_ID = ID_IDX >= 0 ? args[ID_IDX + 1] : null;
const DATE_IDX = args.indexOf('--date');
const TARGET_DATE = DATE_IDX >= 0 ? args[DATE_IDX + 1] : new Date().toISOString().slice(0, 10);
const DAYS_IDX = args.indexOf('--days');
const DAYS = DAYS_IDX >= 0 ? parseInt(args[DAYS_IDX + 1], 10) : 1;

if (!DISPLAY_ID) {
  console.error('❌ 請提供 --display-id');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 核心：從 vocabulary/current/words/{wordId} 抓單字
//
// wordId 可能是 sanitized（Mr_）或原文（Mr.）
// 兩種都試
// ============================================================
async function fetchWordMeta(wordIds) {
  const meta = new Map();
  const uniqueIds = [...new Set(wordIds)].filter(Boolean);

  console.log(`   查詢 ${uniqueIds.length} 個 wordId...`);

  const BATCH = 100;
  for (let i = 0; i < uniqueIds.length; i += BATCH) {
    const chunk = uniqueIds.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map(async (id) => {
        // 先試原文
        try {
          const snap = await db.doc(`vocabulary/current/words/${id}`).get();
          if (snap.exists) {
            const d = snap.data();
            return { id, word: d.word ?? id, level: d.level, found: true };
          }
        } catch (e) {
          // 忽略，繼續試
        }

        // 再試 sanitized 版本（把 _ 還原成 .）
        const restored = id.replace(/_/g, '.');
        if (restored !== id) {
          try {
            const snap = await db.doc(`vocabulary/current/words/${restored}`).get();
            if (snap.exists) {
              const d = snap.data();
              return { id, word: d.word ?? restored, level: d.level, found: true };
            }
          } catch (e) {
            // 忽略
          }
        }

        return { id, word: null, level: null, found: false };
      })
    );
    for (const r of results) {
      meta.set(r.id, r);
    }
  }

  return meta;
}

// ============================================================
// 日期工具
// ============================================================
function getLocalDate(iso, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

async function main() {
  console.log(`\n🔍 診斷學生：${DISPLAY_ID}`);
  console.log(`   日期範圍：${TARGET_DATE} 往前 ${DAYS} 天\n`);

  // ============================================================
  // 1. 學生狀態
  // ============================================================
  const stateRef = db.doc(`studentStates/${DISPLAY_ID}`);
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) {
    console.error(`❌ 找不到 studentStates/${DISPLAY_ID}`);
    process.exit(1);
  }
  const state = stateSnap.data();
  const tz = state.timeZone ?? 'Asia/Taipei';

  console.log('📋 學生狀態：');
  console.log(`   currentLevel: L${state.currentLevel}`);
  console.log(`   totalAttempts: ${state.totalAttempts}`);
  console.log(`   levelLockedUntilTotalAttempts: ${state.levelLockedUntilTotalAttempts}`);
  console.log(`   lastEvaluatedAtTotalAttempts: ${state.lastEvaluatedAtTotalAttempts}`);

  // ============================================================
  // 2. 作業設定
  // ============================================================
  const assignmentsSnap = await db.collection('assignments')
    .where('isActive', '==', true)
    .get();
  const assignments = assignmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const assignment = assignments.find(a => a.className === DISPLAY_ID);

  console.log(`\n🧮 作業設定：`);
  if (assignment) {
    console.log(`   名稱：${assignment.name}`);
    console.log(`   targetLevel: L${assignment.targetLevel}`);
    console.log(`   dailyQuota: ${assignment.dailyQuota}`);
    console.log(`   newRatio: ${assignment.newRatio}`);
    console.log(`   competitionMode: ${assignment.competitionMode}`);
  } else {
    console.log(`   （找不到該學生的作業）`);
  }

  // ============================================================
  // 3. 抓指定日期範圍的 attempts
  // ============================================================
  const endDate = new Date(TARGET_DATE + 'T23:59:59+08:00');
  const startDate = new Date(endDate.getTime() - DAYS * 24 * 60 * 60 * 1000);

  const attemptsSnap = await db.collection('attempts')
    .where('studentDisplayId', '==', DISPLAY_ID)
    .get();

  const allAttempts = attemptsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(a => {
      const t = new Date(a.timestamp);
      return t >= startDate && t <= endDate;
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  console.log(`\n✍️  過去 ${DAYS} 天的作答記錄：共 ${allAttempts.length} 筆`);

  if (allAttempts.length === 0) {
    console.log('   （沒有資料）');
    return;
  }

  // ============================================================
  // 4. 抓所有 wordId 的 meta
  // ============================================================
  const allWordIds = [...new Set(allAttempts.map(a => a.wordId).filter(Boolean))];
  const wordMeta = await fetchWordMeta(allWordIds);

  const foundCount = [...wordMeta.values()].filter(m => m.found).length;
  console.log(`   找到 vocabulary 中的字：${foundCount} / ${allWordIds.length}`);

  // ============================================================
  // 5. 統計：每日字數、跨天重複、字頻
  // ============================================================
  const wordCounts = {};
  const dateWordMap = {};
  const dateCounts = {};

  for (const a of allAttempts) {
    const localDate = getLocalDate(a.timestamp, tz);
    wordCounts[a.wordId] = (wordCounts[a.wordId] || 0) + 1;
    if (!dateWordMap[localDate]) dateWordMap[localDate] = new Set();
    dateWordMap[localDate].add(a.wordId);
    dateCounts[localDate] = (dateCounts[localDate] || 0) + 1;
  }

  console.log(`\n📊 統計：`);
  console.log(`   總題數：${allAttempts.length}`);
  console.log(`   不重複字數：${Object.keys(wordCounts).length}`);

  // 每日統計
  console.log(`\n   每日：`);
  const dates = Object.keys(dateWordMap).sort();
  const seenWords = new Set();
  for (const date of dates) {
    const todayWords = dateWordMap[date];
    const repeated = [...todayWords].filter(w => seenWords.has(w));
    const repeatedPct = todayWords.size > 0
      ? ((repeated.length / todayWords.size) * 100).toFixed(1)
      : '0.0';
    console.log(
      `     ${date}: ${dateCounts[date]} 題, ${todayWords.size} 個不同字, ` +
      `其中 ${repeated.length} 個前幾天出過 (${repeatedPct}%)`
    );
    for (const w of todayWords) seenWords.add(w);
  }

  // 重複 TOP 10
  const sorted = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]);
  console.log(`\n   重複出題 TOP 10：`);
  for (const [wordId, count] of sorted.slice(0, 10)) {
    const m = wordMeta.get(wordId);
    const word = m?.word ?? wordId;
    const level = m?.level ?? '?';
    console.log(`     ${word} (L${level}, wordId=${wordId}): ${count} 次`);
  }

  // ============================================================
  // 6. 每日出題序列（前 10 題）
  // ============================================================
  for (const date of dates.slice(-3)) {  // 只顯示最後 3 天
    const dayAttempts = allAttempts.filter(a => getLocalDate(a.timestamp, tz) === date);
    console.log(`\n   ${date}（${dayAttempts.length} 題）：`);
    for (let i = 0; i < Math.min(10, dayAttempts.length); i++) {
      const a = dayAttempts[i];
      const m = wordMeta.get(a.wordId);
      const word = m?.word ?? a.wordId;
      const level = m?.level ?? '?';
      console.log(`     ${i + 1}. ${a.isCorrect ? '✅' : '❌'} ${word} (L${level})`);
    }
    if (dayAttempts.length > 10) {
      console.log(`     ...（還有 ${dayAttempts.length - 10} 題）`);
    }
  }

  // ============================================================
  // 7. 診斷結論
  // ============================================================
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 診斷結論`);
  console.log(`${'═'.repeat(60)}`);

  const totalUnique = Object.keys(wordCounts).length;
  const totalAttempts = allAttempts.length;
  const repeatRate = ((totalAttempts - totalUnique) / totalAttempts * 100).toFixed(1);

  console.log(`   整體重複率：${repeatRate}%（${totalAttempts - totalUnique} 次重複 / ${totalAttempts} 題）`);

  // 檢查跨天重複
  let crossDayRepeatCount = 0;
  const wordDates = {};
  for (const a of allAttempts) {
    const date = getLocalDate(a.timestamp, tz);
    if (!wordDates[a.wordId]) wordDates[a.wordId] = new Set();
    wordDates[a.wordId].add(date);
  }
  for (const [wordId, datesSet] of Object.entries(wordDates)) {
    if (datesSet.size > 1) crossDayRepeatCount++;
  }
  console.log(`   跨天重複的字：${crossDayRepeatCount} 個 / ${totalUnique} 個`);

  if (crossDayRepeatCount / totalUnique > 0.5) {
    console.log(`\n🚨 高度跨天重複：超過一半的字在不同天重複出現。`);
    console.log(`   可能原因：`);
    console.log(`   1. 複習池的加權抽樣偏重高 reviewCount 的字`);
    console.log(`   2. 沒有「最近 N 天已出過的字降低權重」機制`);
    console.log(`   3. 比賽模式下的出題池太小`);
  }

  if (totalUnique === 1 && totalAttempts > 10) {
    console.log(`\n🚨 確認問題：${totalAttempts} 題只出了 1 個字。`);
  } else if (totalUnique < totalAttempts * 0.3) {
    console.log(`\n⚠️ 出題多樣性偏低：${totalAttempts} 題只出了 ${totalUnique} 個不同字。`);
  } else {
    console.log(`\n✅ 出題多樣性正常：${totalAttempts} 題出了 ${totalUnique} 個不同字。`);
  }

  console.log(`\n`);
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});