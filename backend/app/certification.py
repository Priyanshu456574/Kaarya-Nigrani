"""Certification eligibility: the only gate between 'claimed complete' and 'certified usable'.

Work status state machine (server-enforced):
  SANCTIONED -> IN_PROGRESS -> REPORTED_COMPLETE -> USABLE_VERIFIED
  REPORTED_COMPLETE -> IN_PROGRESS   (claim returned by the AE/EE with a reason)

Claiming needs every stage measured to its (revised) sanctioned quantity.
Certifying needs everything in `blockers()` to be empty. Payment is reported separately and never a condition.
"""
from typing import Optional

from sqlmodel import Session, select

from .flags import stage_coverage
from .i18n import hi
from .models import (Bill, Evidence, Issue, Measurement, Officer, QualityTest, ScopeRevision, Stage, UsabilityItem,
                     Work)
from .workflow import TERMINAL

CHECKLIST_PURPOSES = {"inspection", "completion", "reinspection"}


def _b(code, en, hn, **extra):
    return {"code": code, "message": en, "message_hi": hn, **extra}


def short(done, required) -> bool:
    """Quantities compared to 2 decimals (measurement entries are rounded to 3)."""
    return round(done, 2) < round(required, 2)


def measured_ok(stages):
    return [s for s in stages if short(s.qty_executed, s.qty_sanctioned)]


def claim_blockers(session: Session, work: Work):
    stages = session.exec(select(Stage).where(Stage.work_id == work.id).order_by(Stage.seq)).all()
    out = []
    if work.status != "IN_PROGRESS":
        out.append(_b("STATUS", f"Work is {work.status}; only a work in progress can be claimed complete.",
                      "केवल चालू कार्य को पूरा बताया जा सकता है।"))
    for s in measured_ok(stages):
        out.append(_b("STAGE_NOT_MEASURED", f"'{s.name}': {s.qty_executed:g} of {s.qty_sanctioned:g} {s.unit} measured.",
                      f"'{hi('stage', s.name)}': {s.qty_sanctioned:g} में से {s.qty_executed:g} {s.unit} मापा गया।", stage_id=s.id))
    return out


def blockers(session: Session, work: Work, actor: Optional[Officer] = None, check_status: bool = True):
    stages = session.exec(select(Stage).where(Stage.work_id == work.id).order_by(Stage.seq)).all()
    mbs = session.exec(select(Measurement).where(Measurement.work_id == work.id)).all()
    tests = session.exec(select(QualityTest).where(QualityTest.work_id == work.id)).all()
    issues = session.exec(select(Issue).where(Issue.work_id == work.id)).all()
    items = session.exec(select(UsabilityItem).where(UsabilityItem.work_id == work.id).order_by(UsabilityItem.id)).all()
    evidence = session.exec(select(Evidence).where(Evidence.work_id == work.id)).all()
    officer_ev = [e for e in evidence if e.source == "officer"]
    out = []

    if check_status and work.status != "REPORTED_COMPLETE":
        out.append(_b("STATUS", "The JE has not claimed this work complete." if work.status == "IN_PROGRESS"
                      else f"Work is {work.status}.", "कनीय अभियंता ने कार्य पूरा नहीं बताया है।"))
    if actor is not None and (actor.role != "EE" or work.ee_id != actor.id):
        out.append(_b("AUTHORITY", "Only the Executive Engineer in charge of this work can certify it.",
                      "केवल इस कार्य के प्रभारी कार्यपालक अभियंता प्रमाणित कर सकते हैं।"))

    # 1. scope executed and independently check-measured
    for s in stages:
        if short(s.qty_executed, s.qty_sanctioned):
            out.append(_b("STAGE_INCOMPLETE", f"'{s.name}': {s.qty_executed:g} of {s.qty_sanctioned:g} {s.unit} measured.",
                          f"'{hi('stage', s.name)}': {s.qty_sanctioned:g} में से {s.qty_executed:g} {s.unit} मापा गया।", stage_id=s.id))
        checked = sum(m.qty for m in mbs if m.stage_id == s.id and m.checked_by is not None)
        if short(checked, s.qty_sanctioned) and not short(s.qty_executed, s.qty_sanctioned):
            out.append(_b("NOT_CHECK_MEASURED", f"'{s.name}': only {checked:g} of {s.qty_sanctioned:g} {s.unit} check-measured by the AE.",
                          f"'{hi('stage', s.name)}': {s.qty_sanctioned:g} में से केवल {checked:g} {s.unit} की जाँच-माप हुई।", stage_id=s.id))
        frac, gaps, _ = stage_coverage(s, officer_ev, mbs, work.length_km)
        if s.qty_executed > 0 and (frac == 0 or gaps):
            out.append(_b("EVIDENCE_MISSING", f"'{s.name}': site evidence missing" + (" for part of the measured stretch." if gaps else "."),
                          f"'{hi('stage', s.name)}': साइट साक्ष्य नहीं" + (" (मापे गए हिस्से के कुछ भाग)।" if gaps else "।"), stage_id=s.id))

    # 2. quality tests to specification; failures resolved and retested
    for t in tests:
        if t.result is None:
            out.append(_b("TEST_MISSING", f"Required test not on record: {t.name}.", f"आवश्यक परीक्षण दर्ज नहीं: {hi('test', t.name)}।", test_id=t.id))
        elif t.passed is not True:
            out.append(_b("TEST_FAILED", f"{t.name} does not meet specification; retest after rectification.",
                          f"{hi('test', t.name)} मानक पर खरा नहीं; सुधार के बाद पुनः परीक्षण करें।", test_id=t.id))

    # 3. no unresolved issues of any kind
    open_issues = [i for i in issues if i.status not in TERMINAL]
    if open_issues:
        out.append(_b("OPEN_ISSUES", f"{len(open_issues)} issue(s) still open: " + ", ".join(i.ticket for i in open_issues[:5]) + ".",
                      f"{len(open_issues)} मामले अभी खुले हैं।"))

    # 4. usability checklist, each item backed by valid technical evidence
    if not items:
        out.append(_b("NO_CHECKLIST", "No usability checklist for this work.", "उपयोगिता जाँच-सूची नहीं है।"))
    for c in items:
        if c.passed is not True:
            out.append(_b("CHECK_NOT_PASSED", f"Usability not passed: {c.item}.", f"उपयोगिता जाँच बाकी: {hi('check', c.item)}।", item_id=c.id))
            continue
        ev = session.get(Evidence, c.evidence_id) if c.evidence_id else None
        up = session.get(Officer, ev.uploaded_by) if ev and ev.uploaded_by else None
        if ev is None or ev.work_id != work.id or ev.source != "officer" or up is None or up.role not in {"AE", "EE"}:
            out.append(_b("CHECK_BAD_EVIDENCE", f"Usability item '{c.item}' has no valid AE/EE evidence on this work.",
                          f"उपयोगिता बिंदु '{hi('check', c.item)}' का वैध साक्ष्य नहीं।", item_id=c.id))
    return out


def financial_status(session: Session, work: Work):
    bills = session.exec(select(Bill).where(Bill.work_id == work.id)).all()
    s = lambda st: round(sum(b.amount_lakh for b in bills if b.status in st), 2)
    paid = round(sum((b.paid_lakh or 0) for b in bills if b.status == "PAID"), 2)
    approved = s({"CHECKED", "AUTHORIZED"})
    by = lambda field: round(sum(b.amount_lakh for b in bills if getattr(b, field) is not None), 2)
    return {
        "sanctioned_lakh": work.sanctioned_lakh,
        "submitted_lakh": s({"SUBMITTED", "CHECKED", "AUTHORIZED", "PAID"}),
        "checked_lakh": by("checked_by"),  # by recorded approver, so a skipped check shows as a shortfall
        "authorized_lakh": by("authorized_by"),
        "paid_lakh": paid,
        "liability_lakh": round(approved, 2),  # approved for payment but no disbursement recorded yet
        "pending_check_lakh": s({"SUBMITTED"}),
        "paid_pct": round(min(100.0, paid / work.sanctioned_lakh * 100), 1) if work.sanctioned_lakh else 0.0,
        "verified_source": False,  # no treasury / PFMS feed in this prototype
        "sources": sorted({b.payment_source for b in bills if b.payment_source}),
    }


def readiness(session: Session, work: Work, viewer: Optional[Officer] = None):
    b = blockers(session, work)
    revisions = session.exec(select(ScopeRevision).where(ScopeRevision.work_id == work.id)).all()
    return {"eligible": not b, "blockers": b, "claim_blockers": claim_blockers(session, work) if work.status == "IN_PROGRESS" else [],
            "scope_revised": bool(revisions), "financial": financial_status(session, work)}
