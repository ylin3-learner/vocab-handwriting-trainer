// scripts/simplifyVocabByUsage.ts
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';

interface WordRow {
  word: string;
  level: string;
  meaning: string;
  sentence: string;
}

/**
 * 要完全過濾掉的條目
 * 這些是「文法功能詞」，不是單字，不該出現在手寫單字系統中
 */
const EXCLUDED_WORDS = new Set([
  // 代詞（變位太複雜，超出 scope）
  'he (him, his, himself)',
  'i (me, my, mine, myself)',
  'it (its, itself)',
  'she (her, hers, herself)',
  'they (them, their, theirs, themselves)',
  'we (us, our, ours, ourselves)',
  'you (your, yours, yourself, yourselves)',
  // 冠詞（不是單字）
  'a/an',
  'O.K./OK/okay',
  'am/a.m.',
  'Mr./Mister'
]);

/**
 * 從原始 word 欄位生成所有可能的變體候選
 */
function generateCandidates(word: string): string[] {
  const candidates = new Set<string>();
  const s = word.trim();
  if (!s) return [];

  // 模式 A：斜線分隔
  if (s.includes('/')) {
    s.split('/').forEach(w => candidates.add(w.trim()));
  }

  // 模式 B：含括號
  const parenMatch = s.match(/^([^(]+)\(([^)]+)\)(.*)$/);
  if (parenMatch) {
    // 🔥 用解構 + 預設值，避開 noUncheckedIndexedAccess
    const [, before = '', inside = '', after = ''] = parenMatch;
    const b = before.trim();
    const i = inside.trim();
    const a = after.trim();
    candidates.add((b + a).trim());       // 原形
    candidates.add((b + i + a).trim());   // 加尾碼
  }

  if (candidates.size === 0) candidates.add(s);

  return [...candidates].filter(c => c.length > 0);
}

/**
 * 在句子中找「第一個出現」的候選變體
 */
function findFirstMatchInSentence(word: string, sentence: string): string | null {
  if (!sentence) return null;

  const candidates = generateCandidates(word);
  if (candidates.length === 0) return null;

  let bestIdx = Infinity;
  let bestCandidate: string | null = null;

  for (const candidate of candidates) {
    if (!candidate) continue;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const regex = new RegExp(`\\b${escaped}`, 'i');
      const match = regex.exec(sentence);
      if (match && match.index < bestIdx) {
        bestIdx = match.index;
        bestCandidate = candidate;
      }
    } catch {
      continue;
    }
  }

  return bestCandidate;
}

async function processFile(inputFile: string, outputFile: string) {
  console.log(`📖 讀取 ${inputFile}...`);
  const workbook = new ExcelJS.Workbook();
  const worksheet = await workbook.csv.readFile(inputFile);
  if (!worksheet) throw new Error(`無法讀取 ${inputFile}`);

  const headers: string[] = [];
  worksheet.getRow(1).eachCell(cell => {
    headers.push(String(cell.value || '').trim().replace(/^\uFEFF/, ''));
  });

  const wordIdx = headers.indexOf('word');
  const levelIdx = headers.indexOf('level');
  const meaningIdx = headers.indexOf('meaning');
  const sentenceIdx = headers.indexOf('sentence');

  if (wordIdx === -1 || levelIdx === -1 || meaningIdx === -1 || sentenceIdx === -1) {
    throw new Error(`缺少必要欄位。找到: ${headers.join(', ')}`);
  }

  const rows: WordRow[] = [];
  const changed: { before: string; after: string }[] = [];
  const unmatched: { word: string; sentence: string }[] = [];
  const excluded: string[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const word = String(row.getCell(wordIdx + 1).value || '').trim();
    if (!word) return;

    // 🔥 步驟 1：過濾排除清單
    if (EXCLUDED_WORDS.has(word.toLowerCase())) {
      excluded.push(word);
      return; // 直接跳過，不加入結果
    }

    const level = String(row.getCell(levelIdx + 1).value || '').trim();
    const meaning = String(row.getCell(meaningIdx + 1).value || '').trim();
    const sentence = String(row.getCell(sentenceIdx + 1).value || '').trim();

    // 🔥 步驟 2：若含 / 或 ()，依句子用法簡化
    const needsSimplification = /[/()]/.test(word);
    let finalWord = word;

    if (needsSimplification) {
      const matched = findFirstMatchInSentence(word, sentence);
      if (matched) {
        finalWord = matched;
        if (matched !== word) {
          changed.push({ before: word, after: matched });
        }
      } else {
        unmatched.push({ word, sentence });
      }
    }

    rows.push({ word: finalWord, level, meaning, sentence });
  });

  // 輸出 CSV
  const outWorkbook = new ExcelJS.Workbook();
  const outSheet = outWorkbook.addWorksheet('Vocabulary');
  outSheet.addRow(['word', 'level', 'meaning', 'sentence']);
  for (const r of rows) {
    outSheet.addRow([r.word, r.level, r.meaning, r.sentence]);
  }

  const outDir = path.dirname(outputFile);
  if (outDir && !fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  await outWorkbook.csv.writeFile(outputFile);

  // ===== 報告 =====
  console.log('\n═══════════════════════════════════════');
  console.log('✅ 處理完成！');
  console.log('═══════════════════════════════════════');
  console.log(`📊 原始筆數：${rows.length + excluded.length}`);
  console.log(`🚫 已過濾：${excluded.length} 筆`);
  console.log(`   ${excluded.join(', ')}`);
  console.log(`📊 保留筆數：${rows.length}`);
  console.log(`✏️ 簡化：${changed.length} 筆`);
  console.log(`⚠️ 無法匹配（保留原樣）：${unmatched.length} 筆`);

  if (changed.length > 0) {
    console.log('\n📝 簡化範例（前 20 筆）：');
    changed.slice(0, 20).forEach(c => {
      console.log(`   "${c.before}" → "${c.after}"`);
    });
    if (changed.length > 20) console.log(`   ...還有 ${changed.length - 20} 筆未顯示`);
  }

  if (unmatched.length > 0) {
    console.log('\n⚠️ 無法匹配的項目（需人工檢查）：');
    unmatched.forEach(u => {
      console.log(`   "${u.word}"  |  句子: "${u.sentence}"`);
    });
  }

  console.log(`\n📁 輸出檔案：${outputFile}`);
}

async function main() {
  const inputFile = process.argv[2] || './vocab_merged.csv';
  const outputFile = process.argv[3] || './vocab_cleaned.csv';
  await processFile(inputFile, outputFile);
}

main().catch(err => {
  console.error('❌ 錯誤:', err);
  process.exit(1);
});