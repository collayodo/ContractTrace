import os
from datetime import date
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query

from app.ai import analyze_case
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

    app = FastAPI(
        title="ContractTrace Review API",
        version="0.1.0",
        description="Evidence-first public-spending contract reconciliation and case review.",
    )
    app.state.store = repository

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/contracts")
    def list_contracts() -> list[dict[str, Any]]:
        return repository.list("contracts")

    @app.get("/contracts/{contract_id}/evidence")
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
    def create_amendment(contract_id: str, request: AmendmentCreate) -> dict[str, Any]:
        if repository.get("contracts", contract_id) is None:
            raise HTTPException(status_code=404, detail="Contract not found")
        amendment_id = repository.add(
            "amendments",
            {
                **request.model_dump(mode="json"),
                "contract_id": contract_id,
            },
        )
        saved = repository.get("amendments", amendment_id)
        if saved is None:
            raise HTTPException(status_code=500, detail="Amendment was not persisted")
        return saved

    @app.post("/reconcile")
    def run_reconciliation(as_of: date = Query(default_factory=date.today)) -> dict[str, Any]:
        return reconcile(repository, as_of)

    @app.get("/cases")
    def list_cases(status: CaseStatus | None = None) -> list[dict[str, Any]]:
        cases = repository.list("cases")
        if status is not None:
            cases = [item for item in cases if item.get("status") == status.value]
        return cases

    @app.get("/cases/{case_id}")
    def get_case(case_id: str) -> dict[str, Any]:
        case = repository.get("cases", case_id)
        if case is None:
            raise HTTPException(status_code=404, detail="Case not found")
        return case

    @app.post("/cases/{case_id}/investigation")
    def add_investigation(case_id: str, request: InvestigationRequest) -> dict[str, Any]:
        case = _get_case(repository, case_id)
        if case.status == CaseStatus.resolved:
            raise HTTPException(status_code=409, detail="Resolved cases cannot be changed")
        case.investigation.append(
            InvestigationEntry(
                actor=request.actor,
                action=request.action,
                note=request.note,
            )
        )
        case.status = CaseStatus.investigating
        case.updated_at = utc_now()
        return _save_case(repository, case)

    @app.post("/cases/{case_id}/resolve")
    def resolve_case(case_id: str, request: ResolutionRequest) -> dict[str, Any]:
        case = _get_case(repository, case_id)
        if case.status == CaseStatus.resolved:
            raise HTTPException(status_code=409, detail="Case is already resolved")
        case.determination = request.determination
        case.resolution_note = request.note
        case.status = CaseStatus.resolved
        case.updated_at = utc_now()
        case.investigation.append(
            InvestigationEntry(
                actor=request.actor,
                action=f"resolved:{request.determination.value}",
                note=request.note,
            )
        )
        return _save_case(repository, case)

    @app.post("/cases/{case_id}/ai-analysis")
    async def case_ai_analysis(case_id: str) -> dict[str, Any]:
        case = _get_case(repository, case_id)
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


def _save_case(store: Store, case: ReviewCase) -> dict[str, Any]:
    value = case.model_dump(mode="json")
    store.put("cases", case.id, value)
    return value


app = create_app()
