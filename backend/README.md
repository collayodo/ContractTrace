# ContractTrace backend

Evidence-first FastAPI MVP for connecting fictional contracts, amendments, invoices, and payments. A reconciliation flag is a request for review; it is not an accusation or finding. Amounts are represented in integer cents.

## Run locally

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

By default, the API uses an in-memory store and seeds ten fictional contracts, their invoices and payments, and a proposed amendment for `CT-004`. A signed, effective amendment for that contract removes the invoice-over-contract flag on the next reconciliation. The original reviewer case remains in the case history.

## Firestore

Set `STORAGE_BACKEND=firestore` and `GOOGLE_CLOUD_PROJECT` (or use the standard Google Cloud project environment setting). Authenticate with Application Default Credentials. Firestore uses collections named `contracts`, `amendments`, `invoices`, `payments`, and `cases`. `SEED_DEMO_DATA=false` disables startup seeding.

## NVIDIA AI

Set `NVIDIA_API_KEY` and optionally `NVIDIA_MODEL` to enable `POST /cases/{case_id}/ai-analysis`. This calls NVIDIA's OpenAI-compatible chat-completions API to draft a neutral summary of the case evidence. The deterministic reconciliation logic, not the model, raises flags or determines resolutions. Missing credentials and provider failures are returned explicitly.

## Main endpoints

- `GET /contracts`, `GET /contracts/{id}/evidence`
- `POST /contracts/{id}/amendments`
- `POST /reconcile?as_of=YYYY-MM-DD`
- `GET /cases`, `GET /cases/{id}`
- `POST /cases/{id}/investigation`, `POST /cases/{id}/resolve`
- `POST /cases/{id}/ai-analysis`

Resolve a case with `determination=confirmed_issue` or `determination=dismissed` and a reviewer note. Resolution and investigation actions are retained on the case record. Interactive OpenAPI docs are available at `/docs`.

## Test

```bash
cd backend
pytest
```

## CI

GitHub Actions runs the backend tests and Python syntax check on pushes and pull requests that change `backend/**` or the workflow. CI uses the in-memory store and does not require Firestore credentials or an NVIDIA API key. Automatic deployment is not configured.
