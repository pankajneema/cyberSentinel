"""Run the CA reporting consumer:  python -m backend.reporting.ca

Run from the repo root; no PYTHONPATH needed — this adds the paths the app's
bare `utils.*` / `models.*` / `notificationservice.*` imports rely on.
"""

import pathlib
import sys

_ROOT = pathlib.Path(__file__).resolve().parents[3]  # ca -> reporting -> backend -> ROOT
for _p in (str(_ROOT), str(_ROOT / "backend"), str(_ROOT / "backend" / "api_service")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import asyncio  # noqa: E402
import logging  # noqa: E402

from backend.api_service.utils.reporting import bootstrap  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
bootstrap()  # MUST run before importing the consumer (it pulls models)

from backend.reporting.ca.consumer import run  # noqa: E402

asyncio.run(run())
