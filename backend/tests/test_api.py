from datetime import date, datetime

from fastapi.testclient import TestClient

from app import main as main_module
from app.main import create_app
from app.models import AIAnalysis
from app.reconciliation import reconcile
from app.store import MemoryStore
from auth_helpers import headers


def make_client() -> TestClient:
    return TestClient(create_app(MemoryStore()), headers=headers("reviewer"))


def test_seeded_contracts_come_from_the_frontend_dataset() -> None:
    client = make_client()
    contracts = client.get("/contracts").json()
    assert len(contracts) == 10
    assert {item["id"] for item in contracts} == {f"CNT-2026-{number:03}" for number in range(1, 11)}
    medical = next(item for item in contracts if item["id"] == "CNT-2026-004")
    assert medical["vendor"] == "Highland Logistics Ltd"
    assert medical["track"] == "Public Health Supply"
    # The authorized amount is the original cap; executed amendments add the delta.
    assert medical["authorized_amount_cents"] == 20_000_000


def test_demo_dataset_reconciles_to_expected_open_cases() -> None:
    client = make_client()
    result = client.post("/reconcile", params={"as_of": "2026-12-31"}).json()

    # Two contracts bill above their authorized cap. Each also has an invoice whose
    # disbursement was blocked, so it never links a payment and the mismatch rule fires too.
    assert result["flag_count"] == 4
    assert {item["contract_id"] for item in result["flags"]} == {"CNT-2026-002", "CNT-2026-008"}
    assert {item["exception_type"] for item in result["flags"]} == {
        "invoice_over_contract",
        "payment_mismatch",
    }
    assert all(item["status"] == "open" for item in result["flags"])
    assert "not conclusions" in result["note"]


def test_reconciliation_reports_all_three_exception_types() -> None:
    store = MemoryStore()
    store.put(
        "contracts",
        "D-1",
        {
            "id": "D-1",
            "title": "Fixture contract",
            "track": "Fixture",
            "vendor": "Fixture Vendor",
            "authorized_amount_cents": 10_000,
            "currency": "USD",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
        },
    )
    store.put(
        "invoices",
        "D-INV-1",
        {
            "id": "D-INV-1",
            "contract_id": "D-1",
            "invoice_number": "F-1",
            "amount_cents": 20_000,
            "issue_date": "2026-02-01",
            "description": "Fixture invoice",
        },
    )
    store.put(
        "payments",
        "D-PAY-1",
        {
            "id": "D-PAY-1",
            "contract_id": "D-1",
            "invoice_id": "D-INV-1",
            "amount_cents": 15_000,
            "payment_date": "2026-02-10",
            "reference": "FIXTURE-1",
        },
    )
    store.put(
        "payments",
        "D-PAY-2",
        {
            "id": "D-PAY-2",
            "contract_id": "D-1",
            "invoice_id": "F-MISSING",
            "amount_cents": 1_000,
            "payment_date": "2026-02-11",
            "reference": "FIXTURE-2",
        },
    )

    result = reconcile(store, date(2026, 6, 30))
    assert {item["exception_type"] for item in result["flags"]} == {
        "invoice_over_contract",
        "payment_mismatch",
        "unmatched_payment",
    }


def test_signed_amendment_changes_reconciliation_and_preserves_prior_case() -> None:
    client = make_client()
    before = client.post("/reconcile", params={"as_of": "2026-12-31"}).json()
    over_contract = next(
        item
        for item in before["flags"]
        if item["contract_id"] == "CNT-2026-002" and item["exception_type"] == "invoice_over_contract"
    )

    amendment = client.post(
        "/contracts/CNT-2026-002/amendments",
        json={
            "title": "Signed scope increase",
            "delta_amount_cents": 3_500_000,
            "effective_date": "2026-03-01",
            "status": "signed",
            "rationale": "Fictional signed change order covering the billed overage.",
        },
        headers=headers("admin"),
    )
    assert amendment.status_code == 201

    after = client.post("/reconcile", params={"as_of": "2026-12-31"}).json()
    assert not any(
        item["contract_id"] == "CNT-2026-002" and item["exception_type"] == "invoice_over_contract"
        for item in after["flags"]
    )
    historical_case = client.get(f"/cases/{over_contract['id']}").json()
    assert historical_case["status"] == "open"
    assert over_contract["id"] in [item["id"] for item in client.get("/cases").json()]


def test_case_investigation_and_resolution_keep_audit_record() -> None:
    client = make_client()
    cases = client.post("/reconcile", params={"as_of": date(2026, 12, 31).isoformat()}).json()["flags"]
    case_id = cases[0]["id"]

    investigation = client.post(
        f"/cases/{case_id}/investigation",
        json={"actor": "reviewer@example.gov", "action": "payment_cross-check", "note": "Checked remittance advice."},
    ).json()
    assert investigation["status"] == "investigating"

    resolved = client.post(
        f"/cases/{case_id}/resolve",
        json={
            "actor": "reviewer@example.gov",
            "determination": "dismissed",
            "note": "A timing difference was confirmed against treasury records.",
        },
    ).json()
    assert resolved["status"] == "resolved"
    assert resolved["determination"] == "dismissed"
    assert len(resolved["investigation"]) == 2
    refreshed = client.post("/reconcile", params={"as_of": "2026-12-31"}).json()
    refreshed_case = next(item for item in refreshed["flags"] if item["id"] == case_id)
    assert refreshed_case["status"] == "resolved"
    assert refreshed_case["determination"] == "dismissed"
    assert client.post(
        f"/cases/{case_id}/investigation",
        json={"actor": "reviewer@example.gov", "action": "edit", "note": "Should be blocked"},
    ).status_code == 409


def test_reconciliation_stamps_configurable_sla_due_dates(monkeypatch) -> None:
    monkeypatch.setenv("SLA_WINDOW_DAYS_MEDIUM", "21")
    client = make_client()
    result = client.post("/reconcile", params={"as_of": "2026-12-31"}).json()
    high = next(item for item in result["flags"] if item["exception_type"] == "invoice_over_contract")
    medium = next(item for item in result["flags"] if item["exception_type"] == "payment_mismatch")

    # HIGH (cap overrun) keeps the 7-day default; MEDIUM picks up the override.
    assert (datetime.fromisoformat(high["due_at"]) - datetime.fromisoformat(high["created_at"])).days == 7
    assert (datetime.fromisoformat(medium["due_at"]) - datetime.fromisoformat(medium["created_at"])).days == 21

    # The due date is a stable commitment: re-running reconciliation must not move it.
    rerun = client.post("/reconcile", params={"as_of": "2026-12-31"}).json()
    rerun_high = next(item for item in rerun["flags"] if item["id"] == high["id"])
    assert rerun_high["due_at"] == high["due_at"]


def test_investigation_stamps_started_at_only_once() -> None:
    client = make_client()
    case_id = client.post("/reconcile", params={"as_of": "2026-12-31"}).json()["flags"][0]["id"]

    assert client.get(f"/cases/{case_id}").json()["started_at"] is None
    first = client.post(
        f"/cases/{case_id}/investigation",
        json={"action": "open_review", "note": "Begin the review."},
    ).json()
    assert first["started_at"] is not None
    second = client.post(
        f"/cases/{case_id}/investigation",
        json={"action": "follow_up", "note": "Second note."},
    ).json()
    assert second["started_at"] == first["started_at"]


def test_ai_analysis_accepts_contract_id_when_it_has_one_case(monkeypatch) -> None:
    # The demo dataset puts two cases on every flagged contract, so use a fixture store
    # where a contract raises exactly one case.
    store = MemoryStore()
    store.put(
        "contracts",
        "SOLO-1",
        {
            "id": "SOLO-1",
            "title": "Single-case fixture contract",
            "track": "Fixture",
            "vendor": "Fixture Vendor",
            "authorized_amount_cents": 10_000,
            "currency": "USD",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
        },
    )
    store.put(
        "invoices",
        "SOLO-INV-1",
        {
            "id": "SOLO-INV-1",
            "contract_id": "SOLO-1",
            "invoice_number": "S-1",
            "amount_cents": 20_000,
            "issue_date": "2026-02-01",
            "description": "Fixture invoice",
        },
    )
    store.put(
        "payments",
        "SOLO-PAY-1",
        {
            "id": "SOLO-PAY-1",
            "contract_id": "SOLO-1",
            "invoice_id": "SOLO-INV-1",
            "amount_cents": 20_000,
            "payment_date": "2026-02-10",
            "reference": "SOLO-FIXTURE-1",
        },
    )
    client = TestClient(create_app(store), headers=headers("reviewer"))

    before_reconciliation = client.post("/cases/SOLO-1/ai-analysis")
    assert before_reconciliation.status_code == 409
    assert "Run POST /reconcile first" in before_reconciliation.json()["detail"]

    client.post("/reconcile", params={"as_of": "2026-12-31"})
    analyzed_case_ids: list[str] = []

    async def fake_analyze_case(case):
        analyzed_case_ids.append(case.id)
        return AIAnalysis(
            case_id=case.id,
            summary="The invoice total exceeds the current authorized amount.",
            evidence_observations=["Invoice SOLO-INV-1 is above the base contract amount."],
            limitation="Verify the signed amendment and supporting invoice.",
            model="test-model",
        )

    monkeypatch.setattr(main_module, "analyze_case", fake_analyze_case)
    response = client.post("/cases/SOLO-1/ai-analysis")

    assert response.status_code == 200
    assert response.json()["case_id"] == "SOLO-1-invoice_over_contract-SOLO-INV-1"
    assert analyzed_case_ids == [response.json()["case_id"]]
