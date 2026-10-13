// scripts/exportAttempts.mjs
//
// 用途：匯出所有 attempts 資料，供未來 ML 手寫辨識訓練使用。
//
// 🔥 修正歷史：
//   2026-10-13 v1：attempts 只有 wordId，需從 vocabulary 查回 word
//   2026-10-13 v2：加入 CorrectnessSignal 四象限分類
//   2026-10-13 v3：加入 IME 品質訊號（forcedMatch + candidatesSnapshot
//                  + targetRank），用於訓練時的假陽性過濾
//
// 輸出：
//   exports/attempts-{date}/
//     ├── manifest.jsonl      # 完整元資料
//     ├── training.csv        # 精簡版
//     ├── train.txt           # 訓練集清單
//     ├── val.txt             # 驗證集清單（依學生分組）
//     ├── summary.json        # 統計摘要
//     ├── images/{displayId}/ # 解碼後的 PNG
//     └── README.md           # 資料集說明
//
// 使用方式：
//   node scripts/exportAttempts.mjs              # 預覽
//   node scripts/exportAttempts.mjs --apply      # 實際匯出
//   node scripts/exportAttempts.mjs --apply --no-images
//   node scripts/exportAttempts.mjs --apply --only-matched
//   node scripts/exportAttempts.mjs --apply --only-high-ime-confidence
//
// 預估讀取量：
//   - attempts 全部：約 14,500 次
//   - vocabulary 全部：約 5,991 次
//   總計約 20,500 次讀取（Spark 每日 50K 內）
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
const ONLY_MATCHED = args.includes('--only-matched');
const ONLY_HIGH_IME = args.includes('--only-high-ime-confidence');
const VAL_RATIO = 0.15;
const BATCH_SIZE = 500;

const DATE = new Date().toISOString().slice(0, 10);
const OUT_DIR = `./exports/attempts-${DATE}`;

// ============================================================
// 畫布常數
// ============================================================
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 120;

// ============================================================
// 預設時限（用於舊資料的 timedOut 回推）
// ============================================================
const DEFAULT_TIME_LIMIT_MS = 8000;

// ============================================================
// 🔥 IME 信賴度門檻
//
// targetRank 的定義：目標字在 candidatesSnapshot 中的位置（0-indexed）
//   - 0：IME 的第一候選就是目標字 → 高信賴度
//   - 1-2：IME 把目標字排在第 2-3 位 → 中信賴度
//   - 3+：目標字排在很後面 → 低信賴度（可能假陽性）
//   - null：目標字不在前 5 名 → 極低信賴度（幾乎確定是假陽性）
//
// 這裡只定義「高信賴度」的門檻，用於 --only-high-ime-confidence。
// ============================================================
const HIGH_IME_CONFIDENCE_RANK = 0;

// ============================================================
// Firebase 初始化
// ============================================================
const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf-8')
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ============================================================
// 載入 vocabulary（wordId → word 映射）
// ============================================================
async function loadWordMap() {
  console.log('📖 載入 vocabulary（wordId → word 映射）...');

  const snap = await db.collection('vocabulary').doc('current').collection('words').get();

  const map = new Map();

  for (const doc of snap.docs) {
    const data = doc.data();
    const originalId = doc.id;
    const word = data.word || originalId;

    map.set(originalId, word);

    const sanitizedId = originalId.replace(/\./g, '_');
    if (sanitizedId !== originalId) {
      map.set(sanitizedId, word);
    }
  }

  console.log(`   共載入 ${snap.docs.length} 個字，建立 ${map.size} 個 key\n`);
  return map;
}

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

function isLikelyBlank(parsed) {
  if (!parsed) return true;
  return parsed.approxBytes < 1024;
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

function buildImageFileName(word, signal, counter) {
  const safeWord = safeFileName((word || 'unknown').toLowerCase());
  const safeSignal = safeFileName(signal);
  return `${safeWord}_${safeSignal}_${String(counter).padStart(5, '0')}.png`;
}

function resolveWord(attempt, wordMap) {
  const wordId = attempt.wordId || '';
  return wordMap.get(wordId) || wordId;
}

function computeMatched(attempt, word) {
  const recognized = (attempt.recognizedText || '').toLowerCase().trim();
  const correct = (word || '').toLowerCase().trim();
  return recognized !== '' && recognized === correct;
}

/**
 * 🔥 計算目標字在候選清單中的排名（0-indexed）。
 *
 * 為什麼重要：
 *   當 matched=true 時，目標字一定在候選清單中（因為系統主動選了它）。
 *   但目標字的排名反映了 IME 的辨識信心：
 *     - rank 0：IME 第一候選就是目標字 → 高信賴度
 *     - rank 3+：目標字排很後面 → 低信賴度（可能假陽性）
 *
 * 回傳值：
 *   0-4：目標字在候選前 5 名的位置
 *   null：目標字不在前 5 名（或沒有候選清單）
 */
function computeTargetRank(attempt, word) {
  const candidates = attempt.candidatesSnapshot || [];
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const target = (word || '').toLowerCase().trim();
  if (!target) return null;

  for (let i = 0; i < candidates.length; i++) {
    const cand = (candidates[i] || '').toLowerCase().trim();
    if (cand === target) return i;
  }
  return null;
}

/**
 * 🔥 IME 信賴度分類。
 *
 * 依 targetRank 與 forcedMatch 綜合判斷：
 *   - high：targetRank = 0（IME 第一候選就是目標字）
 *   - medium：targetRank 1-2
 *   - low：targetRank 3+ 或 null
 *   - unknown：舊資料（無 candidatesSnapshot）
 */
function classifyImeConfidence(attempt, word) {
  if (!attempt.candidatesSnapshot) return 'unknown';

  const rank = computeTargetRank(attempt, word);
  if (rank === null) return 'low';
  if (rank === 0) return 'high';
  if (rank <= 2) return 'medium';
  return 'low';
}

function resolveCorrectness(attempt, word) {
  if (attempt.correctnessSignal) {
    return {
      signal: attempt.correctnessSignal,
      matched: attempt.correctnessSignal === 'true-positive'
            || attempt.correctnessSignal === 'false-negative',
      timedOut: attempt.correctnessSignal === 'false-negative'
             || attempt.correctnessSignal === 'compound-error',
      signalSource: 'measured',
    };
  }

  const matched = computeMatched(attempt, word);
  const timedOut = attempt.timedOut !== undefined
    ? attempt.timedOut
    : (attempt.responseTimeMs || 0) > DEFAULT_TIME_LIMIT_MS;

  let signal;
  if (matched && !timedOut) signal = 'true-positive';
  else if (matched && timedOut) signal = 'false-negative';
  else if (!matched && !timedOut) signal = 'true-negative';
  else signal = 'compound-error';

  return { signal, matched, timedOut, signalSource: 'inferred' };
}

function classifyConfidence(attempt, word, resolved) {
  const recognized = (attempt.recognizedText || '').toLowerCase().trim();
  const correct = (word || '').toLowerCase().trim();

  if (!recognized) return 'low';
  if (recognized === correct) return 'high';
  if (attempt.editDistance !== undefined && attempt.editDistance <= 1) {
    return 'medium';
  }
  return 'low';
}

function determineLabel(attempt, word, resolved) {
  if (resolved.matched) {
    return (word || '').toLowerCase().trim();
  }
  return (attempt.recognizedText || '').toLowerCase().trim();
}

function splitStudentsForValidation(studentIds, valRatio) {
  const shuffled = [...studentIds].sort(() => Math.random() - 0.5);
  const valCount = Math.max(1, Math.floor(studentIds.length * valRatio));
  return new Set(shuffled.slice(0, valCount));
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log(`\n📦 匯出 attempts 資料集`);
  console.log(`   輸出目錄：${OUT_DIR}`);
  console.log(`   模式：${APPLY ? '🔥 實際匯出' : '👀 預覽（不寫檔）'}`);
  console.log(`   圖像：${SKIP_IMAGES ? '跳過' : '匯出'}`);
  console.log(`   範圍：${ONLY_MATCHED ? '只匯出 matched=true' : '全部'}`);
  if (ONLY_HIGH_IME) {
    console.log(`   額外篩選：只匯出 IME 高信賴度（targetRank=0）`);
  }
  console.log(`   驗證集比例：${(VAL_RATIO * 100).toFixed(0)}%（按學生分組）`);
  console.log('');

  // ============================================================
  // 步驟 1：載入 vocabulary 映射
  // ============================================================
  const wordMap = await loadWordMap();

  // ============================================================
  // 步驟 2：讀取所有 attempts
  // ============================================================
  console.log('📖 讀取 Firestore attempts...');
  const snapshot = await db.collection('attempts').get();
  console.log(`   找到 ${snapshot.docs.length} 筆 attempts\n`);

  if (snapshot.docs.length === 0) {
    console.log('⚠️  沒有資料可匯出');
    return;
  }

  // ============================================================
  // 步驟 3：收集學生 ID + 判斷新舊資料比例
  // ============================================================
  const allStudentIds = new Set();
  let measuredCount = 0;
  let inferredCount = 0;
  let hasCandidatesCount = 0;

  for (const doc of snapshot.docs) {
    const a = doc.data();
    const sid = a.studentDisplayId || a.studentId;
    if (sid) allStudentIds.add(sid);
    if (a.correctnessSignal) measuredCount++;
    else inferredCount++;
    if (a.candidatesSnapshot) hasCandidatesCount++;
  }

  const valStudents = splitStudentsForValidation(
    Array.from(allStudentIds),
    VAL_RATIO
  );

  console.log(`   👥 學生總數：${allStudentIds.size}`);
  console.log(`   🎯 驗證集學生：${Array.from(valStudents).join(', ')}`);
  console.log(`   📊 標籤來源：`);
  console.log(`      measured（新資料，有 correctnessSignal）：${measuredCount}`);
  console.log(`      inferred（舊資料，啟發式回推）：${inferredCount}`);
  console.log(`   📊 IME 候選清單：`);
  console.log(`      有記錄（新資料）：${hasCandidatesCount}`);
  console.log(`      無記錄（舊資料）：${snapshot.docs.length - hasCandidatesCount}\n`);

  // ============================================================
  // 步驟 4：準備輸出目錄
  // ============================================================
  if (APPLY) {
    ensureDir(OUT_DIR);
    if (!SKIP_IMAGES) {
      ensureDir(join(OUT_DIR, 'images'));
    }
    console.log(`✅ 已建立輸出目錄：${OUT_DIR}\n`);
  }

  // ============================================================
  // 步驟 5：處理每一筆 attempt
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
    csvStream.write(
      'image_path,transcript,confidence,correctness_signal,matched,timed_out,' +
      'signal_source,ime_confidence,target_rank,forced_match,candidates_count,' +
      'student_id,word,word_length\n'
    );
  }

  const stats = {
    total: 0,
    exported: 0,
    skipped: 0,
    skippedBlank: 0,
    skippedNoImage: 0,
    skippedLowIme: 0,
    withImage: 0,
    // 舊版分類（保留向後相容）
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    // 四象限分類
    truePositive: 0,
    falseNegative: 0,
    trueNegative: 0,
    compoundError: 0,
    // 標籤來源
    measuredCount: 0,
    inferredCount: 0,
    // 🔥 IME 品質訊號
    imeHigh: 0,
    imeMedium: 0,
    imeLow: 0,
    imeUnknown: 0,
    // 資料分割
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

    // 解析實際單字
    const word = resolveWord(attempt, wordMap);

    // 解析 correctnessSignal
    const resolved = resolveCorrectness(attempt, word);

    // 🔥 IME 信賴度分類
    const imeConfidence = classifyImeConfidence(attempt, word);
    const targetRank = computeTargetRank(attempt, word);

    // 篩選：只匯出 matched=true
    if (ONLY_MATCHED && !resolved.matched) {
      stats.skipped += 1;
      continue;
    }

    // 🔥 篩選：只匯出 IME 高信賴度
    if (ONLY_HIGH_IME && imeConfidence !== 'high') {
      stats.skippedLowIme += 1;
      continue;
    }

    // 處理圖像
    const parsed = parseDataUrl(attempt.snapshotImageUrl);

    if (!parsed) {
      stats.skippedNoImage += 1;
      continue;
    }

    if (isLikelyBlank(parsed)) {
      stats.skippedBlank += 1;
      continue;
    }

    // 統計（四象限）
    switch (resolved.signal) {
      case 'true-positive':  stats.truePositive += 1; break;
      case 'false-negative': stats.falseNegative += 1; break;
      case 'true-negative':  stats.trueNegative += 1; break;
      case 'compound-error': stats.compoundError += 1; break;
    }

    // 統計（標籤來源）
    if (resolved.signalSource === 'measured') stats.measuredCount += 1;
    else stats.inferredCount += 1;

    // 🔥 統計（IME 信賴度）
    switch (imeConfidence) {
      case 'high':    stats.imeHigh += 1; break;
      case 'medium':  stats.imeMedium += 1; break;
      case 'low':     stats.imeLow += 1; break;
      default:        stats.imeUnknown += 1; break;
    }

    // 統計（向後相容）
    const confidence = classifyConfidence(attempt, word, resolved);
    if (confidence === 'high') stats.highConfidence += 1;
    else if (confidence === 'medium') stats.mediumConfidence += 1;
    else stats.lowConfidence += 1;

    const displayId = attempt.studentDisplayId || attempt.studentId || 'unknown';
    stats.byStudent[displayId] = (stats.byStudent[displayId] || 0) + 1;

    const level = attempt.level ?? 'unknown';
    stats.byLevel[level] = (stats.byLevel[level] || 0) + 1;

    const wordLength = (word || '').length;
    stats.byWordLength[wordLength] = (stats.byWordLength[wordLength] || 0) + 1;

    // 寫入圖像
    let imagePath = null;
    if (!SKIP_IMAGES && APPLY) {
      const studentDir = join(OUT_DIR, 'images', safeFileName(displayId));
      ensureDir(studentDir);
      const fileName = buildImageFileName(word, resolved.signal, counter);
      const fullPath = join(studentDir, fileName);
      writeFileSync(fullPath, parsed.buffer);
      imagePath = `images/${safeFileName(displayId)}/${fileName}`;
      stats.imageBytesTotal += parsed.buffer.length;
    }
    stats.withImage += 1;

    // 訓練標籤
    const label = determineLabel(attempt, word, resolved);

    // 判斷 train / val
    const isVal = valStudents.has(displayId);

    // 寫入 manifest.jsonl
    const record = {
      attemptId: attempt.id,
      imagePath,
      // 圖像元資料
      imageWidth: CANVAS_WIDTH,
      imageHeight: CANVAS_HEIGHT,
      imageAspectRatio: CANVAS_WIDTH / CANVAS_HEIGHT,
      canvasCells: wordLength + 2,
      // 單字資訊
      word,
      wordLength,
      wordId: attempt.wordId,
      recognizedText: attempt.recognizedText,
      transcript: label,
      // 正確性訊號
      correctnessSignal: resolved.signal,
      matched: resolved.matched,
      timedOut: resolved.timedOut,
      signalSource: resolved.signalSource,
      confidence,
      // 🔥 IME 品質訊號（新增）
      imeConfidence,
      targetRank,
      forcedMatch: attempt.forcedMatch ?? null,
      candidatesSnapshot: attempt.candidatesSnapshot ?? null,
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
      const candidatesCount = (attempt.candidatesSnapshot || []).length;
      csvStream.write(
        `"${imagePath}","${label}","${confidence}","${resolved.signal}",` +
        `${resolved.matched},${resolved.timedOut},"${resolved.signalSource}",` +
        `"${imeConfidence}",${targetRank ?? ''},${attempt.forcedMatch ?? ''},` +
        `${candidatesCount},"${displayId}","${word}",${wordLength}\n`
      );
    }

    // 寫入 train.txt / val.txt
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
  // 步驟 6：寫入 summary.json
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
      onlyMatched: ONLY_MATCHED,
      onlyHighImeConfidence: ONLY_HIGH_IME,
      imagesExported: !SKIP_IMAGES,
    },
    split: {
      valRatio: VAL_RATIO,
      strategy: 'by-student',
      valStudents: Array.from(valStudents),
    },
    correctness: {
      measured: stats.measuredCount,
      inferred: stats.inferredCount,
      note: 'measured = 有 correctnessSignal 欄位；inferred = 用啟發式回推。' +
            'inferred 的 timedOut 用預設時限 8000ms 猜測，不準確。',
    },
    imeQuality: {
      high: stats.imeHigh,
      medium: stats.imeMedium,
      low: stats.imeLow,
      unknown: stats.imeUnknown,
      note: '依 targetRank 分類：high=rank0, medium=rank1-2, low=rank3+ 或 null。' +
            'unknown 為舊資料（無 candidatesSnapshot）。',
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
  // 步驟 7：寫入 README
  // ============================================================
  const readme = `# Attempts Dataset — ${DATE}

匯出時間：${new Date().toISOString()}
來源：Firestore \`attempts\` 集合

## 檔案說明

| 檔案 | 說明 |
|---|---|
| \`manifest.jsonl\` | 完整元資料（每行一筆 JSON） |
| \`training.csv\` | 精簡版（含所有品質訊號） |
| \`train.txt\` | 訓練集清單（image_path\\tlabel） |
| \`val.txt\` | 驗證集清單（按學生分組） |
| \`summary.json\` | 統計摘要 |
| \`images/{displayId}/\` | 解碼後的 PNG 手寫圖像 |

## 圖像規格

- **畫布尺寸**：${CANVAS_WIDTH} × ${CANVAS_HEIGHT} px
- **格子數**：單字長度 + 2
- **格式**：PNG

## 三層品質訊號

這份資料集有三層獨立的品質訊號，用於訓練資料的篩選與加權。

### 第 1 層：四象限（correctnessSignal）

| 象限 | 條件 | 訓練用途 |
|---|---|---|
| \`true-positive\` | 寫對 + 未超時 | 手寫辨識正樣本 |
| \`false-negative\` | **寫對 + 超時** | **手寫辨識正樣本** + 速度訓練 |
| \`true-negative\` | 寫錯 + 未超時 | 錯誤偵測負樣本 |
| \`compound-error\` | 寫錯 + 超時 | 邊緣樣本，可排除 |

### 第 2 層：標籤來源（signalSource）

| 來源 | 條件 | 可信度 |
|---|---|---|
| \`measured\` | 有 \`correctnessSignal\` 欄位 | 高 |
| \`inferred\` | 無欄位，啟發式回推 | 中 |

### 第 3 層：IME 信賴度（imeConfidence）

**為什麼需要這一層**：Google IME 在辨識時會回傳候選清單。當學生寫的字與目標字相似時，IME 可能把目標字排進候選，而系統的「\`exactMatch || candidates[0]\`」邏輯會**主動選中目標字**。這導致 \`matched = true\` 的樣本中，有一部分其實是**假陽性**。

**訊號定義**：

| 欄位 | 意義 |
|---|---|
| \`targetRank\` | 目標字在候選清單中的位置（0-indexed）；\`null\` 表示不在前 5 名 |
| \`imeConfidence\` | 依 targetRank 分類：\`high\` (rank 0)、\`medium\` (rank 1-2)、\`low\` (rank 3+ 或 null) |
| \`candidatesSnapshot\` | IME 回傳的前 5 個候選字 |
| \`forcedMatch\` | 系統是否主動選中了目標字（新資料才有） |

**關鍵洞察**：\`forcedMatch\` 在當前邏輯下恆等於 \`matched\`（因為系統只有在找到目標字時才會選它）。**真正有價值的訊號是 \`targetRank\`**——它反映了 IME 對該候選的信心排名。

**訓練建議**：

| 訓練策略 | 資料篩選 | 適用 |
|---|---|---|
| **嚴格** | \`matched=true\` 且 \`imeConfidence=high\` | 高品質正樣本，少量資料 |
| **寬鬆** | \`matched=true\`（全部） | 大量資料，容忍雜訊 |
| **加權** | 用 \`targetRank\` 當損失權重 | 平衡數量與品質 |

## 資料統計

### 四象限分佈

- true-positive：${stats.truePositive}
- false-negative：${stats.falseNegative}
- true-negative：${stats.trueNegative}
- compound-error：${stats.compoundError}

### 標籤來源

- measured（準確）：${stats.measuredCount}
- inferred（啟發式回推）：${stats.inferredCount}

### IME 信賴度

- high（rank 0）：${stats.imeHigh}
- medium（rank 1-2）：${stats.imeMedium}
- low（rank 3+ 或 null）：${stats.imeLow}
- unknown（舊資料，無候選清單）：${stats.imeUnknown}

### 整體

- 總筆數：${stats.total}
- 已匯出：${stats.exported}
- 已跳過（空白）：${stats.skippedBlank}
- 已跳過（無圖像）：${stats.skippedNoImage}
- 已跳過（IME 低信賴度）：${stats.skippedLowIme}
- 訓練集：${stats.trainCount}
- 驗證集：${stats.valCount}

## 已知限制

**Google IME 的假陽性（false match）**：當學生寫的字與目標字相似時，
IME 可能把學生寫的錯字「猜成」目標字（例如寫 \`appease\` 被辨識為
\`appear\`）。這使得 \`matched = true\` 的樣本並非 100% 可信。

**緩解方式**：
- 用 \`imeConfidence\` 過濾（\`--only-high-ime-confidence\`）
- 用 \`targetRank\` 對損失函數加權
- 訓練後用模型偵測離群樣本

## 訓練策略

### 不需要二階段訓練

用同一份資料訓練，關鍵是「用 \`matched\` 當標籤，不用 \`isCorrect\`」：

- \`matched = true\` 的樣本 → 標籤 = \`word\`
- \`matched = false\` 的樣本 → 標籤 = \`recognizedText\`

### 不同訓練任務的資料選擇

| 訓練任務 | 資料範圍 | 標籤 |
|---|---|---|
| 手寫辨識模型 | 全部 | \`matched\` |
| 手寫辨識（嚴格） | \`imeConfidence=high\` | \`matched\` |
| 速度預測模型 | 只用 \`signalSource=measured\` | \`timedOut\` |
| 錯誤偵測模型 | 全部 | \`recognizedText\` |

## 使用範例（Python）

\`\`\`python
import json
from PIL import Image

# 手寫辨識：用 matched 當標籤，targetRank 當信心加權
with open('manifest.jsonl') as f:
    for line in f:
        r = json.loads(line)
        if not r['matched']:
            continue
        img = Image.open(r['imagePath'])
        label = r['transcript']
        # 用 targetRank 當 loss 權重
        weight = 1.0 if r['targetRank'] == 0 else 0.5
        # 餵給訓練框架...

# 速度預測：只用 measured 資料
with open('manifest.jsonl') as f:
    for line in f:
        r = json.loads(line)
        if r['signalSource'] != 'measured':
            continue
        img = Image.open(r['imagePath'])
        is_slow = r['timedOut']
        # 訓練二分類器...
\`\`\`

## 隱私提醒

此資料集包含學生姓名與手寫圖像。請妥善保管，遵守個人資料保護法。
`;

  if (APPLY) {
    writeFileSync(join(OUT_DIR, 'README.md'), readme);
  }

  // ============================================================
  // 步驟 8：顯示結果
  // ============================================================
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 匯出結果`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`   總筆數：${stats.total}`);
  console.log(`   已匯出：${stats.exported}`);
  console.log(`   已跳過（空白）：${stats.skippedBlank}`);
  console.log(`   已跳過（無圖像）：${stats.skippedNoImage}`);
  if (ONLY_HIGH_IME) {
    console.log(`   已跳過（IME 非高信賴度）：${stats.skippedLowIme}`);
  }
  console.log('');
  console.log(`   四象限分佈：`);
  console.log(`      true-positive： ${stats.truePositive}`);
  console.log(`      false-negative：${stats.falseNegative}  ← 手寫辨識正樣本`);
  console.log(`      true-negative： ${stats.trueNegative}`);
  console.log(`      compound-error：${stats.compoundError}`);
  console.log('');
  console.log(`   標籤來源：`);
  console.log(`      measured：${stats.measuredCount}`);
  console.log(`      inferred：${stats.inferredCount}`);
  console.log('');
  console.log(`   IME 信賴度：`);
  console.log(`      high（rank 0）：${stats.imeHigh}`);
  console.log(`      medium（rank 1-2）：${stats.imeMedium}`);
  console.log(`      low（rank 3+ 或 null）：${stats.imeLow}`);
  console.log(`      unknown（舊資料）：${stats.imeUnknown}`);
  console.log('');
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
  console.error('\n💡 若錯誤為 RESOURCE_EXHAUSTED，請等太平洋午夜配額重置。\n');
  process.exit(1);
});