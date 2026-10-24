"""Job execution seam: the API only ever talks to a ``JobRunner`` (plan §8.1)."""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol

from starlette.concurrency import run_in_threadpool


@dataclass(frozen=True)
class Job:
    kind: Literal["scan", "cleanup"]
    id: str


Handler = Callable[[Job], None]


class JobRunner(Protocol):
    async def run(self, job: Job) -> None: ...


class InlineRunner:
    """Runs the job inside the request: the only reliable pattern on serverless functions."""

    def __init__(self, handler: Handler) -> None:
        self.handler = handler

    async def run(self, job: Job) -> None:
        await run_in_threadpool(self.handler, job)


class BackgroundRunner:
    """Schedules the job on a worker thread and returns immediately (long-lived processes)."""

    def __init__(self, handler: Handler) -> None:
        self.handler = handler

    async def run(self, job: Job) -> None:
        threading.Thread(target=self.handler, args=(job,), daemon=True, name=f"{job.kind}-{job.id}").start()


def make_runner(kind: str, handler: Handler) -> JobRunner:
    return InlineRunner(handler) if kind == "inline" else BackgroundRunner(handler)
