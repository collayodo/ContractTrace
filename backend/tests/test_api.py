from datetime import date

from fastapi.testclient import TestClient

from app import main as main_module
from app.main import create_app
from app.models import AIAnalysis
from app.store import MemoryStore


def make_client() -> TestClient:
    return TestClient(create_app(MemoryStore()))


def test_seeded_data_has_ten_contracts_and_three_exception_types() -> None:
    client = make_client()
    contracts = client.get("/contracts").json()
    assert len(contracts) == 10
    assert {item["track"] for item in contracts} == {
        "AI cloud leadership",
        "Cybersecurity",
        "Cloud computing foundations",
    }

    result = client.post("/reconcile", params={"as_of": "2025-12-31"}).json()
    assert result["flag_count"] == 3
    assert {item["exception_type"] for item in result["flags"]} == {
        "invoice_over_contract",
        "payment_mismatch",
        "unmatched_payment",
    }
    assert "not conclusions" in result["note"]
    flagged_contract = next(
        item for item in result["flags"] if item["exception_type"] == "invoice_over_contract"
    )
    assert "Proposed or not-yet-effective amendments" in flagged_contract["rationale"]


def test_signed_amendment_changes_reconciliation_and_preserves_prior_case() -> None:
    client = make_client()
    before = client.post("/reconcile", params={"as_of": "2025-12-31"}).json()
    over_contract = next(
        item for item in before["flags"] if item["exception_type"] == "invoice_over_contract"
    )

    amendment = client.post(
        "/contracts/CT-004/amendments",
        json={
            "title": "Signed scope increase",
            "delta_amount_cents": 1_500_000,
            "effective_date": "2025-01-15",
            "status": "signed",
            "rationale": "Fictional signed change order for additional migration work.",
        },
    )
    assert amendment.status_code == 201

    after = client.post("/reconcile", params={"as_of": "2025-12-31"}).json()
    assert not any(item["exception_type"] == "invoice_over_contract" for item in after["flags"])
    historical_case = client.get(f"/cases/{over_contract['id']}").json()
    assert historical_case["status"] == "open"
    assert over_contract["id"] in [item["id"] for item in client.get("/cases").json()]


def test_case_investigation_and_resolution_keep_audit_record() -> None:
    client = make_client()
    cases = client.post("/reconcile", params={"as_of": date(2025, 12, 31).isoformat()}).json()["flags"]
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
    refreshed = client.post("/reconcile", params={"as_of": "2025-12-31"}).json()
    refreshed_case = next(item for item in refreshed["flags"] if item["id"] == case_id)
    assert refreshed_case["status"] == "resolved"
    assert refreshed_case["determination"] == "dismissed"
    assert client.post(
        f"/cases/{case_id}/investigation",
        json={"actor": "reviewer@example.gov", "action": "edit", "note": "Should be blocked"},
    ).status_code == 409


def test_ai_analysis_accepts_contract_id_when_it_has_one_case(monkeypatch) -> None:
    client = make_client()
    before_reconciliation = client.post("/cases/CT-004/ai-analysis")
    assert before_reconciliation.status_code == 409
    assert "Run POST /reconcile first" in before_reconciliation.json()["detail"]

    client.post("/reconcile", params={"as_of": "2025-12-31"})
    analyzed_case_ids: list[str] = []

    async def fake_analyze_case(case):
        analyzed_case_ids.append(case.id)
        return AIAnalysis(
            case_id=case.id,
            summary="The invoice total exceeds the current authorized amount.",
            evidence_observations=["Invoice INV-004 is above the base contract amount."],
            limitation="Verify the signed amendment and supporting invoice.",
            model="test-model",
        )

    monkeypatch.setattr(main_module, "analyze_case", fake_analyze_case)
    response = client.post("/cases/CT-004/ai-analysis")

    assert response.status_code == 200
    assert response.json()["case_id"] == "CT-004-invoice_over_contract-INV-004"
    assert analyzed_case_ids == [response.json()["case_id"]]
