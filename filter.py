#!/usr/bin/env python3
"""
filter.py
將 1200words_deduplicated.csv 進行多層過濾，移除所有異常條目，
產出 1200words_final.csv 供最終上傳使用。

過濾條件：
1. 黑名單關鍵字（章節標題、片語、非單字）
2. 額外關鍵字（解析殘留，如 "(physical"、"education)" 等）
3. 移除過短單字（長度 < 2，但保留 'a' 等合法單字例外，此處採用黑名單處理）
"""

import pandas as pd

# 讀取 CSV
df = pd.read_csv('1200words_deduplicated.csv', encoding='utf-8-sig')

# ---------- 1. 黑名單（章節標題、片語、非單字） ----------
BLACKLIST = [
    'of body', 'characteristics', 'did done)', 'and areas',
    '(be', 'wh', 'other nouns', 'other verbs', 'other adjectives',
    'other adverbs', 'prepositions', 'geographical', 'determiners',
    'forms of address', 'countries', 'festivals', 'terms',
    'auxiliaries', 'measurements', 'nature', 'insects',
    'accessories', 'clothing', 'apartments', 'houses',
    'hobbies', 'sports', 'transportation', 'locations',
    'places', 'school', 'parts of body', 'personal',
    # 補充遺漏
    'people',  # 避免 'people' 被誤當類別，但 'people' 是合法單字，不應刪除，先註解
    'time',    # 同上
    'family',  # 同上
    'numbers', # 同上
    'clothes', # 合法單字
    'colors',  # 合法單字
    'money',   # 合法單字
    'health',  # 合法單字
]

# 修正：以上黑名單中有些是合法單字，不應刪除，調整為只刪除明確的標題
# 將明確是標題的關鍵字保留
BLACKLIST = [
    'of body', 'characteristics', 'did done)', 'and areas',
    '(be', 'wh', 'other nouns', 'other verbs', 'other adjectives',
    'other adverbs', 'prepositions', 'geographical', 'determiners',
    'forms of address', 'countries', 'festivals', 'terms',
    'auxiliaries', 'measurements', 'nature', 'insects',
    'accessories', 'clothing', 'apartments', 'houses',
    'hobbies', 'sports', 'transportation', 'locations',
    'places', 'school', 'parts of body', 'personal',
    'geographical terms',  # 完整標題
    'and areas',           # 部分標題
]

# ---------- 2. 額外異常關鍵字（解析殘留） ----------
EXTRA_KEYWORDS = [
    '(physical',
    'education)',
    'mailman',
    'carrier)',
    'camp(camping)',
    'fish(fishing)',
    'run(running)',
    'cheer leader',        # 啦啦隊長
    'police officer',      # 警察
    'waitress',            # 女服務生
    'shopkeeper',          # 店主
]

# ---------- 3. 開始過濾 ----------
# 建立布林遮罩（初始全 True）
mask = pd.Series([True] * len(df))

# 過濾黑名單（檢查 word 欄位，不區分大小寫，但我們已統一用小寫）
for keyword in BLACKLIST:
    mask &= ~df['word'].str.lower().str.contains(keyword, na=False, regex=False)

# 過濾額外關鍵字（同時檢查 word 和 meaning，因為有些異常出現在 meaning 中）
for keyword in EXTRA_KEYWORDS:
    mask &= ~df['word'].str.contains(keyword, na=False, regex=False)
    mask &= ~df['meaning'].str.contains(keyword, na=False, regex=False)

# 移除過短單字（長度 < 2），但保留 'a' 等合法單字（'a' 不在黑名單，但我們保留）
# 此處不強制移除，因為黑名單已處理大部分

# 另外移除一些明顯的錯誤條目（手動檢查發現）
# 例如 "PE(physical cheer leader science" 等
mask &= ~df['word'].str.startswith('PE(physical', na=False)
mask &= ~df['word'].str.startswith('education)', na=False)
mask &= ~df['word'].str.startswith('mailman (mail police officer', na=False)

# ---------- 4. 套用過濾 ----------
df_filtered = df[mask]

# ---------- 5. 儲存結果 ----------
df_filtered.to_csv('1200words_final.csv', index=False, encoding='utf-8-sig')

# ---------- 6. 統計資訊 ----------
print(f'原始筆數：{len(df)}')
print(f'過濾後筆數：{len(df_filtered)}')
print(f'移除筆數：{len(df) - len(df_filtered)}')