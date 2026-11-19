"""Runtime configuration. Demo mode is the default; pilot mode switches off every demo convenience."""
import os
import secrets

MODE = os.environ.get("KN_MODE", "demo").lower()  # demo | pilot
if MODE not in {"demo", "pilot"}:
    raise RuntimeError("KN_MODE must be 'demo' or 'pilot'")
DEMO = MODE == "demo"

# Signing key for login tokens and private media links. Pilot mode refuses to start without one.
SECRET = os.environ.get("KN_SECRET") or ("demo-only-not-secret" if DEMO else "")
if not DEMO and len(SECRET) < 32:
    raise RuntimeError("Pilot mode needs KN_SECRET (at least 32 characters)")
TOKEN_HOURS = int(os.environ.get("KN_TOKEN_HOURS", "10"))
MEDIA_LINK_MINUTES = int(os.environ.get("KN_MEDIA_LINK_MINUTES", "60"))

ALLOWED_ORIGINS = [o for o in os.environ.get("KN_ALLOWED_ORIGINS", "*" if DEMO else "").split(",") if o]

MAX_IMAGE_BYTES = int(os.environ.get("KN_MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
MAX_AUDIO_BYTES = int(os.environ.get("KN_MAX_AUDIO_BYTES", str(5 * 1024 * 1024)))
MAX_DOC_BYTES = int(os.environ.get("KN_MAX_DOC_BYTES", str(10 * 1024 * 1024)))

# Public endpoints: max requests per client per window
RATE_WINDOW_S = int(os.environ.get("KN_RATE_WINDOW_S", "600"))
RATE_LIMITS = {"report": int(os.environ.get("KN_RATE_REPORT", "6")), "support": 20, "vote": 20, "track": 60, "appeal": 5}

APPEAL_DAYS = 30
MAX_APPEALS = 2
VOTER_SALT = os.environ.get("KN_VOTER_SALT") or secrets.token_hex(8)
