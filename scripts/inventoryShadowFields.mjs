// scripts/inventoryShadowFields.mjs
//
// 用途：盤點系統中所有「複製品欄位」，檢查是否與來源一致。
//
// 這不是「檢查工具」，是「盤點工具」——跑一次，看結果，
// 決定哪些欄位該刪、哪些該保留、哪些需要修復機制。
//
// 跑完後可以刪掉這支腳本。
//
// 使用方式：
//   node scripts/inventoryShadowFields.mjs

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log(`\n📋 盤點影子欄位\n`);

  // ============================================================
  // 檢查 1：studentStates.totalAttempts vs 實際 attempts 數量
  // ============================================================
  console.log(`【檢查 1】studentStates.totalAttempts vs attempts 集合`);
  console.log('═'.repeat(60));

  const statesSnap = await db.collection('studentStates').get();
  const attemptsSnap = await db.collection('attempts').get();

  // 用 displayId 分組
  const attemptsByDisplay = new Map();
  for (const doc of attemptsSnap.docs) {
    const a = doc.data();
    const displayId = a.studentDisplayId;
    if (!displayId) continue;
    attemptsByDisplay.set(displayId, (attemptsByDisplay.get(displayId) || 0) + 1);
  }

  let mismatch1 = 0;
  for (const stateDoc of statesSnap.docs) {
    const displayId = stateDoc.id;
    const state = stateDoc.data();
    const expected = attemptsByDisplay.get(displayId) || 0;
    const actual = state.totalAttempts || 0;

    if (actual !== expected) {
      mismatch1++;
      console.log(`   ❌ ${displayId}: state=${actual}, actual=${expected}, diff=${actual - expected}`);
    }
  }
  if (mismatch1 === 0) {
    console.log(`   ✅ 所有 ${statesSnap.size} 位學生的 totalAttempts 都一致`);
  } else {
    console.log(`   ⚠️  ${mismatch1} / ${statesSnap.size} 位學生不一致`);
  }
  console.log('');

  // ============================================================
  // 檢查 2：classStats.students[id].attempts vs 實際
  // ============================================================
  console.log(`【檢查 2】classStats.students[id].attempts vs attempts 集合`);
  console.log('═'.repeat(60));

  const classStatsSnap = await db.collection('classStats').get();
  let mismatch2 = 0;

  for (const csDoc of classStatsSnap.docs) {
    const cs = csDoc.data();
    if (!cs.students) continue;

    for (const [displayId, s] of Object.entries(cs.students)) {
      const expected = attemptsByDisplay.get(displayId) || 0;
      const actual = s.attempts || 0;

      if (actual !== expected) {
        mismatch2++;
        console.log(`   ❌ ${displayId}: classStats=${actual}, actual=${expected}, diff=${actual - expected}`);
      }
    }
  }
  if (mismatch2 === 0) {
    console.log(`   ✅ 所有 classStats.students 的 attempts 都一致`);
  } else {
    console.log(`   ⚠️  ${mismatch2} 筆不一致`);
  }
  console.log('');

  // ============================================================
  // 檢查 3：classStats.students[id].correct vs 實際
  // ============================================================
  console.log(`【檢查 3】classStats.students[id].correct vs attempts.isCorrect`);
  console.log('═'.repeat(60));

  const correctByDisplay = new Map();
  for (const doc of attemptsSnap.docs) {
    const a = doc.data();
    const displayId = a.studentDisplayId;
    if (!displayId) continue;
    if (a.isCorrect) {
      correctByDisplay.set(displayId, (correctByDisplay.get(displayId) || 0) + 1);
    }
  }

  let mismatch3 = 0;
  for (const csDoc of classStatsSnap.docs) {
    const cs = csDoc.data();
    if (!cs.students) continue;

    for (const [displayId, s] of Object.entries(cs.students)) {
      const expected = correctByDisplay.get(displayId) || 0;
      const actual = s.correct || 0;

      if (actual !== expected) {
        mismatch3++;
        console.log(`   ❌ ${displayId}: classStats=${actual}, actual=${expected}, diff=${actual - expected}`);
      }
    }
  }
  if (mismatch3 === 0) {
    console.log(`   ✅ 所有 classStats.students 的 correct 都一致`);
  } else {
    console.log(`   ⚠️  ${mismatch3} 筆不一致`);
  }
  console.log('');

  // ============================================================
  // 檢查 4：classStats 的總數
  // ============================================================
  console.log(`【檢查 4】classStats.totalAttempts / totalCorrect vs 加總`);
  console.log('═'.repeat(60));

  let mismatch4 = 0;
  for (const csDoc of classStatsSnap.docs) {
    const cs = csDoc.data();
    if (!cs.students) continue;

    const sumAttempts = Object.values(cs.students).reduce((sum, s) => sum + (s.attempts || 0), 0);
    const sumCorrect = Object.values(cs.students).reduce((sum, s) => sum + (s.correct || 0), 0);

    if (cs.totalAttempts !== sumAttempts) {
      mismatch4++;
      console.log(`   ❌ ${csDoc.id}.totalAttempts: 文件=${cs.totalAttempts}, 加總=${sumAttempts}`);
    }
    if (cs.totalCorrect !== sumCorrect) {
      mismatch4++;
      console.log(`   ❌ ${csDoc.id}.totalCorrect: 文件=${cs.totalCorrect}, 加總=${sumCorrect}`);
    }
  }
  if (mismatch4 === 0) {
    console.log(`   ✅ 所有 classStats 的總數都與加總一致`);
  } else {
    console.log(`   ⚠️  ${mismatch4} 筆不一致`);
  }
  console.log('');

  // ============================================================
  // 總結
  // ============================================================
  console.log('═'.repeat(60));
  console.log(`📊 盤點總結`);
  console.log('═'.repeat(60));
  console.log(`   totalAttempts 不一致：  ${mismatch1}`);
  console.log(`   classStats.attempts：  ${mismatch2}`);
  console.log(`   classStats.correct：   ${mismatch3}`);
  console.log(`   classStats 總數：      ${mismatch4}`);
  console.log('');
  console.log(`💡 這些數字告訴你：哪些「複製品欄位」正在漂移。`);
  console.log(`   一致 → 目前沒問題，但機制上仍然脆弱（下次壞了也不知道）。`);
  console.log(`   不一致 → 已知問題。決定是要「修復值」還是「刪除欄位」。\n`);
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  console.error('\n💡 若錯誤為 RESOURCE_EXHAUSTED，請等太平洋午夜配額重置。\n');
  process.exit(1);
});