Evidence-first React + Vite auditor dashboard for reviewing contracts, amendments, invoices, and payments (UN SDG 16.6). A reconciliation flag is a request for review; it is not an accusation or finding.

Live deployment
https://contracttrace.vercel.app/

Run locally
cd frontend
npm install
npm run dev

Opens at http://localhost:5173. Runs standalone by default using a bundled ten-contract dataset (CNT-2026-001 through CNT-2026-010). Signed amendments covering cumulative billing resolve cap-overrun flags while retaining the original case in history.

Backend connection
To connect to the FastAPI backend (Cloud Run or local), configure VITE_API_BASE_URL in frontend/.env or in Vercel Project Settings -> Environment Variables:
VITE_API_BASE_URL=https://your-backend-service-url

Once configured, the dashboard fetches live contract, amendment, invoice, payment, and reconciliation case records from the API instead of the bundled dataset.

Main views
- Overview: Portfolio KPIs, rule breakdown, decision outcomes, and priority queue
- Reviewer Workbench: Contract dossier, variance analysis, case assignment, and Confirm/Dismiss resolution with mandatory reviewer notes
- Contracts Explorer: Status filters, cap utilization bars, and slide-over contract details
- Audit Flags: Filterable exception queue with inline auditor assignment
- Operational Analytics: Cap exposure, blocked disbursements, and contract reconciliation matrix
- Investigation History: Immutable audit log of rule triggers, assignments, and determinations stamped with Auditor UID

Build
cd frontend
npm run build

Deployment
Deployed on Vercel with Root Directory set to frontend and SPA rewrites configured in frontend/vercel.json.
