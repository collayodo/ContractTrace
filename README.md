# ContractTrace

Evidence-first public-spending oversight and audit platform (UN SDG target 16.6). ContractTrace connects contracts, amendments, invoices, and treasury payments, then surfaces reconciliation exceptions so an accredited auditor can review each one.

> A flag is a signal to investigate, never a final finding of wrongdoing.

The system is deliberately split: deterministic rules raise flags, an auditor records the determination, and every action is appended to a tamper-evident audit log. The optional AI analysis only drafts a neutral summary of the evidence — it never raises or resolves a flag.

## Repository layout

```
ContractTrace/
├── backend/                 FastAPI review API (Python 3.12)
│   ├── app/
│   │   ├── main.py          App factory, routes, CORS, dev-login
│   │   ├── models.py        Pydantic models (amounts are integer cents)
│   │   ├── reconciliation.py Deterministic exception rules
│   │   ├── audit.py         Hash-chained audit log
│   │   ├── auth.py          JWT verification and role/permission matrix
│   │   ├── store.py         Memory / Firestore store abstraction
│   │   ├── ai.py            Optional NVIDIA analysis
│   │   ├── seed.py          Loads the demo dataset on startup
│   │   └── demo_dataset.json  Seeded records, generated from the frontend
│   ├── tests/               pytest suite
│   ├── scripts/             issue_dev_token.py
│   ├── Dockerfile           Cloud Run image
│   └── requirements.txt
├── frontend/                React 19 + Vite auditor dashboard
│   ├── src/
│   │   ├── App.jsx          Views: overview, workbench, contracts, flags, analytics, history
│   │   ├── api/client.js    REST client (bearer token, VITE_API_BASE_URL)
│   │   ├── api/adapter.js   Backend records -> dashboard shapes
│   │   ├── api/dataContext.jsx  Live-vs-mock data provider
│   │   ├── components/      Icon and UI primitives
│   │   ├── data/mockData.js Bundled offline dataset and rule catalog (source of truth)
│   │   └── main.jsx
│   ├── vercel.json          SPA rewrites (frontend deploys to Vercel)
│   └── package.json
├── scripts/
│   └── export-demo-dataset.mjs  Frontend mock data -> backend seed JSON
├── .github/workflows/backend-ci.yml   Backend tests + syntax check
├── firebase.json            Firebase Hosting -> Cloud Run rewrite, Firestore rules
└── firestore.rules          Denies all direct client access
```

## Architecture

- **Frontend** — a React 19 dashboard built with Vite and Tailwind. It renders six views (Overview, Reviewer Workbench, Contracts Explorer, Audit Flags, Operational Analytics, Investigation History). A single data provider ([dataContext.jsx](frontend/src/api/dataContext.jsx)) either loads live records from the API or falls back to a bundled dataset, and [adapter.js](frontend/src/api/adapter.js) translates backend records into the shapes the views expect.
- **Backend** — a FastAPI service. `POST /reconcile` runs deterministic rules over the stored records and opens review cases; auditors investigate and resolve those cases. Data lives in Firestore in production and in memory for local dev and tests.
- **Audit log** — append-only. Each entry stores the hash of the previous entry plus a hash of its own contents, so any edit or deletion breaks the chain (`GET /audit/verify`).
- **AI (optional)** — `POST /cases/{id}/ai-analysis` calls NVIDIA's OpenAI-compatible API to draft a neutral case summary. The Reviewer Workbench exposes it as an **Analyze with AI** action on the selected case (live mode only, reviewer role). Missing credentials or provider failures are returned explicitly.
- **Deployment** — the API runs as a container on Cloud Run, exposed through Firebase Hosting (`firebase.json` rewrites `**` to the `contracttrace-api` service); Firestore rules deny all direct client access. The dashboard deploys separately to Vercel.

## Deterministic rules

Reconciliation is arithmetic, not judgement. The backend raises three exception types, and the dashboard maps them onto its rule catalog:

| Exception type | Dashboard rule | Condition |
| --- | --- | --- |
| `invoice_over_contract` | Rule 1 · Cap Overrun | Cumulative invoices exceed the authorized cap + signed, effective amendments |
| `payment_mismatch` | Rule 4 · Payment Mismatch | Linked payments for an invoice do not total the invoice amount |
| `unmatched_payment` | Rule 5 · Unmatched Payment | A payment has no invoice under the same contract |

The bundled frontend dataset additionally demonstrates **Rule 2** (payment executed before the contract start date) and **Rule 3** (an executed amendment raises the cap and clears an overrun flag while the original case stays in history). Those two are presentation-only: they have no backend counterpart.

Both sides now share one dataset. The API seeds from [demo_dataset.json](backend/app/demo_dataset.json), which `node scripts/export-demo-dataset.mjs` generates from [mockData.js](frontend/src/data/mockData.js), so the live API and the offline dashboard show the same contracts. Seeding writes only the raw contracts, amendments, invoices, and payments — every case is still re-derived by `POST /reconcile`. Blocked disbursements are not exported (a payment that was never released is not a payment record), so their invoices appear as `payment_mismatch` cases live. Proposed or not-yet-effective amendments never change the authorized amount.

Amounts are stored and computed in **integer cents** in the backend and converted to currency units for display.

## Quick start

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export AUTH_JWT_SECRET="dev-secret-that-is-at-least-32-characters-long"
uvicorn app.main:app --reload
```

Runs at `http://127.0.0.1:8000` with an in-memory store seeded with the shared demo dataset (`CNT-2026-001`…`CNT-2026-010`, the same contracts the dashboard shows offline). Interactive docs are at `/docs`. The app loads `backend/.env` automatically if present.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`. With no API configured it uses the bundled dataset (`CNT-2026-001`…`CNT-2026-010`) and needs no sign-in.

### 3. Connect the two

```bash
cd frontend
cp .env.example .env          # sets VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

With `VITE_API_BASE_URL` set, the dashboard shows the auditor sign-in screen, obtains a bearer token from `POST /auth/dev-login`, and loads live data. If the API is unreachable it falls back to the bundled dataset and shows a banner with a retry action.

## Configuration

### Backend (`backend/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_JWT_SECRET` | – | JWT signing secret, at least 32 characters. Without it the API returns 503 instead of running open. |
| `APP_ENV` | `development` | `production` hides `/docs` and `/openapi.json` and disables `POST /auth/dev-login`. |
| `STORAGE_BACKEND` | `memory` | `memory` or `firestore`. |
| `GOOGLE_CLOUD_PROJECT` | – | Required when using Firestore. |
| `SEED_DEMO_DATA` | `true` for memory | Seeds the shared demo dataset from `backend/app/demo_dataset.json` on startup. |
| `CORS_ALLOW_ORIGINS` | local Vite dev server | Comma-separated browser origins allowed to call the API. |
| `NVIDIA_API_KEY` / `NVIDIA_MODEL` | – | Enable AI case analysis. |

### Frontend (`frontend/.env`)

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Base URL of the FastAPI backend. Unset = bundled demo dataset only. |

## API endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Unauthenticated. |
| `POST` | `/auth/dev-login` | Development only; disabled when `APP_ENV=production`. |
| `GET` | `/contracts`, `/contracts/{id}/evidence` | Contract list and linked amendments, invoices, payments. |
| `POST` | `/contracts/{id}/amendments` | Record an amendment (admin only). |
| `POST` | `/reconcile?as_of=YYYY-MM-DD` | Run deterministic rules and open cases. |
| `GET` | `/cases`, `/cases/{id}` | Review cases. |
| `POST` | `/cases/{id}/investigation` | Add an investigation note. |
| `POST` | `/cases/{id}/resolve` | Record `confirmed_issue` or `dismissed` with a note. |
| `POST` | `/cases/{id}/ai-analysis` | Optional NVIDIA case summary. |
| `GET` | `/audit`, `/audit/verify` | List the audit chain and verify its integrity. |

## Access control

Every endpoint except `/health` requires `Authorization: Bearer <token>`. The actor on every case and audit entry comes from the token; the `actor` field in request bodies is ignored.

| Permission | viewer | reviewer | admin |
| --- | --- | --- | --- |
| Read contracts and cases | yes | yes | yes |
| Read the audit log | no | yes | yes |
| Run reconciliation | no | yes | yes |
| Investigate, resolve, request AI analysis | no | yes | no |
| Record amendments | no | no | yes |

Admins cannot resolve cases and reviewers cannot record amendments, because an amendment can clear a flag and one person should not be able to do both. Denied write attempts by signed-in users are recorded as `permission_denied`. For local testing see `backend/scripts/issue_dev_token.py`.

## Testing and CI

```bash
cd backend && pytest          # 58 tests, in-memory store, no cloud credentials
cd frontend && npm run build  # production build
```

GitHub Actions ([backend-ci.yml](.github/workflows/backend-ci.yml)) installs `backend/requirements.txt`, runs the tests, and compiles the sources whenever `backend/**` changes. Continuous deployment is not configured.

## Deployment

- **Backend** — build the `backend/Dockerfile` to Cloud Run and inject `AUTH_JWT_SECRET` (and `NVIDIA_API_KEY` if used) from Secret Manager. Use `STORAGE_BACKEND=firestore`, `SEED_DEMO_DATA=false`, and `APP_ENV=production`. Firebase Hosting proxies the public domain to the service.
- **Frontend** — build with Vite and deploy to Vercel (`frontend/vercel.json` handles SPA rewrites). Set `VITE_API_BASE_URL` to the deployed API and add the frontend origin to `CORS_ALLOW_ORIGINS` on the backend.
