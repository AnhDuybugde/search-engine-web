"""Small local bootstrap for the imported legacy experiment scripts.

The original branch referenced a private helper that was not committed. Keep
the experiment runnable from ``legacy-pipeline`` without changing its model
or evaluation code.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
os.environ.setdefault("USE_TF", "0")
