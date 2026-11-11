from datetime import date, datetime, timezone
from typing import Any

from app.models import (
    Amendment,
    AmendmentStatus,
    CaseStatus,
    Contract,
    ExceptionType,
    Invoice,
    Payment,
    ReviewCase,
)
from app.store import Store


def reconcile(store: Store, as_of: date) -> dict[str, Any]:
    contracts = [Contract.model_validate(item) for item in store.list("contracts")]
    amendments = [Amendment.model_validate(item) for item in store.list("amendments")]
    invoices = [Invoice.model_validate(item) for item in store.list("invoices")]
    payments = [Payment.model_validate(item) for item in store.list("payments")]
    known_contracts = {contract.id for contract in contracts}
    known_invoices = {invoice.id: invoice for invoice in invoices}
    findings: list[ReviewCase] = []

    for contract in contracts:
        active_amendments = [
            item
            for item in amendments
            if item.contract_id == contract.id
            and item.status == AmendmentStatus.signed
            and item.effective_date <= as_of
        ]
        authorized = contract.authorized_amount_cents + sum(
            item.delta_amount_cents for item in active_amendments
        )
        contract_invoices = [item for item in invoices if item.contract_id == contract.id]
        invoiced = sum(item.amount_cents for item in contract_invoices)
        if invoiced > authorized:
            contract_amendments = [item for item in amendments if item.contract_id == contract.id]
            findings.append(
                _finding(
                    contract.id,
                    ExceptionType.invoice_over_contract,
                    [
                        contract.id,
                        *(item.id for item in contract_invoices),
                        *(item.id for item in contract_amendments),
                    ],
                    f"Recorded invoices total {invoiced} cents, above the {authorized} cents authorized "
                    f"by the contract and signed, effective amendments as of {as_of.isoformat()}. "
                    "Proposed or not-yet-effective amendments do not change the authorized amount. "
                    "This is a discrepancy for review, not a finding of wrongdoing.",
                    invoiced,
                    authorized,
                    identity_ids=[item.id for item in contract_invoices],
                )
            )

    for invoice in invoices:
        if invoice.contract_id not in known_contracts:
            continue
        related = [
            payment
            for payment in payments
            if payment.invoice_id == invoice.id and payment.contract_id == invoice.contract_id
        ]
        paid = sum(payment.amount_cents for payment in related)
        if paid != invoice.amount_cents:
            findings.append(
                _finding(
                    invoice.contract_id,
                    ExceptionType.payment_mismatch,
                    [invoice.id, *(item.id for item in related)],
                    f"Invoice {invoice.id} records {invoice.amount_cents} cents, while linked payments "
                    f"total {paid} cents as of {as_of.isoformat()}. Review payment timing, credits, and "
                    "supporting records before determining whether an issue exists.",
                    paid,
                    invoice.amount_cents,
                    identity_ids=[invoice.id],
                )
            )

    for payment in payments:
        linked_invoice = known_invoices.get(payment.invoice_id or "")
        if (
            payment.contract_id in known_contracts
            and (
                linked_invoice is None
                or linked_invoice.contract_id != payment.contract_id
            )
        ):
            findings.append(
                _finding(
                    payment.contract_id,
                    ExceptionType.unmatched_payment,
                    [payment.id, payment.invoice_id or "missing-invoice-reference"],
                    f"Payment {payment.id} for {payment.amount_cents} cents does not link to an invoice "
                    "record under the same contract. Confirm the remittance reference and source records.",
                    payment.amount_cents,
                    None,
                    identity_ids=[payment.id],
                )
            )

    for finding in findings:
        existing = store.get("cases", finding.id)
        if existing is None:
            store.put("cases", finding.id, finding.model_dump(mode="json"))
        else:
            previous = ReviewCase.model_validate(existing)
            finding.status = previous.status
            finding.determination = previous.determination
            finding.investigation = previous.investigation
            finding.resolution_note = previous.resolution_note
            finding.created_at = previous.created_at
            finding.updated_at = previous.updated_at

    return {
        "as_of": as_of.isoformat(),
        "contracts_checked": len(contracts),
        "flags": [item.model_dump(mode="json") for item in findings],
        "flag_count": len(findings),
        "note": "Flags are signals for review, not conclusions or allegations.",
    }


def _finding(
    contract_id: str,
    exception_type: ExceptionType,
    source_ids: list[str],
    rationale: str,
    observed_amount_cents: int | None,
    expected_amount_cents: int | None,
    identity_ids: list[str] | None = None,
) -> ReviewCase:
    case_id = f"{contract_id}-{exception_type.value}-{'-'.join(identity_ids or source_ids[1:])}"
    now = datetime.now(timezone.utc)
    return ReviewCase(
        id=case_id,
        contract_id=contract_id,
        exception_type=exception_type,
        source_ids=source_ids,
        rationale=rationale,
        observed_amount_cents=observed_amount_cents,
        expected_amount_cents=expected_amount_cents,
        status=CaseStatus.open,
        created_at=now,
        updated_at=now,
    )
