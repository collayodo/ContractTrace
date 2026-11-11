from datetime import date, datetime, timezone
from enum import StrEnum
from typing import Optional

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AmendmentStatus(StrEnum):
    proposed = "proposed"
    signed = "signed"


class ExceptionType(StrEnum):
    invoice_over_contract = "invoice_over_contract"
    payment_mismatch = "payment_mismatch"
    unmatched_payment = "unmatched_payment"


class CaseStatus(StrEnum):
    open = "open"
    investigating = "investigating"
    resolved = "resolved"


class Determination(StrEnum):
    confirmed_issue = "confirmed_issue"
    dismissed = "dismissed"


class Contract(BaseModel):
    id: str
    title: str
    track: str
    vendor: str
    authorized_amount_cents: int = Field(ge=0)
    currency: str = "USD"
    start_date: date
    end_date: date


class Amendment(BaseModel):
    id: str
    contract_id: str
    title: str
    delta_amount_cents: int
    effective_date: date
    status: AmendmentStatus
    rationale: str


class Invoice(BaseModel):
    id: str
    contract_id: str
    invoice_number: str
    amount_cents: int = Field(ge=0)
    issue_date: date
    description: str


class Payment(BaseModel):
    id: str
    contract_id: str
    invoice_id: Optional[str] = None
    amount_cents: int = Field(ge=0)
    payment_date: date
    reference: str


class InvestigationEntry(BaseModel):
    at: datetime = Field(default_factory=utc_now)
    actor: str
    action: str
    note: str


class ReviewCase(BaseModel):
    id: str
    contract_id: str
    exception_type: ExceptionType
    source_ids: list[str]
    rationale: str
    observed_amount_cents: Optional[int] = None
    expected_amount_cents: Optional[int] = None
    status: CaseStatus = CaseStatus.open
    determination: Optional[Determination] = None
    investigation: list[InvestigationEntry] = Field(default_factory=list)
    resolution_note: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class InvestigationRequest(BaseModel):
    actor: str = Field(min_length=1, max_length=120)
    action: str = Field(min_length=1, max_length=120)
    note: str = Field(min_length=1, max_length=4000)


class ResolutionRequest(BaseModel):
    actor: str = Field(min_length=1, max_length=120)
    determination: Determination
    note: str = Field(min_length=1, max_length=4000)


class AmendmentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    delta_amount_cents: int
    effective_date: date
    status: AmendmentStatus
    rationale: str = Field(min_length=1, max_length=4000)


class AIAnalysis(BaseModel):
    case_id: str
    summary: str
    evidence_observations: list[str]
    limitation: str
    model: str
