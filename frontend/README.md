# ContractTrace — Frontend

An evidence-first contract auditing dashboard built with **React 19 and Vite**, designed to help auditors review public contracts, amendments, invoices, and payments in alignment with **UN Sustainable Development Goal 16.6 — Effective, Accountable and Transparent Institutions**.

ContractTrace provides a centralized interface for contract monitoring, financial reconciliation, investigation management, and audit transparency.

A reconciliation flag is an indication requiring review, not an accusation or a final finding.

**Live Application:** https://contracttrace.vercel.app/

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Application Architecture](#application-architecture)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [Backend Integration](#backend-integration)
- [Role-Based Access Control](#role-based-access-control)
- [AI-Powered Case Analysis](#ai-powered-case-analysis)
- [Project Structure](#project-structure)
- [Available Scripts](#available-scripts)
- [Deployment](#deployment)
- [Demo Mode](#demo-mode)

---

## Overview

ContractTrace is an auditor-facing dashboard that enables users to monitor public contracts and identify potential financial and procedural discrepancies.

The frontend communicates with a FastAPI backend to retrieve contract records, supporting evidence, investigation cases, and audit history.

It also supports a standalone demo mode using a bundled dataset, allowing the application to remain functional without an active backend connection.

The application is designed around three principles:

- **Transparency:** Make contract information, financial discrepancies, and investigation history accessible.
- **Accountability:** Maintain clear auditor responsibilities and traceable decisions.
- **Human oversight:** Use deterministic reconciliation rules and AI-assisted analysis without automating final audit decisions.

---

## Features

### 1. Overview Dashboard
- Portfolio-level KPIs and contract monitoring.
- Deterministic reconciliation rule distribution (Rules 1–3).
- Auditor decision outcome breakdown.
- Priority investigation queue.
- Portfolio-level financial visibility.

### 2. Reviewer Workbench
- Detailed contract dossier and supporting evidence.
- Invoice-versus-contract-cap variance analysis.
- Auditor assignment and investigation notes.
- AI-assisted case analysis using NVIDIA Nemotron.
- Issue confirmation and flag dismissal.
- Mandatory written rationale for auditor resolutions.

### 3. Contracts Explorer
- Centralized contract listing and inspection.
- Status-based filtering:
  - Flagged
  - Amendment Resolved
  - Clean
- Contract cap utilization indicators.
- Slide-over contract evidence inspection.

### 4. Audit Flags
- Filterable exception queue.
- Severity indicators and reconciliation rule tags.
- Inline auditor assignment.
- Investigation status visibility.

### 5. Operational Analytics
- Portfolio cap exposure.
- Blocked disbursement tracking.
- Contract reconciliation matrix.
- SLA lifecycle monitoring and burndown.
- Investigation cycle time and throughput metrics.

The SLA dashboard uses `SlaBurndownPanel.jsx` to track:
- Case creation timestamps.
- Investigation start timestamps.
- Due dates.
- Investigation cycle time.
- Case throughput.

### 6. Investigation History
- Chronological audit trail.
- Deterministic rule triggers.
- Auditor assignments.
- Confirmation and dismissal decisions.
- Auditor UID attribution.

---

## Technology Stack

| Category | Technology |
|---|---|
| Frontend Framework | React 19 |
| Build Tool | Vite |
| Language | JavaScript (ES6+) |
| Styling | CSS |
| API Communication | Fetch API |
| Authentication | Bearer Token Authentication |
| Backend | FastAPI |
| Database / Persistence | Firebase Firestore |
| AI Integration | NVIDIA Nemotron |
| Deployment | Vercel |
| Backend Hosting | Google Cloud Run |

---

## Application Architecture

The frontend follows a component-based architecture with a dedicated API integration layer.

**Core application flow:**

1. The user signs in using an available auditor profile.
2. The frontend requests a signed authentication token.
3. The API client attaches the bearer token to authenticated requests.
4. The data context retrieves and manages application records.
5. The adapter transforms backend responses into frontend-compatible view models.
6. React components render the dashboard and update the interface based on application state.
7. User actions such as assignments, investigation notes, and resolutions are persisted through the backend.

The frontend supports both live API-backed operation and standalone demo operation.

---

## Getting Started

### Prerequisites

Ensure the following are installed:

- Node.js
- npm
- Git

### 1. Clone the repository

```bash
git clone <repository-url>
cd ContractTrace/frontend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

The application will be available at:

```text
http://localhost:5173
```

By default, the frontend starts in standalone demo mode when `VITE_API_BASE_URL` is not configured.

---

## Environment Configuration

Create a `.env` file inside the `frontend/` directory.

```env
VITE_API_BASE_URL=https://contracttrace-api-623186002597.africa-south1.run.app
```

The environment variable determines whether the frontend connects to the live FastAPI backend.

**Important:** Vite exposes variables prefixed with `VITE_` to client-side code. Never store private API keys, database credentials, or backend secrets in frontend environment variables.

---

## Backend Integration

ContractTrace connects to a FastAPI backend hosted on Google Cloud Run.

**Production API:**

https://contracttrace-api-623186002597.africa-south1.run.app

When `VITE_API_BASE_URL` is configured, the application switches to live mode through `src/api/dataContext.jsx`.

### Authentication

The frontend requests a signed bearer token through:

```http
POST /auth/session
```

For local development, it can fall back to:

```http
POST /auth/dev-login
```

The application supports three auditor profiles:

- `viewer`
- `reviewer`
- `admin`

### Data Retrieval

The frontend integrates with the following backend endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /contracts` | Retrieve contract records |
| `GET /contracts/{id}/evidence` | Retrieve supporting contract evidence |
| `GET /cases` | Retrieve investigation cases |
| `GET /audit` | Retrieve audit history |
| `POST /cases/{id}/resolve` | Record auditor decisions |
| `POST /cases/{id}/ai-analysis` | Request AI-assisted case analysis |

The frontend API adapter (`src/api/adapter.js`) transforms backend schemas, including integer-cent monetary values and backend enums, into frontend view models.

The application also persists case assignments, investigation notes, AI summaries, and auditor resolutions through the backend's Firestore integration.

Existing confirmed and dismissed case states are preserved across sessions without requiring reconciliation to run again on every page reload.

If the backend is unavailable, the application falls back to its bundled demo dataset and displays a retry notification.

---

## Role-Based Access Control

ContractTrace implements a role-based permission model aligned with the backend's four-eyes workflow.

| Capability | Viewer | Reviewer | Admin |
|---|:---:|:---:|:---:|
| View contracts and supporting evidence | Yes | Yes | Yes |
| View audit flags and analytics | Yes | Yes | Yes |
| View investigation history | Yes | Yes | Yes |
| Assign cases | No | Yes | No |
| Record investigation notes | No | Yes | No |
| Confirm or dismiss flags | No | Yes | No |
| Request AI case analysis | No | Yes | No |

The four-eyes principle separates amendment authority from investigation resolution:

- **Admin:** Can record contract amendments but cannot resolve audit flags through the Reviewer Workbench.
- **Reviewer:** Can investigate and resolve audit flags but cannot issue contract amendments.
- **Viewer:** Has read-only access to application information.

These permissions are enforced by the backend; frontend restrictions provide the corresponding user experience.

---

## AI-Powered Case Analysis

The Reviewer Workbench includes an AI-assisted investigation feature powered by NVIDIA Nemotron.

When a reviewer selects **Analyze with AI**, the frontend sends a request to:

```http
POST /cases/{case_id}/ai-analysis
```

The response provides:

- A neutral case summary.
- Evidence-based observations.
- Source-verification limitations.

AI analysis is advisory only. It does not automatically create, modify, confirm, or dismiss an investigation case.

All reconciliation flags are generated through deterministic financial and date-based rules. Final investigation decisions remain under human auditor control.

**Requirement:** A live backend with `NVIDIA_API_KEY` configured and an authenticated reviewer session.

---

## Project Structure

```text
frontend/
│
├── public/
│
├── src/
│   ├── api/
│   │   ├── adapter.js
│   │   ├── client.js
│   │   └── dataContext.jsx
│   │
│   ├── components/
│   │   ├── Icon.jsx
│   │   ├── SlaBurndownPanel.jsx
│   │   └── UI.jsx
│   │
│   ├── data/
│   │   └── mockData.js
│   │
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
│
├── index.html
├── package.json
├── vercel.json
└── vite.config.js
```

### Key Files

| File | Responsibility |
|---|---|
| `App.jsx` | Main dashboard, application views, workbench, and modals |
| `main.jsx` | Application entry point |
| `index.css` | Global styling |
| `api/client.js` | API requests, bearer authentication, and error handling |
| `api/adapter.js` | Backend response transformation |
| `api/dataContext.jsx` | Session management, live data synchronization, and offline fallback |
| `components/SlaBurndownPanel.jsx` | SLA lifecycle analytics |
| `components/UI.jsx` | Reusable interface components |
| `data/mockData.js` | Bundled standalone demo dataset |
| `vercel.json` | SPA fallback routing configuration |

---

## Available Scripts

Run the following commands from the `frontend/` directory.

| Command | Description |
|---|---|
| `npm install` | Install project dependencies |
| `npm run dev` | Start the local development server |
| `npm run build` | Generate the production build |
| `npm run preview` | Preview the production build locally |

Production assets are generated in:

```text
frontend/dist/
```

---

## Deployment

The frontend is deployed using **Vercel**, with the backend hosted on **Google Cloud Run**.

**Live Application:** https://contracttrace.vercel.app/

### Vercel Configuration

Configure the following project settings:

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

### Environment Variables

Add the following variable under:

**Vercel → Project Settings → Environment Variables**

```env
VITE_API_BASE_URL=https://contracttrace-api-623186002597.africa-south1.run.app
```

### Backend CORS Configuration

Ensure the backend's `CORS_ALLOW_ORIGINS` configuration includes:

```text
https://contracttrace.vercel.app
```

### Deploy

To deploy using the Vercel CLI:

```bash
npx vercel --prod
```

---

## Demo Mode

ContractTrace includes a bundled dataset containing ten sample contracts:

```text
CNT-2026-001
through
CNT-2026-010
```

The dataset is maintained in:

```text
src/data/mockData.js
```

When `VITE_API_BASE_URL` is unset, the frontend operates independently using this dataset.

The demo dataset is also exported to:

```text
backend/app/demo_dataset.json
```

using:

```bash
node scripts/export-demo-dataset.mjs
```

This allows standalone and API-backed demonstrations to evaluate identical contract records.

For example, the signed and effective amendment associated with `CNT-2026-004` resolves the relevant cap-overrun flag while preserving the original investigation case in the history.

---

## Project Purpose

ContractTrace aims to improve transparency and accountability in public contract auditing by combining deterministic financial reconciliation, structured evidence management, AI-assisted investigation, and human-reviewed decisions.

**A flag initiates an investigation. Evidence informs the decision. An auditor remains accountable for the outcome.**


