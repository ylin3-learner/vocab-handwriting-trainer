# 單字手寫訓練器 (Vocab Handwriting Trainer)

一個專為中學生設計的英文單字手寫練習系統。老師上傳單字庫、派發作業，學生在平板上手寫作答，系統自動辨識、判分、排程複習，並在教師後台呈現學習數據。

## ✨ 核心功能

- **手寫辨識**：Google IME API，支援完整單字辨識
- **間隔重複（SM-2）**：智慧排程複習時間
- **Top-K 候選池**：大幅降低 Firestore 讀取量（99%+）
- **作業派發**：老師可設定每日配額、新舊字比例、複習專注度
- **教師後台**：班級進度、風險學生、弱點單字分析
- **離線優先**：本地 localStorage + 背景雲端同步
- **角色權限**：Firebase Auth + Firestore 安全規則

## 🛠️ 技術棧

| 層級 | 技術 |
| :--- | :--- |
| 前端 | TypeScript + React + Vite |
| 後端 | Firebase Firestore + Firebase Auth |
| 手寫辨識 | Google Input Tools API |
| 語音 | Web Speech API |
| 部署 | GitHub Pages |

## 🚀 快速開始

### 前置需求

- Node.js 18+
- 一個 Firebase 專案（Spark 免費方案即可）

### 1. 安裝依賴

```bash
npm install