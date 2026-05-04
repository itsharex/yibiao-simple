from __future__ import annotations

import os
from dataclasses import dataclass


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return int(raw)


@dataclass(frozen=True)
class Settings:
    max_upload_mb: int = _get_int("DOC2MD_MAX_UPLOAD_MB", 100)
    max_response_mb: int = _get_int("DOC2MD_MAX_RESPONSE_MB", 30)
    request_timeout_seconds: int = _get_int("DOC2MD_REQUEST_TIMEOUT_SECONDS", 300)
    office_timeout_seconds: int = _get_int("DOC2MD_OFFICE_TIMEOUT_SECONDS", 180)
    max_workers: int = _get_int("DOC2MD_MAX_WORKERS", 4)
    max_queue_size: int = _get_int("DOC2MD_MAX_QUEUE_SIZE", 8)
    chunk_size_bytes: int = _get_int("DOC2MD_CHUNK_SIZE_BYTES", 1048576)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def max_response_bytes(self) -> int:
        return self.max_response_mb * 1024 * 1024

    @property
    def max_pending_tasks(self) -> int:
        return self.max_workers + self.max_queue_size


settings = Settings()
