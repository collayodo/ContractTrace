import os
from datetime import date
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.ai import analyze_case
from app.audit import append_audit, list_entries, verify_chain
from app.auth import Permission, Principal, Role, issue_token, require
from app.models import (
    Amendment,
    AmendmentCreate,
    CaseStatus,
    Determination,
    InvestigationEntry,
    InvestigationRequest,
    ResolutionRequest,
    ReviewCase,
    utc_now,
)
from app.reconciliation import reconcile
from app.seed import seed_demo_data
from app.store import MemoryStore, Store, create_store


def create_app(store: Store | None = None) -> FastAPI:
    repository = store or create_store()
    default_seed = "true" if isinstance(repository, MemoryStore) else "false"
    if os.getenv("SEED_DEMO_DATA", default_seed).lower() == "true":
        seed_demo_data(repository)

    production = os.getenv("APP_ENV", "development").lower() == "production"
    app = FastAPI(
        title="ContractTrace Review API",
        version="0.1.0",
        description="Evidence-first public-spending contract reconciliation and case review.",
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    app.state.store = repository

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    class SessionRequest(BaseModel):
        user_id: str = "aud-urvashi-01"
        role: Role = Role.reviewer

    @app.post("/auth/session")
    def create_demo_session(request: SessionRequest) -> dict[str, Any]:
        if not repository.list("contracts"):
            seed_demo_data(repository)
        if not repository.list("cases"):
            reconcile(repository, date.today())
        token = issue_token(user_id=request.user_id, role=request.role)
        return {
            "access_token": token,
            "token_type": "bearer",
            "user_id": request.user_id,
            "role": request.role.value,
        }

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/contracts", dependencies=[Depends(require(Permission.contracts_read))])
    def list_contracts() -> list[dict[str, Any]]:
        return repository.list("contracts")

    @app.get(
        "/contracts/{contract_id}/evidence",
        dependencies=[Depends(require(Permission.contracts_read))],
    )
    def contract_evidence(contract_id: str) -> dict[str, Any]:
        contract = repository.get("contracts", contract_id)
        if contract is None:
            raise HTTPException(status_code=404, detail="Contract not found")
        return {
            "contract": contract,
            "amendments": [
                item for item in repository.list("amendments") if item["contract_id"] == contract_id
            ],
            "invoices": [
                item for item in repository.list("invoices") if item["contract_id"] == contract_id
            ],
            "payments": [
                item for item in repository.list("payments") if item["contract_id"] == contract_id
            ],
        }

    @app.post("/contracts/{contract_id}/amendments", status_code=201)
    def create_amendment(
        contract_id: str,
        request: AmendmentCreate,
        principal: Principal = Depends(require(Permission.amendment_record)),
    ) -> dict[str, Any]:
        if repository.get("contracts", contract_id) is None:
            raise HTTPException(status_code=404, detail="Contract not found")
        amendment_id = repository.add(
            "amendments",
            {
                **request.model_dump(mode="json"),
                "contract_id": contract_id,
                "recorded_by": principal.user_id,
            },
        )
        saved = repository.get("amendments", amendment_id)
        if saved is None:
            raise HTTPException(status_code=500, detail="Amendment was not persisted")
        append_audit(
            repository,
            actor=principal.user_id,
            action="amendment_recorded",
            target_type="amendment",
            target_id=amendment_id,
            details={
                "role": principal.role.value,
                "contract_id": contract_id,
                "title": request.title,
                "delta_amount_cents": request.delta_amount_cents,
                "effective_date": request.effective_date.isoformat(),
                "status": request.status.value,
                "rationale": request.rationale,
            },
        )
        return saved

    @app.post("/reconcile", dependencies=[Depends(require(Permission.reconcile_run))])
    def run_reconciliation(as_of: date = Query(default_factory=date.today)) -> dict[str, Any]:
        return reconcile(repository, as_of)

    @app.get("/cases", dependencies=[Depends(require(Permission.cases_read))])
    def list_cases(status: CaseStatus | None = None) -> list[dict[str, Any]]:
        cases = repository.list("cases")
        if status is not None:
            cases = [item for item in cases if item.get("status") == status.value]
        return cases

    @app.get("/cases/{case_id}", dependencies=[Depends(require(Permission.cases_read))])
    def get_case(case_id: str) -> dict[str, Any]:
        case = repository.get("cases", case_id)
        if case is None:
            raise HTTPException(status_code=404, detail="Case not found")
        return case

    @app.post("/cases/{case_id}/investigation")
    def add_investigation(
        case_id: str,
        request: InvestigationRequest,
        principal: Principal = Depends(require(Permission.case_investigate)),
    ) -> dict[str, Any]:
        case = _get_case(repository, case_id)
        if case.status == CaseStatus.resolved:
            raise HTTPException(status_code=409, detail="Resolved cases cannot be changed")
        status_before = case.status.value
        case.investigation.append(
            InvestigationEntry(
                actor=principal.user_id,
                action=request.action,
                note=request.note,
            )
        )
        case.status = CaseStatus.investigating
        case.updated_at = utc_now()
        saved = _save_case(repository, case)
        append_audit(
            repository,
            actor=principal.user_id,
            action="investigation_note_added",
            target_type="case",
            target_id=case.id,
            details={
                "role": principal.role.value,
                "contract_id": case.contract_id,
                "investigation_action": request.action,
                "note": request.note,
                "status_before": status_before,
                "status_after": case.status.value,
            },
        )
        return saved

    @app.post("/cases/{case_id}/resolve")
    def resolve_case(
        case_id: str,
        request: ResolutionRequest,
        principal: Principal = Depends(require(Permission.case_resolve)),
    ) -> dict[str, Any]:
        case = _get_case(repository, case_id)
        if case.status == CaseStatus.resolved:
            raise HTTPException(status_code=409, detail="Case is already resolved")
        status_before = case.status.value
        case.determination = request.determination
        case.resolution_note = request.note
        case.status = CaseStatus.resolved
        case.updated_at = utc_now()
        case.investigation.append(
            InvestigationEntry(
                actor=principal.user_id,
                action=f"resolved:{request.determination.value}",
                note=request.note,
            )
        )
        saved = _save_case(repository, case)
        append_audit(
            repository,
            actor=principal.user_id,
            action="case_resolved",
            target_type="case",
            target_id=case.id,
            details={
                "role": principal.role.value,
                "contract_id": case.contract_id,
                "exception_type": case.exception_type.value,
                "determination": request.determination.value,
                "note": request.note,
                "status_before": status_before,
                "status_after": case.status.value,
                "source_ids": case.source_ids,
            },
        )
        return saved

    @app.get("/audit", dependencies=[Depends(require(Permission.audit_read))])
    def get_audit_log(target_id: str | None = None) -> list[dict[str, Any]]:
        entries = list_entries(repository)
        if target_id is not None:
            entries = [item for item in entries if item.target_id == target_id]
        return [item.model_dump(mode="json") for item in entries]

    @app.get("/audit/verify", dependencies=[Depends(require(Permission.audit_read))])
    def verify_audit_log() -> dict[str, Any]:
        return verify_chain(repository)

    @app.post(
        "/cases/{case_id}/ai-analysis",
        dependencies=[Depends(require(Permission.ai_analyze))],
        description=(
            "Analyze a case by case ID. A contract ID is also accepted when it has exactly one "
            "review case; run POST /reconcile first to create cases."
        ),
    )
    async def case_ai_analysis(case_id: str) -> dict[str, Any]:
        case = _get_analysis_case(repository, case_id)
        try:
            return (await analyze_case(case)).model_dump(mode="json")
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except (KeyError, ValueError) as error:
            raise HTTPException(status_code=502, detail="NVIDIA returned an invalid analysis response") from error
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail="NVIDIA analysis request failed") from error

    return app


def _get_case(store: Store, case_id: str) -> ReviewCase:
    value = store.get("cases", case_id)
    if value is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return ReviewCase.model_validate(value)


def _get_analysis_case(store: Store, case_or_contract_id: str) -> ReviewCase:
    value = store.get("cases", case_or_contract_id)
    if value is not None:
        return ReviewCase.model_validate(value)

    if store.get("contracts", case_or_contract_id) is None:
        raise HTTPException(
            status_code=404,
            detail="Case not found. Run POST /reconcile, then use a case ID from its flags.",
        )

    matches = [
        ReviewCase.model_validate(item)
        for item in store.list("cases")
        if item.get("contract_id") == case_or_contract_id
    ]
    if not matches:
        raise HTTPException(
            status_code=409,
            detail=f"No review case exists for contract {case_or_contract_id}. Run POST /reconcile first.",
        )
    if len(matches) > 1:
        case_ids = ", ".join(sorted(item.id for item in matches))
        raise HTTPException(
            status_code=409,
            detail=f"Multiple review cases exist for contract {case_or_contract_id}; use a case ID: {case_ids}",
        )
    return matches[0]


def _save_case(store: Store, case: ReviewCase) -> dict[str, Any]:
    value = case.model_dump(mode="json")
    store.put("cases", case.id, value)
    return value


load_dotenv(Path(__file__).resolve().parents[1] / ".env")
app = create_app()
