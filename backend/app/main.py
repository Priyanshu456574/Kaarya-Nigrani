import hashlib
import io
import json
import math
import time
from collections import defaultdict, deque
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import qrcode
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field as PField
from sqlmodel import Session, select

from .db import MEDIA_DIR, get_session, init_db
from . import access, audit, certification, config, geo
from . import evidence as evidence_rules
from .auth import check_password, current_officer, issue_token, require_officer
from .extras import iso_week, tasks_for, weekly_picks
from .flags import actual_progress, check_measured_progress, due_date, duplicate_photo_index, evaluate_test, hold_pending, s_curve, spec_text, work_flags
from .i18n import hi
from .models import (AuditEvent, Bill, Evidence, Inspection, Issue, IssueEvent, Measurement, Notification, Officer,
                     OfficerCredential, PostCheck, ProgressReport, QualityTest, ScopeRevision, Stage, SupportRecord,
                     TimeExtension, UsabilityItem, UsabilityVote, Work)
from .workflow import (DELAY_REASONS, OPEN_UNVERIFIED, OPEN_VERIFIED, STATUS_LABEL, TERMINAL, TECHNICAL, ENGINEERS,
                       WorkflowError, appeal, available_actions, create_issue, escalation, mask, notify_status, now,
                       send_sms, transition)

app = FastAPI(title="Kaarya Nigrani API", version="0.5")
if config.ALLOWED_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type", "Authorization", "X-User"] if config.DEMO else ["Content-Type", "Authorization"])


@app.on_event("startup")
def _startup():
    init_db()
    if config.DEMO:
        from .seed import seed
        seed()  # loads synthetic demo data only if the database is empty; never in pilot mode


@app.exception_handler(WorkflowError)
def _wf_error(_, exc: WorkflowError):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=exc.code, content={"detail": exc.message})


@app.get("/media/{name}")
def media(name: str, exp: Optional[int] = None, sig: Optional[str] = None, session: Session = Depends(get_session)):
    """Public site photos are open; everything else (resident uploads, voice notes, inspection and test files)
    needs a short-lived signed link that the API only hands to people allowed to see it."""
    if not evidence_rules.safe_name(name):
        raise HTTPException(404, "Not found")
    ev = session.exec(select(Evidence).where(Evidence.file == name)).first()
    if ev is None:
        raise HTTPException(404, "Not found")
    if not ev.public and not evidence_rules.media_ok(name, exp, sig):
        raise HTTPException(403, "This file is private")
    path = (MEDIA_DIR / name).resolve()
    if MEDIA_DIR.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type=ev.mime or "application/octet-stream",
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"})


# ---------- abuse control for public endpoints (per client, in memory; use the gateway's limiter in a pilot) ----------
_hits: dict = defaultdict(deque)


def client_key(request: Request) -> str:
    ip = request.client.host if request.client else "?"
    return hashlib.sha256(f"{config.VOTER_SALT}|{ip}|{request.headers.get('user-agent', '')}".encode()).hexdigest()[:24]


def rate_limit(request: Request, bucket: str):
    k, t = (bucket, client_key(request)), time.time()
    q = _hits[k]
    while q and q[0] < t - config.RATE_WINDOW_S:
        q.popleft()
    if len(q) >= config.RATE_LIMITS[bucket]:
        raise HTTPException(429, "Too many requests from this device. Please try again later.")
    q.append(t)


def voter_id(request: Request, phone: Optional[str]) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    base = f"phone:{digits[-10:]}" if len(digits) >= 10 else f"device:{client_key(request)}"
    return hashlib.sha256(f"{config.VOTER_SALT}|{base}".encode()).hexdigest()[:32]


def valid_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 10 or len(digits) > 12:
        raise HTTPException(400, "Enter a 10-digit mobile number")
    return digits[-10:]


# ---------- helpers ----------


def get_work(session: Session, work_id: int) -> Work:
    w = session.get(Work, work_id)
    if w is None:
        raise HTTPException(404, "Work not found")
    return w


def work_for(session: Session, me: Officer, work_id: int, allow=("full",)) -> Work:
    """The work, if this person's role lets them do this to it."""
    w = get_work(session, work_id)
    lvl = access.level(session, me, w)
    if lvl is None:
        raise HTTPException(403, "This work is not one of your responsibilities")
    if lvl not in allow:
        raise HTTPException(403, "Your role cannot do this on this work")
    return w


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def save_evidence(session: Session, work: Work, *, upload: Optional[bytes], filename: str, kind: str,
                  caption: str, stage_id, lat, lng, uploaded_by, source, captured_at=None, purpose: Optional[str] = None,
                  allowed=("image",)) -> Evidence:
    uploader = session.get(Officer, uploaded_by) if uploaded_by else None
    purpose = purpose or ("citizen_report" if source == "citizen" else ("test_report" if kind == "test_report" else "progress"))

    def place(ev):
        line = geo.load_line(work.alignment)
        if line:  # linear work: chainage from the geotag, site = corridor along the alignment
            ch, off = geo.project(line, ev.lat, ev.lng)
            ev.chainage_km, ev.in_geofence = ch, off <= work.geofence_m
        else:
            ev.in_geofence = haversine_m(ev.lat, ev.lng, work.lat, work.lng) <= work.geofence_m

    return evidence_rules.store(session, work, data=upload, purpose=purpose, kind=kind, caption=caption, stage_id=stage_id,
                                lat=lat, lng=lng, uploader=uploader, source=source, captured_at=captured_at,
                                now=captured_at or now(), media_dir=MEDIA_DIR, allowed=allowed, geo_fn=place)


def officer_brief(session, oid):
    if oid is None:
        return None
    o = session.get(Officer, oid)
    return {"id": o.id, "name": o.name, "role": o.role, "department": o.department} if o else None


def evidence_dict(e: Evidence, public=False, allowed=True):
    d = {"id": e.id, "stage_id": e.stage_id, "issue_id": e.issue_id, "kind": e.kind, "caption": e.caption,
         "url": evidence_rules.media_url(e, allowed and not public), "captured_at": e.captured_at.isoformat(),
         "source": e.source, "in_geofence": e.in_geofence, "chainage_km": e.chainage_km, "purpose": e.purpose,
         "coord_source": e.coord_source}
    if not public:
        d.update(lat=e.lat, lng=e.lng, uploaded_by=e.uploaded_by, uploader_role=e.uploader_role,
                 uploaded_at=e.uploaded_at.isoformat() if e.uploaded_at else None, sha256=e.sha256)
    return d


def issue_dict(session, i: Issue, viewer: Optional[Officer] = None, public=False, show_person=True):
    events = session.exec(select(IssueEvent).where(IssueEvent.issue_id == i.id).order_by(IssueEvent.at, IssueEvent.id)).all()
    d = {
        "id": i.id, "ticket": i.ticket, "work_id": i.work_id, "stage_id": i.stage_id, "source": i.source,
        "category": i.category, "reason_code": i.reason_code,
        "reason_label": DELAY_REASONS.get(i.reason_code) if i.reason_code else None,
        "reason_label_hi": hi("reason", i.reason_code) if i.reason_code else None,
        "title": i.title, "description": i.description, "status": i.status,
        "status_label": STATUS_LABEL[i.status], "verified": i.status in OPEN_VERIFIED | {"CLOSED"},
        "appealable": bool(i.source == "citizen" and i.status in TERMINAL and i.appeals < config.MAX_APPEALS and
                           (not i.closed_at or (now() - i.closed_at).days <= config.APPEAL_DAYS)),
        "finding": i.finding, "created_at": i.created_at.isoformat(), "supporters": i.supporters,
        "voice": None if (public or not show_person) else next((evidence_rules.media_url(e, True) for e in session.exec(select(Evidence).where(Evidence.issue_id == i.id, Evidence.kind == "voice")).all()), None),
        "appeals": i.appeals,
        "due_date": i.due_date.isoformat() if i.due_date else None,
        "overdue": bool(i.due_date and i.due_date < date.today() and i.status not in TERMINAL),
        "events": [{"at": e.at.isoformat(), "action": e.action, "to_status": e.to_status,
                    "to_label": STATUS_LABEL[e.to_status], "note": e.note, "evidence_id": e.evidence_id,
                    "actor": (e.actor_label.split(" ")[0] if public and e.actor_id else e.actor_label)}
                   for e in events],
    }
    if public:
        d["owner_role"] = officer_brief(session, i.owner_id)["role"] if i.owner_id else None
    else:
        d["owner"] = officer_brief(session, i.owner_id)
        d["complainant_name"] = i.complainant_name if show_person else None
        d["complainant_phone"] = i.complainant_phone if show_person else None
        d["actions"] = available_actions(i, viewer)
        esc = escalation(session, i, session.get(Work, i.work_id))
        d["overdue_days"] = esc["days"]
        d["escalated_to"] = officer_brief(session, esc["escalated_to"].id) if esc["escalated_to"] else None
    return d


def work_summary(session, w: Work, today, dup, viewer: Optional[Officer] = None, lvl: str = "full"):
    f = work_flags(session, w, today, dup)
    if viewer is not None:
        f["flags"] = access.visible_flags(viewer, lvl, f["flags"])
        f["score"] = sum(x["severity"] for x in f["flags"])
    open_issues = session.exec(select(Issue).where(Issue.work_id == w.id)).all()
    return {
        "id": w.id, "code": w.code, "name": w.name, "work_type": w.work_type, "department": w.department,
        "scheme": w.scheme, "block": w.block, "village": w.village, "lat": w.lat, "lng": w.lng,
        "status": w.status, "sanctioned_lakh": w.sanctioned_lakh, "planned_end": w.planned_end.isoformat(),
        "revised_end": w.revised_end.isoformat() if w.revised_end else None, "due_date": due_date(w).isoformat(),
        "qr_token": w.qr_token, "je": officer_brief(session, w.je_id),
        "planned": f["planned"], "actual": f["actual"], "evidenced": f["evidenced"], "financial": f["financial"],
        "reported": f["reported"], "check_measured": f["check_measured"],
        "flags": f["flags"], "score": f["score"], "length_km": w.length_km,
        "line": geo.load_line(w.alignment), "_coverage": f["coverage"],
        "open_reported": sum(1 for i in open_issues if i.status in OPEN_UNVERIFIED),
        "open_verified": sum(1 for i in open_issues if i.status in OPEN_VERIFIED),
    }


# ---------- meta ----------

@app.get("/api/meta")
def meta(session: Session = Depends(get_session), me: Optional[Officer] = Depends(current_officer)):
    officers = session.exec(select(Officer).order_by(Officer.role, Officer.name)).all()
    if not config.DEMO:  # no staff directory for anonymous callers in a pilot
        officers = [o for o in officers if me is not None and (o.id == me.id or me.role in access.INTERNAL)]
    return {
        "mode": config.MODE,
        "today": date.today().isoformat(),
        "officers": [o.model_dump() for o in officers],
        "delay_reasons": DELAY_REASONS,
        "status_labels": STATUS_LABEL,
        "blocks": sorted({w.block for w in session.exec(select(Work)).all()}),
        "departments": sorted({w.department for w in session.exec(select(Work)).all()}),
    }


class LoginIn(BaseModel):
    officer_id: int
    password: str = PField(max_length=200)


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, session: Session = Depends(get_session)):
    if config.DEMO:
        raise HTTPException(400, "The synthetic demo uses the persona switcher, not passwords")
    rate_limit(request, "appeal")
    cred = session.get(OfficerCredential, body.officer_id)
    if cred is None or not cred.active or not check_password(body.password, cred.pw_hash):
        raise HTTPException(401, "Wrong officer ID or password")
    o = session.get(Officer, body.officer_id)
    return {"token": issue_token(o.id), "officer": o.model_dump()}


# ---------- officer views ----------

@app.get("/api/dashboard")
def dashboard(session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    today = date.today()
    dup = duplicate_photo_index(session)
    levels = {w.id: access.level(session, me, w) for w in session.exec(select(Work)).all()}
    works = [work_summary(session, w, today, dup, me, levels[w.id]) for w in session.exec(select(Work)).all() if levels[w.id]]
    for w in works:
        w.pop("_coverage", None)
    visible_ids = {w["id"] for w in works}
    issues = [i for i in session.exec(select(Issue)).all() if i.work_id in visible_ids]
    by_id = {w["id"]: w for w in works}
    holdups = {}
    for i in issues:
        if i.category == "delay" and i.status not in TERMINAL:
            h = holdups.setdefault(i.reason_code, {"reason": i.reason_code, "label": DELAY_REASONS[i.reason_code],
                                                   "label_hi": hi("reason", i.reason_code), "works": [], "sanctioned_lakh": 0.0,
                                                   "overdue": 0})
            w = by_id[i.work_id]
            h["works"].append({"id": w["id"], "code": w["code"], "name": w["name"]})
            h["sanctioned_lakh"] = round(h["sanctioned_lakh"] + w["sanctioned_lakh"], 1)
            if i.due_date and i.due_date < today:
                h["overdue"] += 1
    escalated = []
    for i in issues:
        esc = escalation(session, i, session.get(Work, i.work_id), today)
        if esc["escalated_to"]:
            escalated.append({"ticket": i.ticket, "title": i.title, "work_id": i.work_id, "days": esc["days"],
                              "to": officer_brief(session, esc["escalated_to"].id), "owner": officer_brief(session, i.owner_id)})
    flagged = sorted([w for w in works if w["flags"]], key=lambda w: (-w["score"], w["code"]))
    # decision queue: what needs intervention, why, who acts, since when, by when, how far it has escalated
    from .extras import FLAG_TASK
    decisions = []
    for i in issues:
        esc = escalation(session, i, session.get(Work, i.work_id), today)
        if esc["level"] >= 2 or (i.category == "delay" and i.status not in TERMINAL and esc["level"] >= 1):
            w = by_id[i.work_id]
            owner = officer_brief(session, i.owner_id)
            decisions.append({"kind": "escalation", "severity": 3, "work": {"id": w["id"], "code": w["code"], "name": w["name"]},
                              "decision": "Overdue action: decide on the owner's next step" if i.category != "delay" else "Hold-up past its deadline: decide",
                              "decision_hi": "लंबित कार्रवाई: अगले कदम पर निर्णय लें" if i.category != "delay" else "बाधा समय-सीमा पार: निर्णय लें",
                              "why": f"{i.ticket}: {i.title}", "owner": owner, "escalated_to": officer_brief(session, esc["escalated_to"].id) if esc["escalated_to"] else None,
                              "level": esc["level"], "age_days": (today - i.created_at.date()).days, "due_date": i.due_date.isoformat() if i.due_date else None,
                              "overdue_days": esc["days"], "last_action": next((e.note for e in reversed(session.exec(select(IssueEvent).where(IssueEvent.issue_id == i.id).order_by(IssueEvent.at)).all()) if e.note), ""),
                              "tab": "issues", "focus": f"issue-{i.id}"})
    for w in works:
        for f in w["flags"]:
            if f["severity"] < 3 or f["code"] in ("OVERDUE_ACTION",) or f["code"] not in FLAG_TASK:
                continue
            en, hn, tab = FLAG_TASK[f["code"]]
            decisions.append({"kind": "flag", "code": f["code"], "severity": 3, "work": {"id": w["id"], "code": w["code"], "name": w["name"]},
                              "decision": en, "decision_hi": hn, "why": f["message"], "why_hi": f["message_hi"],
                              "owner": {"role": f["next_action_by"], "name": f["next_person"]}, "escalated_to": None, "level": 0,
                              "age_days": None, "due_date": None, "overdue_days": 0, "last_action": "", "tab": tab, "focus": None})
    decisions.sort(key=lambda d: (-d["level"], -(d["overdue_days"] or 0), d["work"]["code"]))

    blocks = {}
    for w in works:
        b = blocks.setdefault(w["block"], {"block": w["block"], "works": 0, "flagged": 0, "sanctioned_lakh": 0})
        b["works"] += 1
        b["flagged"] += 1 if w["flags"] else 0
        b["sanctioned_lakh"] = round(b["sanctioned_lakh"] + w["sanctioned_lakh"], 1)
    return {
        "today": today.isoformat(),
        "totals": {
            "works": len(works),
            "sanctioned_lakh": round(sum(w["sanctioned_lakh"] for w in works), 1),
            "behind_schedule": sum(1 for w in works if any(f["code"] in ("SCHEDULE_SLIP", "PAST_DEADLINE") for f in w["flags"])),
            "complete_not_usable": sum(1 for w in works if any(f["code"] == "COMPLETE_NOT_USABLE" for f in w["flags"])),
            "usable_verified": sum(1 for w in works if w["status"] == "USABLE_VERIFIED"),
            "open_reported": sum(1 for i in issues if i.status in OPEN_UNVERIFIED),
            "open_verified": sum(1 for i in issues if i.status in OPEN_VERIFIED),
            "overdue_actions": sum(1 for i in issues if i.due_date and i.due_date < today and i.status not in TERMINAL),
            "needs_decision": sum(1 for w in works if any(f["severity"] == 3 for f in w["flags"])),
            "escalated": len(escalated),
        },
        "intervention": flagged[:10],
        "decisions": decisions[:12],
        "holdups": sorted(holdups.values(), key=lambda h: -h["sanctioned_lakh"]),
        "escalated": sorted(escalated, key=lambda e: -e["days"]),
        "scope": access.scope_label(me),
        "inspections": ([{"work": {"id": p["work"].id, "code": p["work"].code, "name": p["work"].name}, "reason": p["reason"],
                          "week": p["week"], "due": p["due"].isoformat(), "assigned_to": officer_brief(session, p["assigned_to"]),
                          "done": ({"outcome": p["done"].outcome, "on": p["done"].done_on.isoformat()} if p["done"] else None)}
                         for p in weekly_picks(session, today)] if me.role in access.DISTRICT else None),
        "works": sorted(works, key=lambda w: w["code"]),
        "blocks": sorted(blocks.values(), key=lambda b: b["block"]),
    }


def _need(o: Optional[Officer]) -> Officer:
    if o is None:
        raise HTTPException(401, "Officer login required")
    return o


@app.get("/api/works/{work_id}")
def work_detail(work_id: int, session: Session = Depends(get_session), viewer: Officer = Depends(require_officer)):
    w = work_for(session, viewer, work_id, allow=("full", "contractor", "limited"))
    lvl = access.level(session, viewer, w)
    today = date.today()
    summary = work_summary(session, w, today, duplicate_photo_index(session), viewer, lvl)
    stages = session.exec(select(Stage).where(Stage.work_id == w.id).order_by(Stage.seq)).all()
    evidence = session.exec(select(Evidence).where(Evidence.work_id == w.id).order_by(Evidence.captured_at.desc())).all()
    reports = session.exec(select(ProgressReport).where(ProgressReport.work_id == w.id).order_by(ProgressReport.report_date)).all()
    issues = session.exec(select(Issue).where(Issue.work_id == w.id).order_by(Issue.created_at.desc())).all()
    checklist = session.exec(select(UsabilityItem).where(UsabilityItem.work_id == w.id).order_by(UsabilityItem.id)).all()
    ready = certification.readiness(session, w, viewer)
    can_certify = ready["eligible"] and viewer.role == "EE" and w.ee_id == viewer.id
    show_person = access.sees_complainant(viewer, lvl)
    issues = [i for i in issues if access.issue_visible(viewer, lvl, i, session.exec(select(IssueEvent).where(IssueEvent.issue_id == i.id)).all())]
    if lvl != "full":  # residents' own photos stay with the engineers handling their reports
        evidence = [e for e in evidence if e.source == "officer"]
    coverage = summary.pop("_coverage")
    mbs = session.exec(select(Measurement).where(Measurement.work_id == w.id).order_by(Measurement.entry_date)).all()
    tests = session.exec(select(QualityTest).where(QualityTest.work_id == w.id).order_by(QualityTest.id)).all()
    bills = session.exec(select(Bill).where(Bill.work_id == w.id).order_by(Bill.bill_no)).all()
    unchecked = {m.id for m in mbs if m.checked_by is None}
    hold = {}
    for s in stages:
        prev, pending = hold_pending(stages, tests, s)
        if pending:
            hold[s.id] = {"stage": prev.name, "stage_hi": hi("stage", prev.name), "tests": [x.name for x in pending],
                          "tests_hi": [hi("test", x.name) for x in pending]}
    stage_out = []
    for s in stages:
        cov = coverage[s.id]
        stage_out.append({**s.model_dump(mode="json"),
                          "evidence_count": sum(1 for e in evidence if e.stage_id == s.id and e.source == "officer"),
                          "covered": cov["covered"], "gaps": cov["gaps"], "executed": cov["executed"], "hold": hold.get(s.id),
                          "measurements": [{**m.model_dump(mode="json"), "recorded_by_name": officer_brief(session, m.recorded_by)["name"],
                                            "checked_by_name": (officer_brief(session, m.checked_by) or {}).get("name")}
                                           for m in mbs if m.stage_id == s.id],
                          "tests": [{**t.model_dump(mode="json"), "spec": spec_text(t), "spec_hi": spec_text(t, True)}
                                    for t in tests if t.stage_id == s.id]})
    pick = next((p for p in weekly_picks(session, today) if p["work"].id == w.id), None)
    if lvl == "limited":  # Circle Officer / BDO: the hold-up they own, not the engineering file
        for s in stage_out:
            s["measurements"], s["tests"] = [], []
        bills = []
    return {
        **summary,
        "access": {"level": lvl, "tabs": access.TABS[lvl], "complainant": show_person},
        "stages": stage_out,
        "bills": [{**b.model_dump(mode="json"), "mb_ids": json.loads(b.mb_ids),
                   "unchecked": bool(unchecked & set(json.loads(b.mb_ids)))} for b in bills],
        "finance": ready["financial"] if lvl != "limited" else None,
        "certification": {"eligible": ready["eligible"], "blockers": ready["blockers"], "claim_blockers": ready["claim_blockers"]},
        "revisions": [{**r.model_dump(mode="json"), "approved_by_name": (officer_brief(session, r.approved_by) or {}).get("name"),
                       "stage_name": session.get(Stage, r.stage_id).name}
                      for r in session.exec(select(ScopeRevision).where(ScopeRevision.work_id == w.id).order_by(ScopeRevision.id)).all()],
        "audit": audit.history(session, w.id) if viewer.role in access.INTERNAL else None,
        "geofence_m": w.geofence_m, "start_date": w.start_date.isoformat(),
        "completion_claimed_on": w.completion_claimed_on.isoformat() if w.completion_claimed_on else None,
        "people": {k: officer_brief(session, getattr(w, f"{k}_id")) for k in ("je", "ae", "ee", "contractor")},
        "evidence": [{**evidence_dict(e), **({} if viewer.role in access.INTERNAL else {"in_geofence": None})} for e in evidence],
        "sanction": {"sanctioned_lakh": w.sanctioned_lakh, "start_date": w.start_date.isoformat(), "planned_end": w.planned_end.isoformat(),
                     "revised_end": w.revised_end.isoformat() if w.revised_end else None, "scheme": w.scheme,
                     "stages": [{"id": s.id, "name": s.name, "unit": s.unit, "qty_sanctioned": s.qty_sanctioned,
                                 "qty_original": s.qty_original if s.qty_original is not None else s.qty_sanctioned} for s in stages]},
        "reports": [r.model_dump(mode="json") for r in reports],
        "curve": s_curve(stages, w.start_date, due_date(w), work=w),
        "extensions": [{**x.model_dump(mode="json"), "approved_by_name": (officer_brief(session, x.approved_by) or {}).get("name"),
                        "reason_label": DELAY_REASONS.get(x.reason_code), "reason_label_hi": hi("reason", x.reason_code)}
                       for x in session.exec(select(TimeExtension).where(TimeExtension.work_id == w.id).order_by(TimeExtension.approved_on)).all()],
        "postchecks": [p.model_dump(mode="json") for p in session.exec(select(PostCheck).where(PostCheck.work_id == w.id).order_by(PostCheck.due_date)).all()],
        "votes": {"yes": sum(1 for v in session.exec(select(UsabilityVote).where(UsabilityVote.work_id == w.id)).all() if v.usable),
                  "no": sum(1 for v in session.exec(select(UsabilityVote).where(UsabilityVote.work_id == w.id)).all() if not v.usable)},
        "certified_on": w.certified_on.isoformat() if w.certified_on else None, "dlp_end": w.dlp_end.isoformat() if w.dlp_end else None,
        "inspection": ({"reason": pick["reason"], "week": pick["week"], "due": pick["due"].isoformat(),
                        "assigned_to": officer_brief(session, pick["assigned_to"]),
                        "done": ({"outcome": pick["done"].outcome, "note": pick["done"].note, "on": pick["done"].done_on.isoformat()} if pick["done"] else None)}
                       if pick and access.sees_inspection(viewer, w, bool(pick["done"])) else None),
        "issues": [issue_dict(session, i, viewer, show_person=show_person) for i in issues],
        "checklist": [c.model_dump(mode="json") for c in checklist],
        "can_certify": bool(can_certify),
    }


class MeasurementIn(BaseModel):
    stage_id: int
    qty: float
    ch_from: Optional[float] = None
    ch_to: Optional[float] = None


def hold_for(session, stage: Stage):
    """Tests that must pass before this stage can be measured (hold point)."""
    stages = session.exec(select(Stage).where(Stage.work_id == stage.work_id)).all()
    tests = session.exec(select(QualityTest).where(QualityTest.work_id == stage.work_id)).all()
    return hold_pending(stages, tests, stage)


def refresh_report(session, w: Work, me: Officer):
    stages = session.exec(select(Stage).where(Stage.work_id == w.id)).all()
    bills = session.exec(select(Bill).where(Bill.work_id == w.id)).all()
    session.add(ProgressReport(work_id=w.id, report_date=date.today(),
                               physical_pct=round(sum(s.weight * s.progress / 100 for s in stages), 1),
                               financial_pct=round(sum((b.paid_lakh or 0) for b in bills if b.status == "PAID") / w.sanctioned_lakh * 100, 1),
                               note="Measured progress (measurement book)", reported_by=me.id))


@app.post("/api/works/{work_id}/measurements")
def add_measurement(work_id: int, body: MeasurementIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id)
    if me.role != "JE":
        raise HTTPException(403, "Measurements are recorded by the JE")
    st = session.get(Stage, body.stage_id)
    if st is None or st.work_id != w.id:
        raise HTTPException(400, "Stage does not belong to this work")
    prev, pending = hold_for(session, st)
    if pending:
        raise HTTPException(409, f"Hold point: '{prev.name}' must pass {', '.join(t.name for t in pending)} before '{st.name}' can be measured.")
    if body.qty <= 0:
        raise HTTPException(400, "Quantity must be more than zero")
    if st.qty_executed + body.qty > st.qty_sanctioned + 1e-6:
        raise HTTPException(400, f"Only {st.qty_sanctioned - st.qty_executed:g} {st.unit} remain in the sanctioned quantity")
    if st.linear:
        if body.ch_from is None or body.ch_to is None or body.ch_to <= body.ch_from or body.ch_to > (w.length_km or 0) + 1e-6:
            raise HTTPException(400, f"Give the chainage from and to (km, within 0–{w.length_km:g})")
    mb = Measurement(work_id=w.id, stage_id=st.id, entry_date=date.today(), qty=body.qty,
                     ch_from=body.ch_from, ch_to=body.ch_to, recorded_by=me.id)
    session.add(mb)
    session.flush()
    audit.record(session, work_id=w.id, entity="measurement", entity_id=mb.id, action="record", actor=me,
                 after={"stage": st.name, "qty": body.qty, "ch_from": body.ch_from, "ch_to": body.ch_to})
    st.qty_executed = round(st.qty_executed + body.qty, 3)
    st.progress = round(min(100.0, st.qty_executed / st.qty_sanctioned * 100), 1)
    if st.progress >= 100 and not st.completed_on:
        st.completed_on = date.today()
    if w.status == "SANCTIONED":
        w.status = "IN_PROGRESS"
    session.flush()
    refresh_report(session, w, me)
    session.commit()
    return {"ok": True}


@app.post("/api/measurements/{mb_id}/check")
def check_measurement(mb_id: int, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    m = session.get(Measurement, mb_id)
    if m is None:
        raise HTTPException(404, "Measurement not found")
    if me.role not in {"AE", "EE"}:
        raise HTTPException(403, "Check-measurement is done by the AE or EE")
    work_for(session, me, m.work_id)
    if m.recorded_by == me.id:
        raise HTTPException(403, "The officer who recorded a measurement cannot check it")
    if m.checked_by is not None:
        raise HTTPException(409, "Already check-measured")
    m.checked_by, m.checked_on = me.id, date.today()
    audit.record(session, work_id=m.work_id, entity="measurement", entity_id=m.id, action="check_measure", actor=me,
                 after={"qty": m.qty})
    session.commit()
    return {"ok": True}


class TestIn(BaseModel):
    result: float
    chainage_km: Optional[float] = None
    lab: Optional[str] = None
    evidence_id: Optional[int] = None
    reason: str = ""  # required when a result is already on record (retest or correction)


@app.post("/api/tests/{test_id}")
def record_test(test_id: int, body: TestIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    t = session.get(QualityTest, test_id)
    if t is None:
        raise HTTPException(404, "Test not found")
    if me.role not in ENGINEERS:
        raise HTTPException(403, "Tests are recorded by engineers")
    w = work_for(session, me, t.work_id)
    if not math.isfinite(body.result):
        raise HTTPException(400, "Enter the test result")
    ev = evidence_rules.require(session, body.evidence_id, w, purposes={"test_report", "inspection"}, roles=ENGINEERS,
                                stage_id=t.stage_id, what="a test result")
    before = None
    if t.result is not None:
        if not body.reason.strip():
            raise HTTPException(400, "A result is already on record. Say why you are entering a retest or correction.")
        if ev.id == t.evidence_id:
            raise HTTPException(400, "A retest needs its own test report, not the earlier one")
        before = {"result": t.result, "passed": t.passed, "tested_on": t.tested_on, "tested_by": t.tested_by, "evidence_id": t.evidence_id}
    t.result, t.passed = body.result, evaluate_test(t, body.result)
    t.chainage_km, t.lab, t.evidence_id = body.chainage_km, body.lab or "Field test", ev.id
    t.tested_on, t.tested_by = date.today(), me.id
    audit.record(session, work_id=w.id, entity="test", entity_id=t.id, action="retest" if before else "record", actor=me,
                 before=before, after={"result": t.result, "passed": t.passed, "evidence_id": ev.id}, reason=body.reason.strip(),
                 evidence_id=ev.id)
    raised = None
    if not t.passed:
        st = session.get(Stage, t.stage_id)
        where = f" at km {body.chainage_km:g}" if body.chainage_km is not None else ""
        raised = create_issue(session, work=w, actor=None if me.role == "JE" else me, source="inspection", category="quality",
                              title=f"{t.name} failed{where}: {body.result:g} {t.unit} against {spec_text(t)}",
                              description=f"{t.name} on '{st.name}'{where}: {body.result:g} {t.unit} against {spec_text(t)}. Raised automatically from the test register.",
                              stage_id=t.stage_id, evidence_id=None)
        # a failed test on record is a verified finding regardless of who entered it
        if raised.status == "REPORTED":
            raised.status, raised.finding, raised.owner_id = "VERIFIED", raised.description, w.ee_id
            from .workflow import log
            log(session, raised, "verify", me, "REPORTED", "VERIFIED", "Failed test result on record.", ev.id)
        t.issue_id = raised.id
    session.commit()
    return {"ok": True, "passed": t.passed, "issue": raised.ticket if raised else None}


UPLOAD_PURPOSES = {
    "full": {"JE": {"progress", "inspection", "rectification", "test_report", "completion", "document"},
             "AE": {"progress", "inspection", "reinspection", "test_report", "completion", "document"},
             "EE": {"progress", "inspection", "reinspection", "test_report", "completion", "document"},
             "DM": {"inspection", "reinspection", "document"}, "DDC": {"inspection", "reinspection", "document"}},
    "contractor": {"CONTRACTOR": {"progress", "rectification", "completion", "document"}},
    "limited": {"CO": {"document", "progress"}, "BDO": {"document", "progress"}},
}


@app.post("/api/works/{work_id}/evidence")
async def upload_evidence(work_id: int, kind: str = Form("photo"), caption: str = Form(""),
                          stage_id: Optional[int] = Form(None), lat: Optional[float] = Form(None),
                          lng: Optional[float] = Form(None), purpose: Optional[str] = Form(None),
                          file: Optional[UploadFile] = File(None),
                          session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id, allow=("full", "contractor", "limited"))
    lvl = access.level(session, me, w)
    if kind not in {"photo", "test_report", "document"}:
        raise HTTPException(400, "Unknown evidence kind")
    purpose = purpose or ("test_report" if kind == "test_report" else "progress")
    if purpose not in UPLOAD_PURPOSES.get(lvl, {}).get(me.role, set()):
        raise HTTPException(403, f"Your role cannot file evidence as '{purpose}' on this work")
    if lat is not None and (not -90 <= lat <= 90 or lng is None or not -180 <= lng <= 180):
        raise HTTPException(400, "Invalid coordinates")
    data = await file.read(config.MAX_DOC_BYTES + 1) if file else None
    if not data:
        raise HTTPException(400, "Attach a photo or document")
    ev = save_evidence(session, w, upload=data, filename=file.filename if file else "", kind=kind, caption=caption,
                       stage_id=stage_id, lat=lat, lng=lng, uploaded_by=me.id, source="officer", purpose=purpose,
                       allowed=("image", "doc") if purpose in {"test_report", "document"} else ("image",))
    session.commit()
    return evidence_dict(ev)


class IssueIn(BaseModel):
    category: str
    title: str
    description: str = ""
    stage_id: Optional[int] = None
    reason_code: Optional[str] = None
    evidence_id: Optional[int] = None
    owner_id: Optional[int] = None
    due_date: Optional[date] = None


@app.post("/api/works/{work_id}/issues")
def raise_issue(work_id: int, body: IssueIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id, allow=("full", "limited"))
    src = "inspection" if me.role in {"AE", "EE"} and body.evidence_id else "officer"
    i = create_issue(session, work=w, actor=me, source=src, category=body.category, title=body.title,
                     description=body.description, stage_id=body.stage_id, reason_code=body.reason_code,
                     evidence_id=body.evidence_id, owner_id=body.owner_id, due_date=body.due_date)
    session.commit()
    return issue_dict(session, i, me)


class ActionIn(BaseModel):
    action: str
    note: str = PField("", max_length=2000)
    evidence_id: Optional[int] = None
    owner_id: Optional[int] = None
    due_date: Optional[date] = None
    expected_status: Optional[str] = None  # the status the officer saw; a stale screen gets a 409 instead of a double step


@app.post("/api/issues/{issue_id}/actions")
def issue_action(issue_id: int, body: ActionIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    i = session.get(Issue, issue_id)
    if i is None:
        raise HTTPException(404, "Issue not found")
    w = get_work(session, i.work_id)
    lvl = access.level(session, me, w)
    events = session.exec(select(IssueEvent).where(IssueEvent.issue_id == i.id)).all()
    escalated = (lambda e: e["escalated_to"] is not None and e["escalated_to"].id == me.id)(escalation(session, i, w))
    if not escalated and (lvl is None or not access.issue_visible(me, lvl, i, events)):
        raise HTTPException(403, "This issue is not one of your responsibilities")
    transition(session, i, body.action, me, note=body.note, evidence_id=body.evidence_id,
               owner_id=body.owner_id, due_date=body.due_date, expected_status=body.expected_status)
    session.commit()
    return issue_dict(session, i, me, show_person=access.sees_complainant(me, lvl or ""))


@app.get("/api/issues")
def list_issues(mine: bool = False, open_only: bool = True, session: Session = Depends(get_session),
                viewer: Officer = Depends(require_officer)):
    q = select(Issue).order_by(Issue.due_date)
    works = {w.id: w for w in session.exec(select(Work)).all()}
    levels = {wid: access.level(session, viewer, w) for wid, w in works.items()}
    rows = [i for i in session.exec(q).all() if levels[i.work_id] and access.issue_visible(
        viewer, levels[i.work_id], i, session.exec(select(IssueEvent).where(IssueEvent.issue_id == i.id)).all())]
    if open_only:
        rows = [i for i in rows if i.status not in TERMINAL]
    if mine and viewer:  # owned by me, or escalated to me
        rows = [i for i in rows if i.owner_id == viewer.id or
                (lambda e: e["escalated_to"] is not None and e["escalated_to"].id == viewer.id)(escalation(session, i, session.get(Work, i.work_id)))]
    return [{**issue_dict(session, i, viewer, show_person=access.sees_complainant(viewer, levels[i.work_id])), "work": {"id": i.work_id, "code": works[i.work_id].code, "name": works[i.work_id].name}}
            for i in rows]


def blocked(message: str, items):
    raise HTTPException(409, {"message": message, "blockers": items})


@app.post("/api/works/{work_id}/claim-complete")
def claim_complete(work_id: int, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id)
    if me.role != "JE" or w.je_id != me.id:
        raise HTTPException(403, "Completion is claimed by the JE of this work")
    b = certification.claim_blockers(session, w)
    if b:
        blocked("Cannot claim completion yet", b)
    w.status, w.completion_claimed_on = "REPORTED_COMPLETE", date.today()
    audit.record(session, work_id=w.id, entity="work", entity_id=w.id, action="claim_complete", actor=me,
                 before={"status": "IN_PROGRESS"}, after={"status": w.status})
    session.commit()
    return {"ok": True}


class ReasonIn(BaseModel):
    reason: str = PField("", max_length=2000)


@app.post("/api/works/{work_id}/return-claim")
def return_claim(work_id: int, body: ReasonIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    """AE/EE send a completion claim back to the JE, with the reason on record."""
    w = work_for(session, me, work_id)
    if me.role not in TECHNICAL:
        raise HTTPException(403, "Only the AE or EE can return a completion claim")
    if w.status != "REPORTED_COMPLETE":
        raise HTTPException(409, "There is no pending completion claim")
    if len(body.reason.strip()) < 10:
        raise HTTPException(400, "Write why the claim is being returned")
    w.status, w.completion_claimed_on = "IN_PROGRESS", None
    audit.record(session, work_id=w.id, entity="work", entity_id=w.id, action="return_claim", actor=me,
                 before={"status": "REPORTED_COMPLETE"}, after={"status": "IN_PROGRESS"}, reason=body.reason.strip())
    session.commit()
    return {"ok": True}


class CheckIn(BaseModel):
    passed: bool
    evidence_id: Optional[int] = None
    note: str = PField("", max_length=1000)


@app.post("/api/works/{work_id}/checklist/{item_id}")
def check_item(work_id: int, item_id: int, body: CheckIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id)
    if me.role not in TECHNICAL:
        raise HTTPException(403, "Usability is checked by AE/EE")
    c = session.get(UsabilityItem, item_id)
    if c is None or c.work_id != work_id:
        raise HTTPException(404, "Checklist item not found")
    if w.status not in ("REPORTED_COMPLETE", "USABLE_VERIFIED") and body.passed:
        raise HTTPException(409, "Usability is checked after the JE claims the work complete")
    ev = None
    if body.passed:
        ev = evidence_rules.require(session, body.evidence_id, w, purposes=certification.CHECKLIST_PURPOSES,
                                    actor=me, by_actor=True, roles=TECHNICAL, what="a usability check")
    elif not body.note.strip() and body.evidence_id is None:
        raise HTTPException(400, "Say what failed")
    before = {"passed": c.passed, "evidence_id": c.evidence_id, "verified_by": c.verified_by}
    c.passed, c.evidence_id, c.verified_by, c.verified_on = body.passed, ev.id if ev else None, me.id, date.today()
    audit.record(session, work_id=w.id, entity="checklist", entity_id=c.id, action="check", actor=me, before=before,
                 after={"passed": c.passed, "evidence_id": c.evidence_id}, reason=body.note.strip(), evidence_id=c.evidence_id)
    session.commit()
    session.refresh(c)
    return c.model_dump(mode="json")


@app.get("/api/works/{work_id}/certification")
def certification_status(work_id: int, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id, allow=("full", "contractor"))
    return certification.readiness(session, w, me)


@app.post("/api/works/{work_id}/certify")
def certify(work_id: int, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id)
    if me.role != "EE":
        raise HTTPException(403, "Only the EE certifies a work as usable")
    b = certification.blockers(session, w, actor=me)
    if b:
        blocked("Cannot certify yet", b)
    w.status = "USABLE_VERIFIED"
    certify_dates(session, w, date.today())
    audit.record(session, work_id=w.id, entity="work", entity_id=w.id, action="certify", actor=me,
                 before={"status": "REPORTED_COMPLETE"}, after={"status": w.status, "dlp_end": w.dlp_end},
                 reason="All certification conditions met")
    session.commit()
    return {"ok": True}


def certify_dates(session, w: Work, on: date):
    """Defect liability period of 5 years, and a re-check after the first monsoon that follows."""
    w.certified_on = on
    w.dlp_end = date(on.year + 5, on.month, min(on.day, 28))
    year = on.year if on < date(on.year, 6, 15) else on.year + 1
    session.add(PostCheck(work_id=w.id, due_date=date(year, 10, 31)))


class ExtensionIn(BaseModel):
    new_end: date
    reason_code: str
    note: str = ""


@app.post("/api/works/{work_id}/extensions")
def grant_extension(work_id: int, body: ExtensionIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id)
    if me.role != "EE":
        raise HTTPException(403, "Time extensions are approved by the EE")
    if body.reason_code not in DELAY_REASONS:
        raise HTTPException(400, "Choose the reason for the extension")
    if body.new_end <= due_date(w):
        raise HTTPException(400, "The new date must be after the current due date")
    if not body.note.strip():
        raise HTTPException(400, "Write why the extension is justified")
    session.add(TimeExtension(work_id=w.id, old_end=due_date(w), new_end=body.new_end, reason_code=body.reason_code,
                              note=body.note.strip(), approved_by=me.id, approved_on=date.today()))
    audit.record(session, work_id=w.id, entity="work", entity_id=w.id, action="time_extension", actor=me,
                 before={"due": due_date(w)}, after={"due": body.new_end}, reason=body.note.strip())
    w.revised_end = body.new_end
    session.commit()
    return {"ok": True}


class CheckResultIn(BaseModel):
    passed: bool
    note: str = ""
    evidence_id: Optional[int] = None


def _evidence_ok(session, work_id, evidence_id, me=None):
    return evidence_rules.require(session, evidence_id, get_work(session, work_id), purposes={"inspection", "reinspection"},
                                  actor=me, by_actor=me is not None, roles=TECHNICAL | access.DISTRICT, what="an inspection")


@app.post("/api/postchecks/{pc_id}")
def record_postcheck(pc_id: int, body: CheckResultIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    pc = session.get(PostCheck, pc_id)
    if pc is None:
        raise HTTPException(404, "Check not found")
    if me.role not in {"AE", "EE"}:
        raise HTTPException(403, "Re-checks are done by the AE or EE")
    work_for(session, me, pc.work_id)
    _evidence_ok(session, pc.work_id, body.evidence_id, me)
    if not body.passed and not body.note.strip():
        raise HTTPException(400, "Describe what is wrong")
    if pc.done_on:
        raise HTTPException(409, "This re-check is already recorded")
    pc.done_on, pc.done_by, pc.passed, pc.note, pc.evidence_id = date.today(), me.id, body.passed, body.note.strip(), body.evidence_id
    if not body.passed:
        w = get_work(session, pc.work_id)
        create_issue(session, work=w, actor=me, source="inspection", category="quality",
                     title=f"Post-monsoon re-check: {body.note.strip()[:60]}", description=body.note.strip() +
                     (f" Repair is the contractor's duty under the defect liability period (until {w.dlp_end:%d %b %Y})." if w.dlp_end else ""),
                     evidence_id=body.evidence_id)
    session.commit()
    return {"ok": True}


class InspectionIn(BaseModel):
    outcome: str  # ok, issues
    note: str = ""
    evidence_id: Optional[int] = None


@app.post("/api/works/{work_id}/inspection")
def record_inspection(work_id: int, body: InspectionIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id)
    if me.role not in {"AE", "EE"}:
        raise HTTPException(403, "Surprise inspections are done by the AE or EE")
    if body.outcome not in {"ok", "issues"}:
        raise HTTPException(400, "Choose what you found")
    _evidence_ok(session, w.id, body.evidence_id, me)
    if body.outcome == "issues" and not body.note.strip():
        raise HTTPException(400, "Describe what you found")
    if session.exec(select(Inspection).where(Inspection.work_id == w.id, Inspection.week == iso_week(date.today()))).first():
        raise HTTPException(409, "This week's inspection of this work is already recorded")
    session.add(Inspection(work_id=w.id, week=iso_week(date.today()), done_on=date.today(), done_by=me.id,
                           outcome=body.outcome, note=body.note.strip(), evidence_id=body.evidence_id))
    if body.outcome == "issues":
        create_issue(session, work=w, actor=me, source="inspection", category="quality",
                     title=f"Surprise inspection: {body.note.strip()[:60]}", description=body.note.strip(), evidence_id=body.evidence_id)
    session.commit()
    return {"ok": True}


# ---------- bills: submitted -> checked -> authorised -> payment recorded ----------

class BillIn(BaseModel):
    amount_lakh: float = PField(gt=0)
    mb_ids: list[int]


def bill_for(session, bill_id) -> Bill:
    b = session.get(Bill, bill_id)
    if b is None:
        raise HTTPException(404, "Bill not found")
    return b


@app.post("/api/works/{work_id}/bills")
def submit_bill(work_id: int, body: BillIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    w = work_for(session, me, work_id, allow=("contractor", "full"))
    if me.role not in {"CONTRACTOR", "JE"}:
        raise HTTPException(403, "Bills are submitted by the contractor (or the JE on their behalf)")
    if not body.mb_ids:
        raise HTTPException(400, "A bill must cite the measurement-book entries it pays for")
    mbs = [session.get(Measurement, i) for i in body.mb_ids]
    if any(m is None or m.work_id != w.id for m in mbs):
        raise HTTPException(400, "Every measurement entry must belong to this work")
    billed = set()
    for b in session.exec(select(Bill).where(Bill.work_id == w.id)).all():
        billed |= set(json.loads(b.mb_ids))
    if billed & set(body.mb_ids):
        raise HTTPException(409, "Some of these measurement entries are already billed")
    total = sum(x.amount_lakh for x in session.exec(select(Bill).where(Bill.work_id == w.id)).all())
    if total + body.amount_lakh > w.sanctioned_lakh * 1.0 + 1e-6:
        raise HTTPException(400, "Bills would exceed the sanctioned amount; a revised sanction is needed first")
    no = (max((x.bill_no for x in session.exec(select(Bill).where(Bill.work_id == w.id)).all()), default=0)) + 1
    b = Bill(work_id=w.id, bill_no=no, bill_date=date.today(), amount_lakh=round(body.amount_lakh, 2),
             mb_ids=json.dumps(sorted(set(body.mb_ids))), status="SUBMITTED", submitted_by=me.id)
    session.add(b)
    session.flush()
    audit.record(session, work_id=w.id, entity="bill", entity_id=b.id, action="submit", actor=me,
                 after={"amount_lakh": b.amount_lakh, "mb_ids": body.mb_ids})
    session.commit()
    session.refresh(b)
    return b.model_dump(mode="json")


@app.post("/api/bills/{bill_id}/check")
def check_bill(bill_id: int, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    b = bill_for(session, bill_id)
    w = work_for(session, me, b.work_id)
    if me.role != "AE":
        raise HTTPException(403, "Bills are checked by the AE")
    if b.status != "SUBMITTED":
        raise HTTPException(409, f"Bill is already {b.status}")
    unchecked = [m for m in (session.get(Measurement, i) for i in json.loads(b.mb_ids)) if m.checked_by is None]
    if unchecked:
        raise HTTPException(409, f"Check-measure the {len(unchecked)} measurement entr{'y' if len(unchecked) == 1 else 'ies'} this bill pays for first")
    b.status, b.checked_by, b.checked_on = "CHECKED", me.id, date.today()
    audit.record(session, work_id=w.id, entity="bill", entity_id=b.id, action="check", actor=me, before={"status": "SUBMITTED"}, after={"status": b.status})
    session.commit()
    session.refresh(b)
    return b.model_dump(mode="json")


@app.post("/api/bills/{bill_id}/authorize")
def authorize_bill(bill_id: int, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    b = bill_for(session, bill_id)
    w = work_for(session, me, b.work_id)
    if me.role != "EE" or w.ee_id != me.id:
        raise HTTPException(403, "Payment is authorised by the EE of this work")
    if b.status != "CHECKED":
        raise HTTPException(409, "Only a bill checked by the AE can be authorised" if b.status == "SUBMITTED" else f"Bill is already {b.status}")
    b.status, b.authorized_by, b.authorized_on = "AUTHORIZED", me.id, date.today()
    audit.record(session, work_id=w.id, entity="bill", entity_id=b.id, action="authorize", actor=me, before={"status": "CHECKED"}, after={"status": b.status})
    session.commit()
    session.refresh(b)
    return b.model_dump(mode="json")


class PaymentIn(BaseModel):
    paid_lakh: float = PField(gt=0)
    payment_ref: str = PField(min_length=4, max_length=80)
    paid_on: Optional[date] = None


@app.post("/api/bills/{bill_id}/payment")
def record_payment(bill_id: int, body: PaymentIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    """Records that money was disbursed, from a manual entry of the treasury/PFMS reference.
    It is labelled 'manual entry': this prototype has no bank or PFMS feed to verify it."""
    b = bill_for(session, bill_id)
    w = work_for(session, me, b.work_id)
    if me.role not in {"EE", "DDC"}:
        raise HTTPException(403, "Payments are recorded by the EE (drawing officer) or the DDC")
    if b.status != "AUTHORIZED":
        raise HTTPException(409, "Only an authorised bill can be recorded as paid" if b.status in ("SUBMITTED", "CHECKED") else "Payment already recorded")
    if body.paid_lakh > b.amount_lakh + 1e-6:
        raise HTTPException(400, "Payment cannot exceed the bill amount")
    if body.paid_on and body.paid_on > date.today():
        raise HTTPException(400, "Payment date cannot be in the future")
    b.status, b.paid_lakh, b.payment_ref = "PAID", round(body.paid_lakh, 2), body.payment_ref.strip()
    b.paid_on, b.payment_source, b.recorded_by = body.paid_on or date.today(), "manual_entry", me.id
    audit.record(session, work_id=w.id, entity="bill", entity_id=b.id, action="record_payment", actor=me,
                 before={"status": "AUTHORIZED"}, after={"status": "PAID", "paid_lakh": b.paid_lakh, "ref": b.payment_ref, "source": "manual_entry"})
    session.flush()
    refresh_report(session, w, me)
    session.commit()
    session.refresh(b)
    return b.model_dump(mode="json")


# ---------- approved scope revisions ----------

class RevisionIn(BaseModel):
    stage_id: int
    new_qty: float = PField(gt=0)
    reason: str = PField(min_length=10, max_length=2000)
    order_ref: str = PField(min_length=3, max_length=80)


@app.post("/api/works/{work_id}/revisions")
def revise_scope(work_id: int, body: RevisionIn, session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    """The only way a sanctioned quantity can change. The original stays on record; who, why and the order are kept."""
    w = work_for(session, me, work_id)
    if me.role != "EE" or w.ee_id != me.id:
        raise HTTPException(403, "Scope revisions are approved by the EE of this work")
    st = session.get(Stage, body.stage_id)
    if st is None or st.work_id != w.id:
        raise HTTPException(400, "Stage does not belong to this work")
    if w.status == "USABLE_VERIFIED":
        raise HTTPException(409, "The work is already certified")
    if body.new_qty + 1e-6 < st.qty_executed:
        raise HTTPException(400, f"{st.qty_executed:g} {st.unit} is already measured; the revised quantity cannot be lower")
    if abs(body.new_qty - st.qty_sanctioned) < 1e-9:
        raise HTTPException(400, "The new quantity is the same as the current one")
    if st.qty_original is None:
        st.qty_original = st.qty_sanctioned
    rev = ScopeRevision(work_id=w.id, stage_id=st.id, old_qty=st.qty_sanctioned, new_qty=body.new_qty,
                        reason=body.reason.strip(), order_ref=body.order_ref.strip(), approved_by=me.id, approved_on=date.today())
    session.add(rev)
    audit.record(session, work_id=w.id, entity="stage", entity_id=st.id, action="scope_revision", actor=me,
                 before={"qty_sanctioned": st.qty_sanctioned}, after={"qty_sanctioned": body.new_qty, "order_ref": rev.order_ref},
                 reason=rev.reason)
    st.qty_sanctioned = body.new_qty
    st.progress = round(min(100.0, st.qty_executed / st.qty_sanctioned * 100), 1)
    st.completed_on = st.completed_on if st.progress >= 100 else None
    session.commit()
    return {"ok": True}


@app.get("/api/tasks")
def my_tasks(session: Session = Depends(get_session), me: Officer = Depends(require_officer)):
    return tasks_for(session, me, date.today())


@app.get("/api/works/{work_id}/qr.png")
def work_qr(work_id: int, base: str = "http://localhost:5173", session: Session = Depends(get_session)):
    w = get_work(session, work_id)
    img = qrcode.make(f"{base}/w/{w.qr_token}")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png")


# ---------- public ----------

def public_work(session, w: Work):
    stages = session.exec(select(Stage).where(Stage.work_id == w.id).order_by(Stage.seq)).all()
    issues = session.exec(select(Issue).where(Issue.work_id == w.id, Issue.source == "citizen").order_by(Issue.created_at.desc())).all()
    actual = actual_progress(stages)
    return {
        "qr_token": w.qr_token, "code": w.code, "name": w.name, "work_type": w.work_type, "department": w.department,
        "scheme": w.scheme, "block": w.block, "village": w.village, "lat": w.lat, "lng": w.lng,
        "status": w.status, "sanctioned_lakh": w.sanctioned_lakh, "start_date": w.start_date.isoformat(),
        "planned_end": w.planned_end.isoformat(), "progress": actual,
        "check_measured": check_measured_progress(stages, session.exec(select(Measurement).where(Measurement.work_id == w.id)).all()),
        "revised_end": w.revised_end.isoformat() if w.revised_end else None, "due_date": due_date(w).isoformat(),
        "certified_on": w.certified_on.isoformat() if w.certified_on else None, "dlp_end": w.dlp_end.isoformat() if w.dlp_end else None,
        "votes": {"yes": sum(1 for v in session.exec(select(UsabilityVote).where(UsabilityVote.work_id == w.id)).all() if v.usable),
                  "no": sum(1 for v in session.exec(select(UsabilityVote).where(UsabilityVote.work_id == w.id)).all() if not v.usable)},
        "stages": [{"name": s.name, "progress": s.progress} for s in stages],
        "reports": [issue_dict(session, i, public=True) for i in issues],
    }


@app.get("/api/public/works")
def public_works(session: Session = Depends(get_session)):
    return [{"qr_token": w.qr_token, "code": w.code, "name": w.name, "block": w.block, "village": w.village,
             "work_type": w.work_type, "status": w.status, "lat": w.lat, "lng": w.lng}
            for w in session.exec(select(Work).order_by(Work.block, Work.name)).all()]


@app.get("/api/public/works/{qr}")
def public_work_view(qr: str, session: Session = Depends(get_session)):
    w = session.exec(select(Work).where(Work.qr_token == qr)).first()
    if w is None:
        raise HTTPException(404, "Work not found")
    return public_work(session, w)


@app.post("/api/public/works/{qr}/reports")
async def public_report(qr: str, request: Request, category: str = Form(...), description: str = Form("", max_length=3000),
                        name: Optional[str] = Form(None, max_length=100), phone: Optional[str] = Form(None, max_length=20),
                        lat: Optional[float] = Form(None), lng: Optional[float] = Form(None),
                        file: Optional[UploadFile] = File(None), voice: Optional[UploadFile] = File(None),
                        session: Session = Depends(get_session)):
    w = session.exec(select(Work).where(Work.qr_token == qr)).first()
    if w is None:
        raise HTTPException(404, "Work not found")
    if category not in {"quality", "usability", "delay", "safety"}:
        raise HTTPException(400, "Unknown category")
    rate_limit(request, "report")
    phone = valid_phone(phone)
    voice_data = await voice.read(config.MAX_AUDIO_BYTES + 1) if voice is not None else None
    if len(description.strip()) < 5 and not voice_data:
        raise HTTPException(400, "Please describe the problem, or record a voice note")
    ev_ids = []
    if file is not None:
        data = await file.read(config.MAX_IMAGE_BYTES + 1)
        if data:
            ev_ids.append(save_evidence(session, w, upload=data, filename=file.filename, kind="photo", caption="Resident photo",
                                        stage_id=None, lat=lat, lng=lng, uploaded_by=None, source="citizen").id)
    if voice_data:
        ev = save_evidence(session, w, upload=voice_data, filename=voice.filename or "voice.webm", kind="voice",
                           caption="Resident voice note", stage_id=None, lat=None, lng=None, uploaded_by=None, source="citizen",
                           allowed=("audio",))
        ev.phash = None
        ev_ids.append(ev.id)
    text = description.strip()
    title = text.split("\n")[0][:80] if text else "Voice report (listen to the recording)"
    i = create_issue(session, work=w, actor=None, source="citizen", category="usability" if category == "delay" else category,
                     title=title, description=text, evidence_id=ev_ids[0] if ev_ids else None,
                     complainant_name=name, complainant_phone=phone or None)
    for extra in ev_ids[1:]:
        session.get(Evidence, extra).issue_id = i.id
    notify_status(session, i)
    session.commit()
    sms = session.exec(select(Notification).where(Notification.ticket == i.ticket)).all()
    return {"ticket": i.ticket, "track_key": i.track_key, "status_label": STATUS_LABEL[i.status],
            "sms": [{"to": mask(n.phone), "text": n.text, "text_hi": n.text_hi} for n in sms]}


class SupportIn(BaseModel):
    phone: Optional[str] = PField(None, max_length=20)


@app.post("/api/public/issues/{ticket}/support")
def support_report(ticket: str, body: SupportIn, request: Request, session: Session = Depends(get_session)):
    """'Same problem': adds the resident's voice to an existing report instead of opening a duplicate.
    One per phone number (or per device when no number is given)."""
    i = session.exec(select(Issue).where(Issue.ticket == ticket.upper().strip())).first()
    if i is None or i.source != "citizen" or i.status in TERMINAL:
        raise HTTPException(404, "Open report not found")
    rate_limit(request, "support")
    phone = valid_phone(body.phone)
    voter = voter_id(request, phone)
    if session.exec(select(SupportRecord).where(SupportRecord.issue_id == i.id, SupportRecord.voter == voter)).first():
        raise HTTPException(409, "You have already added your voice to this report")
    session.add(SupportRecord(issue_id=i.id, voter=voter, at=now()))
    i.supporters += 1
    body.phone = phone
    sms = []
    if body.phone:
        en = f"You have been added to report {i.ticket}. You will get an SMS at every step."
        hn = f"आपको शिकायत {i.ticket} से जोड़ दिया गया है। हर कदम पर SMS मिलेगा।"
        send_sms(session, i.ticket, body.phone, en, hn)
        sms = [{"to": mask(body.phone), "text": "Kaarya Nigrani: " + en, "text_hi": "कार्य निगरानी: " + hn}]
    session.commit()
    return {"ticket": i.ticket, "supporters": i.supporters, "sms": sms}


class VoteIn(BaseModel):
    usable: bool
    phone: Optional[str] = PField(None, max_length=20)


@app.post("/api/public/works/{qr}/usable")
def usable_vote(qr: str, body: VoteIn, request: Request, session: Session = Depends(get_session)):
    """One opinion per resident per work; voting again replaces the earlier answer."""
    w = session.exec(select(Work).where(Work.qr_token == qr)).first()
    if w is None:
        raise HTTPException(404, "Work not found")
    rate_limit(request, "vote")
    voter = voter_id(request, valid_phone(body.phone))
    v = session.exec(select(UsabilityVote).where(UsabilityVote.work_id == w.id, UsabilityVote.voter == voter)).first()
    changed = v is not None
    if v is None:
        v = UsabilityVote(work_id=w.id, usable=body.usable, at=now(), voter=voter)
    v.usable, v.at = body.usable, now()
    session.add(v)
    session.commit()
    return {"ok": True, "updated": changed}


def tracked_issue(session, ticket: str, key: Optional[str]) -> Issue:
    i = session.exec(select(Issue).where(Issue.ticket == ticket.upper().strip())).first()
    # same answer for "no such ticket" and "wrong key", so tickets cannot be probed
    if i is None or i.source != "citizen" or not key or not i.track_key or not hmac_eq(i.track_key, key.strip()):
        raise HTTPException(404, "Ticket not found. Check the ticket number and the tracking code from your SMS.")
    return i


def hmac_eq(a: str, b: str) -> bool:
    import hmac as _h
    return _h.compare_digest(a.encode(), b.encode())


class AppealIn(BaseModel):
    key: str = PField(max_length=40)
    reason: str = PField(max_length=1000)


@app.post("/api/public/track/{ticket}/appeal")
def public_appeal(ticket: str, body: AppealIn, request: Request, session: Session = Depends(get_session)):
    rate_limit(request, "appeal")
    i = tracked_issue(session, ticket, body.key)
    appeal(session, i, body.reason)
    session.commit()
    return {"ok": True, "status_label": STATUS_LABEL[i.status]}


@app.get("/api/public/track/{ticket}")
def public_track(ticket: str, request: Request, key: Optional[str] = None, session: Session = Depends(get_session)):
    rate_limit(request, "track")
    i = tracked_issue(session, ticket, key)
    w = session.get(Work, i.work_id)
    sms = session.exec(select(Notification).where(Notification.ticket == i.ticket).order_by(Notification.sent_at)).all()
    return {"issue": issue_dict(session, i, public=True), "work": {"name": w.name, "qr_token": w.qr_token, "block": w.block},
            "sms": [{"to": mask(n.phone), "text": n.text, "text_hi": n.text_hi, "at": n.sent_at.isoformat()} for n in sms]}


# ---------- demo ----------

@app.post("/api/demo/reset")
def demo_reset():
    if not config.DEMO:
        raise HTTPException(403, "Reset is disabled outside the synthetic demo")
    from .seed import seed
    seed(reset=True)
    return {"ok": True}


DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        if path.startswith("api/") or path.startswith("media/"):
            raise HTTPException(404, "Not found")
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST.resolve() in f.parents:  # never serve files outside the built app
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
