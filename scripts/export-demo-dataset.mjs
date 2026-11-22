// Exports the frontend demo dataset (frontend/src/data/mockData.js) into the
// backend seed file (backend/app/demo_dataset.json) so the live API and the
// offline dashboard show the same contracts, invoices, and payments.
//
// Run from the repository root:  node scripts/export-demo-dataset.mjs
//
// Translations applied here:
//   - currency units (dollars) -> integer cents, as required by app/models.py
//   - department -> track, milestone -> description, newCap -> delta_amount_cents
//   - "Executed" -> "signed", "Pending Approval" -> "proposed"
//   - blocked payments (no disbursement date) are dropped: a payment that was
//     never released is not a payment record.
import { writeFile } from "node:fs/promises";

import { amendments, contracts, invoices, payments } from "../frontend/src/data/mockData.js";

const toCents = (units) => Math.round(units * 100);

const originalCapOf = (contractId) => {
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) throw new Error(`Unknown contract in amendment: ${contractId}`);
  return contract.originalCap;
};

const dataset = {
  contracts: contracts.map((item) => ({
    id: item.id,
    title: item.title,
    track: item.department,
    vendor: item.vendor,
    authorized_amount_cents: toCents(item.originalCap),
    currency: "USD",
    start_date: item.startDate,
    end_date: item.endDate,
  })),
  amendments: amendments.map((item) => ({
    id: item.id,
    contract_id: item.contract,
    title: `${item.type} (${item.number})`,
    delta_amount_cents: toCents(item.newCap - originalCapOf(item.contract)),
    effective_date: item.effectiveDate,
    status: item.status === "Executed" ? "signed" : "proposed",
    rationale: item.description,
  })),
  invoices: invoices.map((item) => ({
    id: item.id,
    contract_id: item.contract,
    invoice_number: item.number,
    amount_cents: toCents(item.amount),
    issue_date: item.date,
    description: `${item.milestone} milestone`,
  })),
  payments: payments
    .filter((item) => item.date)
    .map((item) => ({
      id: item.id,
      contract_id: item.contract,
      invoice_id: item.invoice,
      amount_cents: toCents(item.amount),
      payment_date: item.date,
      reference: item.reference,
    })),
};

const target = new URL("../backend/app/demo_dataset.json", import.meta.url);
await writeFile(target, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

console.info(
  `Wrote ${target.pathname}: ${dataset.contracts.length} contracts, ` +
    `${dataset.amendments.length} amendments, ${dataset.invoices.length} invoices, ` +
    `${dataset.payments.length} payments.`
);
