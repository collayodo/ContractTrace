// Maps backend API records onto the shapes the dashboard components already use.
//
// The backend models an evidence-first case review (contracts, amendments,
// invoices, payments, review cases, audit log). The dashboard was written
// against a richer presentation model, so this module is the single place that
// translates between them.

import { RULE_PAYMENT_MISMATCH, RULE_UNMATCHED_PAYMENT } from "../data/mockData";

// Backend exception types -> dashboard rule codes.
export const RULE_BY_EXCEPTION = {
  invoice_over_contract: "RULE_1_OVERBILL",
  payment_mismatch: RULE_PAYMENT_MISMATCH,
  unmatched_payment: RULE_UNMATCHED_PAYMENT,
};

const AUDIT_ACTION_LABELS = {
  case_opened: "Flag Raised by Rule Engine",
  case_resolved: "Auditor Determination Recorded",
  investigation_note_added: "Investigation Note Added",
  amendment_recorded: "Amendment Recorded",
  permission_denied: "Permission Denied",
};

const toUnits = (cents) => (Number(cents) || 0) / 100;
const asDate = (value) => (value ? String(value).slice(0, 10) : "");
const asText = (value) => (value === undefined || value === null ? "" : String(value));

function mapCaseStatus(reviewCase) {
  if (reviewCase.determination === "confirmed_issue") return "CONFIRMED";
  if (reviewCase.determination === "dismissed") return "DISMISSED";
  return "ACTIVE";
}

function pickRecordId(reviewCase) {
  const ids = reviewCase.source_ids || [];
  const payment = ids.find((id) => id.startsWith("PAY"));
  const invoice = ids.find((id) => id.startsWith("INV"));
  if (reviewCase.exception_type === "invoice_over_contract") {
    return invoice || payment || ids[0] || "";
  }
  return payment || invoice || ids[0] || "";
}

function deriveReviewer(reviewCase) {
  const investigation = reviewCase.investigation || [];
  if (investigation.length > 0) return investigation[investigation.length - 1].actor;
  return "System Rule Engine";
}

export function adaptCase(reviewCase) {
  const rule = RULE_BY_EXCEPTION[reviewCase.exception_type] || "RULE_1_OVERBILL";
  return {
    id: reviewCase.id,
    contract: reviewCase.contract_id,
    record: pickRecordId(reviewCase),
    rule,
    severity: reviewCase.exception_type === "invoice_over_contract" ? "HIGH" : "MEDIUM",
    created: asDate(reviewCase.created_at),
    reviewer: deriveReviewer(reviewCase),
    status: mapCaseStatus(reviewCase),
    amount: toUnits(reviewCase.observed_amount_cents),
    observed: reviewCase.observed_amount_cents ?? null,
    expected: reviewCase.expected_amount_cents ?? null,
    evidence: reviewCase.rationale,
    sourceIds: reviewCase.source_ids || [],
    investigation: reviewCase.investigation || [],
    resolutionNote: reviewCase.resolution_note || "",
    determination: reviewCase.determination || null,
  };
}

export function adaptInvoice(invoice) {
  return {
    id: invoice.id,
    contract: invoice.contract_id,
    number: invoice.invoice_number,
    date: asDate(invoice.issue_date),
    amount: toUnits(invoice.amount_cents),
    milestone: invoice.description,
    status: "Approved",
  };
}

export function adaptPayment(payment) {
  return {
    id: payment.id,
    invoice: payment.invoice_id || "",
    contract: payment.contract_id,
    reference: payment.reference,
    date: asDate(payment.payment_date),
    amount: toUnits(payment.amount_cents),
    status: payment.invoice_id ? "Completed" : "Unmatched",
  };
}

export function adaptAuditEntry(entry) {
  const details = entry.details || {};
  const isCase = entry.target_type === "case";
  const toStatus =
    details.status_after ||
    (entry.action === "case_opened" ? "ACTIVE" : entry.action === "amendment_recorded" ? "AMENDED" : "");
  return {
    id: `AUD-${String(entry.seq ?? 0).padStart(4, "0")}`,
    caseId: asText(isCase ? entry.target_id : details.contract_id || entry.target_id),
    contractId: asText(details.contract_id || entry.target_id),
    actor: entry.actor,
    auditor: entry.actor,
    action: AUDIT_ACTION_LABELS[entry.action] || entry.action,
    fromStatus: details.status_before || null,
    toStatus,
    timestamp: entry.at,
    note: asText(details.reason || details.note || ""),
  };
}

function contractNote(contractCases) {
  const openCase = contractCases.find((item) => item.status === "ACTIVE");
  if (openCase) return openCase.evidence;
  const resolved = contractCases.find((item) => item.status !== "ACTIVE");
  if (resolved) return resolved.resolutionNote || resolved.evidence;
  return "No exception raised by the deterministic reconciliation rules.";
}

// Turns the raw API payload into the arrays the dashboard renders.
export function adaptApiData({ contracts = [], amendments = [], invoices = [], payments = [], cases = [], audit = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  const authorizedById = new Map(contracts.map((item) => [item.id, item.authorized_amount_cents]));

  const signedEffectiveDelta = (contractId, onOrBefore) =>
    amendments
      .filter(
        (item) =>
          item.contract_id === contractId &&
          item.status === "signed" &&
          asDate(item.effective_date) <= onOrBefore
      )
      .reduce((sum, item) => sum + item.delta_amount_cents, 0);

  const adaptedAmendments = amendments.map((item) => {
    const signed = item.status === "signed";
    const base = authorizedById.get(item.contract_id) || 0;
    const newCapCents = base + signedEffectiveDelta(item.contract_id, asDate(item.effective_date));
    return {
      id: item.id,
      contract: item.contract_id,
      number: item.id,
      type: item.delta_amount_cents >= 0 ? "Cap Increase" : "Cap Decrease",
      description: item.title,
      rationale: item.rationale,
      newCap: toUnits(newCapCents),
      deltaAmount: toUnits(item.delta_amount_cents),
      effectiveDate: asDate(item.effective_date),
      status: signed ? "Executed" : "Pending Approval",
    };
  });

  const flags = cases.map(adaptCase);

  const adaptedContracts = contracts.map((item) => {
    const capCents = item.authorized_amount_cents + signedEffectiveDelta(item.id, today);
    const contractCases = flags.filter((flag) => flag.contract === item.id);
    const status = contractCases.some((flag) => flag.status === "ACTIVE") ? "ACTIVE" : "CLEAN";
    return {
      id: item.id,
      vendor: item.vendor,
      title: item.title,
      department: item.track,
      currency: item.currency || "USD",
      originalCap: toUnits(item.authorized_amount_cents),
      value: toUnits(capCents),
      cap: toUnits(capCents),
      startDate: asDate(item.start_date),
      endDate: asDate(item.end_date),
      start: asDate(item.start_date),
      end: asDate(item.end_date),
      status,
      flagStatusLabel: status === "ACTIVE" ? "Active Flag" : "Clean",
      notes: contractNote(contractCases),
    };
  });

  return {
    contracts: adaptedContracts,
    amendments: adaptedAmendments,
    invoices: invoices.map(adaptInvoice),
    payments: payments.map(adaptPayment),
    flags,
    auditHistory: audit.map(adaptAuditEntry),
  };
}
