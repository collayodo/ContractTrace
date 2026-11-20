import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.auth import ALGORITHM, ROLE_PERMISSIONS, Permission, Role, issue_token
from app.main import create_app
from app.store import MemoryStore
from auth_helpers import headers

SECRET = "test-only-secret-that-is-at-least-32-characters-long"

PROTECTED = [
    ("GET", "/contracts"),
    ("GET", "/contracts/CT-004/evidence"),
    ("POST", "/contracts/CT-004/amendments"),
    ("POST", "/reconcile"),
    ("GET", "/cases"),
    ("GET", "/cases/some-case"),
    ("POST", "/cases/some-case/investigation"),
    ("POST", "/cases/some-case/resolve"),
    ("POST", "/cases/some-case/ai-analysis"),
    ("GET", "/audit"),
    ("GET", "/audit/verify"),
]

AMENDMENT = {
    "title": "Signed scope increase",
    "delta_amount_cents": 1_500_000,
    "effective_date": "2025-01-15",
    "status": "signed",
    "rationale": "Fictional change order.",
}


def make_client() -> TestClient:
    return TestClient(create_app(MemoryStore()))


def first_case_id(client: TestClient) -> str:
    return client.post("/reconcile", params={"as_of": "2025-12-31"}, headers=headers("reviewer")).json()["flags"][0]["id"]


def raw_token(**overrides) -> str:
    claims = {"sub": "someone", "role": "reviewer", "exp": int(time.time()) + 600}
    claims.update(overrides)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, SECRET, algorithm=ALGORITHM)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_health_is_open() -> None:
    assert make_client().get("/health").status_code == 200


@pytest.mark.parametrize("method,path", PROTECTED)
def test_every_protected_endpoint_requires_a_token(method: str, path: str) -> None:
    response = make_client().request(method, path)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "token",
    [
        "not-a-token",
        jwt.encode({"sub": "x", "role": "admin", "exp": int(time.time()) + 600}, "a-different-secret-that-is-long-enough-1", algorithm=ALGORITHM),
        jwt.encode({"sub": "x", "role": "admin", "exp": int(time.time()) - 10}, SECRET, algorithm=ALGORITHM),
        jwt.encode({"sub": "x", "role": "superuser", "exp": int(time.time()) + 600}, SECRET, algorithm=ALGORITHM),
        jwt.encode({"role": "admin", "exp": int(time.time()) + 600}, SECRET, algorithm=ALGORITHM),
        jwt.encode({"sub": "x", "role": "admin"}, SECRET, algorithm=ALGORITHM),
        jwt.encode({"sub": "   ", "role": "admin", "exp": int(time.time()) + 600}, SECRET, algorithm=ALGORITHM),
    ],
    ids=["garbage", "wrong_secret", "expired", "unknown_role", "no_subject", "no_expiry", "blank_subject"],
)
def test_bad_tokens_are_rejected(token: str) -> None:
    assert make_client().get("/contracts", headers=bearer(token)).status_code == 401


def test_unsigned_alg_none_token_is_rejected() -> None:
    unsigned = jwt.encode({"sub": "x", "role": "admin", "exp": int(time.time()) + 600}, key=None, algorithm="none")
    assert make_client().get("/contracts", headers=bearer(unsigned)).status_code == 401


def test_viewer_can_read_but_not_act() -> None:
    client = make_client()
    case_id = first_case_id(client)
    viewer = headers("viewer")

    assert client.get("/contracts", headers=viewer).status_code == 200
    assert client.get("/cases", headers=viewer).status_code == 200
    assert client.get(f"/cases/{case_id}", headers=viewer).status_code == 200

    assert client.get("/audit", headers=viewer).status_code == 403
    assert client.get("/audit/verify", headers=viewer).status_code == 403
    assert client.post("/reconcile", headers=viewer).status_code == 403
    assert client.post(
        f"/cases/{case_id}/investigation", json={"action": "x", "note": "y"}, headers=viewer
    ).status_code == 403
    assert client.post(
        f"/cases/{case_id}/resolve", json={"determination": "dismissed", "note": "y"}, headers=viewer
    ).status_code == 403
    assert client.post("/contracts/CT-004/amendments", json=AMENDMENT, headers=viewer).status_code == 403


def test_reviewer_can_resolve_but_cannot_record_amendments() -> None:
    client = make_client()
    case_id = first_case_id(client)
    reviewer = headers("reviewer")

    assert client.post(
        f"/cases/{case_id}/resolve", json={"determination": "dismissed", "note": "Checked."}, headers=reviewer
    ).status_code == 200
    assert client.post("/contracts/CT-004/amendments", json=AMENDMENT, headers=reviewer).status_code == 403


def test_admin_records_amendments_but_cannot_resolve_cases() -> None:
    client = make_client()
    case_id = first_case_id(client)
    admin = headers("admin")

    assert client.post("/contracts/CT-004/amendments", json=AMENDMENT, headers=admin).status_code == 201
    assert client.post(
        f"/cases/{case_id}/resolve", json={"determination": "dismissed", "note": "Checked."}, headers=admin
    ).status_code == 403
    assert client.post(
        f"/cases/{case_id}/investigation", json={"action": "x", "note": "y"}, headers=admin
    ).status_code == 403


def test_actor_comes_from_the_token_not_the_request_body() -> None:
    client = make_client()
    case_id = first_case_id(client)
    reviewer = headers("reviewer", "real-reviewer")

    resolved = client.post(
        f"/cases/{case_id}/resolve",
        json={"actor": "someone-else", "determination": "confirmed_issue", "note": "Verified."},
        headers=reviewer,
    ).json()
    assert resolved["investigation"][-1]["actor"] == "real-reviewer"

    entry = client.get("/audit", params={"target_id": case_id}, headers=reviewer).json()[-1]
    assert entry["actor"] == "real-reviewer"
    assert entry["details"]["role"] == "reviewer"


def test_amendment_records_who_entered_it() -> None:
    client = make_client()
    saved = client.post(
        "/contracts/CT-004/amendments", json=AMENDMENT, headers=headers("admin", "admin-7")
    ).json()
    assert saved["recorded_by"] == "admin-7"


def test_denied_write_attempts_are_logged_but_denied_reads_are_not() -> None:
    client = make_client()
    reviewer = headers("reviewer", "reviewer-1")

    client.post("/contracts/CT-004/amendments", json=AMENDMENT, headers=headers("viewer", "viewer-9"))
    client.get("/audit", headers=headers("viewer", "viewer-9"))

    entries = client.get("/audit", headers=reviewer).json()
    assert [item["action"] for item in entries] == ["permission_denied"]
    assert entries[0]["actor"] == "viewer-9"
    assert entries[0]["details"]["required_permission"] == "amendment:record"
    assert client.get("/audit/verify", headers=reviewer).json()["valid"] is True


def test_unauthenticated_attempts_do_not_write_to_the_audit_log() -> None:
    client = make_client()
    client.post("/contracts/CT-004/amendments", json=AMENDMENT)
    client.post("/contracts/CT-004/amendments", headers=bearer("garbage"))
    assert client.get("/audit", headers=headers("reviewer")).json() == []


def test_fails_closed_without_a_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    client = make_client()
    token = issue_token("x", "admin")
    monkeypatch.delenv("AUTH_JWT_SECRET")
    assert client.get("/contracts", headers=bearer(token)).status_code == 503


def test_fails_closed_with_a_short_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    client = make_client()
    token = issue_token("x", "admin")
    monkeypatch.setenv("AUTH_JWT_SECRET", "too-short")
    assert client.get("/contracts", headers=bearer(token)).status_code == 503


def test_every_permission_is_granted_to_some_role() -> None:
    granted = set().union(*ROLE_PERMISSIONS.values())
    assert granted == set(Permission)


def test_separation_of_duties_in_the_matrix() -> None:
    assert Permission.case_resolve in ROLE_PERMISSIONS[Role.reviewer]
    assert Permission.amendment_record not in ROLE_PERMISSIONS[Role.reviewer]
    assert Permission.amendment_record in ROLE_PERMISSIONS[Role.admin]
    assert Permission.case_resolve not in ROLE_PERMISSIONS[Role.admin]
    assert ROLE_PERMISSIONS[Role.viewer] <= ROLE_PERMISSIONS[Role.reviewer]


def test_api_docs_are_hidden_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    client = make_client()
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
