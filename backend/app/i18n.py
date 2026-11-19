"""Hindi terms shared with the frontend (shared/terms_hi.json)."""
import json
from pathlib import Path

_TERMS = json.loads((Path(__file__).resolve().parents[2] / "shared" / "terms_hi.json").read_text(encoding="utf-8"))


def hi(kind: str, text: str) -> str:
    return _TERMS.get(kind, {}).get(text, text)
