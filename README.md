# 📖 Vocabulary King Trainer (英語單字王比賽訓練系統)

An adaptive, offline-friendly vocabulary training platform built to help a small cohort of
middle-school students prepare for a live English vocabulary competition ("英語單字王比賽").
The system pairs a spaced-repetition engine (SM-2) with speech prompts, handwriting capture
and recognition, and a teacher analytics dashboard — while staying simple enough that a
non-technical teacher can update the word bank by dragging a spreadsheet into GitHub.

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

## ✨ Key Features

| Area | Feature |
|---|---|
| Practice loop | TTS word + sentence prompt → timed handwriting capture → recognition → objective grading → SM-2 scheduling |
| Spaced repetition | SM-2 algorithm, adapted from an earlier GRE vocabulary SRS project |
| Handwriting | Canvas capture + pluggable recognition engine (Google IME handwriting API, with a TensorFlow.js/OpenCV.js fallback path) |
| Word bank management | Teachers upload a `.xlsx` file → schema validation → preview → versioned publish, with zero code changes required |
| Teacher dashboard | Student overview, at-risk student detection, Top-K weakness analysis, response-time analysis, memory-curve visualization |
| Roles & auth | Anonymous auth for students, Email/Password for teachers/admins, Firestore security rules enforcing per-role access |
| Anti-cheat signals | Edit-distance + response-time based "random guessing" detection, flagged separately from genuine spelling mistakes |
| Performance | Top-K candidate pooling (not full-table scans), pre-aggregated class stats, batched writes, live quota monitoring — designed to survive Firestore's free-tier quota |
| Adaptive leveling | A `PlacementOrchestrator` + rule-based `LevelProgressionStrategy` decide which difficulty tier a student starts at and moves through, independent of the day-to-day SM-2 scheduling |
| Reporting | Per-student PDF report export; archiving service for students who graduate out of a cohort |

## 🧱 Architecture

The codebase is organized by **Single Responsibility Principle (SRP)**: `domain/` holds pure
logic, `services/` owns every I/O boundary (Firestore, exports, monitoring), and
`features/` wires them together into screens. This is the actual current project tree:

```
vocab-handwriting-trainer/
├── tsconfig.json
├── vite.config.ts
│
├── scripts/                                # Build-time / maintenance tools
│   ├── mergeVocabCsv.ts                    # Merge multiple raw vocab sources into one CSV
│   ├── simplifyVocabByUsage.ts             # Trim/simplify the word bank by usage frequency
│   ├── set-role.mjs                        # Assign teacher/admin custom claims to a Firebase user
│   └── tsconfig.json
│
├── vocab_csv/
│   └── vocab_cleaned.csv                   # Cleaned word bank (CSV-based pipeline)
│
└── src/
    ├── App.tsx / main.tsx / firebase.ts / vite-env.d.ts
    │
    ├── contexts/
    │   └── AuthContext.tsx                 # Reads Firebase custom claims → role (student/teacher/admin)
    │
    ├── domain/                             # Pure functions only — no DOM, no network, no DB
    │   ├── analytics/
    │   │   ├── radarMetrics.ts             # Learning-style radar chart math
    │   │   └── studentAnalyzer.ts (+test)  # Per-student stat aggregation
    │   ├── date/overdue.ts                 # Overdue-review date math
    │   ├── grading/grader.ts (+test)       # Objective pass/fail + SM-2 "quality" score
    │   ├── progression/                    # Adaptive leveling logic
    │   │   ├── LevelProgressionStrategy.ts
    │   │   ├── RuleBasedStrategy.ts
    │   │   ├── metricsCalculator.ts
    │   │   └── progression.test.ts
    │   ├── scheduler/
    │   │   ├── sm2.ts (+test)              # Spaced-repetition math
    │   │   └── reviewStateMapper.ts
    │   ├── selection/questionSelector.ts (+test)
    │   ├── string/
    │   │   ├── sanitizeId.ts               # word → stable Firestore-safe wordId
    │   │   └── similarity.ts               # editDistance / similarity for guess detection
    │   └── validation/wordSchema.ts        # Word-bank field contract
    │
    ├── services/                           # I/O boundary layer
    │   ├── analytics/
    │   │   ├── AnalyticsService.ts         # Per-student data aggregation from Firestore
    │   │   ├── ClassStatsService.ts        # Pre-aggregated class-wide stats
    │   │   └── ArchivedStudentsService.ts  # Archive/retire students across cohorts
    │   ├── assignment/AssignmentService.ts # Teacher-configurable daily quota per class
    │   ├── export/studentReportPdf.ts      # Per-student PDF report generation
    │   ├── profile/ProfileService.ts       # Student name/class profile (keyed by uid)
    │   ├── progression/
    │   │   ├── LevelProgressionService.ts
    │   │   ├── PerformanceTracker.ts
    │   │   └── StudentStateService.ts
    │   ├── status/quotaMonitor.ts          # Firestore read/write quota tracking
    │   ├── storage/
    │   │   ├── ProgressStore.ts            # Interface
    │   │   ├── FirestoreProgressStore.ts
    │   │   ├── LocalStorageProgressStore.ts
    │   │   ├── InMemoryProgressStore.ts
    │   │   ├── HybridProgressStore.ts      # Local-first, syncs to Firestore
    │   │   └── AttemptBatcher.ts           # Batches attempt writes
    │   └── wordRepository/
    │       ├── WordRepository.ts           # Interface
    │       ├── FirestoreWordRepository.ts
    │       └── InMemoryWordRepository.ts
    │
    ├── features/                           # Screens, organized by user-facing flow
    │   ├── admin/AdminPanel.tsx
    │   ├── common/AppHeader.tsx            # Role-aware navigation
    │   ├── login/
    │   │   ├── StudentLogin.tsx            # Anonymous auth + profile save
    │   │   └── TeacherLogin.tsx            # Email/Password auth
    │   ├── placement/PlacementOrchestrator.ts  # Initial level-placement flow
    │   ├── quiz/
    │   │   ├── QuizOrchestrator.ts         # Coordinates the whole practice loop
    │   │   ├── QuizSessionApi.ts
    │   │   ├── AnswerProcessor.ts          # Recognition result → grading → SM-2 → storage
    │   │   ├── HandwritingCanvas.tsx
    │   │   ├── Countdown.tsx
    │   │   └── QuizScreen.tsx
    │   └── dashboard/
    │       ├── TeacherDashboard.tsx
    │       ├── AssignmentManager.tsx
    │       ├── hooks/useStudentDetail.ts   # Fetch + cache per-student detail
    │       └── components/
    │           ├── StudentDetailPanel.tsx
    │           ├── WeakWordsTable.tsx
    │           ├── ResponseTimeBar.tsx
    │           ├── ErrorBreakdownPie.tsx
    │           ├── LearningStyleRadar.tsx
    │           └── StudentGrowthChart.tsx
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
  `easeFactor`, `nextReviewDate`, …) lives in Firestore, keyed by student. A teacher can
  publish a new word list without wiping out anyone's review history.
- **Grading never trusts the user.** `domain/grading/grader.ts` computes an objective
  `quality` score (0–5) purely from recognized text vs. correct answer and elapsed time vs.
  time limit; `AnswerProcessor.ts` is the only place that pipes a recognition result through
  grading, SM-2, and storage. `sm2.ts` never sees raw user input — only the pre-computed
  score. This mirrors the real competition, where a whiteboard is judged by a human referee,
  not self-reported.
- **Storage is layered, not monolithic.** `ProgressStore` is an interface with
  `InMemoryProgressStore`, `LocalStorageProgressStore`, `FirestoreProgressStore`, and a
  `HybridProgressStore` that combines local-first responsiveness with a Firestore sync —
  plus `AttemptBatcher` to avoid write storms.
- **Candidate pools, not full scans.** Early versions loaded a student's entire review
  history on login, which blew through Firestore's free-tier read quota (7,000+ reads at
  once). `quotaMonitor.ts` now tracks read/write volume directly, alongside Top-K candidate
  pooling and pre-aggregated `ClassStatsService` documents for the teacher dashboard.
- **Question selection avoids "stuck on one word."** An earlier bug caused the selector to
  loop over the same 2–3 words once a student exhausted their small pool of due reviews.
  The fix combines: a same-day "asked" set, a candidate pool sized as a multiple of the
  daily quota (not equal to it), backfilling with recently-studied-but-not-yet-due words,
  and an ε-greedy exploration term so no single word can get "stuck" at zero selection
  weight.
- **Adaptive leveling sits alongside SRS, not inside it.** `domain/progression/` (a
  strategy-pattern `LevelProgressionStrategy` with a `RuleBasedStrategy` implementation) and
  `PlacementOrchestrator.ts` handle *which difficulty level* a student is placed into,
  separately from SM-2's *which specific word is due today*. The two systems compose rather
  than overlap.

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
| `level` | – | Difficulty/grouping tag |

The conversion script only recognizes these column names — extra columns are ignored, and a
missing required column produces a specific, teacher-readable error (e.g. "Row 5 is missing
the `meaning` column") rather than a silent failure or a stack trace.

## 🗺️ Development Roadmap

The project was deliberately staged so that each phase could be validated independently
before the next began:

| Stage | Goal |
|---|---|
| 0 | Lock the data contract (`.xlsx` schema ↔ JSON schema) |
| 1 | Data pipeline: conversion/validation scripts + CI automation |
| 2 | Core quiz logic (SM-2, question selection) — validated with **typed input**, deliberately isolated from handwriting recognition risk |
| 3 | Quiz UI: TTS prompt, countdown, canvas (storage only, no recognition yet) |
| 4 | Wire up real handwriting recognition; measure accuracy independently |
| 5 | End-to-end integration: recognition → grading → SM-2 → cloud write |
| 6-A | Teacher dashboard (read-only: student overview, risk detection, weakness analysis, response time) |
| 6-B | Word-bank upload, schema validation, preview, versioned publish |
| 6-C | Memory-curve visualization |
| 6-D | Performance hardening: Top-K pooling, pre-aggregated stats, batched uploads, composite indexes |
| 6-E | Firebase Authentication + role-based navigation |
| 7 | Pilot test with real students on real tablets; collect recognition error cases |

Stage 6-A was deliberately prioritized over 6-B: dashboards are **read-only** and touch
nothing in the existing quiz flow, while word-bank upload requires rewiring the core
`WordRepository`, which is the highest-risk refactor in the whole system.

## 🛠️ Tech Stack

- **Frontend:** TypeScript + Vite (static output, deployable to GitHub Pages)
- **Data conversion:** Node.js/TypeScript. Teacher-facing word-bank publishing still goes
  through the Excel upload flow in `AdminPanel.tsx`; a separate set of one-off maintenance
  scripts (`mergeVocabCsv.ts`, `simplifyVocabByUsage.ts`) prepare and clean the underlying
  `vocab_csv/vocab_cleaned.csv` source list before it's imported
- **Handwriting recognition:** Google IME handwriting API, with an open-source
  TensorFlow.js + OpenCV.js path as a self-hosted fallback
- **Speech:** Web Speech API (browser-native TTS)
- **Backend:** Firebase (Firestore + Anonymous/Email Auth), free Spark tier
- **CI/CD:** GitHub Actions — a teacher drags a new `words.xlsx` into GitHub, and the
  pipeline validates, converts, builds, and deploys automatically

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

## 📌 Status

Stages 0 through 6-B (partial) are complete: data contract, pipeline, SM-2 core logic,
handwriting recognition (Google IME), Firebase storage, teacher dashboard (overview, risk
detection, weakness analysis, average response time), and Excel/CSV upload with schema
validation, preview, and versioned publish/draft state. Firebase Authentication (roles for
student/teacher/admin) and further performance/UX polish (Stage 6-D/6-E) are in progress
ahead of the Stage 7 pilot test.

## 📄 License

GPL-3.0
