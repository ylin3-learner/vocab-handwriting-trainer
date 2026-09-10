# Vocab Handwriting Trainer

[繁體中文版 README](./README.zh-TW.md)

A handwriting-based English vocabulary practice system built for middle school students. Teachers upload a vocabulary bank and assign practice sets; students write their answers by hand on a tablet; the system automatically recognizes, grades, and schedules reviews — with a teacher dashboard showing class-wide learning data.

This project was built to replace self-reported spelling drills (where students can under-report mistakes) with objective, handwriting-based assessment that mirrors real spelling-bee conditions: the teacher reads a word and a sentence aloud, the student has a fixed time window to write the answer from memory, and the system judges the result exactly — no self-grading, no partial credit.

## ✨ Features

- **Handwriting recognition** — Google Input Tools API, full-word recognition
- **Spaced repetition (SM-2)** — smart scheduling of review timing based on objectively measured accuracy and response time (not student self-rating)
- **Top-K candidate pool** — dramatically reduces Firestore reads (99%+) by keeping the active review set small instead of querying the whole word bank every time
- **Assignment distribution** — teachers can set daily quotas, the new-word/review-word ratio, and review focus per class or per student
- **Teacher dashboard** — class progress, at-risk students, and weak-word analysis
- **Offline-first** — local `localStorage` cache with background cloud sync, so a flaky classroom Wi-Fi connection doesn't interrupt practice
- **Role-based access** — Firebase Auth + Firestore security rules separating teacher and student permissions

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| Frontend | TypeScript + React + Vite |
| Backend | Firebase Firestore + Firebase Auth |
| Handwriting recognition | Google Input Tools API |
| Text-to-speech | Web Speech API |
| Deployment | GitHub Pages |

## 📁 Project Structure

```
vocab-handwriting-trainer/
├── data/
│   ├── raw/words.xlsx          # Teacher-maintained vocabulary source (single source of truth)
│   ├── schema/                 # Fixed column contract shared by the converter and the app's types
│   └── generated/              # Auto-generated words.json + validation report (do not edit by hand)
├── src/
│   ├── domain/                 # Pure business logic: SM-2, grading, question selection, countdown
│   ├── services/                # I/O boundary: recognition engine, speech prompter, Firestore sync
│   ├── features/                # Screens: quiz, login, teacher dashboard
│   └── types/                   # Shared type definitions matching the data contract
├── scripts/                     # Build-time Excel → JSON conversion & validation
├── .github/workflows/           # CI: data conversion + build + deploy
└── docs/                        # Architecture notes and the Excel data contract
```

See [`docs/architecture.md`](./docs/architecture.md) and [`docs/data-contract.md`](./docs/data-contract.md) for details.

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A Firebase project (the free Spark plan is enough)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Firebase

Copy the example environment file and fill in your Firebase project's web app credentials:

```bash
cp .env.example .env
```

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 3. Add your vocabulary bank

Replace `data/raw/words.xlsx` with your own file, following the column contract described in [`docs/data-contract.md`](./docs/data-contract.md) (`word`, `meaning`, `sentence`, plus optional `root`, `root_meaning`, `hint`, `level`). Pushing a new file to this path automatically triggers the conversion workflow.

### 4. Run the app locally

```bash
npm run dev
```

### 5. Run tests

```bash
npm test
```

Domain logic (SM-2 scheduling, grading, question selection, countdown state) is covered by fast, dependency-free unit tests using Node's built-in test runner. Browser-only integrations (handwriting recognition, speech synthesis, canvas capture) are verified manually in the browser.

### 6. Build and deploy

```bash
npm run build
```

Pushing to `main` triggers the GitHub Actions workflow, which builds the app and deploys it to GitHub Pages.

## 📊 Data Format

The vocabulary bank is intentionally kept in `.xlsx` so non-technical teachers can maintain it in Excel. Student review progress is stored separately in Firestore and is never overwritten when the word bank is replaced. Full column specification: [`docs/data-contract.md`](./docs/data-contract.md).

## 🧪 Design Principles

- **Single Responsibility** — each module (grading, scheduling, selection, recognition, storage) has exactly one reason to change.
- **Objective grading** — the quality score fed into SM-2 is always computed from spelling accuracy and response time, never from student self-report.
- **Swappable recognition engine** — the app depends on a `RecognitionEngine` interface, not a specific vendor, so the handwriting backend can be replaced without touching quiz logic.

## 🤝 Contributing

Issues and pull requests are welcome. Please make sure `npm test` passes before submitting a PR.

## 📄 License

See [`LICENSE`](./LICENSE).
