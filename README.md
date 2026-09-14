# 📖 Vocabulary King Trainer (英語單字王比賽訓練系統)

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

## ✨ Key Features

| Area | Feature |
|---|---|
| Practice loop | TTS word + sentence prompt → timed handwriting capture → recognition → objective grading → SM-2 scheduling |
| Spaced repetition | SM-2 algorithm, adapted from an earlier GRE vocabulary SRS project; **only wrong answers enter the review pool** (`everWrong` flag), and a word leaves the pool after **5 consecutive correct answers** |
| Handwriting | Canvas capture + pluggable recognition engine (Google IME handwriting API) |
| Speech | Web Speech API with configurable playback rate (default 1.0x for authentic listening practice) + a "🐢 Replay slower" button bounded by a teacher-configurable floor (default 0.85x) |
| Adaptive difficulty | `PlacementOrchestrator` places new students at roughly the right tier using a binary-search-style ladder (start L3, 3 questions per tier); `LevelProgressionService` + `RuleBasedStrategy` continuously promote/demote based on rolling performance |
| Assignment system | Teacher-configurable daily quota, new-vs-review ratio, exploration focus, **target difficulty tier** (weighted question selection mixes target + current + probe), and per-assignment speech-rate floor. Priority order: individual > class > school-wide |
| Word bank management | Teachers upload a `.xlsx` file → schema validation → preview → batched publish with 1-second delays between 400-row chunks, avoiding quota blowouts |
| Teacher dashboard | Student overview, at-risk detection, Top-K weakness analysis, response-time distribution, learning-style radar, error-type pie, memory-curve growth chart (unlocked after 7 days of practice), per-student PDF report export |
| Roles & auth | Anonymous auth for students, Email/Password for teachers/admins, Firestore security rules enforcing per-role access, custom claims read via `getIdTokenResult(true)` |
| Anti-cheat signals | Edit-distance + response-time based "random guessing" detection, flagged separately from genuine spelling mistakes |
| Performance | Top-K candidate pooling (not full-table scans), pre-aggregated class stats, batched writes (`AttemptBatcher`), random-sampling word selection via a `random` field, live Firestore quota monitoring with a global banner when exhausted |
| Cross-device state | Learning state (current level, SM-2 progress, daily snapshots) keyed by a compound `displayId` (`{class}_{seat}_{name}`) rather than Firebase UID, so a student who re-logs-in or switches devices keeps their progress |
| Reporting & lifecycle | Per-student PDF report export; archiving service for students who graduate out of a cohort |

## 🧱 Architecture

The codebase is organized by **Single Responsibility Principle (SRP)**: `domain/` holds pure
logic, `services/` owns every I/O boundary (Firestore, exports, monitoring), and
`features/` wires them together into screens. This is the actual current project tree:

```
vocab-handwriting-trainer/
├── tsconfig.json
├── vite.config.ts
│
├── scripts/ # Build-time / maintenance tools
│ ├── mergeVocabCsv.ts # Merge multiple raw vocab sources into one CSV
│ ├── simplifyVocabByUsage.ts # Trim/simplify the word bank by usage frequency
│ ├── set-role.mjs # Assign teacher/admin custom claims to a Firebase user
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
│ ├── grading/grader.ts (+test) # Objective pass/fail + SM-2 "quality" score
│ ├── placement/
│ │ └── placementDecision.ts (+test)# Ladder logic for placement test
│ ├── progression/ # Adaptive leveling logic
│ │ ├── evaluationGuard.ts (+test) # "Should we evaluate now?" gate
│ │ ├── LevelProgressionStrategy.ts
│ │ ├── RuleBasedStrategy.ts
│ │ ├── metricsCalculator.ts
│ │ └── progression.test.ts
│ ├── scheduler/
│ │ ├── sm2.ts (+test) # Spaced-repetition math
│ │ └── reviewStateMapper.ts
│ ├── selection/questionSelector.ts (+test)
│ ├── string/
│ │ ├── displayId.ts # buildDisplayId: {class}{seat}{name}
│ │ ├── sanitizeId.ts # word → stable Firestore-safe wordId
│ │ └── similarity.ts # editDistance / similarity for guess detection
│ └── validation/wordSchema.ts # Word-bank field contract
│
├── services/ # I/O boundary layer
│ ├── analytics/
│ │ ├── AnalyticsService.ts # Per-student data aggregation from Firestore
│ │ ├── ClassStatsService.ts # Pre-aggregated class-wide stats
│ │ └── ArchivedStudentsService.ts # Archive/retire students across cohorts
│ ├── assignment/AssignmentService.ts # Teacher-configurable daily quota per class
│ ├── export/studentReportPdf.ts # Per-student PDF report generation
│ ├── profile/ProfileService.ts # Student name/class profile (keyed by uid)
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
│ │ └── AttemptBatcher.ts # Batches attempt writes into a single atomic commit
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
│ │ ├── Countdown.tsx
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
  device switch. The compound key `{class}_{seat}_{name}` (e.g. `709_1_林佑倫`) is stable
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
  plus `AttemptBatcher` to merge the four writes per attempt (SM-2 state, learning state
  counter, attempt record, class stats) into a **single atomic `writeBatch`**.

- **Circuit breaker + retry queue for quota exhaustion.** When Firestore returns
  `resource-exhausted`, `HybridProgressStore` stops trying to write to the cloud, queues
  mutations in `localStorage`, and displays a global banner. The circuit breaker releases
  at the next Pacific-midnight quota reset — not after a fixed delay that would just hit
  the same wall again.

- **Candidate pools, not full scans.** Early versions loaded a student's entire review
  history on login, which blew through Firestore's free-tier read quota (7,000+ reads at
  once). `quotaMonitor.ts` now tracks read/write volume directly, alongside Top-K candidate
  pooling and pre-aggregated `ClassStatsService` documents for the teacher dashboard.

- **Random word sampling via a `random` field.** `getNewWordsByLevels` originally used
  `orderBy('word')`, which meant the same alphabetically-first words were picked every
  session. Each word document now carries a `random: number` field, and the query does a
  two-pass range scan (`random >= r` then `random < r` to fill gaps) for genuinely random
  sampling.

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

- **Pure decision logic is extracted for testability.** Four of the highest-risk
  algorithms live as pure functions in `domain/`: `placementDecision.ts` (placement ladder),
  `evaluationGuard.ts` (DDA "should we evaluate now?" gate), `selectAssignment.ts`
  (assignment priority order), and the `everWrong` lifecycle logic in `AnswerProcessor.ts`.
  Each has its own unit test file, so any future change is caught immediately by `npm test`.

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
| 7 | Pilot test with real students on real tablets; collect recognition error cases | ⏳ |

**Additional features built beyond the original roadmap** (all complete): cross-UID state
tracking (`studentStates`), initial degree placement (`PlacementOrchestrator`),
teacher-configurable target-tier weighted selection, speech rate control with per-student
override, per-student PDF report export, student archiving, `writeBatch` optimization,
Firestore offline persistence, circuit breaker + retry queue, quota monitoring, and the
`everWrong` mastery lifecycle (auto-clear after 5 consecutive correct answers).

**Automated test coverage: 101 unit tests** across `grader`, `sm2`, `questionSelector`,
`studentAnalyzer`, `RuleBasedStrategy`, `placementDecision`, `selectAssignment`,
`evaluationGuard`, and `AnswerProcessor`. Tests focus on the highest-risk pure functions;
I/O layers are intentionally not unit-tested (they would require a Firestore emulator,
which is deferred to Stage 7+).

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

## ⚠️ Known Limitations

### Firestore security rules — deferred to post-pilot

`studentStates`, `attempts`, and `classStats` currently allow read/write to any signed-in
user. The `displayId` key format (`{class}_{seat}_{name}`) is documented in this README,
which means anyone who reads the README and knows the school's class/seat range could
enumerate `displayId`s to read or tamper with other students' progress.

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

## 📌 Status

Stages 0 through 6-E are complete. The system supports the full practice loop
(TTS → handwriting → grading → SM-2 → Firestore), adaptive difficulty placement,
teacher-configurable assignments with target-tier weighted selection, per-student speech
rate control, the teacher dashboard with growth-chart visualization, per-student PDF report
export, and role-based auth for students/teachers/admins. Automated tests cover 101 cases
across the highest-risk pure logic.

**Stage 7 (pilot test with real students on real tablets) has not yet started.** All
features are frozen at this point — the next phase is real-world validation, not additional
scope.

## 📄 License

GPL 3.0