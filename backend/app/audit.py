"""Tamper evident audit log.

Every entry stores the hash of the entry before it plus a hash of its own
contents, so editing, reordering or removing any entry in the middle of the
log breaks the chain and is caught by verify_chain().

The application only ever appends. Pair this with Firestore security rules
and IAM that deny update and delete on the audit_log collection, and keep a
copy of the latest head hash somewhere outside the database, because a chain
cannot prove that its newest entries were not cut off.
"""

import hashlib
import json
from threading import RLock
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models import utc_now
from app.store import Store

AUDIT_COLLECTION = "audit_log"
GENESIS_HASH = "0" * 64

# Serialises appends inside one process. Across several Cloud Run instances the
# Firestore version must claim the next sequence number in a transaction.
_append_lock = RLock()


class AuditEntry(BaseModel):
    seq: int
    at: str
    actor: str
    action: str
    target_type: str
    target_id: str
    details: dict[str, Any] = Field(default_factory=dict)
    prev_hash: str
    hash: str


def _digest(fields: dict[str, Any]) -> str:
    canonical = json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _hashed_fields(entry: dict[str, Any]) -> dict[str, Any]:
    return {key: entry.get(key) for key in (
        "seq", "at", "actor", "action", "target_type", "target_id", "details", "prev_hash"
    )}


def list_entries(store: Store) -> list[AuditEntry]:
    entries = [AuditEntry.model_validate(item) for item in store.list(AUDIT_COLLECTION)]
    return sorted(entries, key=lambda item: item.seq)


def append_audit(
    store: Store,
    *,
    actor: str,
    action: str,
    target_type: str,
    target_id: str,
    details: Optional[dict[str, Any]] = None,
) -> AuditEntry:
    with _append_lock:
        entries = list_entries(store)
        last = entries[-1] if entries else None
        fields = {
            "seq": last.seq + 1 if last else 1,
            "at": utc_now().isoformat(),
            "actor": actor,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "details": json.loads(json.dumps(details or {}, default=str)),
            "prev_hash": last.hash if last else GENESIS_HASH,
        }
        entry = AuditEntry(**fields, hash=_digest(fields))
        store.put(AUDIT_COLLECTION, f"{entry.seq:08d}", entry.model_dump(mode="json"))
        return entry


def verify_chain(store: Store) -> dict[str, Any]:
    raw = sorted(store.list(AUDIT_COLLECTION), key=lambda item: item.get("seq", 0))
    previous_hash = GENESIS_HASH
    for index, item in enumerate(raw, start=1):
        problem = None
        if item.get("seq") != index:
            problem = "sequence gap or duplicate; an entry may have been removed or inserted"
        elif item.get("prev_hash") != previous_hash:
            problem = "link to the previous entry does not match"
        elif _digest(_hashed_fields(item)) != item.get("hash"):
            problem = "entry contents do not match their recorded hash"
        if problem:
            return {
                "valid": False,
                "entries_checked": index,
                "first_invalid_seq": item.get("seq"),
                "problem": problem,
                "head_hash": previous_hash,
            }
        previous_hash = item["hash"]
    return {
        "valid": True,
        "entries_checked": len(raw),
        "first_invalid_seq": None,
        "problem": None,
        "head_hash": previous_hash,
    }
