import os
from threading import RLock
from typing import Any, Callable, Protocol

from google.cloud import firestore


COLLECTIONS = ("contracts", "amendments", "invoices", "payments", "cases", "audit_log")


class Store(Protocol):
    def list(self, collection: str) -> list[dict[str, Any]]: ...
    def get(self, collection: str, document_id: str) -> dict[str, Any] | None: ...
    def put(self, collection: str, document_id: str, value: dict[str, Any]) -> None: ...
    def add(self, collection: str, value: dict[str, Any]) -> str: ...
    def append_chained(
        self,
        collection: str,
        build: Callable[[dict[str, Any] | None], tuple[str, dict[str, Any]]],
    ) -> dict[str, Any]: ...


# Holds a copy of the newest entry of each chained collection, so the next
# sequence number can be claimed inside one Firestore transaction.
HEAD_COLLECTION = "audit_head"
HEAD_DOCUMENT = "head"


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

    def append_chained(
        self,
        collection: str,
        build: Callable[[dict[str, Any] | None], tuple[str, dict[str, Any]]],
    ) -> dict[str, Any]:
        """Add the next entry of a chain. build gets the newest entry (or None) and
        returns the new document id and value. Runs under one lock."""
        with self._lock:
            existing = self._data[collection].values()
            last = max(existing, key=lambda item: item.get("seq", 0)) if existing else None
            document_id, value = build(dict(last) if last is not None else None)
            if document_id in self._data[collection]:
                raise ValueError(f"Document {document_id} already exists in {collection}")
            self._data[collection][document_id] = dict(value)
            return dict(value)


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

    def append_chained(
        self,
        collection: str,
        build: Callable[[dict[str, Any] | None], tuple[str, dict[str, Any]]],
    ) -> dict[str, Any]:
        """Claim the next entry of a chain in a Firestore transaction.

        The newest entry is read from a head document and the new entry plus the
        updated head are written together. If two instances race, Firestore retries
        one of them, so sequence numbers are never duplicated. build may run more
        than once, so it must not have side effects.
        """
        client = self._client
        head_ref = client.collection(HEAD_COLLECTION).document(HEAD_DOCUMENT)

        @firestore.transactional
        def run(transaction: Any) -> dict[str, Any]:
            snapshot = head_ref.get(transaction=transaction)
            last = snapshot.to_dict() if snapshot.exists else None
            document_id, value = build(last)
            transaction.create(client.collection(collection).document(document_id), value)
            transaction.set(head_ref, value)
            return value

        return run(client.transaction())


def create_store() -> Store:
    backend = os.getenv("STORAGE_BACKEND", "memory").lower()
    if backend == "memory":
        return MemoryStore()
    if backend == "firestore":
        return FirestoreStore(project=os.getenv("GOOGLE_CLOUD_PROJECT") or None)
    raise ValueError(f"Unsupported STORAGE_BACKEND: {backend}")
