"""Evidence: safe storage, provenance, and the one validator every decision uses.

Three kinds of fact are kept apart:
  observed   - the file itself, its SHA-256 and perceptual hash, upload time, uploader and role
  claimed    - the capture time and geotag the device sent (coord_source='device_claimed'); not verified
  decided    - what an authorised officer concluded, recorded in IssueEvent / AuditEvent with the evidence id
"""
import hashlib
import hmac
import io
import re
import time
import uuid
from typing import Iterable, Optional

import imagehash
from fastapi import HTTPException
from PIL import Image
from sqlmodel import Session, select

from . import config
from .models import Evidence, IssueEvent, Officer, Stage, Work

PURPOSES = {"progress", "inspection", "reinspection", "rectification", "test_report", "completion", "citizen_report",
            "document"}
OFFICER_PURPOSES = PURPOSES - {"citizen_report"}
# purposes that can support an engineering decision (verify, close, certify a checklist item, a test result)
TECHNICAL_ROLES = {"AE", "EE"}
PHASH_SAME = 4

# allowed formats: extension -> (mime, size limit key, magic check)
FORMATS = {
    ".jpg": ("image/jpeg", "image"), ".jpeg": ("image/jpeg", "image"), ".png": ("image/png", "image"),
    ".webp": ("image/webp", "image"),
    ".webm": ("audio/webm", "audio"), ".ogg": ("audio/ogg", "audio"), ".mp3": ("audio/mpeg", "audio"),
    ".m4a": ("audio/mp4", "audio"), ".pdf": ("application/pdf", "doc"),
}
LIMITS = {"image": lambda: config.MAX_IMAGE_BYTES, "audio": lambda: config.MAX_AUDIO_BYTES, "doc": lambda: config.MAX_DOC_BYTES}
NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|jpeg|png|webp|webm|ogg|mp3|m4a|pdf)$")


def sniff(data: bytes) -> Optional[str]:
    """Format from the file's own bytes, never from its name or the browser's content-type."""
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return ".webm"
    if data[:4] == b"OggS":
        return ".ogg"
    if data[:3] == b"ID3" or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return ".mp3"
    if data[4:8] == b"ftyp":
        return ".m4a"
    if data[:5] == b"%PDF-":
        return ".pdf"
    return None


def validate_upload(data: bytes, allowed: Iterable[str] = ("image",)) -> tuple[str, str]:
    """(extension, mime) for an acceptable upload, else HTTP 400/413."""
    if not data:
        raise HTTPException(400, "The file is empty")
    ext = sniff(data)
    if ext is None or FORMATS[ext][1] not in allowed:
        raise HTTPException(400, "File type not allowed. Use a JPG, PNG or WebP photo" +
                            (", a voice recording" if "audio" in allowed else "") + (" or a PDF" if "doc" in allowed else ""))
    kind = FORMATS[ext][1]
    if len(data) > LIMITS[kind]():
        raise HTTPException(413, f"File too large (limit {LIMITS[kind]() // (1024 * 1024)} MB)")
    if kind == "image":
        try:
            Image.open(io.BytesIO(data)).verify()
        except Exception:
            raise HTTPException(400, "The photo could not be read")
    return ext, FORMATS[ext][0]


def safe_name(name: str) -> bool:
    return bool(NAME_RE.match(name or ""))


# ---------- signed links for private media ----------

def media_sig(name: str, exp: int) -> str:
    return hmac.new(config.SECRET.encode(), f"{name}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def media_url(e: Evidence, allowed: bool) -> Optional[str]:
    if not e.file:
        return None
    if e.public:
        return f"/media/{e.file}"
    if not allowed:
        return None
    exp = int(time.time()) + config.MEDIA_LINK_MINUTES * 60
    return f"/media/{e.file}?exp={exp}&sig={media_sig(e.file, exp)}"


def media_ok(name: str, exp: Optional[int], sig: Optional[str]) -> bool:
    if exp is None or sig is None or exp < time.time():
        return False
    return hmac.compare_digest(media_sig(name, exp), sig)


# ---------- the validator ----------

def require(session: Session, evidence_id: Optional[int], work: Work, *, purposes: Iterable[str],
            actor: Optional[Officer] = None, by_actor: bool = False, roles: Optional[set] = None,
            stage_id: Optional[int] = None, not_ids: Iterable[int] = (), not_like: Iterable[Evidence] = (),
            after=None, what: str = "this step") -> Evidence:
    """The evidence for a decision, or a 400 that says exactly what is wrong with it."""
    if evidence_id is None:
        raise HTTPException(400, f"Attach evidence for {what}")
    ev = session.get(Evidence, evidence_id)
    if ev is None:
        raise HTTPException(400, f"Evidence {evidence_id} does not exist")
    if ev.work_id != work.id:
        raise HTTPException(400, "That evidence belongs to another work")
    if ev.source != "officer" or ev.purpose == "citizen_report":
        raise HTTPException(400, "A resident's upload is an allegation, not engineering verification")
    if ev.purpose not in set(purposes):
        raise HTTPException(400, f"Evidence filed as '{ev.purpose}' cannot support {what}")
    if stage_id is not None and ev.stage_id is not None and ev.stage_id != stage_id:
        raise HTTPException(400, "That evidence is filed under a different stage")
    if by_actor and actor is not None and ev.uploaded_by != actor.id:
        raise HTTPException(400, f"For {what} you must attach evidence you captured yourself")
    if roles is not None:
        up = session.get(Officer, ev.uploaded_by) if ev.uploaded_by else None
        if up is None or up.role not in roles:
            raise HTTPException(400, f"Evidence for {what} must come from {' / '.join(sorted(roles))}")
    if ev.id in set(not_ids):
        raise HTTPException(400, "The same evidence cannot be reused for an independent check")
    for other in not_like:
        if other is None:
            continue
        if ev.sha256 and other.sha256 and ev.sha256 == other.sha256:
            raise HTTPException(400, "This is the same file as the earlier evidence; take a fresh photo on site")
        if ev.phash and other.phash and imagehash.hex_to_hash(ev.phash) - imagehash.hex_to_hash(other.phash) <= PHASH_SAME:
            raise HTTPException(400, "This photo is (near-)identical to the earlier evidence; take a fresh photo on site")
    if after is not None and ev.uploaded_at is not None and ev.uploaded_at < after:
        raise HTTPException(400, f"Evidence for {what} must be captured after the previous step")
    return ev


def event_evidence(session: Session, issue_id: int, action: str) -> Optional[Evidence]:
    e = session.exec(select(IssueEvent).where(IssueEvent.issue_id == issue_id, IssueEvent.action == action)
                     .order_by(IssueEvent.at.desc(), IssueEvent.id.desc())).first()
    return session.get(Evidence, e.evidence_id) if e and e.evidence_id else None


def store(session: Session, work: Work, *, data: Optional[bytes], purpose: str, kind: str, caption: str,
          stage_id, lat, lng, uploader: Optional[Officer], source: str, captured_at, now, media_dir,
          allowed=("image",), geo_fn=None) -> Evidence:
    if purpose not in PURPOSES:
        raise HTTPException(400, "Unknown evidence purpose")
    if source == "officer" and purpose == "citizen_report":
        raise HTTPException(400, "Unknown evidence purpose")
    if stage_id is not None:
        st = session.get(Stage, stage_id)
        if st is None or st.work_id != work.id:
            raise HTTPException(400, "Stage does not belong to this work")
    ev = Evidence(work_id=work.id, stage_id=stage_id, kind=kind, caption=caption[:200], lat=lat, lng=lng,
                  captured_at=captured_at or now, uploaded_at=now, uploaded_by=uploader.id if uploader else None,
                  uploader_role=uploader.role if uploader else "RESIDENT", source=source, purpose=purpose,
                  coord_source="device_claimed" if lat is not None and lng is not None else "none")
    if data:
        ext, mime = validate_upload(data, allowed)
        name = f"{uuid.uuid4().hex}{ext}"
        (media_dir / name).write_bytes(data)
        ev.file, ev.mime, ev.sha256 = name, mime, hashlib.sha256(data).hexdigest()
        if mime.startswith("image/"):
            try:
                ev.phash = str(imagehash.phash(Image.open(io.BytesIO(data))))
            except Exception:
                ev.phash = None
    # progress photos by officers are public site facts; everything else needs a signed link
    ev.public = source == "officer" and kind == "photo" and purpose in {"progress", "completion"}
    if geo_fn and lat is not None and lng is not None:
        geo_fn(ev)
    session.add(ev)
    session.flush()
    return ev
