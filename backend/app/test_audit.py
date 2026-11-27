from fastapi.testclient import TestClient

from app.audit import AUDIT_COLLECTION, GENESIS_HASH, append_audit, verify_chain
from app.main import create_app
from app.store import MemoryStore
from auth_helpers import headers


def make_client() -> tuple[TestClient, MemoryStore]:
    store = MemoryStore()
    return TestClient(create_app(store), headers=headers("reviewer", "reviewer-1")), store


def open_case(client: TestClient) -> dict:
    flags = client.post("/reconcile", params={"as_of": "2026-12-31"}).json()["flags"]
    return flags[0]


def test_empty_log_is_valid() -> None:
    result = verify_chain(MemoryStore())
    assert result["valid"] is True
    assert result["entries_checked"] == 0
    assert result["head_hash"] == GENESIS_HASH


def test_reconcile_logs_why_each_flag_appeared() -> None:
    client, _ = make_client()
    result = client.post("/reconcile", params={"as_of": "2026-12-31"}).json()
    entries = client.get("/audit").json()

    assert len(entries) == result["flag_count"]
    for entry in entries:
        assert entry["action"] == "case_opened"
        assert entry["actor"] == "system:reconciliation"
        assert entry["details"]["reason"]
        assert entry["details"]["source_ids"]
    assert client.get("/audit/verify").json()["valid"] is True


def test_rerunning_reconcile_does_not_duplicate_case_opened_entries() -> None:
    client, _ = make_client()
    client.post("/reconcile", params={"as_of": "2026-12-31"})
    first = len(client.get("/audit").json())
    client.post("/reconcile", params={"as_of": "2026-12-31"})
    assert len(client.get("/audit").json()) == first


def test_investigation_and_resolution_are_logged() -> None:
    client, _ = make_client()
    case = open_case(client)

    client.post(
        f"/cases/{case['id']}/investigation",
        json={"actor": "reviewer-1", "action": "requested_documents", "note": "Asked for the invoice PDF."},
    )
    client.post(
        f"/cases/{case['id']}/resolve",
        json={"actor": "reviewer-1", "determination": "dismissed", "note": "Credit note found."},
    )

    entries = client.get("/audit", params={"target_id": case["id"]}).json()
    assert [item["action"] for item in entries] == [
        "case_opened",
        "investigation_note_added",
        "case_resolved",
    ]
    resolved = entries[-1]
    assert resolved["actor"] == "reviewer-1"
    assert resolved["details"]["determination"] == "dismissed"
    assert resolved["details"]["status_before"] == "investigating"
    assert resolved["details"]["status_after"] == "resolved"
    assert client.get("/audit/verify").json()["valid"] is True


def test_rejected_changes_to_resolved_case_are_not_logged() -> None:
    client, _ = make_client()
    case = open_case(client)
    client.post(
        f"/cases/{case['id']}/resolve",
        json={"actor": "reviewer-1", "determination": "confirmed_issue", "note": "Verified."},
    )
    count = len(client.get("/audit").json())

    blocked = client.post(
        f"/cases/{case['id']}/resolve",
        json={"actor": "reviewer-2", "determination": "dismissed", "note": "Changing my mind."},
    )
    assert blocked.status_code == 409
    assert len(client.get("/audit").json()) == count


def test_amendment_recording_is_logged() -> None:
    client, _ = make_client()
    client.post(
        "/contracts/CNT-2026-004/amendments",
        json={
            "title": "Signed scope increase",
            "delta_amount_cents": 1_500_000,
            "effective_date": "2025-01-15",
            "status": "signed",
            "rationale": "Fictional change order.",
        },
        headers=headers("admin", "admin-1"),
    )
    entry = client.get("/audit").json()[-1]
    assert entry["action"] == "amendment_recorded"
    assert entry["details"]["contract_id"] == "CNT-2026-004"
    assert entry["details"]["delta_amount_cents"] == 1_500_000
    assert entry["actor"] == "admin-1"


def test_editing_an_entry_breaks_the_chain() -> None:
    client, store = make_client()
    case = open_case(client)
    client.post(
        f"/cases/{case['id']}/resolve",
        json={"actor": "reviewer-1", "determination": "confirmed_issue", "note": "Verified."},
    )
    assert client.get("/audit/verify").json()["valid"] is True

    tampered = store.get(AUDIT_COLLECTION, "00000002")
    assert tampered is not None
    tampered["details"] = {**tampered["details"], "determination": "dismissed"}
    store.put(AUDIT_COLLECTION, "00000002", tampered)

    result = client.get("/audit/verify").json()
    assert result["valid"] is False
    assert result["first_invalid_seq"] == 2


def test_removing_a_middle_entry_is_detected() -> None:
    store = MemoryStore()
    for index in range(4):
        append_audit(store, actor="a", action="x", target_type="case", target_id=str(index))
    del store._data[AUDIT_COLLECTION]["00000002"]

    result = verify_chain(store)
    assert result["valid"] is False
    assert result["first_invalid_seq"] == 3


def test_rewriting_an_actor_is_detected() -> None:
    store = MemoryStore()
    append_audit(store, actor="reviewer-1", action="case_resolved", target_type="case", target_id="c1")
    entry = store.get(AUDIT_COLLECTION, "00000001")
    assert entry is not None
    entry["actor"] = "reviewer-2"
    store.put(AUDIT_COLLECTION, "00000001", entry)

    assert verify_chain(store)["valid"] is False


def test_concurrent_appends_keep_one_unbroken_chain() -> None:
    from concurrent.futures import ThreadPoolExecutor

    store = MemoryStore()

    def write(index: int) -> None:
        append_audit(store, actor="a", action="x", target_type="case", target_id=str(index))

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(write, range(60)))

    result = verify_chain(store)
    assert result["valid"] is True
    assert result["entries_checked"] == 60
    assert sorted(item["seq"] for item in store.list(AUDIT_COLLECTION)) == list(range(1, 61))


def test_append_chained_refuses_an_existing_document_id() -> None:
    import pytest

    store = MemoryStore()
    store.append_chained("audit_log", lambda last: ("00000001", {"seq": 1, "hash": "h"}))
    with pytest.raises(ValueError):
        store.append_chained("audit_log", lambda last: ("00000001", {"seq": 1, "hash": "h"}))
