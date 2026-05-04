from __future__ import annotations

import asyncio
import atexit
from concurrent.futures import ProcessPoolExecutor
from threading import BoundedSemaphore, Lock
from pathlib import Path

from .config import settings
from .conversion import convert_path_to_markdown
from .errors import ConversionError

_executor: ProcessPoolExecutor | None = None
_submission_limiter: BoundedSemaphore | None = None
_executor_lock = Lock()
_limiter_lock = Lock()


def get_executor() -> ProcessPoolExecutor:
    global _executor
    if _executor is None:
        with _executor_lock:
            if _executor is None:
                _executor = ProcessPoolExecutor(max_workers=settings.max_workers)
    return _executor


def get_submission_limiter() -> BoundedSemaphore:
    global _submission_limiter
    if _submission_limiter is None:
        with _limiter_lock:
            if _submission_limiter is None:
                _submission_limiter = BoundedSemaphore(
                    value=max(1, settings.max_pending_tasks)
                )
    return _submission_limiter


def release_submission_slot() -> None:
    limiter = get_submission_limiter()
    limiter.release()


def shutdown_executor() -> None:
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=False, cancel_futures=True)
        _executor = None


atexit.register(shutdown_executor)


async def run_conversion(
    input_path: Path, include_images: bool, original_name: str
) -> str:
    limiter = get_submission_limiter()
    if not limiter.acquire(blocking=False):
        raise ConversionError(
            code="queue_full",
            message="Too many conversion requests are in progress, please retry later",
            status_code=429,
            details={
                "filename": original_name,
                "max_workers": settings.max_workers,
                "max_queue_size": settings.max_queue_size,
            },
        )

    loop = asyncio.get_running_loop()
    executor = get_executor()
    future = None
    try:
        future = loop.run_in_executor(
            executor,
            convert_path_to_markdown,
            str(input_path),
            include_images,
            original_name,
        )
        future.add_done_callback(lambda _future: release_submission_slot())
        return await asyncio.wait_for(future, timeout=settings.request_timeout_seconds)
    except asyncio.TimeoutError as exc:
        raise ConversionError(
            code="conversion_timeout",
            message="Document conversion timed out",
            status_code=504,
            details={"filename": original_name},
        ) from exc
    except Exception:
        if future is None:
            release_submission_slot()
        raise
