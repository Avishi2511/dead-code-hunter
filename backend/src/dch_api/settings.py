"""All configuration comes from environment variables (see docs/implementation-plan.md §12)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./dch_dev.db"
    github_token: str | None = None
    job_runner: Literal["inline", "background"] = "inline"
    verifier: Literal["auto", "basedpyright", "jedi", "none"] = "auto"
    scan_time_budget_s: float = 40.0
    max_py_files: int = 1000
    max_tarball_mb: int = 30
    maintenance_token: str | None = None
    stale_job_timeout_s: int = 120
    scan_rate_limit_per_hour: int = 20
    purge_after_days: int = 7
    serve_static: bool = False
    static_dir: str = "frontend/dist"
    cors_origins: str = ""  # comma separated; only needed when the frontend is hosted separately


@lru_cache
def get_settings() -> Settings:
    return Settings()
