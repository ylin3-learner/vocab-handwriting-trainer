# 📖 英語單字王比賽訓練系統（Vocabulary King Trainer）

這是一套為國中學生準備「英語單字王比賽」而設計的適應性單字訓練系統。系統結合間隔重
複演算法（SM-2）、語音出題、⼿寫擷取與辨識、適應性難度分級、以及教師數據儀表板，同
時刻意把操作複雜度壓到最低——⽼師只需要把 Excel 拖進 GitHub 就能換掉整套單字庫，完全
不需要碰程式碼。

> 這份 README 記錄了這個專案完整的開發脈絡：⽐賽規則如何形塑系統設計、關鍵架構決
> 策、資料契約，以及分階段的開發路線圖（Stage 0 → Stage 7）。

---

## 🏆 為什麼要做這個系統

⽐賽的計分⽅式是 **五關、每關 10 題**，由主試者現場抽題籤決定題⽬。外籍⽼師唸出單字
與例句，參賽者必須在 **8 秒內**於⼩⽩板上寫出答案，且**答案不得塗改**——⼀旦塗改⼀律
視為未通過。未通過者離開座位，答對 31 題以上者依序評定名次。

正是這種「限時聽寫、⼿寫不得塗改、答錯淘汰」的⽐賽形式，決定了這個系統的核⼼設計⽅
向：

- **間隔重複（Spaced Repetition）**：讓練習時間花在學⽣真正不熟的字上，⽽不是已經
  會的字。
- **限時⼿寫擷取**，對應⽐賽現場「限時內寫完、不得塗改」的規則。
- **客觀判分、不讓學⽣⾃評**：系統只根據辨識出的⽂字與正確答案⽐對、以及作答花費的
  時間來判分，學⽣從來不需要（也不能）⾃⼰打分數。
- **教師儀表板**，讓⽼師⼀眼看出全班的弱點，不需要⼿動彙整成績。
- **適應性難度分級**，讓學⽣從第一天就從差不多的層級開始，並依客觀表現升降——而不是
  假設「大家都從 Level 1 開始」。

## ✨ 核⼼功能

| 類別 | 功能 |
|---|---|
| 練習流程 | 語⾳唸出單字＋例句 → 限時⼿寫擷取 → 辨識 → 客觀判分 → SM-2 排程下次複習 |
| 間隔重複 | SM-2 演算法；**只有答錯的字會進入複習池**（`everWrong` 旗標），避免已經答對的字浪費未來的複習配額 |
| ⼿寫辨識 | 畫布擷取 ＋ Google IME ⼿寫 API |
| 語音 | Web Speech API，可調整播放語速（預設 1.0x 訓練真實英聽）＋「🐢 重聽一次（慢速）」按鈕，速度下限由老師設定（預設 0.85x） |
| 適應性分級 | `PlacementOrchestrator` 用二分搜尋式的階梯（L3 起始、每級 3 題）將新學生放到合適層級；`LevelProgressionService` ＋ `RuleBasedStrategy` 依滾動表現持續升／降級 |
| 作業系統 | 老師可設定每日配額、新舊字比例、複習專注度、**目標難度層級**（加權出題：目標 ＋ 當前 ＋ 探針）、每份作業的語速下限。優先序：個人 > 班級 > 全校 |
| 單字庫管理 | ⽼師上傳 `.xlsx` → Schema 驗證 → 預覽 → 每 400 筆為一批、批間延遲 1 秒的批次發布，避免配額暴衝 |
| 教師儀表板 | 學⽣總覽、⾵險偵測、Top-K 弱點分析、作答時間分佈、學習風格雷達圖、錯誤類型圓餅圖、成長曲線（累積 7 天後解鎖）、單一學生 PDF 報告匯出 |
| ⾝份與權限 | 學⽣匿名登⼊、教師／管理員 Email/Password 登⼊；Firestore 安全規則依⾓⾊限制存取；自訂聲明透過 `getIdTokenResult(true)` 強制刷新讀取 |
| 防作弊訊號 | 依 editDistance ＋作答時間偵測「亂答」，與真正的拼字錯誤分開標記 |
| 效能設計 | Top-K 候選池（⽽⾮全表掃描）、預聚合班級統計、批次寫入（`AttemptBatcher`）、以 `random` 欄位做隨機抽樣、即時配額監控與全域橫幅警示 |
| 跨裝置狀態 | 學習狀態（當前等級、SM-2 進度、每日快照）以複合 `displayId`（`{班級}_{座號}_{姓名}`）為 key，而非 Firebase UID，換裝置或重新登入都不會遺失進度 |
| 報表與生命週期 | 單一學生 PDF 報告匯出；針對畢業／退場學生的封存服務 |

## 🧱 系統架構

整個程式碼庫依照 **單⼀職責原則（SRP）** 拆分：`domain/` 只放純邏輯，`services/`
負責所有對外的 I/O（Firestore、匯出、配額監控），`features/` 再把兩者組裝成畫⾯。
以下是專案**目前實際的檔案結構**：

```
vocab-handwriting-trainer/
├── tsconfig.json
├── vite.config.ts
│
├── scripts/ # Build-time／維護用工具
│ ├── mergeVocabCsv.ts # 合併多個原始單字來源成一份 CSV
│ ├── simplifyVocabByUsage.ts # 依使用頻率精簡單字庫
│ ├── set-role.mjs # 幫 Firebase 使用者設定 teacher/admin 自訂聲明
│ └── tsconfig.json
│
├── vocab_csv/
│ └── vocab_cleaned.csv # 清理後的單字庫（CSV pipeline）
│
└── src/
├── App.tsx / main.tsx / firebase.ts / vite-env.d.ts
│
├── contexts/
│ └── AuthContext.tsx # 讀取 Firebase 自訂聲明 → role（student/teacher/admin）
│
├── domain/ # 純函式：不碰 DOM、不碰網路、不碰資料庫
│ ├── analytics/
│ │ ├── radarMetrics.ts # 學習風格雷達圖運算
│ │ └── studentAnalyzer.ts (+test) # 單一學生的統計聚合
│ ├── assignment/
│ │ └── selectAssignment.ts (+test) # 作業優先序查找
│ ├── date/overdue.ts # 逾期複習日期運算
│ ├── grading/grader.ts (+test) # 客觀判分＋計算 SM-2 用的 quality 分數
│ ├── placement/
│ │ └── placementDecision.ts (+test)# 分級測驗的階梯決策
│ ├── progression/ # 適應性分級邏輯
│ │ ├── evaluationGuard.ts (+test) # 「現在該不該評估？」的守衛判斷
│ │ ├── LevelProgressionStrategy.ts
│ │ ├── RuleBasedStrategy.ts
│ │ ├── metricsCalculator.ts
│ │ └── progression.test.ts
│ ├── scheduler/
│ │ ├── sm2.ts (+test) # 間隔重複演算法
│ │ └── reviewStateMapper.ts
│ ├── selection/questionSelector.ts (+test)
│ ├── string/
│ │ ├── displayId.ts # buildDisplayId：{班級}{座號}{姓名}
│ │ ├── sanitizeId.ts # word → 穩定且 Firestore 安全的 wordId
│ │ └── similarity.ts # editDistance／相似度，用於亂答偵測
│ └── validation/wordSchema.ts # 單字庫欄位契約
│
├── services/ # I/O 邊界層
│ ├── analytics/
│ │ ├── AnalyticsService.ts # 從 Firestore 聚合單一學生資料
│ │ ├── ClassStatsService.ts # 預聚合的班級統計
│ │ └── ArchivedStudentsService.ts # 跨梯次學生的封存／退場管理
│ ├── assignment/AssignmentService.ts # 老師可調整的班級每日配額
│ ├── export/studentReportPdf.ts # 產生單一學生的 PDF 報告
│ ├── profile/ProfileService.ts # 學生姓名／班級 profile（以 uid 為 key）
│ ├── progression/
│ │ ├── LevelProgressionService.ts
│ │ ├── PerformanceTracker.ts
│ │ └── StudentStateService.ts
│ ├── status/quotaMonitor.ts # Firestore 讀寫配額追蹤 ＋ 全域橫幅
│ ├── storage/
│ │ ├── ProgressStore.ts # 介面
│ │ ├── FirestoreProgressStore.ts
│ │ ├── LocalStorageProgressStore.ts
│ │ ├── InMemoryProgressStore.ts
│ │ ├── HybridProgressStore.ts # 本地優先，同步回 Firestore；熔斷器＋重試佇列
│ │ └── AttemptBatcher.ts # 把每次作答的 4 個寫入合併成 1 個原子 commit
│ └── wordRepository/
│ ├── WordRepository.ts # 介面
│ ├── FirestoreWordRepository.ts
│ └── InMemoryWordRepository.ts
│
├── features/ # 依使用者流程切分的畫面
│ ├── admin/AdminPanel.tsx
│ ├── common/AppHeader.tsx # 依角色顯示的導航列
│ ├── login/
│ │ ├── StudentLogin.tsx # 匿名登入＋儲存 profile＋iOS 音訊解鎖
│ │ └── TeacherLogin.tsx # Email/Password 登入
│ ├── placement/PlacementOrchestrator.ts # 初始分級測驗流程
│ ├── quiz/
│ │ ├── QuizOrchestrator.ts # 統籌整個練習流程
│ │ ├── QuizSessionApi.ts # 普通＋分級模式共用的介面
│ │ ├── AnswerProcessor.ts # 辨識結果 → 判分 → SM-2（純運算）
│ │ ├── HandwritingCanvas.tsx
│ │ ├── Countdown.tsx
│ │ └── QuizScreen.tsx
│ └── dashboard/
│ ├── TeacherDashboard.tsx
│ ├── AssignmentManager.tsx
│ ├── hooks/useStudentDetail.ts # 讀取＋快取單一學生詳情
│ └── components/
│ ├── StudentDetailPanel.tsx
│ ├── WeakWordsTable.tsx
│ ├── ResponseTimeBar.tsx
│ ├── ErrorBreakdownPie.tsx
│ ├── LearningStyleRadar.tsx
│ └── StudentGrowthChart.tsx
│
└── types/
├── word.ts
├── progression.ts
├── analytics.ts
├── archivedStudent.ts
└── dailySnapshot.ts
```


### 值得特別說明的設計決策

- **單字內容與學習進度完全分離。** 單字庫永遠只存「內容」（單字、意思、例句、難
  度）。SRS 狀態（`reviewInterval`、`easeFactor`、`nextReviewDate` 等）存在
  Firestore 的 `studentStates/{displayId}/words/{wordId}`。⽼師發布新單字庫時，不會
  不⼩⼼洗掉任何學⽣的複習紀錄。

- **學習狀態以 `displayId` 為 key，而非 Firebase UID。** 匿名登入每次都會產生新
  UID，如果用 UID 當 key，學生換裝置或重新登入就會遺失進度。複合 key
  `{班級}_{座號}_{姓名}`（例如 `709_1_林佑倫`）跨 session 穩定，所以學習等級、
  SM-2 進度、每日快照統一存在 `studentStates/{displayId}` 底下。

- **判分永遠不相信使⽤者輸入。** `domain/grading/grader.ts` 只根據「辨識出的⽂字
  vs. 正確答案」、「作答時間 vs. 時限」計算出客觀的 `quality` 分數（0–5）；
  `AnswerProcessor.ts` 是唯一一個把辨識結果串接到判分、SM-2、儲存的地方。`sm2.ts`
  完全不知道原始的使⽤者輸入是什麼，只接收這個已經算好的分數。

- **SM-2 只追蹤錯題。** `ReviewState.everWrong` 一旦被設為 `true` 就永不清除，所以
  學生第一次就答對的字永遠不會進入複習池。這是刻意的取捨：複習配額應該花在弱點上，
  而不是已經掌握的字。

- **儲存層是分層的，不是單體的。** `ProgressStore` 是一個介面，底下有
  `InMemoryProgressStore`、`LocalStorageProgressStore`、`FirestoreProgressStore`，
  以及結合「本地優先反應速度」與「Firestore 同步」的 `HybridProgressStore`，另外用
  `AttemptBatcher` 把每次作答的 4 個寫入（SM-2 進度、學習狀態計數、作答紀錄、班級統
  計）合併成**單一原子 `writeBatch`**。

- **配額耗盡時有熔斷器＋重試佇列。** 當 Firestore 回傳 `resource-exhausted`，
  `HybridProgressStore` 會停止嘗試寫雲端、把變更排入 `localStorage` 佇列，並顯示全
  域橫幅。熔斷器在下一個太平洋午夜配額重置時才解除——而不是固定延遲後解除，那樣只是
  再撞一次牆。

- **候選池，而非全表掃描。** 早期版本在學⽣登入時載入全部複習歷史，直接把 Firestore
  免費⽅案的讀取配額打爆（⼀次 7,000 多次讀取）。現在由 `quotaMonitor.ts` 直接追蹤
  讀寫量，搭配 Top-K 候選池與 `ClassStatsService` 的預聚合文件供教師儀表板使用。

- **用 `random` 欄位做隨機抽樣。** `getNewWordsByLevels` 原本用 `orderBy('word')`，
  每次都從字母序最前面開始抓同一批單字。現在每個單字文件都帶一個 `random: number`，
  查詢時用兩段式範圍掃描（先 `random >= r`、再 `random < r` 補齊），真正做到隨機。

- **作業優先序是真實的階層。** `selectActiveAssignment`（純函式）選最具體的匹配：個
  人 > 班級 > 全校；同類型多個時取 createdAt 最新。當同一個對象有多個生效中作業
  時，老師會在列表看到 ⚠️ 徽章，可以自己清理。

- **適應性分級與 SRS 並存，而非合併。** `domain/progression/`（策略模式的
  `LevelProgressionStrategy`，目前有 `RuleBasedStrategy` 實作）與
  `PlacementOrchestrator.ts` 負責決定學生「該被放在哪個難度層級」，這跟 SM-2 決定
  「今天該複習哪個字」是兩件事、分開處理，只在系統邊界互相組合。

- **關鍵決策邏輯抽出為可測試的純函式。** 三個最高風險的演算法放在 `domain/` 底下的
  純函式：`placementDecision.ts`（分級階梯）、`evaluationGuard.ts`（DDA 的「現在該
  不該評估」守衛）、`selectAssignment.ts`（作業優先序）。每個都有自己的單元測試
  檔，未來任何改動都會立刻被 `npm test` 抓到。

## 🔐 ⾝份與權限設計

| ⾓⾊ | 認證⽅式 | 可存取範圍 |
|---|---|---|
| `student` | Firebase 匿名登入（自動，零摩擦） | 學生登入頁／測驗頁 |
| `teacher` | Email/Password | 學生登入頁／測驗頁＋教師後台＋作業管理 |
| `admin` | Email/Password | 教師的全部權限，**再加上**單字庫上傳／發布 |

真正的防護層是 Firestore 安全規則，UI 上隱藏按鈕只是使用者體驗，不是安全邊界。學生只
能寫入自己的 `students/{uid}` 文件；只有 `teacher`／`admin` 角色能寫入 `vocabulary`
與 `assignments` 集合。

帳號由管理員透過 Firebase Console 建立，再用
`node scripts/set-role.mjs <email> <role>` 設定角色。自訂聲明使用
`getIdTokenResult(true)` 強制刷新讀取，因此角色會在首次登入時就生效，不需要登出再
登入。

## 📋 資料契約（Excel 欄位規格）

⽼師只需要維護一份固定欄位的 `.xlsx`：

| 欄位 | 必填 | 說明 |
|---|---|---|
| `word` | ✅ | 正確拼字（答案） |
| `meaning` | ✅ | 中⽂意思 |
| `sentence` | ✅ | 出題時唸出的例句 |
| `root` | – | 字根，作為提示 |
| `root_meaning` | – | 字根意思 |
| `hint` | – | 記憶提示 |
| `level` | – | 難度／分組標籤（1–6） |

推動隨機抽樣的 `random` 欄位由系統在發布時自動生成，老師不需要提供。

## 🗺️ 開發路線圖

專案刻意分階段推進，確保每個階段都能獨立驗證後才進入下一步：

| 階段 | ⽬標 | 狀態 |
|---|---|---|
| 0 | 定案資料契約（`.xlsx` 欄位規格 ↔ JSON schema） | ✅ |
| 1 | 資料管線：轉換／驗證腳本 ＋ CI 自動化 | ✅ |
| 2 | 核⼼測驗邏輯（SM-2、選題優先序），先用**打字輸入**驗證 | ✅ |
| 3 | 出題流程 UI：語音唸題、倒數計時、畫布（先只存圖，不辨識） | ✅ |
| 4 | 接上真正的⼿寫辨識引擎，獨立測準確率 | ✅ |
| 5 | 端到端整合：辨識結果 → 逐字比對 → SM-2 → 寫回雲端 | ✅ |
| 6-A | 教師後台（只讀）：學生總覽、風險偵測、弱點分析、作答時間 | ✅ |
| 6-B | 單字庫上傳、Schema 驗證、預覽、版本化發布 | ✅ |
| 6-C | 記憶曲線視覺化 | ✅ |
| 6-D | 效能強化：Top-K 候選池、預聚合統計、分批上傳、複合索引 | ✅ |
| 6-E | Firebase Authentication ＋依角色顯示的導航 | ✅ |
| 7 | 真實學生於平板上進行試點測試，蒐集辨識錯誤案例 | ⏳ |

**原路線圖之外的額外功能**（皆已完成）：跨 UID 狀態追蹤（`studentStates`）、初始
程度分級（`PlacementOrchestrator`）、老師可設定目標層級的加權出題、語速控制與個人
覆蓋、單一學生 PDF 報告匯出、學生封存、`writeBatch` 最佳化、Firestore 離線持久化、
熔斷器＋重試佇列、配額監控。

**自動化測試：89 個單元測試**，涵蓋 `grader`、`sm2`、`questionSelector`、
`studentAnalyzer`、`RuleBasedStrategy`、`placementDecision`、`selectAssignment`、
`evaluationGuard`。

Stage 6-A 之所以刻意排在 6-B 之前，是因為儀表板**只讀**、完全不影響現有測驗流程，而
單字庫上傳需要重新接線核⼼的 `WordRepository`，是整個系統中風險最高的重構。

## 🛠️ 技術棧

- **前端：** TypeScript + Vite（靜態輸出，可直接部署到 GitHub Pages）
- **資料轉換：** Node.js/TypeScript。老師端的單字庫發布走 `AdminPanel.tsx` 的
  Excel 上傳流程；另外有一組獨立的維護腳本（`mergeVocabCsv.ts`、
  `simplifyVocabByUsage.ts`）用來在匯入前整理、清理底層的
  `vocab_csv/vocab_cleaned.csv` 單字來源
- **⼿寫辨識：** Google IME ⼿寫 API
- **語音：** Web Speech API（瀏覽器內建 TTS），含 iOS 音訊解鎖處理
- **後端：** Firebase（Firestore ＋匿名／Email 認證），免費 Spark 方案
- **CI/CD：** GitHub Actions——老師把新的 `words.xlsx` 拖進 GitHub，管線自動驗證、
  轉檔、建置、部署

## 🧭 產品驗證思路

由於這個系統要服務一場有明確日期、對象人數固定（約 7 位學生）的真實比賽，路線圖刻意
把「需求驗證」排在「功能開發」之前：

1. 訪談曾經帶過這場比賽的老師——不是問「要不要做這個工具」，而是問「你們現在到底
   怎麼準備、哪裡最痛苦」。
2. 直接與 2–3 位學生聊他們現在怎麼自己練習、卡在哪裡（拼字／聽力／記憶）。
3. 根據訪談結果，才決定哪些差異化功能（錯誤類型診斷、老師端彙整視圖）值得做，哪些
   Quizlet 這類現成工具已經解決了。
4. 比賽介面（TTS、拼字、計時）盡量用現成工具，用最少力氣做到堪用，因為它不是這個
   專案的差異化價值所在。
5. 在比賽前對這 7 位目標學生進行真實試跑，並把正面與負面的發現都當作合理的成果來
   記錄，而不是只挑好聽的講。

## 📌 目前進度

Stage 0 到 Stage 6-E 已完成。系統支援完整的練習流程（TTS → 手寫 → 判分 → SM-2 →
Firestore）、適應性難度分級、老師可設定的作業與目標層級加權出題、個人化語速控制、
含成長曲線視覺化的教師儀表板、單一學生 PDF 報告匯出，以及學生／教師／管理員的角色
權限。自動化測試涵蓋 89 個案例，覆蓋所有高風險的純邏輯。

**Stage 7（真實學生於平板上進行試點測試）尚未開始。** 功能到此凍結——下一階段是
真實世界的驗證，而不是繼續擴充功能。

## 📄 授權

GPL-3.0