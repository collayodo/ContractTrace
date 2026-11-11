from datetime import date
from typing import Any

from app.models import Amendment, Contract, Invoice, Payment
from app.store import Store


def demo_records() -> dict[str, list[dict[str, Any]]]:
    tracks = [
        ("AI cloud leadership", "AI Cloud"),
        ("Cybersecurity", "Secure Systems"),
        ("Cloud computing foundations", "Cloud Foundations"),
    ]
    contracts: list[Contract] = []
    amendments: list[Amendment] = []
    invoices: list[Invoice] = []
    payments: list[Payment] = []

    for number in range(1, 11):
        track, prefix = tracks[(number - 1) % len(tracks)]
        contract_id = f"CT-{number:03}"
        invoice_id = f"INV-{number:03}"
        amount = 100_000_00
        invoices.append(
            Invoice(
                id=invoice_id,
                contract_id=contract_id,
                invoice_number=f"FY25-{number:03}",
                amount_cents=amount,
                issue_date=date(2025, 2, min(number + 1, 28)),
                description=f"{track} delivery milestone",
            )
        )
        contracts.append(
            Contract(
                id=contract_id,
                title=f"{prefix} services contract {number}",
                track=track,
                vendor=f"Fictional Vendor {number:02}",
                authorized_amount_cents=amount,
                start_date=date(2025, 1, 1),
                end_date=date(2025, 12, 31),
            )
        )
        payment_amount = amount
        payment_invoice: str | None = invoice_id
        if number == 4:
            invoices[-1] = invoices[-1].model_copy(update={"amount_cents": 112_000_00})
            amendments.append(
                Amendment(
                    id="AMD-004-PROPOSED",
                    contract_id=contract_id,
                    title="Proposed additional implementation scope",
                    delta_amount_cents=15_000_00,
                    effective_date=date(2025, 1, 15),
                    status="proposed",
                    rationale="Draft change order for additional migration work.",
                )
            )
            payment_amount = 112_000_00
        elif number == 7:
            payment_amount = 90_000_00
        elif number == 10:
            payment_invoice = "INV-MISSING-010"
        payments.append(
            Payment(
                id=f"PAY-{number:03}",
                contract_id=contract_id,
                invoice_id=invoice_id if number == 10 else payment_invoice,
                amount_cents=payment_amount,
                payment_date=date(2025, 3, min(number + 1, 28)),
                reference=f"FICTIONAL-TREASURY-{number:03}",
            )
        )
        if number == 10:
            payments.append(
                Payment(
                    id="PAY-010-UNMATCHED",
                    contract_id=contract_id,
                    invoice_id="INV-MISSING-010",
                    amount_cents=500_00,
                    payment_date=date(2025, 3, 15),
                    reference="FICTIONAL-TREASURY-010-ADJUSTMENT",
                )
            )

    return {
        "contracts": [item.model_dump(mode="json") for item in contracts],
        "amendments": [item.model_dump(mode="json") for item in amendments],
        "invoices": [item.model_dump(mode="json") for item in invoices],
        "payments": [item.model_dump(mode="json") for item in payments],
    }


def seed_demo_data(store: Store) -> None:
    for collection, records in demo_records().items():
        for record in records:
            if store.get(collection, record["id"]) is None:
                store.put(collection, record["id"], record)
