import os
from threading import RLock
from typing import Any, Protocol

from google.cloud import firestore


COLLECTIONS = ("contracts", "amendments", "invoices", "payments", "cases")


class Store(Protocol):
    def list(self, collection: str) -> list[dict[str, Any]]: ...
    def get(self, collection: str, document_id: str) -> dict[str, Any] | None: ...
    def put(self, collection: str, document_id: str, value: dict[str, Any]) -> None: ...
    def add(self, collection: str, value: dict[str, Any]) -> str: ...


class MemoryStore:
    def __init__(self) -> None:
        self._data: dict[str, dict[str, dict[str, Any]]] = {
            collection: {} for collection in COLLECTIONS
        }
        self._lock = RLock()

    def list(self, collection: str) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(value) for value in self._data[collection].values()]

    def get(self, collection: str, document_id: str) -> dict[str, Any] | None:
        with self._lock:
            value = self._data[collection].get(document_id)
            return dict(value) if value is not None else None

    def put(self, collection: str, document_id: str, value: dict[str, Any]) -> None:
        with self._lock:
            self._data[collection][document_id] = dict(value)

    def add(self, collection: str, value: dict[str, Any]) -> str:
        import uuid

        document_id = str(uuid.uuid4())
        self.put(collection, document_id, {**value, "id": document_id})
        return document_id


class FirestoreStore:
    def __init__(self, project: str | None = None) -> None:
        self._client = firestore.Client(project=project)

    def list(self, collection: str) -> list[dict[str, Any]]:
        return [
            {"id": snapshot.id, **snapshot.to_dict()}
            for snapshot in self._client.collection(collection).stream()
        ]

    def get(self, collection: str, document_id: str) -> dict[str, Any] | None:
        snapshot = self._client.collection(collection).document(document_id).get()
        if not snapshot.exists:
            return None
        return {"id": snapshot.id, **(snapshot.to_dict() or {})}

    def put(self, collection: str, document_id: str, value: dict[str, Any]) -> None:
        self._client.collection(collection).document(document_id).set(value)

    def add(self, collection: str, value: dict[str, Any]) -> str:
        reference = self._client.collection(collection).document()
        reference.set({**value, "id": reference.id})
        return reference.id


def create_store() -> Store:
    backend = os.getenv("STORAGE_BACKEND", "memory").lower()
    if backend == "memory":
        return MemoryStore()
    if backend == "firestore":
        return FirestoreStore(project=os.getenv("GOOGLE_CLOUD_PROJECT") or None)
    raise ValueError(f"Unsupported STORAGE_BACKEND: {backend}")
