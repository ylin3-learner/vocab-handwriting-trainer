// scripts/exportAttempts.mjs
//
// 用途：匯出所有 attempts 資料，供未來 ML 手寫辨識訓練使用。
//
// 輸出：
//   exports/attempts-{date}/
//     ├── manifest.jsonl      # 完整元資料（每行一筆 attempt）
//     ├── training.csv        # 精簡版（image_path, transcript）
//     ├── summary.json        # 統計摘要
//     ├── images/{displayId}/ # 解碼後的 PNG 圖像
//     └── README.md           # 資料集說明
//
// 使用方式：
//   node scripts/exportAttempts.mjs              # 預覽（不寫檔）
//   node scripts/exportAttempts.mjs --apply      # 實際匯出
//   node scripts/exportAttempts.mjs --apply --no-images   # 只匯出元資料
//   node scripts/exportAttempts.mjs --apply --only-correct # 只匯出正確答案（高信賴度標籤）
//
// 前置：
//   - 專案根目錄有 serviceAccountKey.json
//   - npm install firebase-admin 已安裝

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, mkdirSync, writeFileSync, createWriteStream } from 'fs';
import { join } from 'path';

// ============================================================
// 命令列參數
// ============================================================
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_IMAGES = args.includes('--no-images');
const ONLY_CORRECT = args.includes('--only-correct');
const BATCH_SIZE = 500;

const DATE = new Date().toISOString().slice(0, 10);
const OUT_DIR = `./exports/attempts-${DATE}`;

// ============================================================
// Firebase 初始化
// ============================================================
const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf-8')
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 工具函式
// ============================================================

/**
 * 解析 data URL，回傳 { mimeType, buffer } 或 null。
 */
function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) return null;
  try {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
    };
  } catch {
    return null;
  }
}

/**
 * 判斷這筆 attempt 的「訓練標籤信賴度」。
 *
 * - high：recognizedText === word.word → 學生寫對、IME 也辨識對
 * - medium：editDistance <= 1 → 可能是輕微筆誤或辨識誤差
 * - low：其他 → 需要人工複核
 */
function classifyConfidence(attempt) {
  const recognized = (attempt.recognizedText || '').toLowerCase().trim();
  const correct = (attempt.word || '').toLowerCase().trim();

  if (!recognized) return 'low';
  if (recognized === correct) return 'high';
  if (attempt.editDistance !== undefined && attempt.editDistance <= 1) {
    return 'medium';
  }
  return 'low';
}

/**
 * 決定這筆 attempt 的訓練標籤。
 *
 * 對於手寫辨識訓練，標籤應該是「學生實際寫出的文字」。
 * 但我們無法直接知道學生寫什麼，只能從 IME 輸出推測。
 *
 * 保守策略：
 *   - high 信賴度：標籤 = word.word（正確拼字）
 *   - medium/low：標籤 = recognizedText（IME 輸出，可能有誤）
 */
function determineLabel(attempt, confidence) {
  if (confidence === 'high') {
    return (attempt.word || '').toLowerCase().trim();
  }
  return (attempt.recognizedText || '').toLowerCase().trim();
}

/**
 * 安全建立目錄。
 */
function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

/**
 * 安全寫入檔案（避免路徑中的特殊字元）。
 */
function safeFileName(str) {
  return String(str)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 100);
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log(`\n📦 匯出 attempts 資料集`);
  console.log(`   輸出目錄：${OUT_DIR}`);
  console.log(`   模式：${APPLY ? '🔥 實際匯出' : '👀 預覽（不寫檔）'}`);
  console.log(`   圖像：${SKIP_IMAGES ? '跳過' : '匯出'}`);
  console.log(`   範圍：${ONLY_CORRECT ? '只匯出正確答案' : '全部'}`);
  console.log('');

  // ============================================================
  // 步驟 1：讀取所有 attempts
  // ============================================================
  console.log('📖 讀取 Firestore attempts...');
  const snapshot = await db.collection('attempts').get();
  console.log(`   找到 ${snapshot.docs.length} 筆 attempts\n`);

  if (snapshot.docs.length === 0) {
    console.log('⚠️  沒有資料可匯出');
    return;
  }

  // ============================================================
  // 步驟 2：準備輸出目錄
  // ============================================================
  if (APPLY) {
    ensureDir(OUT_DIR);
    if (!SKIP_IMAGES) {
      ensureDir(join(OUT_DIR, 'images'));
    }
    console.log(`✅ 已建立輸出目錄：${OUT_DIR}\n`);
  }

  // ============================================================
  // 步驟 3：處理每一筆 attempt
  // ============================================================
  const manifestStream = APPLY
    ? createWriteStream(join(OUT_DIR, 'manifest.jsonl'))
    : null;
  const csvStream = APPLY
    ? createWriteStream(join(OUT_DIR, 'training.csv'))
    : null;

  if (APPLY) {
    csvStream.write('image_path,transcript,confidence,student_id,word\n');
  }

  const stats = {
    total: 0,
    exported: 0,
    skipped: 0,
    withImage: 0,
    withoutImage: 0,
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    byStudent: {},
    byLevel: {},
    imageBytesTotal: 0,
  };

  let counter = 0;

  for (const doc of snapshot.docs) {
    const attempt = { id: doc.id, ...doc.data() };
    stats.total += 1;

    // 篩選
    const confidence = classifyConfidence(attempt);
    if (ONLY_CORRECT && confidence !== 'high') {
      stats.skipped += 1;
      continue;
    }

    // 統計
    if (confidence === 'high') stats.highConfidence += 1;
    else if (confidence === 'medium') stats.mediumConfidence += 1;
    else stats.lowConfidence += 1;

    const displayId = attempt.studentDisplayId || attempt.studentId || 'unknown';
    stats.byStudent[displayId] = (stats.byStudent[displayId] || 0) + 1;

    const level = attempt.level ?? 'unknown';
    stats.byLevel[level] = (stats.byLevel[level] || 0) + 1;

    // 處理圖像
    let imagePath = null;
    const parsed = parseDataUrl(attempt.snapshotImageUrl);

    if (parsed) {
      if (!SKIP_IMAGES && APPLY) {
        const studentDir = join(OUT_DIR, 'images', safeFileName(displayId));
        ensureDir(studentDir);
        const fileName = `attempt_${String(counter).padStart(5, '0')}.png`;
        const fullPath = join(studentDir, fileName);
        writeFileSync(fullPath, parsed.buffer);
        imagePath = `images/${safeFileName(displayId)}/${fileName}`;
        stats.imageBytesTotal += parsed.buffer.length;
      }
      stats.withImage += 1;
    } else {
      stats.withoutImage += 1;
    }

    // 訓練標籤
    const label = determineLabel(attempt, confidence);

    // 寫入 manifest.jsonl
    const record = {
      attemptId: attempt.id,
      imagePath,
      word: attempt.word,
      recognizedText: attempt.recognizedText,
      transcript: label,
      confidence,
      isCorrect: attempt.isCorrect,
      editDistance: attempt.editDistance,
      similarity: attempt.similarity,
      responseTimeMs: attempt.responseTimeMs,
      timestamp: attempt.timestamp,
      studentId: attempt.studentId,
      studentDisplayId: displayId,
      className: attempt.className,
      level: attempt.level,
    };

    if (manifestStream) {
      manifestStream.write(JSON.stringify(record) + '\n');
    }

    // 寫入 training.csv（給 ML 框架的簡潔版）
    if (csvStream && imagePath && label) {
      csvStream.write(
        `"${imagePath}","${label}","${confidence}","${displayId}","${attempt.word}"\n`
      );
    }

    stats.exported += 1;
    counter += 1;

    if (counter % BATCH_SIZE === 0) {
      console.log(`   已處理 ${counter} / ${snapshot.docs.length}...`);
    }
  }

  // 關閉 streams
  if (manifestStream) await new Promise(r => manifestStream.end(r));
  if (csvStream) await new Promise(r => csvStream.end(r));

  // ============================================================
  // 步驟 4：寫入 summary.json
  // ============================================================
  const summary = {
    exportedAt: new Date().toISOString(),
    sourceCollection: 'attempts',
    filters: {
      onlyCorrect: ONLY_CORRECT,
      imagesExported: !SKIP_IMAGES,
    },
    stats: {
      ...stats,
      imageBytesTotalMB: (stats.imageBytesTotal / 1024 / 1024).toFixed(2),
    },
  };

  if (APPLY) {
    writeFileSync(
      join(OUT_DIR, 'summary.json'),
      JSON.stringify(summary, null, 2)
    );
  }

  // ============================================================
  // 步驟 5：寫入 README
  // ============================================================
  const readme = `# Attempts Dataset — ${DATE}

匯出時間：${new Date().toISOString()}
來源：Firestore \`attempts\` 集合

## 檔案說明

| 檔案 | 說明 |
|---|---|
| \`manifest.jsonl\` | 完整元資料（每行一筆 JSON） |
| \`training.csv\` | 精簡版（image_path, transcript, confidence, student_id, word） |
| \`summary.json\` | 統計摘要 |
| \`images/{displayId}/\` | 解碼後的 PNG 手寫圖像 |

## 訓練標籤信賴度（confidence）

| 等級 | 條件 | 用途 |
|---|---|---|
| \`high\` | \`recognizedText === word.word\` | 學生寫對、IME 也辨識對。**首選訓練資料** |
| \`medium\` | \`editDistance <= 1\` | 輕微筆誤或辨識誤差。可作為負樣本 |
| \`low\` | 其他 | 需人工複核。**建議先排除** |

## 訓練建議

1. **先用 \`high\` 信賴度資料微調**：這些樣本標籤最乾淨
2. **用 \`medium\` 資料做對比學習**：讓模型學習「幾乎對」與「完全錯」的差異
3. **排除 \`low\` 資料**：除非有人工標註，否則會汙染訓練集
4. **保留所有元資料**：\`responseTimeMs\`、\`level\` 等欄位可用於分析，不一定要進訓練

## 資料統計

- 總筆數：${stats.total}
- 已匯出：${stats.exported}
- 有圖像：${stats.withImage}
- 無圖像：${stats.withoutImage}
- 高信賴度：${stats.highConfidence}
- 中信賴度：${stats.mediumConfidence}
- 低信賴度：${stats.lowConfidence}

## 使用範例（Python）

\`\`\`python
import json
from PIL import Image

with open('manifest.jsonl') as f:
    for line in f:
        record = json.loads(line)
        if record['confidence'] != 'high':
            continue
        img = Image.open(record['imagePath'])
        label = record['transcript']
        # 餵給你的訓練框架...
\`\`\`

## 隱私提醒

此資料集包含學生姓名與手寫圖像。請：
- 儲存於加密硬碟
- 不要上傳到公開雲端
- 遵守個人資料保護法
- 訓練完成後考慮去識別化或銷毀原始資料
`;

  if (APPLY) {
    writeFileSync(join(OUT_DIR, 'README.md'), readme);
  }

  // ============================================================
  // 步驟 6：顯示結果
  // ============================================================
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 匯出結果`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`   總筆數：${stats.total}`);
  console.log(`   已匯出：${stats.exported}`);
  console.log(`   已跳過：${stats.skipped}`);
  console.log(`   有圖像：${stats.withImage}`);
  console.log(`   無圖像：${stats.withoutImage}`);
  console.log(`   高信賴度：${stats.highConfidence}`);
  console.log(`   中信賴度：${stats.mediumConfidence}`);
  console.log(`   低信賴度：${stats.lowConfidence}`);
  console.log(`   圖像總大小：${(stats.imageBytesTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`${'═'.repeat(60)}\n`);

  if (!APPLY) {
    console.log('⚠️  這是預覽模式，沒有實際寫檔。');
    console.log('   確認無誤後執行：');
    console.log(`   node scripts/exportAttempts.mjs --apply\n`);
  } else {
    console.log(`🎉 匯出完成！`);
    console.log(`   位置：${OUT_DIR}`);
    console.log(`\n⚠️  提醒：`);
    console.log(`   1. 資料含學生姓名，請妥善保管`);
    console.log(`   2. 備份到兩個地方（本機 + 雲端硬碟）`);
    console.log(`   3. 未來訓練完模型後，考慮銷毀原始資料\n`);
  }
}

main().catch((err) => {
  console.error('\n❌ 執行失敗:', err);
  process.exit(1);
});