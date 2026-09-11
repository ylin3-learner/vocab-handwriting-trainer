// scripts/mergeVocabCsv.ts
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
 * 讀取單一 CSV 檔案
 * 使用 ExcelJS 內建的 CSV 解析器（處理引號、逗號）
 */
async function readCsvAsRows(filePath: string): Promise<WordRow[]> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = await workbook.csv.readFile(filePath);

  if (!worksheet) {
    throw new Error(`無法讀取工作表：${filePath}`);
  }

  // 解析標題列
  const headers: string[] = [];
  worksheet.getRow(1).eachCell((cell) => {
    headers.push(String(cell.value || '').trim().replace(/^\uFEFF/, '')); // 去除 BOM
  });

  const wordIdx = headers.indexOf('word');
  const levelIdx = headers.indexOf('level');
  const meaningIdx = headers.indexOf('meaning');
  const sentenceIdx = headers.indexOf('sentence');

  if (wordIdx === -1 || levelIdx === -1 || meaningIdx === -1 || sentenceIdx === -1) {
    throw new Error(
      `缺少必要欄位。\n找到的欄位：${headers.join(', ')}\n需要：word, level, meaning, sentence`
    );
  }

  const rows: WordRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const word = String(row.getCell(wordIdx + 1).value || '').trim();
    if (!word) return;

    rows.push({
      word,
      level: String(row.getCell(levelIdx + 1).value || '').trim(),
      meaning: String(row.getCell(meaningIdx + 1).value || '').trim(),
      sentence: String(row.getCell(sentenceIdx + 1).value || '').trim(),
    });
  });

  return rows;
}

async function merge() {
  const inputDir = process.argv[2] || './vocab_csv';
  const outputFile = process.argv[3] || './vocab_merged.csv';

  if (!fs.existsSync(inputDir)) {
    console.error(`❌ 找不到輸入資料夾：${inputDir}`);
    process.exit(1);
  }

  const files: string[] = fs
    .readdirSync(inputDir)
    .filter((f: string) => f.toLowerCase().endsWith('.csv'))
    .sort();

  if (files.length === 0) {
    console.error(`❌ 資料夾中沒有 CSV 檔案：${inputDir}`);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════');
  console.log(`📂 找到 ${files.length} 個 CSV 檔案：`);
  files.forEach((f: string) => console.log(`   - ${f}`));
  console.log('═══════════════════════════════════════');

  const allRows: WordRow[] = [];
  const seenWords = new Map<string, string>(); // lowercase word → 來源檔名
  const duplicates: Array<{ word: string; file1: string; file2: string }> = [];

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    console.log(`\n📖 讀取 ${file}...`);

    const rows = await readCsvAsRows(filePath);
    console.log(`   讀取到 ${rows.length} 筆`);

    for (const row of rows) {
      const key = row.word.toLowerCase();
      if (seenWords.has(key)) {
        duplicates.push({
          word: row.word,
          file1: seenWords.get(key)!,
          file2: file,
        });
        continue;
      }
      seenWords.set(key, file);
      allRows.push(row);
    }
  }

  // 按 level 排序（數字升冪），同 level 內按 word 字母排序
  allRows.sort((a, b) => {
    const la = parseInt(a.level, 10) || 0;
    const lb = parseInt(b.level, 10) || 0;
    if (la !== lb) return la - lb;
    return a.word.localeCompare(b.word);
  });

  // 輸出合併 CSV
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Vocabulary');
  worksheet.addRow(['word', 'level', 'meaning', 'sentence']);

  for (const row of allRows) {
    worksheet.addRow([row.word, row.level, row.meaning, row.sentence]);
  }

  // 確保輸出資料夾存在
  const outputDir = path.dirname(outputFile);
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await workbook.csv.writeFile(outputFile);

  // 統計
  const byLevel: Record<string, number> = {};
  for (const row of allRows) {
    byLevel[row.level] = (byLevel[row.level] || 0) + 1;
  }

  console.log('\n═══════════════════════════════════════');
  console.log('✅ 合併完成！');
  console.log('═══════════════════════════════════════');
  console.log(`📊 總計：${allRows.length} 筆（去重後）`);
  console.log(`📊 原始：${allRows.length + duplicates.length} 筆`);
  console.log(`📊 去重：${duplicates.length} 筆`);
  console.log('\n📊 各 level 統計：');
  Object.keys(byLevel)
    .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))
    .forEach((level) => {
      console.log(`   Level ${level}: ${byLevel[level]} 筆`);
    });

  if (duplicates.length > 0) {
    console.log('\n⚠️ 發現重複單字（已保留第一次出現的版本）：');
    duplicates.slice(0, 20).forEach((d) => {
      console.log(`   "${d.word}" 在 ${d.file1} 與 ${d.file2} 重複`);
    });
    if (duplicates.length > 20) {
      console.log(`   ...還有 ${duplicates.length - 20} 筆重複未顯示`);
    }
  }

  console.log(`\n📁 輸出檔案：${outputFile}`);
}

merge().catch((err) => {
  console.error('\n❌ 錯誤：', err);
  process.exit(1);
});