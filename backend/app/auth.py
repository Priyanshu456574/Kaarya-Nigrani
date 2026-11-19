"""Who is calling.

Demo mode: the 'Viewing as' persona switcher sends X-User (synthetic data only).
Pilot mode: X-User is ignored. Officers sign in and send a signed bearer token. The password store here is a
placeholder for the state SSO / OTP gateway, which is not integrated (see PILOT_READINESS.md)."""
import base64
import hashlib
import hmac
import json
import secrets
import sys
import time
from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from . import config
from .db import get_session
from .models import Officer, OfficerCredential

PBKDF2_ROUNDS = 200_000


def hash_password(pw: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${salt.hex()}${dk.hex()}"


def check_password(pw: str, stored: str) -> bool:
    try:
        _, salt, dk = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(pw, bytes.fromhex(salt)).split("$")[2], dk)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign(payload: dict) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    mac = _b64(hmac.new(config.SECRET.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{mac}"


def unsign(token: str) -> Optional[dict]:
    try:
        body, mac = token.split(".")
    except ValueError:
        return None
    good = _b64(hmac.new(config.SECRET.encode(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(good, mac):
        return None
    data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    if data.get("exp", 0) < time.time():
        return None
    return data


def issue_token(officer_id: int) -> str:
    return sign({"sub": officer_id, "exp": int(time.time()) + config.TOKEN_HOURS * 3600, "typ": "officer"})


def current_officer(x_user: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None),
                    session: Session = Depends(get_session)) -> Optional[Officer]:
    oid = None
    if authorization and authorization.lower().startswith("bearer "):
        data = unsign(authorization[7:].strip())
        if not data or data.get("typ") != "officer":
            raise HTTPException(401, "Session expired or invalid; sign in again")
        oid = data["sub"]
    elif x_user:
        if not config.DEMO:
            raise HTTPException(401, "Persona switching is only available in the synthetic demo")
        if not x_user.isdigit():
            raise HTTPException(401, "Unknown user")
        oid = int(x_user)
    if oid is None:
        return None
    o = session.get(Officer, oid)
    if o is None:
        raise HTTPException(401, "Unknown user")
    if not config.DEMO:
        cred = session.get(OfficerCredential, o.id)
        if cred is None or not cred.active:
            raise HTTPException(401, "Account disabled")
    return o


def require_officer(officer: Optional[Officer] = Depends(current_officer)) -> Officer:
    if officer is None:
        raise HTTPException(401, "Officer login required")
    return officer


if __name__ == "__main__":  # python -m app.auth set-password <officer_id> <password>
    from sqlmodel import Session as S
    from .db import engine, init_db
    if len(sys.argv) != 4 or sys.argv[1] != "set-password":
        sys.exit("usage: python -m app.auth set-password <officer_id> <password>")
    init_db()
    with S(engine) as s:
        oid, pw = int(sys.argv[2]), sys.argv[3]
        if len(pw) < 12:
            sys.exit("Use at least 12 characters")
        cred = s.get(OfficerCredential, oid) or OfficerCredential(officer_id=oid, pw_hash="")
        cred.pw_hash, cred.active = hash_password(pw), True
        s.add(cred)
        s.commit()
        print("Password set for officer", oid)
