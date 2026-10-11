// scripts/exportAttempts.mjs
//
// 用途：匯出所有 attempts 資料，供未來 ML 手寫辨識訓練使用。
//
// 輸出：
//   exports/attempts-{date}/
//     ├── manifest.jsonl      # 完整元資料（每行一筆 attempt）
//     ├── training.csv        # 精簡版（image_path, transcript）
//     ├── train.txt           # 訓練集清單（image_path\tlabel）
//     ├── val.txt             # 驗證集清單（依學生分組）
//     ├── summary.json        # 統計摘要
//     ├── images/{displayId}/ # 解碼後的 PNG 圖像
//     └── README.md           # 資料集說明
//
// 使用方式：
//   node scripts/exportAttempts.mjs              # 預覽（不寫檔）
//   node scripts/exportAttempts.mjs --apply      # 實際匯出
//   node scripts/exportAttempts.mjs --apply --no-images   # 只匯出元資料
//   node scripts/exportAttempts.mjs --apply --only-correct # 只匯出正確答案
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
const VAL_RATIO = 0.15;  // 驗證集比例（按學生分組）
const BATCH_SIZE = 500;

const DATE = new Date().toISOString().slice(0, 10);
const OUT_DIR = `./exports/attempts-${DATE}`;

// ============================================================
// 畫布常數（與 HandwritingCanvas.tsx 一致）
// ============================================================
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 120;

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

function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) return null;
  try {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
      approxBytes: Math.floor(match[2].length * 0.75),
    };
  } catch {
    return null;
  }
}

/**
 * 判斷圖像是否為空白。
 *
 * 我們用一個啟發式方法：PNG 檔案大小。
 * 空白畫布（只有格線）的 PNG 通常會非常小（< 2KB）。
 * 有筆畫的畫布通常 > 3KB。
 *
 * 這是近似判斷，不是 100% 準確，但足以過濾明顯的空白樣本。
 */
function isLikelyBlank(parsed) {
  if (!parsed) return true;
  // 空白畫布的 PNG base64 通常 < 1KB
  return parsed.approxBytes < 1024;
}

/**
 * 判斷訓練標籤信賴度。
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
 * 決定訓練標籤。
 *
 * - high：標籤 = word.word（正確拼字）
 * - medium/low：標籤 = recognizedText（IME 輸出，可能有誤）
 */
function determineLabel(attempt, confidence) {
  if (confidence === 'high') {
    return (attempt.word || '').toLowerCase().trim();
  }
  return (attempt.recognizedText || '').toLowerCase().trim();
}

function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

function safeFileName(str) {
  return String(str)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 100);
}

/**
 * 產生有辨識度的檔名。
 *
 * 格式：{word}_{confidence}_{counter}.png
 * 例如：appease_high_00042.png
 *
 * 這樣肉眼檢查時，一眼就知道這張圖是什麼單字、什麼信賴度。
 */
function buildImageFileName(word, confidence, counter) {
  const safeWord = safeFileName((word || 'unknown').toLowerCase());
  const safeConf = safeFileName(confidence);
  return `${safeWord}_${safeConf}_${String(counter).padStart(5, '0')}.png`;
}

/**
 * 按學生分組，隨機選出驗證集學生。
 * 避免「同一個學生的樣本同時出現在訓練與驗證集」的資料洩漏。
 */
function splitStudentsForValidation(studentIds, valRatio) {
  const shuffled = [...studentIds].sort(() => Math.random() - 0.5);
  const valCount = Math.max(1, Math.floor(studentIds.length * valRatio));
  const valStudents = new Set(shuffled.slice(0, valCount));
  return valStudents;
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
  console.log(`   驗證集比例：${(VAL_RATIO * 100).toFixed(0)}%（按學生分組）`);
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
  // 步驟 1.5：第一次掃描，收集所有學生 ID
  // ============================================================
  const allStudentIds = new Set();
  for (const doc of snapshot.docs) {
    const a = doc.data();
    const sid = a.studentDisplayId || a.studentId;
    if (sid) allStudentIds.add(sid);
  }
  const valStudents = splitStudentsForValidation(
    Array.from(allStudentIds),
    VAL_RATIO
  );
  console.log(`   👥 學生總數：${allStudentIds.size}`);
  console.log(`   🎯 驗證集學生：${Array.from(valStudents).join(', ')}\n`);

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
  const trainStream = APPLY
    ? createWriteStream(join(OUT_DIR, 'train.txt'))
    : null;
  const valStream = APPLY
    ? createWriteStream(join(OUT_DIR, 'val.txt'))
    : null;

  if (APPLY) {
    csvStream.write('image_path,transcript,confidence,student_id,word,word_length\n');
  }

  const stats = {
    total: 0,
    exported: 0,
    skipped: 0,
    skippedBlank: 0,
    skippedNoImage: 0,
    withImage: 0,
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    trainCount: 0,
    valCount: 0,
    byStudent: {},
    byLevel: {},
    byWordLength: {},
    imageBytesTotal: 0,
  };

  let counter = 0;
  let trainCounter = 0;
  let valCounter = 0;

  for (const doc of snapshot.docs) {
    const attempt = { id: doc.id, ...doc.data() };
    stats.total += 1;

    // 篩選：只匯出正確答案
    const confidence = classifyConfidence(attempt);
    if (ONLY_CORRECT && confidence !== 'high') {
      stats.skipped += 1;
      continue;
    }

    // 處理圖像
    const parsed = parseDataUrl(attempt.snapshotImageUrl);

    if (!parsed) {
      stats.skippedNoImage += 1;
      continue;
    }

    // 跳過空白圖像
    if (isLikelyBlank(parsed)) {
      stats.skippedBlank += 1;
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

    const wordLength = (attempt.word || '').length;
    stats.byWordLength[wordLength] = (stats.byWordLength[wordLength] || 0) + 1;

    // 寫入圖像
    let imagePath = null;
    if (!SKIP_IMAGES && APPLY) {
      const studentDir = join(OUT_DIR, 'images', safeFileName(displayId));
      ensureDir(studentDir);
      const fileName = buildImageFileName(attempt.word, confidence, counter);
      const fullPath = join(studentDir, fileName);
      writeFileSync(fullPath, parsed.buffer);
      imagePath = `images/${safeFileName(displayId)}/${fileName}`;
      stats.imageBytesTotal += parsed.buffer.length;
    }
    stats.withImage += 1;

    // 訓練標籤
    const label = determineLabel(attempt, confidence);

    // 判斷這筆是 train 還是 val
    const isVal = valStudents.has(displayId);

    // 寫入 manifest.jsonl
    const record = {
      attemptId: attempt.id,
      imagePath,
      // 圖像元資料（固定畫布，但記錄下來方便追溯）
      imageWidth: CANVAS_WIDTH,
      imageHeight: CANVAS_HEIGHT,
      imageAspectRatio: CANVAS_WIDTH / CANVAS_HEIGHT,
      // 畫布格子數 = 單字長度 + 2（隱含字符位置先驗）
      canvasCells: wordLength + 2,
      // 單字資訊
      word: attempt.word,
      wordLength,
      recognizedText: attempt.recognizedText,
      transcript: label,
      confidence,
      // 作答訊號
      isCorrect: attempt.isCorrect,
      editDistance: attempt.editDistance,
      similarity: attempt.similarity,
      responseTimeMs: attempt.responseTimeMs,
      // 學生資訊
      timestamp: attempt.timestamp,
      studentId: attempt.studentId,
      studentDisplayId: displayId,
      className: attempt.className,
      level: attempt.level,
      // 資料分割
      split: isVal ? 'val' : 'train',
    };

    if (manifestStream) {
      manifestStream.write(JSON.stringify(record) + '\n');
    }

    // 寫入 training.csv
    if (csvStream && imagePath && label) {
      csvStream.write(
        `"${imagePath}","${label}","${confidence}","${displayId}","${attempt.word}",${wordLength}\n`
      );
    }

    // 寫入 train.txt / val.txt（給 TrOCR、PaddleOCR 等框架）
    if (imagePath && label) {
      const line = `${imagePath}\t${label}\n`;
      if (isVal) {
        if (valStream) valStream.write(line);
        valCounter += 1;
      } else {
        if (trainStream) trainStream.write(line);
        trainCounter += 1;
      }
    }

    stats.exported += 1;
    counter += 1;

    if (counter % BATCH_SIZE === 0) {
      console.log(`   已處理 ${counter}...`);
    }
  }

  // 關閉 streams
  const closeStream = (s) => s ? new Promise(r => s.end(r)) : Promise.resolve();
  await Promise.all([
    closeStream(manifestStream),
    closeStream(csvStream),
    closeStream(trainStream),
    closeStream(valStream),
  ]);

  stats.trainCount = trainCounter;
  stats.valCount = valCounter;

  // ============================================================
  // 步驟 4：寫入 summary.json
  // ============================================================
  const summary = {
    exportedAt: new Date().toISOString(),
    sourceCollection: 'attempts',
    canvas: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      aspectRatio: CANVAS_WIDTH / CANVAS_HEIGHT,
      note: '固定畫布寬度 600px，格子數 = 單字長度 + 2',
    },
    filters: {
      onlyCorrect: ONLY_CORRECT,
      imagesExported: !SKIP_IMAGES,
    },
    split: {
      valRatio: VAL_RATIO,
      strategy: 'by-student',
      valStudents: Array.from(valStudents),
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
| \`training.csv\` | 精簡版（image_path, transcript, confidence, student_id, word, word_length） |
| \`train.txt\` | 訓練集清單（image_path\\tlabel） |
| \`val.txt\` | 驗證集清單（按學生分組，避免資料洩漏） |
| \`summary.json\` | 統計摘要 |
| \`images/{displayId}/\` | 解碼後的 PNG 手寫圖像 |

## 圖像規格

- **畫布尺寸**：${CANVAS_WIDTH} × ${CANVAS_HEIGHT} px（固定）
- **寬高比**：${(CANVAS_WIDTH / CANVAS_HEIGHT).toFixed(1)}:1
- **格子數**：單字長度 + 2（例如 \`appease\` 有 9 格）
- **格式**：PNG（含黑色筆跡與灰色格線）

**重要**：畫布寬度固定，但有效內容寬度隨單字長度變化。
模型可以從畫布的「相對筆跡分布」學習字符位置，不需要額外的位置標註。

## 訓練標籤信賴度（confidence）

| 等級 | 條件 | 用途 |
|---|---|---|
| \`high\` | \`recognizedText === word.word\` | 學生寫對、IME 也辨識對。**首選訓練資料** |
| \`medium\` | \`editDistance <= 1\` | 輕微筆誤或辨識誤差。可作為負樣本 |
| \`low\` | 其他 | 需人工複核。**建議先排除** |

## 資料分割

- 驗證集按**學生分組**（leave-students-out）
- 驗證集比例：${(VAL_RATIO * 100).toFixed(0)}%
- 驗證集學生：${Array.from(valStudents).join(', ')}
- **理由**：避免同一個學生的樣本同時出現在訓練與驗證集，導致評估過度樂觀

## 訓練建議

1. **先用 \`high\` 信賴度資料微調**：標籤最乾淨
2. **用 \`medium\` 資料做對比學習**：讓模型學習「幾乎對」與「完全錯」的差異
3. **排除 \`low\` 資料**：除非有人工標註，否則會汙染訓練集
4. **保留所有元資料**：\`responseTimeMs\`、\`level\` 可用於分析，不一定要進訓練

## 建議的訓練框架

- **TrOCR**（Microsoft）：Transformer-based，不需要字符切割
- **PaddleOCR**：CTC-based，支援變長輸入
- **自訂 CRNN + CTC**：輕量，適合部署到瀏覽器

## 資料統計

- 總筆數：${stats.total}
- 已匯出：${stats.exported}
- 已跳過（空白）：${stats.skippedBlank}
- 已跳過（無圖像）：${stats.skippedNoImage}
- 高信賴度：${stats.highConfidence}
- 中信賴度：${stats.mediumConfidence}
- 低信賴度：${stats.lowConfidence}
- 訓練集：${stats.trainCount}
- 驗證集：${stats.valCount}

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
        # 所有圖像都是 600x120，不需 resize
        # 但可以按 word_length 做分層採樣
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
  console.log(`   已跳過（空白）：${stats.skippedBlank}`);
  console.log(`   已跳過（無圖像）：${stats.skippedNoImage}`);
  console.log(`   高信賴度：${stats.highConfidence}`);
  console.log(`   中信賴度：${stats.mediumConfidence}`);
  console.log(`   低信賴度：${stats.lowConfidence}`);
  console.log(`   訓練集：${stats.trainCount}`);
  console.log(`   驗證集：${stats.valCount}`);
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