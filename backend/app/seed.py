import json
from pathlib import Path
from typing import Any

from app.models import Amendment, Contract, Invoice, Payment
from app.store import Store

# Exported from frontend/src/data/mockData.js by scripts/export-demo-dataset.mjs,
# so the API and the offline dashboard share one demo dataset.
DATASET_PATH = Path(__file__).resolve().parent / "demo_dataset.json"

RECORD_MODELS = {
    "contracts": Contract,
    "amendments": Amendment,
    "invoices": Invoice,
    "payments": Payment,
}


def demo_records() -> dict[str, list[dict[str, Any]]]:
    raw = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    return {
        collection: [model.model_validate(item).model_dump(mode="json") for item in raw[collection]]
        for collection, model in RECORD_MODELS.items()
    }


def seed_demo_data(store: Store) -> None:
    for collection, records in demo_records().items():
        for record in records:
            if store.get(collection, record["id"]) is None:
                store.put(collection, record["id"], record)
