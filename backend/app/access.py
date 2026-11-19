"""Who may open which work, and what each person sees on it.

Principle: facts are public, work is need-to-know, and three things get stricter rules:
complainant identity, surprise-inspection picks, and unexamined suspicion flags."""
from typing import Optional

from sqlmodel import Session, select

from .models import Issue, IssueEvent, Officer, Work

DISTRICT = {"DM", "DDC"}
INTERNAL = {"DM", "DDC", "EE", "AE"}  # may see suspicion flags
HANDLERS = {"DM", "DDC", "EE", "AE", "JE"}  # may see who complained

# Leads, not findings: shown only to AE/EE/DM/DDC until an engineer has examined them.
SUSPICION_FLAGS = {"DUPLICATE_PHOTO", "OUTSIDE_SITE", "BILL_UNCHECKED", "FIN_AHEAD", "HOLD_BYPASSED"}
CONTRACTOR_FLAGS = {"SCHEDULE_SLIP", "PAST_DEADLINE", "TEST_FAILED", "POSTCHECK_FAILED", "COMPLETE_NOT_USABLE"}
LIMITED_FLAGS = {"SCHEDULE_SLIP", "PAST_DEADLINE"}

TABS = {"full": ["overview", "issues", "work", "money"], "contractor": ["overview", "issues", "work", "money"],
        "limited": ["overview", "issues"]}


def acted_on(session: Session, me: Officer, work: Work) -> bool:
    """CO/BDO: the work has an issue they own or have acted on."""
    issues = session.exec(select(Issue).where(Issue.work_id == work.id)).all()
    if any(i.owner_id == me.id for i in issues):
        return True
    ids = [i.id for i in issues]
    return bool(ids) and session.exec(select(IssueEvent).where(IssueEvent.actor_id == me.id, IssueEvent.issue_id.in_(ids))).first() is not None


def level(session: Session, me: Optional[Officer], work: Work) -> Optional[str]:
    """'full', 'contractor', 'limited', or None (cannot open this work)."""
    if me is None:
        return None
    if me.role in DISTRICT:
        return "full"
    if me.role == "EE" and (work.ee_id == me.id or work.department == me.department):
        return "full"
    if me.role == "AE" and work.ae_id == me.id:
        return "full"
    if me.role == "JE" and work.je_id == me.id:
        return "full"
    if me.role == "CONTRACTOR" and work.contractor_id == me.id:
        return "contractor"
    if me.role in {"CO", "BDO"} and acted_on(session, me, work):
        return "limited"
    return None


def scope_label(me: Officer) -> str:
    return {"DM": "district", "DDC": "district", "EE": "department"}.get(me.role, "own")


def visible_flags(me: Officer, lvl: str, flags):
    if lvl == "contractor":
        allowed = CONTRACTOR_FLAGS
    elif lvl == "limited":
        allowed = LIMITED_FLAGS
    elif me.role in INTERNAL:
        return flags
    else:  # JE
        return [f for f in flags if f["code"] not in SUSPICION_FLAGS]
    return [f for f in flags if f["code"] in allowed]


def sees_complainant(me: Officer, lvl: str) -> bool:
    return lvl == "full" and me.role in HANDLERS


def sees_inspection(me: Officer, work: Work, done: bool) -> bool:
    """Picks are secret until done: only the assigned inspector and the DM/DDC see them beforehand."""
    if me.role in DISTRICT or (me.role == "AE" and work.ae_id == me.id):
        return True
    return done and me.role in {"EE", "JE"}


def issue_visible(me: Officer, lvl: str, issue: Issue, events) -> bool:
    if lvl == "full":
        return True
    mine = issue.owner_id == me.id or issue.rectified_by == me.id or any(e.actor_id == me.id for e in events)
    if lvl == "contractor":  # only verified repairs given to them; never unexamined resident allegations
        return mine and issue.status not in {"REPORTED", "ACKNOWLEDGED", "UNDER_EXAMINATION"}
    return mine
