# 📖 英語單字王比賽訓練系統（Vocabulary King Trainer）

**🌐 Language / 語言：[English](./README.md) ・ [繁體中文](./README.zh-TW.md)**

這是一套為國高中學生準備「英語單字王比賽」而設計的適應性單字訓練系統。系統結合間隔重
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
- **例句不洩漏答案**：作答期間，例句中的目標單字會被遮罩（依詞幹匹配，不是嚴格字串
  相等），答完後才揭露。

## ✨ 核⼼功能

| 類別 | 功能 |
|---|---|
| 練習流程 | 語⾳唸出單字＋例句 → 限時⼿寫擷取 → 辨識 → 客觀判分 → SM-2 排程下次複習 |
| 間隔重複 | SM-2 演算法；**只有答錯的字會進入複習池**（`everWrong` 旗標），且**連續答對 5 次後自動移出**，讓已掌握的字真正畢業 |
| ⼿寫辨識 | 畫布擷取 ＋ Google IME ⼿寫 API |
| 語音 | Web Speech API，可調整播放語速（預設 1.0x 訓練真實英聽）＋「🐢 重聽一次（慢速）」按鈕，速度下限由老師設定（預設 0.85x）。**倒數在語音結束後才啟動**（另有 8 秒保險計時器），模擬⽐賽現場節奏 |
| **例句遮罩** | 作答期間目標單字以同長度下底線遮罩，答完才揭露。使用 **Porter Stemmer** 正規化，`recite` / `recited` / `reciting` 都會被遮罩；但不會過度詞幹化（`art` 與 `artist` 保持區分） |
| **可調每題作答時限** | 每份作業可設定作答秒數（3–30 秒，預設選項 5/8/10/15/20 秒）。由 `QuizTimingPolicy` 三層優先序解析：學生個人覆蓋 > 作業設定 > 系統預設（8 秒） |
| **課後加強** | 學生答完每日配額後，若老師允許，完成頁面會顯示「📚 繼續練習」按鈕。這是兩層選擇：老師選 `stop` 或 `continue`，學生再主動決定是否延長 |
| 適應性分級 | `PlacementOrchestrator` 用二分搜尋式的階梯（L3 起始、每級 3 題）將新學生放到合適層級；`LevelProgressionService` ＋ `RuleBasedStrategy` 依滾動表現持續升／降級，且**評估頻率與滑動視窗對齊（每 30 題評估一次）**。升級門檻：正確率 ≥ 85%、平均 < 7 秒、當前等級或以下的作答 ≥ 20 筆。降級需正確率 < 50% **且** 平均時間 ≥ 5 秒（過濾快速猜錯）。趨勢保護：若學生在進步中（前後半段正確率差 > 20%），不降級。Probe 高階題表現優異可獨立觸發升級。升降級後鎖定：50 題 |
| 作業系統 | 老師可設定每日配額、新舊字比例、複習專注度、**目標難度層級**（加權出題：目標 ＋ 當前 ＋ 探針）、每份作業的語速下限、每份作業的作答時限、每份作業的配額用盡後行為。優先序：個人 > 班級 > 全校 |
| 單字庫管理 | ⽼師上傳 `.xlsx` → Schema 驗證 → 預覽 → 每 400 筆為一批、批間延遲 1 秒的批次發布，避免配額暴衝 |
| 教師儀表板 | 學⽣總覽、⾵險偵測、Top-K 弱點分析、作答時間分佈、學習風格雷達圖、錯誤類型圓餅圖、成長曲線（累積 7 天後解鎖）、單一學生 PDF 報告匯出、學生封存 |
| ⾝份與權限 | 學⽣匿名登⼊、教師／管理員 Email/Password 登⼊；Firestore 安全規則依⾓⾊限制存取；自訂聲明透過 `getIdTokenResult(true)` 強制刷新讀取 |
| 防作弊訊號 | 依 editDistance ＋作答時間偵測「亂答」，與真正的拼字錯誤分開標記 |
| 效能設計 | Top-K 候選池、預聚合班級統計、批次寫入（`AttemptBatcher` 把每次作答的 5 個寫入合併成單一原子 commit）、以 `random` 欄位做隨機抽樣、**教師儀表板三層快取**（記憶體 → Firestore IndexedDB → 伺服器）、即時配額監控與全域橫幅警示 |
| 跨裝置狀態 | 學習狀態（當前等級、SM-2 進度、每日快照）以複合 `displayId`（`{班級}_{座號}_{姓名}`）為 key，而非 Firebase UID，換裝置或重新登入都不會遺失進度 |
| Profile 衛生 | 每次學生登入時，會透過 localStorage 追蹤器自動清理同 `displayId` 的舊 UID profile——零額外 Firestore 讀取，也不會累積孤兒 profile 文件 |
| 報表與生命週期 | 單一學生 PDF 報告匯出；針對畢業／退場學生的封存服務 |

## 🧱 系統架構

整個程式碼庫依照 **單⼀職責原則（SRP）** 拆分：`domain/` 只放純邏輯，`services/`
負責所有對外的 I/O（Firestore、匯出、配額監控），`features/` 再把兩者組裝成畫⾯。
以下是專案**目前實際的檔案結構**：

graph TD
    %% 樣式定義
    classDef features fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef domain fill:#e8f5e9,stroke:#388e3c,stroke-width:2px;
    classDef services fill:#fff3e0,stroke:#f57c00,stroke-width:2px;
    classDef storage fill:#f3e5f5,stroke:#8e24aa,stroke-width:2px;
    classDef external fill:#fce4ec,stroke:#d81b60,stroke-width:2px;

    subgraph Features["前端介面層 (Features)"]
        UI1["測驗流程 (Quiz)"]
        UI2["教師儀表板 (Dashboard)"]
        UI3["管理後台 (Admin)"]
    end

    subgraph Domain["領域層 (Domain - 純函式)"]
        D1["SM-2 排程"]
        D2["評分與遮罩"]
        D3["適應性分級 (DDA)"]
        D4["選題與配額"]
    end

    subgraph Services["服務層 (Services - I/O 邊界)"]
        S1["儲存服務 (ProgressStore)"]
        S2["分析服務 (Analytics)"]
        S3["作業服務 (Assignment)"]
    end

    subgraph Storage["本地儲存 (Local Storage)"]
        L1["In-Memory"]
        L2["LocalStorage"]
        L3["IndexedDB (Firestore Cache)"]
    end

    subgraph External["外部依賴 (External)"]
        E1["Firebase (Firestore/Auth)"]
        E2["Web Speech API (TTS)"]
        E3["Google IME (手寫)"]
    end

    %% 依賴關係
    Features --> Domain
    Features --> Services
    Services --> Domain
    Services --> Storage
    Services --> External

    %% 樣式應用
    class UI1,UI2,UI3 features;
    class D1,D2,D3,D4 domain;
    class S1,S2,S3 services;
    class L1,L2,L3 storage;
    class E1,E2,E3 external;
```

```
vocab-handwriting-trainer/
├── tsconfig.json
├── vite.config.ts
├── firestore.rules
│
├── scripts/ # Build-time／維護用工具
│ ├── mergeVocabCsv.ts # 合併多個原始單字來源成一份 CSV
│ ├── simplifyVocabByUsage.ts # 依使用頻率精簡單字庫
│ ├── set-role.mjs # 幫 Firebase 使用者設定 teacher/admin 自訂聲明
│ ├── cleanupAnonymousProfiles.mjs # 清理重複的 students/{uid} profile
│ ├── deleteStudentData.mjs # 一次性刪除指定 displayId 的所有測試資料
│ ├── inspectStudent.mjs # 印出學生學習狀態、每日快照、最近作答
│ ├── diagnoseDDA.mjs # 診斷等級評估為何沒觸發（count vs totalAttempts、時間缺口、classStats）
│ ├── diagnoseAttemptsGap.mjs # 找出 totalAttempts 與 attempts 實際筆數的落差（by displayId vs by uid）
│ ├── fixStudentStates.mjs # 補齊 StudentLearningState 缺漏欄位（totalAttempts、levelLockedUntil、levelHistory）
│ ├── simulateEvaluation.mjs # 用真實 attempts 重播 RuleBasedStrategy，對比新舊門檻
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
│ ├── firestore/
│ │ └── removeUndefined.ts # Firestore 寫入前過濾 undefined
│ ├── grading/grader.ts (+test) # 客觀判分＋計算 SM-2 用的 quality 分數
│ ├── placement/
│ │ └── placementDecision.ts (+test)# 分級測驗的階梯決策
│ ├── progression/ # 適應性分級邏輯
│ │ ├── evaluationGuard.ts (+test) # 「現在該不該評估？」的守衛判斷
│ │ ├── LevelProgressionStrategy.ts
│ │ ├── RuleBasedStrategy.ts
│ │ ├── metricsCalculator.ts
│ │ └── progression.test.ts
│ ├── quiz/
│ │ ├── QuizTimingPolicy.ts # 三層每題作答時限解析
│ │ └── SessionQuotaPolicy.ts # 兩層配額用盡後行為（stop/continue）
│ ├── scheduler/
│ │ ├── sm2.ts (+test) # 間隔重複演算法
│ │ └── reviewStateMapper.ts
│ ├── selection/questionSelector.ts (+test) # 純選題（不管配額）
│ ├── string/
│ │ ├── displayId.ts # buildDisplayId：{班級}{座號}{姓名}
│ │ ├── sanitizeId.ts # word → 穩定且 Firestore 安全的 wordId
│ │ ├── similarity.ts # editDistance／相似度，用於亂答偵測
│ │ ├── porterStemmer.ts # Porter (1980) 詞幹提取，用於例句遮罩
│ │ └── maskWord.ts (+test) # 詞幹感知的例句目標單字遮罩
│ └── validation/wordSchema.ts # 單字庫欄位契約
│
├── services/ # I/O 邊界層
│ ├── analytics/
│ │ ├── AnalyticsService.ts # 從 Firestore 聚合單一學生資料
│ │ ├── ClassStatsService.ts # 預聚合的班級統計
│ │ └── ArchivedStudentsService.ts # 跨梯次學生的封存／退場管理
│ ├── assignment/AssignmentService.ts # 老師可調整的作業設定
│ ├── export/studentReportPdf.ts # 產生單一學生的 PDF 報告
│ ├── profile/
│ │ ├── ProfileService.ts # 學生姓名／班級 profile（以 uid 為 key）
│ │ └── ProfileCleanupTracker.ts # 以 localStorage 追蹤舊 UID
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
│ │ └── AttemptBatcher.ts # 把每次作答的 5 個寫入合併成 1 個原子 commit
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
│ │ ├── AnswerProcessor.ts (+test) # 辨識結果 → 判分 → SM-2（純運算）
│ │ ├── HandwritingCanvas.tsx
│ │ ├── Countdown.tsx # 語音結束後才啟動的倒數
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
  `{班級}_{座號}_{姓名}`（例如 `709_1_S1`）跨 session 穩定，所以學習等級、
  SM-2 進度、每日快照統一存在 `studentStates/{displayId}` 底下。

- **判分永遠不相信使⽤者輸入。** `domain/grading/grader.ts` 只根據「辨識出的⽂字
  vs. 正確答案」、「作答時間 vs. 時限」計算出客觀的 `quality` 分數（0–5）；
  `AnswerProcessor.ts` 是唯一一個把辨識結果串接到判分、SM-2、儲存的地方。`sm2.ts`
  完全不知道原始的使⽤者輸入是什麼，只接收這個已經算好的分數。

- **SM-2 只追蹤錯題，且會自動畢業。** `ReviewState.everWrong` 在第一次答錯時設為
  `true`，但**連續答對 5 次後會自動清除**（由 `AnswerProcessor` 獨立維護的
  `correctStreak` 計數器判斷，不受 `sm2.ts` 的 `MASTERY_STREAK` 歸零影響）。這代表
  首次就答對的字永遠不進複習池，而經過努力後已掌握的字也會自然退出。

- **儲存層是分層的，不是單體的。** `ProgressStore` 是一個介面，底下有
  `InMemoryProgressStore`、`LocalStorageProgressStore`、`FirestoreProgressStore`，
  以及結合「本地優先反應速度」與「Firestore 同步」的 `HybridProgressStore`，另外用
  `AttemptBatcher` 把每次作答的多個寫入（SM-2 進度、學習狀態計數、作答紀錄、班級統
  計、每日快照）合併成**單一原子 `writeBatch`**。

- **配額耗盡時有熔斷器＋重試佇列。** 當 Firestore 回傳 `resource-exhausted`，
  `HybridProgressStore` 會停止嘗試寫雲端、把變更排入 `localStorage` 佇列，並顯示全
  域橫幅。熔斷器在下一個太平洋午夜配額重置時才解除——而不是固定延遲後解除，那樣只是
  再撞一次牆。

- **候選池，而非全表掃描。** 早期版本在學⽣登入時載入全部複習歷史，直接把 Firestore
  免費⽅案的讀取配額打爆（⼀次 7,000 多次讀取）。現在由 `quotaMonitor.ts` 直接追蹤
  讀寫量，搭配 Top-K 候選池與 `ClassStatsService` 的預聚合文件供教師儀表板使用。

- **教師儀表板走三層快取，並以「手動強制刷新」作為唯一出口。** 儀表板原本會
  對 `attempts` 集合做全表掃描（7,000+ 筆讀取），並且老師每次重新整
  理頁面都會重載所有學生的詳情（7 位學生共約 840 筆）。在 Spark 免
  費方案的每日 50K 讀取上限下，一個下午的老師使用就會把配額打爆。

  修正方式是用三層生命週期不同的快取疊起來：

    1. **記憶體層（`useStudentDetail` 的 module-level Map）**——
       在單一 SPA session 內存活。切換學生 < 1 ms、0 筆讀取。
    2. **Firestore IndexedDB 快取（`getDocsFromCache()`）**——
       在頁面重整、瀏覽器重啟後仍存活。0 筆讀取，5–30 ms 命中。
    3. **Firestore 伺服器（`getDocs()`）**——只有前兩層都 miss，
       或老師明確要求更新時才會被呼叫。

  兩項配套修正：

  - `getAllStudentsStats()` 與 `getTopWeakWords()` 不再掃描
    `attempts` 集合，改讀預聚合的 `classStats` 文件（從 7,000+ 筆
    降到 4 筆）。
  - `getWordsByIds()` 加入 IndexedDB 快取優先檢查，弱點單字查詢
    （每次 5 筆）在快取命中時降為 0 筆。

  **最關鍵的配套是「手動重新整理」按鈕。** 第一版迭代時，`refetch()`
  只清了記憶體層，但 `getStudentDetail()` 仍會先呼叫
  `getDocsFromCache`（Layer 2），永遠拿到同一份舊資料。按鈕看起來
  完全沒作用。修正方式是為 `getStudentDetail()` 加入 `forceServer`
  參數，讓手動刷新能跳過 Layer 2 直接走伺服器；同時加上 600 ms 最短
  spinner 顯示時間，讓使用者「感知得到」更新動作（尼爾森的 100 ms
  回饋門檻——低於此的 spinner 會一閃而過，使用者會懷疑到底有沒有
  更新）。

  **資料新鮮度現在誠實呈現。** 舊版的「🕐 最後更新」顯示的是「前端
  最後一次呼叫 fetch 的時間」，每次互動都重設——永遠顯示「剛剛」，
  即使資料其實是一天前的。新的顯示拆成三個欄位：

    - **「🕐 資料截至 [日期]」**——取自 `analytics.lastAttemptAt`，
      學生最後一次實際作答的時間。這才是老師關心的。
    - **「即時」vs.「快取版本（N 分鐘前同步）」**——取自
      `analytics.dataSource`（`'server'` 或 `'cache'`）與
      `lastServerFetchedAt`（與 `lastFetchedAt` 分開追蹤）。
    - **過期警告**只在「`dataSource === 'cache'` 且最後一次成功
      server 同步超過 30 分鐘」時觸發——不是一個每次互動都重設的
      計時器。

  這個設計**刻意不做自動更新**。學習進度的變化速度是「小時～天」
  級，不是「秒」級。自動更新只會消耗配額，對教學判斷毫無幫助。相
  反地，系統給老師三樣東西：(a) 誠實的資料新鮮度訊號、(b) 明確的
  手動更新按鈕、(c) 每位學生的更新 spinner，讓刷新的成本可見。這
  是一個 **「透明化勝過自動化」** 的案例——最清楚「這筆資料夠不夠
  新」的人，是在教室裡的老師，不是快取層。

  淨效果：每日讀取量從 ~66K（超限）降到一般日的 ~2–3K。老師密集
  使用手動刷新的當天，總量約 20K——仍在 50K 上限內，且完全由老師
  主動控制。切換學生的感知延遲則降到 < 30 ms。

- **用 `random` 欄位做隨機抽樣。** `getNewWordsByLevels` 原本用 `orderBy('word')`，
  每次都從字母序最前面開始抓同一批單字。現在每個單字文件都帶一個 `random: number`，
  查詢時用兩段式範圍掃描（先 `random >= r`、再 `random < r` 補齊），真正做到隨機。

- **例句遮罩使用 Porter Stemmer，而非嚴格字串相等。** 在例句
  「The child recited a poem.」中，還沒學過 `recite` 的學生可以直接從句子抄答案。解
  法是在作答期間把匹配到的單字替換成同長度的下底線。單純嚴格匹配會漏掉屈折變化——
  `recited` 與 `reciting` 不會被遮罩。`maskWordInSentence` 會先對目標單字與句中每個
  token 都做 **Porter Stemmer**（Martin Porter, 1980）正規化再比較，所以同一個詞根的
  所有屈折形式都會被遮罩。為了避免過度詞幹化（例如 Porter 會區分 `art` 與
  `artist`），演算法另外加了長度差的安全網。

- **配額判斷只有單一真實來源。** `SessionQuotaPolicy` 是唯一決定「能不能再出一題」
  的地方。`domain/selection/questionSelector.ts` 的 `pickNextWordId` 是純粹的「下一
  題出什麼」，完全不知道「配額」是什麼。這是刻意的重構：早期版本不小心有兩層獨立
  的配額檢查，導致「課後加強」需要傳 `Number.MAX_SAFE_INTEGER` 的 hack 才能運作。
  收斂到單一來源後，未來任何配額相關功能（週配額、依等級動態配額、學生個別覆蓋）都
  只動一個檔案。

- **倒數在語音結束後才啟動，而不是題目出現就開始。** 比賽規則是「老師唸完單字與例
  句，然後 8 秒寫字時間才開始」。UI 透過 `SpeechSynthesisUtterance.onend` 事件把倒
  數凍結在初始值，直到語音結束才啟動，另加 8 秒保險計時器以防語音無法使用或無聲。
  這避免了瀏覽器語音時長悄悄吃掉學生實際寫字時間。

- **每題作答時限由三層政策解析。** 老師可為每份作業設定作答時限（3–30 秒）；作業的
  值由 `QuizTimingPolicy.resolve()` 依優先序解析：學生個人覆蓋 > 作業設定 > 系統預
  設（8000 ms）。這讓時限規則可測試，也讓 UI 不需要知道解析邏輯。

- **舊 UID profile 的自動清理由 localStorage 驅動，而非 Firestore。** 每次匿名登入
  都會產生新 UID，`students/{uid}` 集合會累積孤兒 profile。走 Firestore 查詢需要在
  每次登入多一次讀取；改由 `ProfileCleanupTracker` 在 localStorage 記錄每個
  `displayId` 之前用過的 UID 清單，只保留當前 UID，正常情況下零額外 Firestore 讀
  取。學生換裝置或清快取時允許暫時累積，由維護腳本 `cleanupAnonymousProfiles.mjs`
  處理這個邊界情況。

- **作業優先序是真實的階層。** `selectActiveAssignment`（純函式）選最具體的匹配：個
  人 > 班級 > 全校；同類型多個時取 createdAt 最新。當同一個對象有多個生效中作業
  時，老師會在列表看到 ⚠️ 徽章，可以自己清理。

- **適應性分級與 SRS 並存，而非合併。** `domain/progression/`（策略模式的
  `LevelProgressionStrategy`，目前有 `RuleBasedStrategy` 實作）與
  `PlacementOrchestrator.ts` 負責決定學生「該被放在哪個難度層級」，這跟 SM-2 決定
  「今天該複習哪個字」是兩件事、分開處理，只在系統邊界互相組合。

- **評估頻率必須與統計視窗對齊，否則視窗會被悄悄污染。** 第一版
  DDA 每 10 題評估一次，但效能視窗是 30 題。這意味著每次評估只用
  10 題新數據 + 20 題舊數據——舊數據的多數主導了決策。真正進步的
  學生，新表現會被過去的失敗稀釋；暫時遇到瓶頸的學生，過去的成功
  會掩蓋現在的退步。可見的症狀是：學生在同一次練習中於 L3 和 L4
  之間反覆橫跳，30 題內可能變動兩次等級。

  修正方式是**把視窗大小當作評估間隔**：
  `MIN_ATTEMPTS_BETWEEN_EVALUATIONS` 從 10 改為 30，與
  `WINDOW_SIZE` 一致。每次評估都對應一個**完全刷新的視窗**——沒有
  舊數據主導，決策所依據的資料集與指標計算的資料集完全相同。

  與此同時，做了三個訊號層面的修正：

    1. **降級加入反應時間。** 舊規則只看正確率就降級，把「快速猜
       錯」與「慢速努力」同等對待。修正加入
       `DEMOTE_MIN_AVG_TIME_MS = 5000`：降級需要同時滿足低正確率
       **且** 慢反應，過濾掉學生亂點的情況。

    2. **趨勢保護。** `metricsCalculator` 現在會計算視窗內的
       `earlyCorrectRate`、`lateCorrectRate`、`trend`（後者減前
       者）。**正在進步**的學生（`trend > 0.2`）即使整體平均偏低，
       也會被保護不被降級——因為他的軌跡比當下快照更重要。

    3. **Probe 升級。** 視窗被拆成 `attemptsAtLevel`、
       `attemptsBelowLevel`、`attemptsAboveLevel`（更高難度的
       probe 題）。如果學生在 probe 題上表現優異（≥ 3 題、正確率
       ≥ 70%），即使當前等級樣本數還沒到 20 題，也能被升級。這解
       決了「學生明顯準備好進下一階，但當前樣本還在累積」的情況。

  最後，`LOCK_ATTEMPTS_AFTER_CHANGE` 從 30 延長到 50，給學生更
  多適應新等級的時間，避免「剛升上去馬上被降級」的震盪。

- **等級升降的門檻必須低於滑動視窗，否則會出現「數學上不可能升級」。**
`PerformanceTracker` 使用 30 筆的滑動視窗，而 `buildDefaultNewWords` 每次固定
混入約 10% 的 probe（比當前等級更高的單字）。舊版把
`PROMOTE_MIN_ATTEMPTS_IN_LEVEL` 設為 30，且 `attemptsInCurrentLevel` 只計「嚴
格等於當前等級」的筆數——這讓升級在數學上不可能發生：視窗內永遠湊不到
30 筆同級作答。症狀是一位學生連續六天正確率 76–98%，卻一直停在 L1。修正方式
是把門檻放寬到 20，並把計算改為「小於或等於當前等級」的筆數（probe 的更
高難度題目不計入，因為它們是超綱挑戰，不是對當前等級的證據）。平均反應時間
門檻也從 5 秒放寬到 7 秒——8 秒的比賽題限讓 5 秒成為不合理的嚴苛門檻。所有門
檻值集中匯出為 `RULE_BASED_THRESHOLDS`，讓單元測試以符號引用而非寫死數字；
下次調參只要改一個檔案。

- **關鍵決策邏輯抽出為可測試的純函式。** 最高風險的演算法放在 `domain/` 底下的純函
  式：`placementDecision.ts`（分級階梯）、`evaluationGuard.ts`（DDA 的「現在該不該
  評估」守衛）、`selectAssignment.ts`（作業優先序）、`QuizTimingPolicy.ts`（時限解
  析）、`SessionQuotaPolicy.ts`（課後行為）、`maskWord.ts` + `porterStemmer.ts`
  （例句遮罩），以及 `AnswerProcessor` 中的 `everWrong` 生命週期邏輯。每個都有自己
  的單元測試檔，未來任何改動都會立刻被 `npm test` 抓到。

- **時區處理遵循單一真實來源：IANA 時區名稱存在學生紀錄上，讀取時才
  解析。** 每日快照的 `date` 欄位原本用
  `new Date().toISOString().slice(0, 10)` 計算，得到的是 **UTC** 日期。
  儀表板則用 `toLocaleDateString()` 顯示「最後練習」，採用的是**瀏覽器
  本地**時區。這兩條路徑在 UTC 16:00–24:00 之間會產生衝突——換算成台
  北時間就是 00:00–08:00，正好是補習結束回家、睡前練習的學生最容易
  答題的時段。

  症狀在試點期間浮現：某位學生的快照被歸到 `2026-10-03`，但儀表板
  顯示她的最後練習是 `2026/10/4`。成長曲線的趨勢線是對的，但日期標
  籤在跨夜練習時會差一天。

  修正方式建立了一條從偵測到顯示的完整鏈路：

    1. **偵測**——每次學生登入時，`detectTimeZone()` 讀取
       `Intl.DateTimeFormat().resolvedOptions().timeZone`，把 IANA 名
       稱（例如 `Asia/Taipei`）寫進 `studentStates/{displayId}`。選擇
       「每次登入都寫」而非「只在首次寫」是刻意的：這樣可以處理學生
       換裝置或旅行的情境。
    2. **儲存**——所有時間戳維持 UTC（Firestore 的原生行為）。儲存層
       完全不變。
    3. **推導**——需要「本地日期」時，用
       `getLocalDateString(date, timeZone)` 透過 `Intl.DateTimeFormat`
       算出該時區的 `YYYY-MM-DD`（用於每日快照、活躍狀態、「最後練
       習」）。
    4. **顯示**——`formatLocalDate(iso, timeZone)` 以學生所屬時區呈
       現日期，而非觀看者的時區。

  為什麼用 `Intl.DateTimeFormat` 而非手動 `+8 小時`：固定偏移無法處理
  夏令時。紐約的學生夏天是 UTC-4、冬天是 UTC-5，寫死的偏移會一年錯
  兩次。`Intl` 把這件事交給瀏覽器處理——它本來就知道規則。

  既有快照**不進行遷移**。舊的 `date` 欄位無法透過重新讀取
  `capturedAt` 來修復，因為 `capturedAt` 只在快照文件首次建立時寫
  入——後續答題會更新同一份文件，但不碰這個欄位。重新分配每日答題數
  所需的資訊，根本不在資料裡。試點剩下的兩週會使用修正後的推導邏輯；
  歷史快照保留原本的標籤。

  這不是「有也好、沒有也好」的修正。每日活躍數、連續練習天數、成長
  曲線的日期軸，全都從這個值推導而來。弄錯它會默默降低老師判斷學生
  行為的能力——而這正是儀表板存在的意義。

- **Firestore 永遠不會看到 `undefined`。** Firestore 的 `addDoc` / `setDoc` /
  `writeBatch.set` 都會拒絕值為 `undefined` 的欄位，但 TypeScript 的 optional 欄位
  （`field?: T`）很容易產生 `undefined`。`removeUndefined` 輔助函式
  （`domain/firestore/removeUndefined.ts`）套用在每個 Firestore 寫入邊界上，讓
  optional 欄位不是有值、就是被省略，永遠不會以 `undefined` 形式存入。

- **儀表板讀取有界化，並按語意分源。** 教師儀表板的單一學生詳情頁，原本每次
  點擊都載入該學生的完整作答歷史（2026-10 時約每位 1,000–1,500 筆，且隨時間
  線性成長）。改為三個有界查詢：最近 100 筆 attempts（供診斷圖表：錯誤分佈、
  作答時間分佈、弱點單字分析）、最近 30 天每日快照（供成長曲線）、以及一份
  `studentStates/{displayId}` 文件（供當前等級）。學生姓名與班級從 `displayId`
  字串解析，不再需要另外掃描 `classStats`。淨效果：每次詳情頁約 110 筆讀取
  （從 ~1,500 降下來），且不再隨時間惡化。

  關鍵是：詳情面板標題的「累積」總數（例如「共 1,074 題」）是從預聚合的
  `classStats` 文件讀取（由 `TeacherDashboard` 以 prop 傳入），而非從 100 筆
  窗口計算。這讓老師看到的數字與學生列表一致，也保留了「練習量」這個對學生
  有鼓勵價值的訊號；圖表則仍反映近期行為。三個不同語意的資料來源，是刻意
  設計，不是巧合。

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
| 7 | 真實學生於平板上進行試點測試，蒐集辨識錯誤案例 | 🔄 進行中——已完成首次現場測試 |

**原路線圖之外的額外功能**（皆已完成）：跨 UID 狀態追蹤（`studentStates`）、初始
程度分級（`PlacementOrchestrator`）、老師可設定目標層級的加權出題、語速控制與個人
覆蓋、可調每題作答時限（`QuizTimingPolicy`）、課後加強（`SessionQuotaPolicy`）、
Porter Stemmer 例句遮罩、單一學生 PDF 報告匯出、學生封存、`writeBatch` 最佳化、
Firestore 離線持久化、熔斷器＋重試佇列、配額監控、`everWrong` 的掌握生命週期（連續
答對 5 次後自動清除），孤兒 UID profile 的自動清理、以及 `RuleBasedStrategy` 的門檻修正——修復了一個
在 30 筆滑動視窗下數學上不可能達成的升級條件（詳見「值得特別說明的設計決策」）。

**自動化測試：131 個單元測試、7 個 suites**，涵蓋 `grader`、`sm2`、
`questionSelector`、`studentAnalyzer`、`RuleBasedStrategy`、`placementDecision`、
`selectAssignment`、`evaluationGuard`、`AnswerProcessor`，以及 `maskWord`（同時涵蓋
`porterStemmer`）的純邏輯單元測試。測試聚焦在最高風險的純函式；I/O 層刻意不寫單元
測試（需要 Firestore emulator，延後到 Stage 7+ 處理）。

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
- **例句遮罩：** 自製 Porter Stemmer 實作（`domain/string/porterStemmer.ts`，無外部
  NLP 依賴）
- **後端：** Firebase（Firestore ＋匿名／Email 認證），免費 Spark 方案
- **CI/CD：** GitHub Actions——老師把新的 `words.xlsx` 拖進 GitHub，管線自動驗證、
  轉檔、建置、部署
- **Lint：** ESLint，使用 `@typescript-eslint/recommended` 規則集

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

Stage 7 的首次現場測試已經完成。測試後直接催生了幾項功能，包括：例句遮罩（防止學生
從例句抄答案）、可調時限（預設 8 秒對初學者太緊）、以及課後加強（學生想繼續練但舊
設計強制重新登入）。

## 🔬 學術定位

目前系統在自適應單字推薦上的做法，位於研究文獻中一個明確的位置，值得寫
清楚。

2026 年一篇論文（[Zhang, *Discover Artificial Intelligence*](https://link.springer.com/article/10.1007/s44163-026-01588-3)）提出基於 GCN
的自適應單字推薦框架。它的核心批判是：早期系統依賴**靜態的專家標註知識圖
譜**（語意、形態、先修關係），而這種圖譜無法反映學習者的真實行為，導致推
薦內容與學生實際需求脫節。

**本 README 描述的系統，正是那樣的早期系統——而且是刻意的。** 詞根關係
是專家先驗知識，選題權重是手工調校的規則，單字圖譜不隨個別學生調整。這
不是疏漏，而是在現實約束下的工程決策：

- **7 人試點規模**：論文的 GCN 在 487 名學生、1,856 個單字、68,342 條
  互動紀錄、橫跨 16 週的資料上訓練。在我們的規模下，GCN 只會過擬合，
  產出噪音而非訊號。
- **Firebase Spark 方案**：任何每次查詢都動態重算的做法都會打爆每日配額。
- **兩週試點窗口**：沒有時間累積模型所需的縱貫資料。

論文眼中的限制，我們當作**起點**。這個靜態的詞根圖被設計為未來學習型模
型的**初始結構**——一旦學生規模成長到足以產生訓練資料時，它就能被接上。

這裡的工程路徑是：**先用規則，後用學習**——不是因為學習比較差，而是因
為資料還沒到。這也是所有生產環境的 ML 系統，會先建立啟發式基線、再對殘
差訓練模型的原因。

## 📊 資料分佈分析

截至 2026 年 10 月，系統已累積 **9,580 筆 attempts**，涵蓋 7 位學生。
依照等級統計後，呈現極度不均衡的分佈：

| 等級 | 估算 attempts 數 | 佔比 |
|---|---|---|
| L1 | 4,915 | 51.3% |
| L2 | 2,826 | 29.5% |
| L3 | 230 | 2.4% |
| L4 | 450 | 4.7% |
| L5 | 1,044 | 10.9% |
| L6 | 115 | 1.2% |

**這不是隨機的。** 這是自適應系統的必然結果。看學生目前所在的等級
（僅以班級與座號識別，不含姓名）：

| 學生 ID | 當前等級 | 累積 attempts |
|---|---|---|
| 801_25 | L1 | 1,679 |
| 802_18 | L1 | 1,533 |
| 805_11 | L1 | 1,649 |
| 805_2  | L1 | 747 |
| 802_16 | L4 | 1,262 |
| 802_25 | L4 | 1,270 |
| 804_18 | L6 | 1,440 |

4 位學生卡在 L1（這一組裡程度較弱的一群），2 位在 L4，1 位在
L6。**沒有學生目前停留在 L2、L3 或 L5。** 這三個等級是「過渡
層」——學生會經過，但不會久留，所以 attempts 只在經過時短暫累
積。

L5 的 10.9% 是一個獨立的現象：它來自 `buildDefaultNewWords` 的
probe 機制，該機制每次固定保留約 10% 的新字池給「比當前等級高
一級」的題目。所以 L5 的 attempts 不是一條連續的學習軌跡，而是
L4 學生被隨機抽中的 probe 題。

### 對知識追蹤的意涵

這個分佈對「從規則式 DDA 邁向機率式技能模型」有直接的後果。以
**BKT（貝氏知識追蹤）** 為例，其四個參數（`P(L0)`、`P(T)`、
`P(S)`、`P(G)`）需要每個技能大約 25–250 筆樣本才能穩定估計。以
單一等級作為技能單位來看：

| 等級 | 單一等級 BKT 的可行性 |
|---|---|
| L1 | ✅ 遠超門檻 |
| L2 | ✅ 遠超門檻 |
| L3 | ⚠️ 邊緣（230 筆） |
| L4 | ⚠️ 邊緣（450 筆） |
| L5 | 🟡 樣本數夠，但樣本來自 probe，不是連續軌跡 |
| L6 | ❌ 不足（115 筆） |

**只有 L1 和 L2 能用樸素的「單一等級 BKT」穩定建模。** 由此衍生
兩個未來方向：

1. **分層貝氏 BKT**——讓稀疏等級（L3、L4、L6）透過「學習率參數
   的共同先驗」借用密集等級的統計力量。這是貝氏建模中處理「組間
   樣本量不均衡」的標準技術。
2. **詞根層級 BKT**——以「詞根」（`spect`、`port`、`form`）而非
   「難度等級」作為技能單位。詞根天然跨越多個等級，同一個詞根的
   資料會自然聚合 L1–L6 的樣本，完全避開「一個等級、一個技能」
   的樣本不均衡問題。這與「未來方向」中已經勾勒的詞根槓桿方向
   一致。

兩個方向都尚未實作。試點資料記錄在此，是為了讓 (a) 這個分佈對
未來重訪建模問題的人來說是明確的，(b) 「分層／詞根層級 BKT 優於
樸素單一等級 BKT」的論證有實際資料支撐，而不是憑直覺。

### 為什麼這一節會在這裡

通往這一節的路徑經過了系統每次答題都會收集的五個手寫品質訊號：
`recognizedText`、`editDistance`、`similarity`、`responseTimeMs`、
`snapshotImageUrl`。這些欄位目前只用於**錯誤類型分類**（老師看到
的圓餅圖）——它們從未進入等級評估的路徑。直覺是：「答錯」不應
該是二元的；`similarity = 0.9` 的失誤與 `similarity = 0.1` 的失誤
不應該被等同看待。這個直覺直接指向 BKT——它用**似然**而非二元標
籤來更新對學生知識狀態的機率信念。

嘗試把 BKT 套用到現有資料上時，立刻浮現了上方的分佈問題。所以
這一節不是岔路——它是「在規則式系統之上建構機率模型」這件事的
第一個結果，也是告訴我們**在當前規模下，哪一種建模路徑才是可行
的**的關鍵依據。

## ⚠️ 已知限制

### Firestore 安全規則（延後到試點後處理）

`studentStates`、`attempts`、`classStats` 目前對任何已登入使用者開放讀寫。
`displayId` 的格式（`{班級}_{座號}_{姓名}`）在本 README 中是公開資訊，這意味著任何
讀過本文件、知道學校班級與座號範圍的人，理論上可以窮舉 `displayId` 來讀取或篡改其他
學生的進度。

同樣地，`students/{uid}` 目前允許任何已登入使用者**刪除**任何 profile 文件（這是為
了讓學生的新 UID 能清理上一次登入留下的孤兒 profile）。實務上風險可控，因為
`students/{uid}` 只存 profile 中介資料（姓名、班級、座號、displayId），不含學習資
料，且刪除後學生下次登入會自動重建。學習狀態存在 `studentStates/{displayId}`，不受
profile 刪除影響。

**這對 7 人試點是可接受的風險**，但**正式大規模部署前必須修復**。正確做法是把
`displayId`（或至少 `class`）綁定到學生 ID token 的 custom claims，讓規則可以檢查
`request.auth.token.displayId == displayId`。這需要 Cloud Function（進而需要 Blaze
方案），已排入 Stage 8。

部分緩解措施：部署網站加上 `noindex, nofollow` 標記，並附上禁止所有爬蟲的
`robots.txt`，降低被意外發現的機率。

### I/O 層未寫單元測試

`FirestoreProgressStore`、`AnalyticsService`、`AssignmentService` 等 I/O 層沒有自動
化測試。它們委派的純邏輯**有**測試。加入 emulator-based 整合測試排入 Stage 7+。

## 🔮 未來方向

### 詞根槓桿：把單字庫建模成圖

目前的選題邏輯把每個單字視為獨立的個體（`questionSelector.ts` 對每個候選單字
給一個獨立的分數），沒有利用單字之間的詞根關聯。

但在真實的教學現場，**詞根拆解**（root / prefix / suffix）是背單字的關鍵
策略之一——學生若知道 `spect` 代表「看」，就能同時掌握 `inspect`、
`respect`、`suspect`、`prospect` 一整組字。目前系統沒有把這件事納入
選題考量。

一個值得探索的方向是：**把單字庫建模成一個圖**，其中節點是單字、邊是
共享的詞根。選題時，對「能解鎖其他單字」的字給更高的權重——例如某個字
的詞根底下有 5 個同級單字尚未出現，這個字的槓桿分數就高。

這在概念上類似最大流問題中的**瓶頸分析**：整體學習效率受限於最窄的那條
邊，而找出瓶頸、鬆動瓶頸，就是提升整體效率的關鍵。但實際上單字庫規模
（L1-L3 對國中生而言只有數百字）小到不需要真正的最大流演算法——一個簡單
的加權方案就足夠。

**為什麼不做 BKT / IRT / HMM？**

這些機率模型長期而言會自動學到詞根關聯，但它們需要足夠的樣本才能收斂。
以 7 位學生的試點規模，統計上跑不動；且規則式方法對老師而言可解釋性更高
（「這個字被選中，是因為它和上次答對的字共享詞根」比「這個字的掌握機率
是 0.43」更容易理解）。因此這個方向延續現有的 Rule-based 一脈——在各種
限制下做出最好的表現，而不是引入更複雜的模型。

**尚未實作的理由**：

1. 需要先確認單字庫的詞根分佈是否足夠密集（若 90% 的單字沒有 `root`
   欄位，這個圖會太稀疏，不值得做）。
2. 需要定義可驗證的指標——「同詞根連續答對率」是否高於「隨機分佈的
   連續答對率」。
3. 競賽有等級邊界（國中最多 L3），詞根圖只在等級內運作，這限制了圖的
   規模，也讓問題變得更具體。

這是一個「未來可能方向」，不是承諾。先讓系統穩定運行、收集真實資料，
再決定是否值得投入。

## 📌 目前進度

Stage 0 到 Stage 6-E 已完成，Stage 7（真實試點）**進行中**——首次真實學生於真實平板
上的現場測試已完成，並依測試觀察新增了一系列功能（例句遮罩、可調時限、課後加強）。
系統支援完整的練習流程（TTS → 手寫 → 判分 → SM-2 → Firestore）、適應性難度分級、
老師可設定的作業與目標層級加權出題、個人化語速控制、每題作答時限控制、含成長曲線視
覺化的教師儀表板、單一學生 PDF 報告匯出，以及學生／教師／管理員的角色權限。

**自動化測試：131 個通過、7 個 suites、0 個失敗。**

**Stage 7 剩下工作：** 繼續蒐集辨識錯誤案例、依真實學生樣本調整手寫辨識流程、依試點
發現持續迭代。功能到此凍結——優先順序是真實世界的驗證，而不是繼續擴充功能。

## 📄 授權

GPL-3.0