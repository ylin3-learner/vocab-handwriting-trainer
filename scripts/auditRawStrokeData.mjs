// scripts/auditRawStrokeData.mjs (升級版)
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log('🔍 開始盤點 rawStrokeData 收集狀況...\n');
  const LIMIT = 1000; 
  console.log(`📥 正在拉取最近 ${LIMIT} 筆 attempts 資料...`);
  
  const snapshot = await db.collection('attempts').orderBy('timestamp', 'desc').limit(LIMIT).get();

  if (snapshot.empty) {
    console.log('📭 找不到任何資料。');
    return;
  }

  let totalDocs = 0;
  let docsWithStroke = 0;
  let shouldHaveStrokeCount = 0; 
  let missingStrokeCount = 0;    
  let sampleStrokeData = null;

  snapshot.forEach(doc => {
    totalDocs++;
    const data = doc.data();
    const shouldHaveStroke = (!data.isCorrect || data.timedOut);
    
    if (shouldHaveStroke) shouldHaveStrokeCount++;

    // 🔥 關鍵修正：改為判斷是否為字串
    if (data.rawStrokeData && typeof data.rawStrokeData === 'string') {
      docsWithStroke++;
      if (!sampleStrokeData) {
        try {
          const parsed = JSON.parse(data.rawStrokeData);
          sampleStrokeData = {
            id: doc.id,
            wordId: data.wordId,
            isCorrect: data.isCorrect,
            strokeCount: parsed.length,
            firstStrokePoints: parsed[0]?.length || 0,
            dataSample: parsed[0]?.slice(0, 3) || []
          };
        } catch (e) {
          console.warn(`⚠️ 解析 JSON 失敗：${doc.id}`);
        }
      }
    } else {
      if (shouldHaveStroke) missingStrokeCount++;
    }
  });

  console.log('\n📊 盤點結果：');
  console.log(`   總樣本數：${totalDocs} 筆`);
  console.log(`   理論上應該有軌跡（答錯或超時）：${shouldHaveStrokeCount} 筆`);
  console.log(`   實際有軌跡資料（字串格式）：${docsWithStroke} 筆`);
  console.log(`   🚨 漏掉軌跡資料：${missingStrokeCount} 筆`);
  console.log(`   收集率：${shouldHaveStrokeCount > 0 ? ((docsWithStroke / shouldHaveStrokeCount) * 100).toFixed(1) : 0}%\n`);

  if (sampleStrokeData) {
    console.log('✅ 找到一筆有效的 rawStrokeData 樣本（已解析）：');
    console.log(`   Document ID: ${sampleStrokeData.id}`);
    console.log(`   Word ID: ${sampleStrokeData.wordId}`);
    console.log(`   Is Correct: ${sampleStrokeData.isCorrect}`);
    console.log(`   真實筆畫數 (Strokes): ${sampleStrokeData.strokeCount}`);
    console.log(`   第一筆畫的點數: ${sampleStrokeData.firstStrokePoints}`);
    console.log('   資料格式範例 (前3個點):');
    console.log(JSON.stringify(sampleStrokeData.dataSample, null, 2));
    console.log('   (每個點代表：[x, y, timeOffset, pressure])\n');
  } else {
    console.log('❌ 完全沒有找到任何 rawStrokeData 資料！\n');
  }
}

main().catch(console.error);