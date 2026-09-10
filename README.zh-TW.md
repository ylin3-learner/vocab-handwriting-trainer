# 單字手寫訓練器 (Vocab Handwriting Trainer)

[English README](./README.md)

一個專為中學生設計的英文單字手寫練習系統。老師上傳單字庫、派發作業，學生在平板上手寫作答，系統自動辨識、判分、排程複習，並在教師後台呈現學習數據。

這個專案的目的是取代容易失真的「學生自評」拼字練習，改用客觀的手寫辨識來模擬真實的英語單字比賽情境：老師唸出單字與例句，學生在限定時間內憑記憶手寫作答，系統依照精確拼字結果直接判定——沒有自評、沒有模糊地帶、沒有部分給分。

## ✨ 核心功能

- **手寫辨識**：Google Input Tools API，支援完整單字辨識
- **間隔重複（SM-2）**：依照客觀量測到的拼字準確度與作答時間智慧排程複習時間，不依賴學生自評分數
- **Top-K 候選池**：只維持一小組活躍複習單字，而非每次都查詢整個單字庫，大幅降低 Firestore 讀取量（99%+）
- **作業派發**：老師可依班級或學生設定每日配額、新舊字比例、複習專注度
- **教師後台**：班級進度、風險學生、弱點單字分析
- **離線優先**：本地 localStorage 快取 + 背景雲端同步，教室網路不穩定也不會中斷練習
- **角色權限**：Firebase Auth + Firestore 安全規則，區分老師與學生的存取權限

## 🛠️ 技術棧

| 層級 | 技術 |
| :--- | :--- |
| 前端 | TypeScript + React + Vite |
| 後端 | Firebase Firestore + Firebase Auth |
| 手寫辨識 | Google Input Tools API |
| 語音 | Web Speech API |
| 部署 | GitHub Pages |

## 📁 專案架構

```
vocab-handwriting-trainer/
├── data/
│   ├── raw/words.xlsx          # 老師維護的單字庫來源(唯一真相來源)
│   ├── schema/                 # 固定欄位契約,轉換腳本與前端型別共用同一份
│   └── generated/              # CI 自動產生的 words.json 與驗證報告(不要手動編輯)
├── src/
│   ├── domain/                 # 純業務邏輯:SM-2、判分、選題、倒數計時
│   ├── services/                # I/O 邊界層:辨識引擎、語音出題、Firestore 同步
│   ├── features/                # 各畫面:測驗、登入、教師後台
│   └── types/                   # 對應資料契約的共用型別
├── scripts/                     # 建置階段的 Excel → JSON 轉換與驗證
├── .github/workflows/           # CI:資料轉換 + 建置 + 部署
└── docs/                        # 架構說明與 Excel 資料契約文件
```

詳見 [`docs/architecture.md`](./docs/architecture.md) 與 [`docs/data-contract.md`](./docs/data-contract.md)。

## 🚀 快速開始

### 前置需求

- Node.js 18+
- 一個 Firebase 專案(Spark 免費方案即可)

### 1. 安裝依賴

```bash
npm install
```

### 2. 設定 Firebase

複製環境變數範例檔,填入你 Firebase 專案的網頁應用程式金鑰:

```bash
cp .env.example .env
```

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 3. 換上你的單字庫

把 `data/raw/words.xlsx` 換成你自己的檔案,欄位需符合 [`docs/data-contract.md`](./docs/data-contract.md) 的規格(`word`、`meaning`、`sentence`,以及選填的 `root`、`root_meaning`、`hint`、`level`)。把新檔案推到這個路徑會自動觸發轉換流程,老師不需要執行任何指令。

### 4. 本機執行

```bash
npm run dev
```

### 5. 執行測試

```bash
npm test
```

核心業務邏輯(SM-2 排程、判分、選題邏輯、倒數計時狀態機)用 Node 內建測試框架撰寫,執行快速且不依賴外部套件。瀏覽器相關的整合(手寫辨識、語音合成、畫布擷取)則在瀏覽器中手動驗證。

### 6. 建置與部署

```bash
npm run build
```

推送到 `main` 分支會觸發 GitHub Actions,自動建置並部署到 GitHub Pages。

## 📊 資料格式

單字庫刻意維持 `.xlsx` 格式,方便沒有資訊背景的老師直接在 Excel 中維護。學生的複習進度另外存在 Firestore,換單字庫時不會被覆蓋或洗掉。完整欄位規格請見 [`docs/data-contract.md`](./docs/data-contract.md)。

## 🧪 設計原則

- **單一職責原則(SRP)**——每個模組(判分、排程、選題、辨識、儲存)都只有一個會讓它改變的理由。
- **客觀判分**——餵給 SM-2 的 quality 分數永遠是由拼字準確度與作答時間客觀算出,絕不是學生自評。
- **可抽換的辨識引擎**——應用程式依賴 `RecognitionEngine` 這個介面,而不是綁定特定廠商,之後要更換手寫辨識後端時完全不用動到測驗邏輯。

## 🤝 貢獻

歡迎提出 Issue 或 Pull Request。提交 PR 前請確認 `npm test` 全數通過。

## 📄 授權

詳見 [`LICENSE`](./LICENSE)。
