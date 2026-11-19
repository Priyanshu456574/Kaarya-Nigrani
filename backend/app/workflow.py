"""Issue lifecycle: the single place where status changes are allowed and recorded."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

import secrets

from . import config
from . import evidence as evidence_rules
from .models import Evidence, Issue, IssueEvent, Notification, Officer, Work

OPEN_VERIFIED = {"VERIFIED", "ACTION_ASSIGNED", "RECTIFIED"}
OPEN_UNVERIFIED = {"REPORTED", "ACKNOWLEDGED", "UNDER_EXAMINATION", "APPEALED"}
TERMINAL = {"CLOSED", "NOT_SUBSTANTIATED"}

STATUS_LABEL = {
    "REPORTED": "Reported (not yet verified)",
    "ACKNOWLEDGED": "Acknowledged",
    "UNDER_EXAMINATION": "Under technical examination",
    "VERIFIED": "Verified defect",
    "NOT_SUBSTANTIATED": "Examined: not substantiated",
    "ACTION_ASSIGNED": "Action assigned",
    "RECTIFIED": "Repair submitted, awaiting independent re-inspection",
    "CLOSED": "Closed after independent re-inspection",
    "APPEALED": "Reopened on the resident's appeal",
}

DELAY_REASONS = {
    "LAND": "Land / encroachment",
    "UTILITY": "Utility shifting",
    "FUNDS": "Fund release pending",
    "CONTRACTOR": "Contractor capacity",
    "DESIGN_CHANGE": "Design change / revised estimate",
    "FLOOD_SEASON": "Flood / monsoon",
    "MATERIAL": "Material shortage",
    "OTHER": "Other",
}

ENGINEERS = {"JE", "AE", "EE"}
TECHNICAL = {"AE", "EE"}


class WorkflowError(Exception):
    def __init__(self, message: str, code: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass
class Rule:
    from_status: set
    to_status: str
    roles: set
    needs_evidence: bool = False
    needs_note: bool = False
    needs_owner: bool = False


RULES = {
    "acknowledge": Rule({"REPORTED"}, "ACKNOWLEDGED", ENGINEERS),
    "examine": Rule({"ACKNOWLEDGED", "APPEALED"}, "UNDER_EXAMINATION", ENGINEERS),
    "verify": Rule({"UNDER_EXAMINATION"}, "VERIFIED", TECHNICAL, needs_evidence=True, needs_note=True),
    "reject": Rule({"UNDER_EXAMINATION"}, "NOT_SUBSTANTIATED", TECHNICAL, needs_evidence=True, needs_note=True),
    "assign": Rule({"VERIFIED"}, "ACTION_ASSIGNED", TECHNICAL | {"DM", "DDC"}, needs_owner=True),
    "rectified": Rule({"ACTION_ASSIGNED"}, "RECTIFIED", {"JE", "CONTRACTOR", "CO", "BDO"}, needs_evidence=True),
    "close": Rule({"RECTIFIED"}, "CLOSED", TECHNICAL, needs_evidence=True),
    "reopen": Rule({"RECTIFIED"}, "ACTION_ASSIGNED", TECHNICAL, needs_evidence=True, needs_note=True),  # re-inspection failed: rework
    # DM/DDC record a decision on an overdue or escalated matter: new instruction, deadline and (optionally) owner
    "direct": Rule({"ACTION_ASSIGNED"}, "ACTION_ASSIGNED", {"DM", "DDC"}, needs_note=True),
}

# what each step's evidence may be filed as
EVIDENCE_PURPOSES = {
    "verify": {"inspection", "test_report", "reinspection"},
    "reject": {"inspection", "reinspection"},
    "rectified": {"rectification", "progress", "completion", "document"},
    "close": {"reinspection", "inspection"},
    "reopen": {"reinspection", "inspection"},
}


def available_actions(issue: Issue, officer: Optional[Officer]) -> list[str]:
    if officer is None:
        return []
    out = []
    for name, r in RULES.items():
        if issue.status not in r.from_status:
            continue
        if name == "rectified":
            # owner can always report rectification; JE/contractor of the work too
            if officer.id != issue.owner_id and officer.role not in {"JE", "CONTRACTOR"}:
                continue
        elif officer.role not in r.roles:
            continue
        if name in ("close", "reopen") and officer.id == issue.rectified_by:
            continue  # nobody re-inspects their own repair
        if issue.appeals and officer.id == issue.decided_by and name in ("examine", "verify", "reject"):
            continue  # an appeal is examined by someone other than the officer who decided it
        out.append(name)
    return out


def now() -> datetime:
    return datetime.now().replace(microsecond=0)


def log(session: Session, issue: Issue, action: str, actor: Optional[Officer], frm, to, note="", evidence_id=None, at=None):
    session.add(IssueEvent(
        issue_id=issue.id, at=at or now(), actor_id=actor.id if actor else None,
        actor_label=f"{actor.role} {actor.name}" if actor else "Resident",
        action=action, from_status=frm, to_status=to, note=note, evidence_id=evidence_id,
    ))


def last_event(session: Session, issue: Issue, action: str) -> Optional[IssueEvent]:
    return session.exec(select(IssueEvent).where(IssueEvent.issue_id == issue.id, IssueEvent.action == action)
                        .order_by(IssueEvent.at.desc(), IssueEvent.id.desc())).first()


def transition(session: Session, issue: Issue, action: str, actor: Officer, *, note: str = "",
               evidence_id: Optional[int] = None, owner_id: Optional[int] = None,
               due_date: Optional[date] = None, at: Optional[datetime] = None,
               expected_status: Optional[str] = None) -> Issue:
    rule = RULES.get(action)
    if rule is None:
        raise WorkflowError(f"Unknown action '{action}'")
    if expected_status is not None and issue.status != expected_status:
        raise WorkflowError(f"This issue changed to '{STATUS_LABEL.get(issue.status, issue.status)}' since you opened it; refresh and try again", 409)
    if action not in available_actions(issue, actor):
        if issue.status not in rule.from_status:
            raise WorkflowError(f"Cannot '{action}' an issue that is {issue.status}", 409)
        if action in ("close", "reopen") and actor.id == issue.rectified_by:
            raise WorkflowError("The person who reported the repair cannot re-inspect it", 403)
        raise WorkflowError(f"{actor.role} is not permitted to '{action}' this issue", 403)
    if rule.needs_note and not note.strip():
        raise WorkflowError("A written note/finding is required for this step")
    work = session.get(Work, issue.work_id)
    if rule.needs_evidence:
        kw = dict(purposes=EVIDENCE_PURPOSES[action], actor=actor, what=f"'{action}'")
        if action in ("verify", "reject"):
            kw.update(roles=ENGINEERS)
        if action in ("close", "reopen"):
            rect = last_event(session, issue, "rectified")
            rect_ev = session.get(Evidence, rect.evidence_id) if rect and rect.evidence_id else None
            if rect_ev is not None and rect_ev.uploaded_by == actor.id:
                raise WorkflowError("You supplied the repair evidence, so another officer must re-inspect it", 403)
            kw.update(by_actor=True, roles=TECHNICAL, not_ids=[rect_ev.id] if rect_ev else [], not_like=[rect_ev],
                      after=rect.at if rect else None, what="the re-inspection after repair")
        if action == "rectified" and actor.role == "CONTRACTOR":
            kw.update(by_actor=True)
        ev = evidence_rules.require(session, evidence_id, work, **kw)
        ev.issue_id = issue.id

    if action == "acknowledge":
        issue.owner_id = owner_id or work.ae_id
        issue.due_date = due_date or (date.today() + timedelta(days=7))
    elif action == "examine":
        issue.owner_id = actor.id if actor.role in TECHNICAL else (issue.owner_id or work.ae_id)
    elif action == "verify":
        issue.finding = note
        issue.owner_id = work.ee_id
        issue.due_date = date.today() + timedelta(days=3)
    elif action == "reject":
        issue.finding = note
        issue.owner_id = None
        issue.due_date = None
        issue.decided_by, issue.closed_at = actor.id, at or now()
    elif action in ("assign", "reopen"):
        if action == "assign":
            if owner_id is None or due_date is None:
                raise WorkflowError("Assigning action needs an owner and a due date")
            owner = session.get(Officer, owner_id)
            if owner is None:
                raise WorkflowError("Unknown owner")
            if owner.role == "CONTRACTOR" and owner.id != work.contractor_id:
                raise WorkflowError("Repairs can only be assigned to this work's own contractor")
            if (at.date() if at else date.today()) > due_date:
                raise WorkflowError("The due date cannot be in the past")
            issue.owner_id, issue.due_date = owner_id, due_date
        else:
            # rework goes back to whoever submitted the repair
            fixer = last_event(session, issue, "rectified")
            issue.owner_id = fixer.actor_id if fixer and fixer.actor_id else (work.contractor_id or work.je_id)
            issue.due_date = due_date or (date.today() + timedelta(days=10))
        issue.rectified_by = None
    elif action == "direct":
        if due_date is None or due_date <= (at.date() if at else date.today()):
            raise WorkflowError("Give the new deadline (a future date)")
        if owner_id is not None:
            owner = session.get(Officer, owner_id)
            if owner is None:
                raise WorkflowError("Unknown owner")
            issue.owner_id = owner_id
        issue.due_date = due_date
    elif action == "rectified":
        issue.rectified_by = actor.id
        issue.owner_id = work.ae_id if work.ae_id != actor.id else work.ee_id
        issue.due_date = date.today() + timedelta(days=5)
    elif action == "close":
        issue.owner_id = None
        issue.due_date = None
        issue.decided_by, issue.closed_at = actor.id, at or now()

    frm = issue.status
    issue.status = rule.to_status
    session.add(issue)
    session.flush()
    log(session, issue, action, actor, frm, issue.status, note, evidence_id, at)
    notify_status(session, issue, at)
    return issue


def appeal(session: Session, issue: Issue, reason: str, at: Optional[datetime] = None) -> Issue:
    """A resident disputes a closure or a 'not substantiated' decision. It goes back for a fresh examination
    by an officer other than the one who decided it."""
    t = at or now()
    if issue.source != "citizen":
        raise WorkflowError("Only resident reports can be appealed", 404)
    if issue.status not in TERMINAL:
        raise WorkflowError("This report is still open; an appeal is only for a closed decision", 409)
    if len(reason.strip()) < 10:
        raise WorkflowError("Tell us in a sentence what is still wrong")
    if issue.appeals >= config.MAX_APPEALS:
        raise WorkflowError("This report has already been appealed the maximum number of times; contact the district office", 409)
    if issue.closed_at and (t - issue.closed_at).days > config.APPEAL_DAYS:
        raise WorkflowError(f"Appeals must be made within {config.APPEAL_DAYS} days of the decision", 409)
    work = session.get(Work, issue.work_id)
    frm = issue.status
    issue.status, issue.appeals = "APPEALED", issue.appeals + 1
    issue.owner_id = work.ee_id
    issue.due_date = t.date() + timedelta(days=7)
    session.add(issue)
    session.flush()
    log(session, issue, "appeal", None, frm, "APPEALED", reason.strip()[:1000], None, t)
    notify_status(session, issue, t)
    return issue


def next_ticket(session: Session) -> str:
    """Reference number (not a secret). Tracking needs the private key as well."""
    year = date.today().year
    last = session.exec(select(Issue.id).order_by(Issue.id.desc())).first() or 0
    return f"KGR-{year}-{last + 1:04d}"


def create_issue(session: Session, *, work: Work, actor: Optional[Officer], source: str, category: str,
                 title: str, description: str = "", stage_id=None, reason_code=None,
                 evidence_id=None, owner_id=None, due_date=None, complainant_name=None,
                 complainant_phone=None, at: Optional[datetime] = None) -> Issue:
    if category == "delay" and reason_code not in DELAY_REASONS:
        raise WorkflowError("Delay issues need a valid reason code")
    if category not in {"quality", "usability", "delay", "safety"}:
        raise WorkflowError("Unknown category")
    if not title.strip():
        raise WorkflowError("Give the issue a short title")
    status = "REPORTED"
    finding = None
    if evidence_id is not None and actor is not None:
        evidence_rules.require(session, evidence_id, work, purposes={"inspection", "test_report", "reinspection", "progress"},
                               roles=ENGINEERS | {"CO", "BDO"}, what="this finding")
    if actor is not None and actor.role in TECHNICAL and evidence_id is not None:
        status, finding = "VERIFIED", description  # inspection finding by a technical officer
    elif actor is not None and category == "delay" and actor.role in ENGINEERS:
        status = "VERIFIED"  # hold-up stated by the responsible engineer
    issue = Issue(
        ticket=next_ticket(session), work_id=work.id, stage_id=stage_id,
        source=source, category=category, reason_code=reason_code, title=title,
        description=description, status=status, finding=finding, created_at=at or now(),
        complainant_name=complainant_name, complainant_phone=complainant_phone,
        owner_id=owner_id, due_date=due_date,
        track_key=secrets.token_urlsafe(9) if source == "citizen" else None,
    )
    if status == "VERIFIED" and owner_id is None:
        issue.owner_id = work.ee_id
        issue.due_date = (at.date() if at else date.today()) + timedelta(days=3)
    if status == "REPORTED":
        issue.owner_id = work.je_id
        issue.due_date = (at.date() if at else date.today()) + timedelta(days=3)
    session.add(issue)
    session.flush()
    if evidence_id is not None:
        ev = session.get(Evidence, evidence_id)
        if ev:
            ev.issue_id = issue.id
    log(session, issue, "create", actor, None, status, description, evidence_id, at)
    return issue


# ---------- escalation ----------
REMIND_DAYS, SUPERVISOR_DAYS = 7, 14  # overdue 1–7: owner; 8–14: supervisor; >14 days: DDC


def escalation(session: Session, issue: Issue, work: Work, today: Optional[date] = None) -> dict:
    """Who an overdue item now sits with. Computed, so it never drifts from the due date."""
    today = today or date.today()
    if issue.status in TERMINAL or not issue.due_date or issue.due_date >= today:
        return {"days": 0, "level": 0, "escalated_to": None}
    days = (today - issue.due_date).days
    owner = session.get(Officer, issue.owner_id) if issue.owner_id else None
    ddc = session.exec(select(Officer).where(Officer.role == "DDC")).first()
    if days <= REMIND_DAYS or owner is None:
        return {"days": days, "level": 1, "escalated_to": None}
    supervisor = {"JE": work.ae_id, "AE": work.ee_id, "CONTRACTOR": work.ee_id}.get(owner.role)
    if days <= SUPERVISOR_DAYS and supervisor:
        return {"days": days, "level": 2, "escalated_to": session.get(Officer, supervisor)}
    return {"days": days, "level": 3, "escalated_to": ddc}


# ---------- SMS to residents (simulated in the demo) ----------
SMS = {
    "REPORTED": ("Your report {t} on {w} is registered. The Junior Engineer will look at it within 3 days.",
                 "{w} पर आपकी शिकायत {t} दर्ज हो गई है। कनीय अभियंता 3 दिनों में देखेंगे।"),
    "ACKNOWLEDGED": ("{t}: the engineer has seen your report and will examine it on site.",
                     "{t}: अभियंता ने आपकी शिकायत देख ली है, स्थल पर जाँच होगी।"),
    "UNDER_EXAMINATION": ("{t}: technical examination has started.", "{t}: तकनीकी जाँच शुरू हो गई है।"),
    "VERIFIED": ("{t}: the engineer confirmed the problem. A repair will be assigned.",
                 "{t}: अभियंता ने समस्या सही पाई। मरम्मत का काम सौंपा जाएगा।"),
    "NOT_SUBSTANTIATED": ("{t}: on inspection the problem was not confirmed. You can see the reason on the tracking page.",
                          "{t}: जाँच में समस्या की पुष्टि नहीं हुई। कारण ट्रैकिंग पेज पर देखें।"),
    "ACTION_ASSIGNED": ("{t}: repair assigned, to be done by {d}.", "{t}: मरम्मत सौंपी गई, {d} तक पूरी होनी है।"),
    "RECTIFIED": ("{t}: repair reported done. The engineer will check it.", "{t}: मरम्मत पूरी बताई गई। अभियंता इसकी जाँच करेंगे।"),
    "CLOSED": ("{t}: repair checked and closed. Thank you for reporting.", "{t}: मरम्मत की जाँच कर मामला बंद। सूचना देने के लिए धन्यवाद।"),
    "APPEALED": ("{t}: your appeal is registered. A different officer will examine it.", "{t}: आपकी अपील दर्ज हुई। कोई दूसरा अधिकारी इसकी जाँच करेगा।"),
}


def recipients(session: Session, issue: Issue):
    phones = [issue.complainant_phone] if issue.complainant_phone else []
    for n in session.exec(select(Notification).where(Notification.ticket == issue.ticket)).all():
        if n.phone not in phones:
            phones.append(n.phone)
    return phones


def send_sms(session: Session, ticket: str, phone: str, en: str, hn: str, at: Optional[datetime] = None):
    session.add(Notification(ticket=ticket, phone=phone, text="Kaarya Nigrani: " + en, text_hi="कार्य निगरानी: " + hn, sent_at=at or now()))


def notify_status(session: Session, issue: Issue, at: Optional[datetime] = None):
    if issue.source != "citizen" or issue.status not in SMS:
        return
    work = session.get(Work, issue.work_id)
    en, hn = SMS[issue.status]
    d = issue.due_date.strftime("%d %b %Y") if issue.due_date else ""
    for phone in recipients(session, issue):
        send_sms(session, issue.ticket, phone, en.format(t=issue.ticket, w=work.name, d=d), hn.format(t=issue.ticket, w=work.name, d=d), at)


def mask(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"{digits[:2]}XXXXXX{digits[-2:]}" if len(digits) >= 6 else "XXXX"
