# 📖 Vocabulary King Trainer 

**🌐 Language / 語言：[English](./README.md) ・ [繁體中文](./README.zh-TW.md)**

An adaptive, offline-friendly vocabulary training platform built to help a small cohort of
middle-school students prepare for a live English vocabulary competition ("英語單字王比賽").
The system pairs a spaced-repetition engine (SM-2) with speech prompts, handwriting capture
and recognition, an adaptive difficulty-tier engine, and a teacher analytics dashboard —
while staying simple enough that a non-technical teacher can update the word bank by
dragging a spreadsheet into GitHub.

> This README documents the full engineering history of the project: the competition rules
> that shaped the design, the architecture decisions, the data contracts, and the staged
> development roadmap (Stage 0 → Stage 7).

---

## 🏆 Why this exists

The target competition scores students across **five rounds of 10 words each**, drawn from a
lottery of question slips. A foreign teacher reads a word and an example sentence, students
have **8 seconds** to write the answer on a whiteboard, and any correction/erasure on the
board is treated as an automatic wrong answer. Students who fail a round leave their seats;
scoring above 31/50 words correct earns a formal ranking.

That format — timed dictation, strict handwriting, elimination pressure — is the reason this
project centers on:

- **Spaced repetition** so practice time is spent on words a student is actually weak on,
  not words they already know.
- **Timed handwriting capture**, mirroring the "write in N seconds, no corrections allowed"
  rule of the real competition.
- **Objective, non-self-reported grading** — a student never rates their own answer; the
  system grades from recognized text vs. the correct spelling and elapsed time.
- **A teacher dashboard** that surfaces class-wide weak points without requiring the teacher
  to manually tally results.
- **Adaptive difficulty placement**, so a student starts at roughly the right tier from day
  one and moves up or down based on objective performance — not a fixed "everyone starts at
  level 1" assumption.
- **No answer leakage in the example sentence** — the target word is masked (with stem-aware
  matching, not strict string equality) while the student is answering, then revealed only
  after submission.

## ✨ Key Features

| Area | Feature |
|---|---|
| Practice loop | TTS word + sentence prompt → timed handwriting capture → recognition → objective grading → SM-2 scheduling |
| Spaced repetition | SM-2 algorithm, adapted from an earlier GRE vocabulary SRS project; **only wrong answers enter the review pool** (`everWrong` flag), and a word leaves the pool after **5 consecutive correct answers** |
| Handwriting | Canvas capture + pluggable recognition engine (Google IME handwriting API) |
| Speech | Web Speech API with configurable playback rate (default 1.0x for authentic listening practice) + a "🐢 Replay slower" button bounded by a teacher-configurable floor (default 0.85x). Speech-driven countdown: the countdown does not start until speech ends (with an 8-second fallback safety timer) |
| **Example-sentence masking** | The target word is masked (underscores of matching length) while answering, revealed after submission. Uses **Porter Stemmer** normalization so `recite` / `recited` / `reciting` are all masked, but does not over-stem (`art` and `artist` stay distinct) |
| **Configurable per-question time limit** | Each assignment can set the answer window (3–30 s; presets 5/8/10/15/20 s). Resolved via `QuizTimingPolicy` with three-layer priority: student override > assignment > system default (8 s) |
| **After-quota practice** | When a student finishes their daily quota, the done screen offers "📚 Continue practicing" if the teacher enabled it. This is a two-layer opt-in: teacher chooses `stop` vs `continue`, then the student actively chooses whether to extend |
| **Adaptive difficulty** | `PlacementOrchestrator` places new students at roughly the right tier using a binary-search-style ladder (start L3, 3 questions per tier); `LevelProgressionService` + `RuleBasedStrategy` continuously promote/demote based on rolling performance over a 30-attempt window, with the evaluation frequency aligned to the window size (every 30 attempts). Promotion gate: ≥ 85% correct, < 7 s average, ≥ 20 attempts at or below the current level. Demotion requires ≥ 50% wrong **and** ≥ 5 s average (filters out fast guessing). A trend guard blocks demotion when the student is improving (> 20% late-vs-early delta), and probe questions at higher levels can trigger promotion independently. Post-change lock: 50 attempts |
| **Assignment system** | Teacher-configurable daily quota, new-vs-review ratio, exploration focus, **target difficulty tier** (weighted question selection mixes target + current + probe), per-assignment speech-rate floor, per-assignment time limit, and per-assignment quota-exceeded behavior. Priority order: individual > class > school-wide |
| **Word bank management** | Teachers upload a `.xlsx` file → schema validation → preview → batched publish with 1-second delays between 400-row chunks, avoiding quota blowouts |
| **Teacher dashboard** | Student overview, at-risk detection, Top-K weakness analysis, response-time distribution, learning-style radar, error-type pie, memory-curve growth chart (unlocked after 7 days of practice), per-student PDF report export, student archiving |
| Roles & auth | Anonymous auth for students, Email/Password for teachers/admins, Firestore security rules enforcing per-role access, custom claims read via `getIdTokenResult(true)` |
| Anti-cheat signals | Edit-distance + response-time based "random guessing" detection, flagged separately from genuine spelling mistakes |
| Performance | Top-K candidate pooling, pre-aggregated class stats, batched writes (`AttemptBatcher` merging 5 writes per attempt into a single atomic commit), random-sampling word selection via a `random` field, **three-layer dashboard cache** (in-memory → Firestore IndexedDB → server), live Firestore quota monitoring with a global banner when exhausted |
| Cross-device state | Learning state (current level, SM-2 progress, daily snapshots) keyed by a compound `displayId` (`{class}_{seat}_{name}`) rather than Firebase UID, so a student who re-logs-in or switches devices keeps their progress |
| Profile hygiene | On every student login, old UID profiles for the same `displayId` are automatically cleaned up via a localStorage-based tracker — zero extra Firestore reads, and no accumulation of orphan profile documents |
| Reporting & lifecycle | Per-student PDF report export; archiving service for students who graduate out of a cohort |

## 🧱 Architecture

The codebase is organized by **Single Responsibility Principle (SRP)**: `domain/` holds pure
logic, `services/` owns every I/O boundary (Firestore, exports, monitoring), and
`features/` wires them together into screens. This is the actual current project tree:

``` mermaid
graph TD
    %% High-contrast styling (dark background + white text) for readability in both light/dark GitHub themes
    classDef ui fill:#1e40af,stroke:#3b82f6,stroke-width:2px,color:#ffffff;
    classDef domain fill:#065f46,stroke:#10b981,stroke-width:2px,color:#ffffff;
    classDef service fill:#9a3412,stroke:#f97316,stroke-width:2px,color:#ffffff;
    classDef infra fill:#4c1d95,stroke:#8b5cf6,stroke-width:2px,color:#ffffff;

    subgraph Features [Presentation Layer Features]
        UI_Quiz[Quiz Flow Orchestration]:::ui
        UI_Dash[Teacher Dashboard]:::ui
        UI_Admin[Admin Panel]:::ui
    end

    subgraph Domain [Domain Layer Domain - Pure Functions]
        D_SM2[SM-2 Spaced Repetition]:::domain
        D_Grade[Objective Grading & Masking]:::domain
        D_DDA[Adaptive Leveling DDA]:::domain
        D_Select[Selection & Quota Policy]:::domain
    end

    subgraph Services [Service Boundary Services - I/O]
        S_Store[Progress Store]:::service
        S_Analytics[Analytics Service]:::service
        S_Assign[Assignment Service]:::service
    end

    subgraph Infrastructure [Infrastructure & External Dependencies]
        I_Firebase[(Firebase Firestore)]:::infra
        I_TTS[Web Speech API TTS]:::infra
        I_IME[Google IME Handwriting]:::infra
    end

    %% Unidirectional dependency flow
    UI_Quiz --> D_SM2
    UI_Quiz --> D_Grade
    UI_Quiz --> D_DDA
    UI_Quiz --> D_Select

    UI_Dash --> S_Analytics
    UI_Admin --> S_Assign

    D_SM2 --> S_Store
    D_Select --> S_Store
    S_Analytics --> S_Store
    S_Assign --> S_Store

    S_Store --> I_Firebase
    UI_Quiz --> I_TTS
    UI_Quiz --> I_IME
```

```
vocab-handwriting-trainer/
├── tsconfig.json
├── vite.config.ts
├── firestore.rules
│
├── scripts/ # Build-time / maintenance tools
│ ├── mergeVocabCsv.ts # Merge multiple raw vocab sources into one CSV
│ ├── simplifyVocabByUsage.ts # Trim/simplify the word bank by usage frequency
│ ├── set-role.mjs # Assign teacher/admin custom claims to a Firebase user
│ ├── cleanupAnonymousProfiles.mjs # Remove duplicate students/{uid} profiles
│ ├── deleteStudentData.mjs # One-off: delete all attempts+profile for a displayId
│ ├── inspectStudent.mjs # Print a student's learning state, daily snapshots, recent attempts
│ ├── diagnoseDDA.mjs # Diagnose why level evaluation isn't triggering (count vs totalAttempts, time gaps, classStats)
│ ├── diagnoseAttemptsGap.mjs # Find mismatches between totalAttempts and the real attempts count (by displayId vs by uid)
│ ├── fixStudentStates.mjs # Backfill missing StudentLearningState fields (totalAttempts, levelLockedUntil, levelHistory)
│ ├── simulateEvaluation.mjs # Replay RuleBasedStrategy on a student's real attempts, old vs new thresholds
│ └── tsconfig.json
│
├── vocab_csv/
│ └── vocab_cleaned.csv # Cleaned word bank (CSV-based pipeline)
│
└── src/
├── App.tsx / main.tsx / firebase.ts / vite-env.d.ts
│
├── contexts/
│ └── AuthContext.tsx # Reads Firebase custom claims → role (student/teacher/admin)
│
├── domain/ # Pure functions only — no DOM, no network, no DB
│ ├── analytics/
│ │ ├── radarMetrics.ts # Learning-style radar chart math
│ │ └── studentAnalyzer.ts (+test) # Per-student stat aggregation
│ ├── assignment/
│ │ └── selectAssignment.ts (+test) # Priority-order assignment selection
│ ├── date/overdue.ts # Overdue-review date math
│ ├── firestore/
│ │ └── removeUndefined.ts # Strip undefined before Firestore writes
│ ├── grading/grader.ts (+test) # Objective pass/fail + SM-2 "quality" score
│ ├── placement/
│ │ └── placementDecision.ts (+test)# Ladder logic for placement test
│ ├── progression/ # Adaptive leveling logic
│ │ ├── evaluationGuard.ts (+test) # "Should we evaluate now?" gate
│ │ ├── LevelProgressionStrategy.ts
│ │ ├── RuleBasedStrategy.ts
│ │ ├── metricsCalculator.ts
│ │ └── progression.test.ts
│ ├── quiz/
│ │ ├── QuizTimingPolicy.ts # 3-layer per-question time limit resolver
│ │ └── SessionQuotaPolicy.ts # 2-layer after-quota behavior (stop/continue)
│ ├── scheduler/
│ │ ├── sm2.ts (+test) # Spaced-repetition math
│ │ └── reviewStateMapper.ts
│ ├── selection/questionSelector.ts (+test) # Pure "which word next?" (no quota)
│ ├── string/
│ │ ├── displayId.ts # buildDisplayId: {class}{seat}{name}
│ │ ├── sanitizeId.ts # word → stable Firestore-safe wordId
│ │ ├── similarity.ts # editDistance / similarity for guess detection
│ │ ├── porterStemmer.ts # Porter (1980) stemming for example-sentence masking
│ │ └── maskWord.ts (+test) # Stem-aware word masking in an example sentence
│ └── validation/wordSchema.ts # Word-bank field contract
│
├── services/ # I/O boundary layer
│ ├── analytics/
│ │ ├── AnalyticsService.ts # Per-student data aggregation from Firestore
│ │ ├── ClassStatsService.ts # Pre-aggregated class-wide stats
│ │ └── ArchivedStudentsService.ts # Archive/retire students across cohorts
│ ├── assignment/AssignmentService.ts # Teacher-configurable assignments
│ ├── export/studentReportPdf.ts # Per-student PDF report generation
│ ├── profile/
│ │ ├── ProfileService.ts # Save/load student profile (keyed by uid)
│ │ └── ProfileCleanupTracker.ts # localStorage-backed old-uid tracker
│ ├── progression/
│ │ ├── LevelProgressionService.ts
│ │ ├── PerformanceTracker.ts
│ │ └── StudentStateService.ts
│ ├── status/quotaMonitor.ts # Firestore read/write quota tracking + global banner
│ ├── storage/
│ │ ├── ProgressStore.ts # Interface
│ │ ├── FirestoreProgressStore.ts
│ │ ├── LocalStorageProgressStore.ts
│ │ ├── InMemoryProgressStore.ts
│ │ ├── HybridProgressStore.ts # Local-first, syncs to Firestore; circuit breaker + retry queue
│ │ └── AttemptBatcher.ts # Batches 5 attempt-related writes into one atomic commit
│ └── wordRepository/
│ ├── WordRepository.ts # Interface
│ ├── FirestoreWordRepository.ts
│ └── InMemoryWordRepository.ts
│
├── features/ # Screens, organized by user-facing flow
│ ├── admin/AdminPanel.tsx
│ ├── common/AppHeader.tsx # Role-aware navigation
│ ├── login/
│ │ ├── StudentLogin.tsx # Anonymous auth + profile save + iOS audio unlock
│ │ └── TeacherLogin.tsx # Email/Password auth
│ ├── placement/PlacementOrchestrator.ts # Initial level-placement flow
│ ├── quiz/
│ │ ├── QuizOrchestrator.ts # Coordinates the whole practice loop
│ │ ├── QuizSessionApi.ts # Interface shared by normal + placement sessions
│ │ ├── AnswerProcessor.ts (+test) # Recognition result → grading → SM-2 (pure)
│ │ ├── HandwritingCanvas.tsx
│ │ ├── Countdown.tsx # Gated countdown (waits for speech end)
│ │ └── QuizScreen.tsx
│ └── dashboard/
│ ├── TeacherDashboard.tsx
│ ├── AssignmentManager.tsx
│ ├── hooks/useStudentDetail.ts # Fetch + cache per-student detail
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



### Design decisions worth calling out

- **Word content vs. learning progress are stored separately.** The word bank only ever
  holds *content* (word, meaning, sentence, level). SRS state (`reviewInterval`,
  `easeFactor`, `nextReviewDate`, …) lives in Firestore under
  `studentStates/{displayId}/words/{wordId}`. A teacher can publish a new word list without
  wiping out anyone's review history.

- **Learning state is keyed by `displayId`, not Firebase UID.** Anonymous auth generates a
  fresh UID every login, so keying progress by UID would lose everything on re-login or
  device switch. The compound key `{class}_{seat}_{name}` (e.g. `709_1_S1`) is stable
  across sessions, so `studentStates/{displayId}` holds levels, SM-2 progress, and daily
  snapshots in one document tree.

- **Grading never trusts the user.** `domain/grading/grader.ts` computes an objective
  `quality` score (0–5) purely from recognized text vs. correct answer and elapsed time vs.
  time limit; `AnswerProcessor.ts` is the only place that pipes a recognition result through
  grading, SM-2, and storage. `sm2.ts` never sees raw user input — only the pre-computed
  score. This mirrors the real competition, where a whiteboard is judged by a human referee,
  not self-reported.

- **SM-2 only tracks wrong answers.** `ReviewState.everWrong` is set to `true` on first wrong
  answer, and **cleared after 5 consecutive correct answers** (tracked via a separate
  `correctStreak` counter that is independent of `sm2.ts`'s `MASTERY_STREAK` reset). This
  means a word a student gets right on the first try never enters the review pool, and a
  word a student eventually masters naturally graduates out.

- **Storage is layered, not monolithic.** `ProgressStore` is an interface with
  `InMemoryProgressStore`, `LocalStorageProgressStore`, `FirestoreProgressStore`, and a
  `HybridProgressStore` that combines local-first responsiveness with a Firestore sync —
  plus `AttemptBatcher` to merge the per-attempt writes (SM-2 state, learning state
  counter, attempt record, class stats, daily snapshot) into a **single atomic
  `writeBatch`**.

- **Circuit breaker + retry queue for quota exhaustion.** When Firestore returns
  `resource-exhausted`, `HybridProgressStore` stops trying to write to the cloud, queues
  mutations in `localStorage`, and displays a global banner. The circuit breaker releases
  at the next Pacific-midnight quota reset — not after a fixed delay that would just hit
  the same wall again.

- **Candidate pools, not full scans.** Early versions loaded a student's entire review
  history on login, which blew through Firestore's free-tier read quota (7,000+ reads at
  once). `quotaMonitor.ts` now tracks read/write volume directly, alongside Top-K candidate
  pooling and pre-aggregated `ClassStatsService` documents for the teacher dashboard.

- **The teacher dashboard reads through a three-layer cache, with explicit
  manual refresh as the escape hatch.** The dashboard used to trigger
  full-table scans on the `attempts` collection (7,000+ reads) and re-fetch
  every student's detail on page refresh (~840 reads across 7 students). On
  the Spark free tier (50K reads/day), this blew the daily quota within a
  single afternoon of teacher use.

  The fix layers three caches with different lifetimes:

    1. **In-memory (module-level Map in `useStudentDetail`)** — survives
       within a single SPA session. Switching between students costs
       < 1 ms and 0 reads.
    2. **Firestore IndexedDB cache (`getDocsFromCache()`)** — survives
       page refresh and browser restart. Costs 0 reads, hits in 5–30 ms.
    3. **Firestore server (`getDocs()`)** — only consulted when layers
       1 and 2 both miss, or when the teacher explicitly requests fresh
       data.

  Two supporting changes came with the layering:

  - `getAllStudentsStats()` and `getTopWeakWords()` no longer scan the
    `attempts` collection; they read the pre-aggregated `classStats`
    documents instead (4 reads instead of 7,000+).
  - `getWordsByIds()` now checks the IndexedDB cache first, so the
    per-student weak-word lookup (5 reads) costs 0 when the cache is warm.

  **The critical piece is the manual refresh button.** During the first
  iteration, `refetch()` only cleared the in-memory cache — but
  `getStudentDetail` still hit `getDocsFromCache` (Layer 2) first, which
  always returned the same stale data. The button appeared to do nothing.
  The fix adds a `forceServer` option to `getStudentDetail()` that skips
  Layer 2 entirely and goes straight to the server, plus a 600 ms minimum
  spinner so the user can perceive that something happened (Nielsen's
  100 ms response threshold — a sub-100 ms spinner looks like nothing
  occurred).

  **Data freshness is now reported honestly.** The old "🕐 Last updated"
  label showed the time of the last frontend call to `fetch`, which was
  reset on every interaction — it always read "just now" even when the
  data was a day old, and the stale-data warning never fired. The new
  display splits the concept into three fields:

    - **"🕐 Data as of [date]"** — derived from `analytics.lastAttemptAt`,
      the student's last actual answer. This is what the teacher cares
      about.
    - **"Live"** vs. **"Cached (synced N min ago)"** — derived from
      `analytics.dataSource` (`'server'` or `'cache'`) and
      `lastServerFetchedAt` (tracked separately from `lastFetchedAt`).
    - **Stale warning** fires only when `dataSource === 'cache'` AND
      the last successful server sync is more than 30 minutes old — not
      on a timer that resets every interaction.

  The design **deliberately does not auto-refresh**. Learning progress
  moves on an hour-to-day scale, not a second-to-second one. Auto-refresh
  would burn quota for no pedagogical benefit. Instead, the teacher is
  given (a) an honest signal of how old the data is, (b) an explicit
  manual refresh button, and (c) a per-student spinner so the cost of
  that refresh is visible. This is a case where **transparency beats
  automation** — the person who knows whether the data is fresh enough
  for their decision is the teacher, not the cache layer.

  Net effect: daily read volume dropped from ~66K (over quota) to
  ~2–3K on typical days. On the day the teacher used manual refresh
  heavily, the total climbed to ~20K — still well under the 50K ceiling,
  and entirely under the teacher's conscious control. Switching between
  students cost < 30 ms in perceived latency.

- **Random word sampling via a `random` field.** `getNewWordsByLevels` originally used
  `orderBy('word')`, which meant the same alphabetically-first words were picked every
  session. Each word document now carries a `random: number` field, and the query does a
  two-pass range scan (`random >= r` then `random < r` to fill gaps) for genuinely random
  sampling.

- **Example-sentence masking uses Porter Stemmer, not strict string equality.** In an
  example sentence like *"The child recited a poem."*, a student who has not learned the
  word `recite` yet could still copy the answer directly from the sentence. The fix is to
  replace the matched word with underscores of the same length while the student is
  answering. Strict matching alone would miss inflected forms — `recited` and `reciting`
  would not be masked. `maskWordInSentence` normalizes both the target word and each token
  in the sentence through **Porter Stemmer** (Martin Porter, 1980) before comparing, so all
  inflections of the same lemma are masked. To avoid over-stemming (`art` vs. `artist`,
  which Porter keeps distinct), the algorithm also applies a length-difference safety net.

- **Quota judgment has a single source of truth.** `SessionQuotaPolicy` is the only place
  that decides "can we show one more question?" `pickNextWordId` in
  `domain/selection/questionSelector.ts` is a pure "which word next?" function that does not
  know what a quota is. This was a deliberate refactor after an earlier version accidentally
  had two independent quota checks, which forced a `Number.MAX_SAFE_INTEGER` hack to make
  "continue practicing after quota" work. With one source of truth, any future quota-related
  feature (weekly quotas, per-level quotas, per-student override) only has to change one
  file.

- **The countdown starts when the speech ends, not when the question appears.** The
  competition format is "teacher reads the word and a sentence, then the 8-second writing
  window begins." The UI enforces this by holding the countdown at its initial value until
  `SpeechSynthesisUtterance.onend` fires, with an 8-second fallback timer in case speech is
  unavailable or silent. This prevents the browser's speech duration from silently eating
  into the student's actual writing time.

- **Per-question time limits are resolved through a three-layer policy.** A teacher can set
  a custom time limit per assignment (3–30 s); the assignment's value is resolved via
  `QuizTimingPolicy.resolve()` with priority: student-specific override > assignment
  setting > system default (8000 ms). This keeps the timing rule testable and keeps the UI
  from having to know about any of the resolution logic.

- **Auto-cleanup of old UID profiles is localStorage-driven, not Firestore-driven.** Every
  anonymous login generates a new UID, which means the `students/{uid}` collection
  accumulates orphan profiles over time. A Firestore-based cleanup would need an extra
  query on every login; a localStorage-based tracker (`ProfileCleanupTracker`) stores the
  list of UIDs previously seen for a `displayId` and deletes all but the current one,
  costing zero Firestore reads in the common case. When a student switches devices or clears
  storage, the profile accumulation is allowed to happen — a maintenance script
  (`cleanupAnonymousProfiles.mjs`) handles that edge case.

- **Assignment priority is a real hierarchy.** `selectActiveAssignment` (a pure function)
  picks the most specific match: individual assignment > class assignment > school-wide
  assignment, and within the same tier the most recently created one. When the same target
  has multiple active assignments, the teacher sees a ⚠️ badge in the list so they can
  clean up manually.

- **Adaptive leveling sits alongside SRS, not inside it.** `domain/progression/`
  (a strategy-pattern `LevelProgressionStrategy` with a `RuleBasedStrategy` implementation)
  and `PlacementOrchestrator.ts` handle *which difficulty level* a student is placed into,
  separately from SM-2's *which specific word is due today*. The two systems compose rather
  than overlap.

- **Evaluation frequency must align with the statistical window, or the
  window is silently corrupted.** The first version of the DDA system
  evaluated a student's level every 10 attempts, but the performance
  window was 30 attempts. This meant each evaluation used only 10 fresh
  data points and 20 stale ones — the stale majority dominated the
  decision. A student who legitimately improved would see their new
  performance diluted by old failures; a student who hit a temporary
  rough patch would see their old successes mask the decline. The visible
  symptom was a student oscillating between L3 and L4 over a single
  practice session, sometimes changing level twice within 30 questions.

  The fix was to **treat the window size as the evaluation interval**:
  `MIN_ATTEMPTS_BETWEEN_EVALUATIONS` went from 10 to 30, matching
  `WINDOW_SIZE`. Every evaluation now corresponds to a **fully-refreshed
  window** — no stale data dominates, and the decision reflects the
  student's performance over the exact same set of attempts the metrics
  are computed from.

  Three additional signal-level fixes went in alongside this:

    1. **Response time on demotion.** The old rules demoted on low
       correctness alone, which punished "fast guessers" identically to
       "slow strugglers." The fix adds `DEMOTE_MIN_AVG_TIME_MS = 5000`:
       demotion requires both low correctness **and** slow responses,
       filtering out the case where a student is clicking randomly.

    2. **Trend guard.** `metricsCalculator` now computes
       `earlyCorrectRate`, `lateCorrectRate`, and `trend` (late minus
       early) within the window. A student who is **actively improving**
       (`trend > 0.2`) is protected from demotion even if their overall
       window average is low, because their trajectory matters more than
       their current snapshot.

    3. **Probe-based promotion.** The window is split into
       `attemptsAtLevel`, `attemptsBelowLevel`, and `attemptsAboveLevel`
       (probe questions at higher difficulty). If a student shows strong
       performance on probe questions (≥ 3 attempts, ≥ 70% correct), they
       can be promoted even without hitting the 20-attempt threshold on
       the current level. This addresses the case where a student is
       clearly ready for the next tier but the current level's sample
       size is still building up.

  Finally, `LOCK_ATTEMPTS_AFTER_CHANGE` was extended from 30 to 50 to
  give the student more adaptation time before the next evaluation can
  fire. Combined with the frequency alignment, this prevents the "just
  promoted, immediately demoted" oscillation pattern entirely.

- **Level-progression thresholds must leave headroom below the sliding window.**
  `PerformanceTracker` uses a 30-attempt sliding window, and buildDefaultNewWords
  reserves roughly 10% of each new-word pool for probe questions above the current
  level. An earlier version set `PROMOTE_MIN_ATTEMPTS_IN_LEVEL = 30` and counted only
  exact-level matches — which made promotion mathematically unreachable: the window
  could never contain 30 same-level attempts once probe words were mixed in. The symptom
  was a student who scored 76–98% for six consecutive days and never left L1. The fix
  relaxes the threshold to 20 and counts attempts at or below the current level
  (probe questions at a higher level are excluded, since they are out-of-syllabus
  challenges rather than evidence about the current tier). The average-response-time
  gate was also loosened from 5 s to 7 s, because the 8-second competition limit makes
  5 s an unreasonably tight bar. All thresholds are exported as `RULE_BASED_THRESHOLDS`
  so the unit tests reference them symbolically instead of hardcoding numbers — the next
  time a threshold is tuned, only one file changes.

- **Pure decision logic is extracted for testability.** The highest-risk algorithms live as
  pure functions in `domain/`: `placementDecision.ts` (placement ladder),
  `evaluationGuard.ts` (DDA "should we evaluate now?" gate), `selectAssignment.ts`
  (assignment priority order), `QuizTimingPolicy.ts` (time limit resolution),
  `SessionQuotaPolicy.ts` (after-quota behavior), `maskWord.ts` + `porterStemmer.ts`
  (example-sentence masking), and the `everWrong` lifecycle logic in `AnswerProcessor.ts`.
  Each has its own unit test file, so any future change is caught immediately by `npm test`.

- **Timezone handling follows a single source of truth: IANA names stored
  on the student record, resolved at read time.** The daily snapshot's
  `date` field was originally computed with
  `new Date().toISOString().slice(0, 10)`, which yields the **UTC** date.
  The dashboard displayed the "last practiced" timestamp with
  `toLocaleDateString()`, which uses the **browser's local** timezone.
  These two paths disagreed for any attempt made between UTC 16:00 and
  24:00 — which is Taipei 00:00–08:00, precisely the window when students
  finishing cram school or studying before bed are most likely to practice.

  The symptom surfaced during the pilot: a student's snapshot was
  attributed to `2026-10-03` while the dashboard reported their last
  practice as `2026/10/4`. The growth chart's trend line was correct, but
  the date labels were off by one day for late-night sessions.

  The fix establishes a single chain from detection to display:

    1. **Detection** — `detectTimeZone()` reads
       `Intl.DateTimeFormat().resolvedOptions().timeZone` on every student
       login and stores the IANA name (e.g. `Asia/Taipei`) on
       `studentStates/{displayId}`. Writing on every login rather than
       only the first time is deliberate: it handles the case where a
       student switches devices or travels.
    2. **Storage** — all timestamps remain in UTC (Firestore's native
       behavior). Nothing about the storage layer changes.
    3. **Derivation** — `getLocalDateString(date, timeZone)` uses
       `Intl.DateTimeFormat` to derive the local `YYYY-MM-DD` when needed
       (daily snapshots, engagement status, "last practiced").
    4. **Display** — `formatLocalDate(iso, timeZone)` renders dates in the
       student's timezone, not the viewer's.

  Why `Intl.DateTimeFormat` and not a manual `+8 hours` offset: a fixed
  offset cannot handle daylight saving time. A student in New York has
  UTC-4 in summer and UTC-5 in winter; a hardcoded offset would produce
  wrong dates twice a year. `Intl` delegates this to the browser, which
  already knows the rules.

  Existing snapshots are **not migrated**. The old `date` field cannot be
  repaired by re-reading `capturedAt`, because `capturedAt` is written
  only when a snapshot document is first created — subsequent attempts
  update the same document without touching that field. The information
  needed to redistribute attempts across day boundaries is simply not in
  the data. The pilot's remaining two weeks will use the corrected
  derivation; historical snapshots keep their original labels.

  This is not a "nice to have" fix. Daily activity counts, active-day
  streaks, and the growth chart's date axis are all derived from this
  value. Getting it wrong silently degrades the teacher's ability to
  reason about student behavior, which is the whole point of the
  dashboard.

- **Firestore never sees `undefined`.** Firestore's `addDoc`/`setDoc`/`writeBatch.set`
  reject any field whose value is `undefined`, but TypeScript's optional fields
  (`field?: T`) make `undefined` very easy to produce. The `removeUndefined` helper
  (`domain/firestore/removeUndefined.ts`) is applied at every Firestore write boundary, so
  optional fields either have a value or are omitted, never stored as `undefined`.

- **Dashboard reads are bounded and split by semantic intent.** The teacher
  dashboard's per-student detail used to load a student's full attempt history on
  every click (~1,000–1,500 reads per student as of Oct 2026, growing linearly).
  The service now uses three bounded queries: the most recent 100 attempts (for
  diagnosis charts — error breakdown, response-time distribution, weak-word
  analysis), the most recent 30 daily snapshots (for the growth chart), and one
  `studentStates/{displayId}` document (for the current level). The student's name
  and class are parsed from `displayId` rather than requiring a separate
  `classStats` scan. Net effect: ~110 reads per student detail view, down from
  ~1,500, and the number no longer grows over time.

  Crucially, the *cumulative* totals shown in the detail panel's header
  ("共 1,074 題") are read from the pre-aggregated `classStats` document (passed
  down as a prop from `TeacherDashboard`), not from the 100-attempt window. This
  keeps the numbers a teacher sees consistent with the student list and preserves
  the "practice volume" signal that has motivational value, while the charts still
  reflect recent behavior. Three different data sources for three different
  semantic purposes — deliberately, not by accident.

## 🔐 Roles & Authentication

| Role | Auth method | Access |
|---|---|---|
| `student` | Firebase Anonymous Auth (automatic, zero friction) | Login/quiz screens only |
| `teacher` | Email/Password | Login/quiz + dashboard + assignment management |
| `admin` | Email/Password | Everything a teacher can do, **plus** word-bank upload/publish |

Firestore security rules are the actual enforcement layer — UI-level hiding of buttons is a
convenience, not a security boundary. Students can only write to their own
`students/{uid}` document; only `teacher`/`admin` roles can write to `vocabulary` and
`assignments`.

Accounts are created by an administrator through Firebase Console, then the role is assigned
via `node scripts/set-role.mjs <email> <role>`. Custom claims are read with
`getIdTokenResult(true)` so the role takes effect on first login without requiring a logout.

## 📋 Data Contract

Teachers only ever touch a `.xlsx` file with these columns:

| Column | Required | Notes |
|---|---|---|
| `word` | ✅ | Correct spelling (the answer) |
| `meaning` | ✅ | Chinese definition |
| `sentence` | ✅ | Example sentence read aloud during quiz |
| `root` | – | Word root, for hints |
| `root_meaning` | – | Root meaning |
| `hint` | – | Memory aid |
| `level` | – | Difficulty/grouping tag (1–6) |

The `random` field that powers random word sampling is generated automatically at publish
time — teachers never need to supply it.

## 🗺️ Development Roadmap

The project was deliberately staged so that each phase could be validated independently
before the next began:

| Stage | Goal | Status |
|---|---|---|
| 0 | Lock the data contract (`.xlsx` schema ↔ JSON schema) | ✅ |
| 1 | Data pipeline: conversion/validation scripts + CI automation | ✅ |
| 2 | Core quiz logic (SM-2, question selection) — validated with **typed input** | ✅ |
| 3 | Quiz UI: TTS prompt, countdown, canvas (storage only, no recognition) | ✅ |
| 4 | Wire up real handwriting recognition; measure accuracy independently | ✅ |
| 5 | End-to-end integration: recognition → grading → SM-2 → cloud write | ✅ |
| 6-A | Teacher dashboard (read-only: overview, risk, weakness, response time) | ✅ |
| 6-B | Word-bank upload, schema validation, preview, versioned publish | ✅ |
| 6-C | Memory-curve visualization | ✅ |
| 6-D | Performance hardening: Top-K pooling, pre-aggregated stats, batched uploads, composite indexes | ✅ |
| 6-E | Firebase Authentication + role-based navigation | ✅ |
| 7 | Pilot test with real students on real tablets; collect recognition error cases | 🔄 In progress — first on-site session completed |

**Additional features built beyond the original roadmap** (all complete): cross-UID state
tracking (`studentStates`), initial degree placement (`PlacementOrchestrator`),
teacher-configurable target-tier weighted selection, speech rate control with per-student
override, configurable per-question time limit (`QuizTimingPolicy`), after-quota practice
(`SessionQuotaPolicy`), example-sentence masking via Porter Stemmer, per-student PDF report
export, student archiving, `writeBatch` optimization, Firestore offline persistence,
circuit breaker + retry queue, quota monitoring, the `everWrong` mastery lifecycle (auto-clear
after 5 consecutive correct answers), and automatic cleanup of orphaned UID profiles, plus a threshold correction in
`RuleBasedStrategy` that fixed a promotion gate which had been mathematically
unreachable under the 30-attempt sliding window (see "Design decisions worth calling
out").

**Automated test coverage: 131 unit tests across 7 suites**, covering `grader`, `sm2`,
`questionSelector`, `studentAnalyzer`, `RuleBasedStrategy`, `placementDecision`,
`selectAssignment`, `evaluationGuard`, `AnswerProcessor`, and `maskWord` (which also covers
`porterStemmer`). Tests focus on the highest-risk pure functions; I/O layers are
intentionally not unit-tested (they would require a Firestore emulator, which is deferred
to Stage 7+).

Stage 6-A was deliberately prioritized over 6-B: dashboards are **read-only** and touch
nothing in the existing quiz flow, while word-bank upload requires rewiring the core
`WordRepository`, which is the highest-risk refactor in the whole system.

## 🛠️ Tech Stack

- **Frontend:** TypeScript + Vite (static output, deployable to GitHub Pages)
- **Data conversion:** Node.js/TypeScript. Teacher-facing word-bank publishing goes through
  the Excel upload flow in `AdminPanel.tsx`; a separate set of one-off maintenance scripts
  (`mergeVocabCsv.ts`, `simplifyVocabByUsage.ts`) prepare and clean the underlying
  `vocab_csv/vocab_cleaned.csv` source list before it's imported
- **Handwriting recognition:** Google IME handwriting API
- **Speech:** Web Speech API (browser-native TTS) with iOS audio-unlock handling
- **Example-sentence masking:** Custom Porter Stemmer implementation
  (`domain/string/porterStemmer.ts`, no external NLP dependency)
- **Backend:** Firebase (Firestore + Anonymous/Email Auth), free Spark tier
- **CI/CD:** GitHub Actions — a teacher drags a new `words.xlsx` into GitHub, and the
  pipeline validates, converts, builds, and deploys automatically
- **Linting:** ESLint with `@typescript-eslint/recommended`

## 🧭 Product Validation Approach

Because this system supports a real, dated competition with a small, known group of
students, the roadmap deliberately front-loads **requirements discovery** over feature
building:

1. Interview the teacher who has previously run this competition — not "should we build a
   tool," but "how do you actually run practice today, and where does it hurt."
2. Talk to 2–3 students directly about how they currently self-study and where they get
   stuck (spelling vs. listening vs. recall).
3. Only then decide which differentiated features (error-type diagnostics, teacher
   roll-up view) are worth building, versus what a generic tool like Quizlet already
   covers.
4. Build the competition-facing UI last, and with the least effort — it is not the
   differentiator.
5. Run a real pilot with the ~7 target students before the competition, and treat both
   positive and negative findings as legitimate outcomes to report on.

The first on-site pilot session (Stage 7) has already happened. Several features were added
directly in response to what students and the teacher hit during that session, including
example-sentence masking (to prevent answer copying), a configurable time limit (the 8-second
default was too tight for beginners), and after-quota "continue practicing" (students wanted
to keep going but the previous design forced a re-login).

## 🔬 Research Positioning

The current system's approach to adaptive vocabulary recommendation sits at a
specific point in the research literature, and it is worth being explicit about
where.

A 2026 paper ([Zhang, *Discover Artificial Intelligence*](https://link.springer.com/article/10.1007/s44163-026-01588-3)) proposes a GCN-based
adaptive vocabulary recommendation framework. Its central critique is of earlier
systems that rely on **static expert-annotated knowledge graphs** (semantic,
morphological, prerequisite relations) — these, the paper argues, cannot reflect
learners' actual behavior, so recommendations drift away from what students
really need.

**The system described in this README is precisely one of those earlier
systems — deliberately.** The morphological relations (word roots) are expert
prior knowledge; the selection weights are hand-tuned rules; the vocabulary
graph does not adapt per student. This is not an oversight; it is a bounded
engineering decision driven by:

- **7-student pilot scale** — the paper's GCN was trained on 487 students,
  1,856 words, and 68,342 interactions over 16 weeks. At our scale, a GCN
  would overfit and produce noise, not signal.
- **Firebase Spark tier** — any dynamic re-computation per query would blow
  the daily quota.
- **Two-week pilot window** — no time to collect the longitudinal data the
  model needs.

What the paper calls a limitation, we treat as a **starting point**. The static
root graph is designed to be the initial structure that a future learned model
could be seeded from, once the student population grows enough to produce
training data.

The engineering path here is: **rules now, learning later** — not because
learning is worse, but because the data isn't there yet. This is the same
reasoning that leads every production ML system to start with a heuristic
baseline before training a model on the residuals.

## 📊 Data Distribution Analysis

As of October 2026, the system has accumulated **9,580 attempts**
across 7 students. A query of the distribution across levels reveals a
highly skewed pattern:

| Level | Estimated attempts | Share |
|---|---|---|
| L1 | 4,915 | 51.3% |
| L2 | 2,826 | 29.5% |
| L3 | 230 | 2.4% |
| L4 | 450 | 4.7% |
| L5 | 1,044 | 10.9% |
| L6 | 115 | 1.2% |

**This is not random.** It is the expected consequence of an adaptive
system. Looking at where students currently sit (identified only by
class and seat number, without names):

| Student ID | Current level | Total attempts |
|---|---|---|
| 801_25 | L1 | 1,679 |
| 802_18 | L1 | 1,533 |
| 805_11 | L1 | 1,649 |
| 805_2  | L1 | 747 |
| 802_16 | L4 | 1,262 |
| 802_25 | L4 | 1,270 |
| 804_18 | L6 | 1,440 |

Four students are stuck at L1 (they are the weakest cohort in this
particular group); two are at L4; one is at L6. **No student is
currently at L2, L3, or L5.** These three tiers are "transit" levels —
students pass through them but rarely stay, so attempts accumulate
only briefly before the student is promoted or demoted.

The L5 spike (10.9%) is a separate phenomenon: it comes from the
probe mechanism in `buildDefaultNewWords`, which reserves ~10% of each
new-word pool for questions one level above the student's current tier.
So L5 attempts are not a continuous learning trajectory — they are
individually sampled probes from students sitting at L4.

### Implication for knowledge tracing

This distribution has a direct consequence for any attempt to move from
rule-based DDA to probabilistic skill models such as **Bayesian
Knowledge Tracing (BKT)**. Standard BKT requires on the order of
25–250 samples per skill to estimate its four parameters
(`P(L0)`, `P(T)`, `P(S)`, `P(G)`) with any stability. At the level of
individual tiers, that gives:

| Level | Feasibility for per-level BKT |
|---|---|
| L1 | ✅ Well above threshold |
| L2 | ✅ Well above threshold |
| L3 | ⚠️ Borderline (230 samples) |
| L4 | ⚠️ Borderline (450 samples) |
| L5 | 🟡 Sample count is adequate, but the samples are *probes*, not a continuous learning trajectory |
| L6 | ❌ Insufficient (115 samples) |

**Only L1 and L2 can be modeled reliably with naive per-level BKT.**
Two future directions follow from this:

1. **Hierarchical Bayesian BKT** — let sparse tiers (L3, L4, L6) share
   statistical strength with dense ones through a common prior on the
   learning-rate parameter. This is the standard technique for
   balancing unequal sample sizes across groups in Bayesian modeling.
2. **Root-level BKT** — treat the word root (`spect`, `port`, `form`)
   rather than the difficulty tier as the skill unit. Roots naturally
   span multiple tiers, so a single root's data aggregates across
   L1-L6 and avoids the "one tier, one skill" imbalance entirely. This
   is consistent with the root-leverage direction already sketched
   under "Future Work".

Neither direction is implemented. The pilot data is documented here so
that (a) the distribution is explicit for anyone revisiting the
modeling question later, and (b) the case for hierarchical/root-level
BKT over naive per-level BKT is grounded in the actual data rather than
in intuition.

### Why this analysis is here

The path to this section ran through the five handwriting-quality
signals the system already collects on every attempt:
`recognizedText`, `editDistance`, `similarity`, `responseTimeMs`, and
`snapshotImageUrl`. These fields are currently used only for
*error-type classification* (the pie chart the teacher sees) — they
never enter the level-evaluation path. The intuition was that "wrong"
should not be binary: a `similarity = 0.9` miss is not the same as a
`similarity = 0.1` miss. That intuition points directly at BKT, which
updates a probabilistic belief about the student's knowledge state
using a *likelihood* rather than a binary label.

Trying to apply BKT to the current data immediately surfaced the
distribution problem above. So the "analysis" section is not a
detour — it is the first result of attempting to build a probabilistic
model on top of the rule-based system, and it is what tells us *which*
modeling approach is actually viable at this scale.

## ⚠️ Known Limitations

### Firestore security rules — deferred to post-pilot

`studentStates`, `attempts`, and `classStats` currently allow read/write to any signed-in
user. The `displayId` key format (`{class}_{seat}_{name}`) is documented in this README,
which means anyone who reads the README and knows the school's class/seat range could
enumerate `displayId`s to read or tamper with other students' progress.

Similarly, `students/{uid}` allows any signed-in user to **delete** any profile document
(this was opened up so a student's new UID can clean up their previous login's orphan
profiles). In practice the risk is contained because `students/{uid}` only stores profile
metadata (name, class, seat number, displayId) — no learning data — and the deleted
document is automatically recreated on next login. Learning state lives in
`studentStates/{displayId}`, which is unaffected by profile deletions.

This is an **acceptable risk for the 7-student pilot** but **must be fixed before any
larger deployment**. The correct fix is to bind `displayId` (or at least `class`) to
custom claims on the student's ID token, so rules can check
`request.auth.token.displayId == displayId`. This requires a Cloud Function (thus Blaze
plan) and is deferred to Stage 8.

As a partial mitigation, the deployed site is marked `noindex, nofollow` and ships a
`robots.txt` disallowing all crawlers, reducing the chance of accidental discovery.

### I/O layers are not unit-tested

`FirestoreProgressStore`, `AnalyticsService`, `AssignmentService`, etc. are not covered by
automated tests. The pure logic they delegate to *is* tested. Adding emulator-based
integration tests is planned for Stage 7+.

### Future Work: Root-Based Leverage Analysis

The current question selector treats each word independently. A future
direction is to model the vocabulary as a graph where words sharing a
root form connected components, and to weight the selection toward
words that "unlock" other words. This resembles the bottleneck
analysis in max-flow problems, but the graph is small enough that a
simple weighting scheme should suffice.

## 📌 Status

Stages 0 through 6-E are complete, and Stage 7 (real-world pilot) is **in progress** — the
first on-site session with real students on real tablets has happened, and the resulting
observations drove a set of post-pilot features (example-sentence masking, configurable time
limit, after-quota practice). The system supports the full practice loop
(TTS → handwriting → grading → SM-2 → Firestore), adaptive difficulty placement,
teacher-configurable assignments with target-tier weighted selection, per-student speech
rate control, per-question time limit control, the teacher dashboard with growth-chart
visualization, per-student PDF report export, and role-based auth for
students/teachers/admins.

**Automated tests: 131 passing across 7 suites, 0 failing.**

**Remaining work in Stage 7:** continue collecting recognition error cases, tune the
handwriting pipeline against real student samples, and iterate on the pilot findings.
Feature scope is frozen at this point — the priority is real-world validation, not
additional scope.

## 📄 License

GPL 3.0