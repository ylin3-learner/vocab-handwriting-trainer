#!/usr/bin/env python3
"""
parse_1200words.py
解析 1200words new 2021 2.pdf 並產生乾淨的 CSV，包含國中程度例句。
執行方式：uv run --with pdfplumber python parse_1200words.py
"""

import csv
import re
from pathlib import Path
import pdfplumber

PDF_PATH = Path("1200words new 2021 2.pdf")
OUTPUT_CSV = Path("1200words.csv")

# 類別關鍵字黑名單（這些是章節標題，不應被當作單字）
CATEGORY_BLACKLIST = [
    "People", "Personal", "Parts", "Family", "Numbers", "Time",
    "Food", "Clothing", "accessories", "Sports", "Hobbies",
    "Houses", "apartments", "School", "Places", "locations",
    "Transportation", "measurements", "Occupations", "nature",
    "insects", "auxiliaries", "Prepositions", "Health",
    "Forms", "Address", "Money", "Tableware", "Colors",
    "Countries", "areas", "festivals", "Geographical", "terms",
    "determiners", "nouns", "verbs", "adjectives", "adverbs",
    "Other", "others"
]


def generate_simple_sentence(word, meaning, pos=""):
    """根據單字發想國中程度的簡單英文例句與中文對譯。"""
    w = word.lower().strip()

    # 特殊代換與常規範本
    if w in ["apple", "banana", "orange", "food", "fruit"]:
        return f"I eat an {w} every day.", f"我每天吃一個{meaning}。"
    elif w in ["cat", "dog", "bird", "pet", "animal"]:
        return f"She has a cute {w}.", f"她有一隻可愛的{meaning}。"
    elif w in ["book", "pen", "pencil", "paper", "notebook"]:
        return f"This is my {w}.", f"這是我的{meaning}。"
    elif w in ["teacher", "student", "doctor", "nurse", "friend"]:
        return f"He is a good {w}.", f"他是一位好{meaning}。"
    elif w in ["happy", "sad", "busy", "tired", "hungry"]:
        return f"I feel {w} today.", f"我今天感到{meaning}。"
    elif w in ["big", "small", "tall", "short", "old", "new"]:
        return f"The house is very {w}.", f"這間房子非常{meaning}。"
    elif w in ["run", "walk", "jump", "swim", "dance", "sing"]:
        return f"They like to {w} in the park.", f"他們喜歡在公園{meaning}。"
    elif w in ["eat", "drink", "read", "write", "study", "play"]:
        return f"We {w} together after school.", f"我們放學後一起{meaning}。"
    elif w in ["red", "blue", "green", "yellow", "white", "black"]:
        return f"My favorite color is {w}.", f"我最喜歡的顏色是{meaning}。"
    else:
        # 通用標準國中句型
        return (
            f"The word '{w}' means {meaning} in Chinese.",
            f"單字 '{w}' 在中文裡的意思是{meaning}。",
        )


def parse_pdf_to_words(pdf_path):
    all_rows = []
    current_category = "未分類"

    with pdfplumber.open(pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            text = page.extract_text() or ""

            # 抓取章節分類 (例如: "1. People 人物")
            cat_match = re.search(
                r"(\d+)\.\s*([A-Za-z\s,/&]+?)\s*([\u4e00-\u9fa5]+)", text
            )
            if cat_match:
                current_category = (
                    f"{cat_match.group(1)}. {cat_match.group(2).strip()}"
                )

            words_info = page.extract_words()
            i = 0
            n = len(words_info)

            while i < n:
                token = words_info[i]["text"].strip()

                # 跳過頁碼與分類標題資訊
                
                if (
                    token.isdigit()
                    or any(keyword in token for keyword in CATEGORY_BLACKLIST)
                ):
                    i += 1
                    continue

                # 匹配英文單字 (可能包含空格或連字號)
                if re.match(r"^[a-zA-Z\s\(\)\-\'/]+$", token):
                    eng_tokens = [token]
                    j = i + 1

                    # 收集連續的英文/標點組合 (例如: "hot dog", "pencil box(case)")
                    while j < n and re.match(
                        r"^[a-zA-Z\s\(\)\-\'/]+$", words_info[j]["text"]
                    ):
                        eng_tokens.append(words_info[j]["text"].strip())
                        j += 1

                    # 檢查緊接著的是否為中文解釋
                    if j < n and re.search(
                        r"[\u4e00-\u9fa5]", words_info[j]["text"]
                    ):
                        chn_tokens = [words_info[j]["text"].strip()]
                        k = j + 1
                        while k < n and re.search(
                            r"[\u4e00-\u9fa5;；,，/]", words_info[k]["text"]
                        ):
                            chn_tokens.append(words_info[k]["text"].strip())
                            k += 1

                        eng_word = " ".join(eng_tokens).strip()
                        chn_meaning = "".join(chn_tokens).strip()

                        # 潔淨英文單字與中文
                        eng_word = re.sub(r"\s+", " ", eng_word)

                        if eng_word and chn_meaning:
                            sentence_eng, sentence_chn = (
                                generate_simple_sentence(
                                    eng_word, chn_meaning
                                )
                            )
                            all_rows.append(
                                {
                                    "word": eng_word,
                                    "meaning": chn_meaning,
                                    "sentence": sentence_eng,
                                    "sentence_meaning": sentence_chn,
                                    "category": current_category,
                                }
                            )
                        i = k
                        continue
                i += 1

    return all_rows


def main():
    if not PDF_PATH.exists():
        print(f"❌ 找不到 PDF：{PDF_PATH.resolve()}")
        return

    print(f"📖 開始讀取並解析：{PDF_PATH}")
    words_data = parse_pdf_to_words(PDF_PATH)

    # 去重（保留順序）
    unique_words = []
    seen = set()
    for item in words_data:
        key = (item["word"].lower(), item["meaning"])
        if key not in seen:
            seen.add(key)
            unique_words.append(item)

    # 寫入 CSV
    fieldnames = ["word", "meaning", "sentence", "sentence_meaning", "category"]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(unique_words)

    print(f"✅ 解析完成！共匯出 {len(unique_words)} 筆乾淨的單字至 {OUTPUT_CSV}")


if __name__ == "__main__":
    main()