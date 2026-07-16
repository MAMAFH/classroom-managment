# 🏫 نظام إدارة وحجز القاعات
### Classroom Reservation & Management System

> A full-stack web application for managing and reserving university classrooms, with AI-powered timetable import from PDF schedules.

---

## ✨ Features

| Feature | Description |
|---|---|
| **📅 Manual Bookings** | Reserve any room for a specific date and time slot with conflict detection |
| **🔁 Fixed Recurring Schedules** | Import semester-wide weekly timetables that repeat every week |
| **🤖 AI PDF Import** | Upload a timetable PDF — the system parses it, then uses **Gemini AI** to validate and correct extracted data |
| **📊 Dashboard** | Live statistics: total rooms, upcoming bookings, occupied vs. available rooms |
| **🏢 Room Browser** | Browse all rooms with availability status per time slot, filterable by building (old / new) |
| **🔍 Conflict Detection** | Prevents double-bookings across both manual reservations and recurring schedules |
| **🗂️ Import Sessions** | Each PDF import is tracked as a named session; re-importing the same semester overwrites previous data |
| **💾 Offline-First** | All data is persisted in `localStorage` — no backend required for basic use |

---

## 🏗️ Architecture

```
Classroom-reservations/
├── src/
│   ├── App.tsx              # Root component — state, routing, actions
│   ├── main.tsx             # React entry point
│   ├── index.css            # Global styles
│   ├── types.ts             # TypeScript interfaces (Room, Booking, FixedSchedule…)
│   ├── utils.ts             # Shared helpers (overlap detection, ID generation…)
│   ├── seed_data.ts         # Initial booking seeds (pre-populated demo data)
│   ├── config/
│   │   └── periods.ts       # Time-slot configuration (period start/end times)
│   ├── pages/
│   │   ├── Dashboard.tsx    # Statistics overview page
│   │   ├── Rooms.tsx        # Room browser + slot-level availability grid
│   │   └── Bookings.tsx     # Booking management + PDF import wizard
│   └── services/
│       ├── gemini.ts        # Gemini AI cleanup/validation layer
│       ├── clientParser.ts  # Client-side PDF.js parser (fallback)
│       ├── serverParser.ts  # Server-side spatial timetable parser
│       └── importService.ts # Import orchestration logic
├── server.ts                # Express API server (PDF parse endpoint)
├── scripts/
│   └── parse_pdf.py         # Python/pypdf deterministic PDF text extractor
├── .env.example             # Environment variable template
├── vite.config.ts           # Vite config with proxy to backend on :3001
├── tailwind.config.js       # Tailwind CSS configuration
├── tsconfig.json            # TypeScript configuration
├── postcss.config.js        # PostCSS configuration
└── package.json             # Scripts and dependencies
```

---

## 🔄 PDF Import Flow

```
User uploads PDF
      │
      ▼
Frontend (Bookings.tsx)
  → Converts PDF to Base64
  → POST /api/import-schedule-pdf  ──→  Express server (server.ts)
                                               │
                                               ▼
                                    Python subprocess (parse_pdf.py)
                                    pypdf → extracts text + bounding boxes
                                               │
                                               ▼
                                    serverParser.ts
                                    Spatial layout analysis → structured rows/cols
                                               │
                                               ▼
                                    gemini.ts
                                    Gemini AI validates, corrects room names,
                                    fills in missing data, flags conflicts
                                               │
                                               ▼
                                    JSON response → Frontend maps rooms
                                    → Committed as a FixedSchedule session
```

> **Fallback:** If the backend is unreachable, the frontend automatically falls back to `clientParser.ts` which runs `pdfjs-dist` entirely in the browser.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19 + TypeScript + Vite 6 |
| **Styling** | Tailwind CSS v3 (dark theme, gold accent) |
| **Animations** | Motion (Framer Motion) |
| **Icons** | Lucide React |
| **Backend** | Node.js + Express (TypeScript, via `tsx`) |
| **PDF Parsing (Server)** | Python `pypdf` via child subprocess |
| **PDF Parsing (Client fallback)** | `pdfjs-dist` (Node.js legacy build) |
| **AI Validation** | Google Gemini API (`@google/genai`) |
| **Dev Orchestration** | `concurrently` (runs frontend + backend together) |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.9 (for server-side PDF parsing)

### 1. Clone the repository

```bash
git clone https://github.com/MAMAFH/Classroom-reservations.git
cd Classroom-reservations
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Set up the Python virtual environment

```bash
# Create the venv (must be named .venv at the project root)
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (Linux / macOS)
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements-parser.txt
```

### 4. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and set your Gemini API key:

```env
GEMINI_API_KEY="your_gemini_api_key_here"
PORT=3001
```

> Get a free Gemini API key at https://aistudio.google.com/apikey

### 5. Run the project

```bash
npm run dev
```

This launches **both** servers concurrently:

| Server | URL | Purpose |
|---|---|---|
| Frontend (Vite) | http://localhost:3000 | React UI |
| Backend (Express) | http://localhost:3001 | PDF parsing API |

> The Vite dev server proxies all `/api/*` requests to the backend automatically.

---

## 📜 Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start both frontend and backend in development mode |
| `npm run dev:frontend` | Start only the Vite dev server |
| `npm run dev:backend` | Start only the Express API server |
| `npm run build` | Build the frontend for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Type-check the TypeScript source |

---

## 🗂️ Data Model

```typescript
// A physical room in the building
Room {
  id: string
  name: string          // e.g. "فصل 101"
  capacity: number
  building: 'old' | 'new'
}

// A one-time manual reservation
Booking {
  id: string
  roomId: string
  date: string          // "YYYY-MM-DD"
  startTime: string     // "HH:MM"
  endTime: string       // "HH:MM"
  title: string
  bookedBy?: string
}

// A recurring weekly slot from an imported timetable
FixedSchedule {
  id: string
  roomId: string
  dayOfWeek: number     // 0 = Sunday … 6 = Saturday
  startTime: string
  endTime: string
  title: string
  semesterId: string    // groups all schedules in one PDF import
  importSessionId: string
  disabled?: boolean
}
```

---

## 🔑 Key Design Decisions

- **localStorage as the database** — No backend database required. All state is persisted client-side, making the app fully portable and zero-config.
- **Two-tier PDF parsing** — The Python `pypdf` layer does reliable text extraction with bounding boxes. The Node.js spatial parser then converts raw word positions into timetable cells.
- **Gemini as a correction layer** — Gemini AI is only invoked *after* the deterministic parser runs, to fix OCR errors, standardize room names, and validate the structured output.
- **Idempotent imports** — Re-uploading the same semester's PDF replaces the previous import session, preventing duplicate schedules.

---

## 📄 License

[MIT](./LICENSE)
