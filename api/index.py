"""Vercel serverless entry point for Project HUNT.

Vercel's @vercel/python runtime imports this file and looks for a module-level
``app`` (ASGI/WSGI) or ``handler`` (AWS-Lambda-style) callable. We expose the
FastAPI app from ``hunt.main``.

The Project HUNT package lives at ``api/core``. To keep the existing import
structure (``from hunt.config import ...`` etc.) working unchanged, we
prepend ``api/core`` to ``sys.path`` and *remove* the project root from the
path so the wrong ``hunt`` package is never picked up.
"""
from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG = os.path.join(_HERE, "core")
_PROJECT_ROOT = os.path.dirname(_HERE)

# Drop the project root from sys.path if it happens to be there — the
# migration left a stale ``hunt/`` package in the root that would shadow
# the real one. We never want to import the stale copy.
sys.path[:] = [p for p in sys.path if p and os.path.abspath(p) != _PROJECT_ROOT]
if _PKG not in sys.path:
    sys.path.insert(0, _PKG)

# Import after sys.path is configured.
from hunt.main import app  # noqa: E402,F401

__all__ = ["app"]
