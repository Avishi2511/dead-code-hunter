"""Vercel adapter: the only Python file that knows about the platform (plan §12.3)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend" / "src"))

from dch_api.main import app_factory  # noqa: E402

app = app_factory()
