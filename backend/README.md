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

The app loads `backend/.env` automatically if present. Existing process environment variables take precedence. Alternatively, Uvicorn can load a file explicitly:

```bash
uvicorn app.main:app --reload --env-file .env
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

Run `POST /reconcile` before requesting AI analysis. The analysis route accepts a case ID, or a contract ID if exactly one case exists for that contract.

## Access control

Every endpoint except `/health` needs `Authorization: Bearer <token>`. The token carries the user (`sub`) and a role (`role`), signed with `AUTH_JWT_SECRET` (at least 32 characters; in Cloud Run, inject it from Secret Manager). With no secret configured the API returns 503 rather than running open. Set `APP_ENV=production` to hide `/docs` and `/openapi.json`.

| Permission | viewer | reviewer | admin |
| --- | --- | --- | --- |
| Read contracts and cases | yes | yes | yes |
| Read the audit log | no | yes | yes |
| Run reconciliation | no | yes | yes |
| Investigate, resolve, request AI analysis | no | yes | no |
| Record amendments | no | no | yes |

Admins cannot resolve cases and reviewers cannot record amendments, because an amendment can clear a flag and one person should not be able to do both. The matrix lives in `app/auth.py` (`ROLE_PERMISSIONS`).

The actor on every case entry and audit entry comes from the token. The `actor` field in request bodies is ignored. Denied write attempts by signed in users are recorded in the audit log as `permission_denied`.

For local testing, create a token with `python scripts/issue_dev_token.py reviewer alice` (needs `AUTH_JWT_SECRET` set) and send it as the bearer token. To move to Firebase Auth or Identity Platform later, replace `verify_token` in `app/auth.py`; the roles and endpoint checks stay the same.

## Audit log

Every case opening, investigation note, resolution and amendment is appended to an `audit_log` collection. Each entry stores the hash of the previous entry and a hash of its own contents, so editing or removing an entry breaks the chain. `GET /audit` lists entries (filter with `target_id`) and `GET /audit/verify` recomputes the chain. The application only appends; deny update and delete on `audit_log` in Firestore rules and IAM, and keep the latest `head_hash` outside the database, because a hash chain cannot show that the newest entries were cut off.

## Deploy on Firebase + Cloud Run

Firebase App Hosting only runs Node.js frameworks, so the Python API runs as a container on Cloud Run and Firebase Hosting proxies the public domain to it. The repository root contains `firebase.json` and the API has a `backend/Dockerfile`. Both services must be in the same Firebase project on the Blaze plan.

1. Select the project, enable the APIs, and create the Firestore database:

   ```bash
   gcloud config set project PROJECT_ID
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com firestore.googleapis.com secretmanager.googleapis.com
   gcloud firestore databases create --location=us-central1
   ```

2. Create a runtime service account that can read and write Firestore:

   ```bash
   gcloud iam service-accounts create contracttrace-run \
     --display-name="ContractTrace Cloud Run"
   gcloud projects add-iam-policy-binding PROJECT_ID \
     --member="serviceAccount:contracttrace-run@PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/datastore.user"
   ```

3. Store secrets in Secret Manager. Generate a real JWT secret, then grant the runtime service account access:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48), end='')" | \
     gcloud secrets create AUTH_JWT_SECRET --data-file=- --replication-policy=automatic
   gcloud secrets add-iam-policy-binding AUTH_JWT_SECRET \
     --member="serviceAccount:contracttrace-run@PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

   Repeat for `NVIDIA_API_KEY` if AI analysis should be enabled.

4. Build and deploy the API. `--source` uses `backend/Dockerfile`:

   ```bash
   gcloud run deploy contracttrace-api \
     --source backend \
     --region us-central1 \
     --service-account contracttrace-run@PROJECT_ID.iam.gserviceaccount.com \
     --allow-unauthenticated \
     --min-instances 0 \
     --max-instances 4 \
     --set-env-vars APP_ENV=production,STORAGE_BACKEND=firestore,SEED_DEMO_DATA=false,GOOGLE_CLOUD_PROJECT=PROJECT_ID \
     --set-secrets AUTH_JWT_SECRET=AUTH_JWT_SECRET:latest,NVIDIA_API_KEY=NVIDIA_API_KEY:latest
   ```

   Drop the `NVIDIA_API_KEY` entry from `--set-secrets` when the secret does not exist yet. `SEED_DEMO_DATA=false` gives an empty production database; set it to `true` only for a demo.

5. Point Firebase Hosting at the service and deploy the Firestore rules:

   ```bash
   firebase login
   firebase use --add
   firebase deploy --only hosting,firestore:rules
   ```

   If Hosting has never been enabled for the project, create the default site once in the Firebase console (Build > Hosting) before deploying.

The API is then available at `https://PROJECT_ID.web.app/` and `https://PROJECT_ID.firebaseapp.com/`, for example `GET /health` and `GET /contracts`. Cloud Run must allow unauthenticated invocations because Hosting does not authenticate to it; the API still requires its bearer token on every route except `/health`, and `firestore.rules` denies all direct client access.

The Hosting rewrite passes the path through unchanged and covers the whole site, so the API owns `/`. If a static frontend is added to the same site later, host the API on its own Hosting site/target, or mount the FastAPI app under `/api` and change the rewrite source to `/api/**`. Hosting requests time out after 60 seconds; AI analysis uses a 45-second upstream timeout.

## Test

```bash
cd backend
pytest
```

## CI

GitHub Actions runs the backend tests and Python syntax check on pushes to any branch and pull requests targeting any branch when `backend/**` or the workflow changes. It does not depend on a `main` branch. CI uses the in-memory store and does not require Firestore credentials or an NVIDIA API key. Automatic deployment is not configured.
