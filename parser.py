import re
import fitz  # PyMuPDF
import pandas as pd

LEVEL_MAP = {"第一級": 2, "第二級": 3, "第三級": 4, "第四級": 5, "第五級": 6, "第六級": 7}

# 預先編譯正則，提升效能
PATTERN = re.compile(r'([a-zA-Z]+(?:[\s-][a-zA-Z]+)*).*?(第一級|第二級|第三級|第四級|第五級|第六級)')

def ultra_fast_clean(pdf_path, output_csv):
    doc = fitz.open(pdf_path)
    extracted_data = []

    for page in doc:
        # get_text("text") 極快，直接吐出整頁文字
        text = page.get_text()
        
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            
            match = PATTERN.search(line)
            if match:
                raw_word = match.group(1).strip().lower()
                raw_level = match.group(2).strip()
                
                extracted_data.append({
                    "word": raw_word,
                    "meaning": "",
                    "sentence": "",
                    "level": LEVEL_MAP.get(raw_level)
                })

    df = pd.DataFrame(extracted_data)
    if not df.empty:
        df = df.drop_duplicates(subset=["word"], keep="first")
        df[["word", "meaning", "sentence", "level"]].to_csv(output_csv, index=False, encoding="utf-8-sig")
        print(f"超高速提取完成！共成功抓取 {len(df)} 筆單字。")
    else:
        print("未抓到資料，可能是 Regex 與 PDF 的文字排版結構不匹配。")

ultra_fast_clean("input.pdf", "words.csv")