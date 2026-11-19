"""Transparent, rule-based flags. Each flag says what is wrong (in English and Hindi), why, and who acts next."""
import json
from datetime import date, timedelta

import imagehash
from sqlmodel import Session, select

from . import geo
from .i18n import hi
from .models import (Bill, Evidence, Issue, Measurement, Officer, PostCheck, ProgressReport, QualityTest, Stage,
                     UsabilityItem, UsabilityVote, Work)
from .workflow import OPEN_VERIFIED, TERMINAL, escalation

def r1(x: float) -> float:
    """Round half up to 1 decimal, the same way the browser demo does (Python's round() is half-to-even)."""
    import math
    return math.floor(x * 10 + 0.5) / 10  # identical to JS Math.round(x * 10) / 10


SLIP_WARN, SLIP_HIGH = 15, 30
FIN_GAP = 15
STALE_DAYS = 21
ACK_DAYS = 3
REPEAT_N, REPEAT_WINDOW = 3, 60
PHASH_MAX_DIST = 4
TEST_DUE_PCT = 50  # required tests must be on record once a stage is half done

# Hold points: a stage may not be measured until the tests of the stage it sits on have passed.
HOLDS = {"Granular sub-base / WBM": "Earthwork & subgrade", "Bituminous surface": "Granular sub-base / WBM",
         "Masonry / RCC walls": "PCC bed", "Cover slabs": "Masonry / RCC walls",
         "Superstructure": "Foundation", "Roofing": "Superstructure", "Barrel / slab": "Foundation"}


def hold_pending(stages, tests, stage):
    """(prerequisite stage, tests not yet passed) for a stage's hold point."""
    pre = next((s for s in stages if s.name == HOLDS.get(stage.name)), None)
    if pre is None:
        return None, []
    return pre, [t for t in tests if t.stage_id == pre.id and t.passed is not True]


def planned_fraction(stage: Stage, today: date) -> float:
    if today <= stage.planned_start:
        return 0.0
    if today >= stage.planned_end:
        return 1.0
    span = (stage.planned_end - stage.planned_start).days or 1
    return (today - stage.planned_start).days / span


def planned_progress(stages, today: date) -> float:
    return r1(sum(s.weight * planned_fraction(s, today) for s in stages))


def actual_progress(stages) -> float:
    return r1(sum(s.weight * s.progress / 100 for s in stages))


def check_measured_progress(stages, mbs) -> float:
    """Share of the work whose quantities the AE/EE has check-measured (weights x checked qty / sanctioned qty)."""
    tot = 0.0
    for s in stages:
        checked = sum(m.qty for m in mbs if m.stage_id == s.id and m.checked_by is not None)
        tot += s.weight * min(1.0, checked / s.qty_sanctioned if s.qty_sanctioned else 0)
    return r1(tot)


def paid_pct(bills, sanctioned) -> float:
    paid = sum((b.paid_lakh or 0) for b in bills if b.status == "PAID")
    return r1(min(100.0, paid / sanctioned * 100)) if paid and sanctioned else 0.0


def plan_date(work: Work, d: date) -> date:
    """With an approved time extension the original plan is stretched to the revised end date."""
    if not work.revised_end or work.revised_end <= work.planned_end or d <= work.start_date:
        return d
    orig = (work.planned_end - work.start_date).days or 1
    new = (work.revised_end - work.start_date).days or 1
    return work.start_date + timedelta(days=round((d - work.start_date).days * orig / new))


def due_date(work: Work) -> date:
    return work.revised_end or work.planned_end


def s_curve(stages, start: date, end: date, points: int = 12, work: Work = None):
    span = max((end - start).days, 1)
    out = []
    for i in range(points + 1):
        d = start + timedelta(days=round(span * i / points))
        out.append({"date": d.isoformat(), "planned": planned_progress(stages, plan_date(work, d) if work else d)})
    return out


def _flag(code, severity, en, hi_text, owner_role, owner_id=None):
    return {"code": code, "severity": severity, "message": en, "message_hi": hi_text,
            "next_action_by": owner_role, "owner_id": owner_id}


def duplicate_photo_index(session: Session):
    evs = session.exec(select(Evidence).where(Evidence.phash != None)).all()  # noqa: E711
    hashes = [(e, imagehash.hex_to_hash(e.phash)) for e in evs]
    codes = {w.id: w.code for w in session.exec(select(Work)).all()}
    dup = {}
    for i, (a, ha) in enumerate(hashes):
        for b, hb in hashes[i + 1:]:
            if a.work_id != b.work_id and ha - hb <= PHASH_MAX_DIST:
                dup.setdefault(a.id, set()).add(codes[b.work_id])
                dup.setdefault(b.id, set()).add(codes[a.work_id])
    return dup


def stage_coverage(stage: Stage, officer_ev, measurements, length_km):
    """Linear stage: share of the measured stretch that has site photos, and the stretches without any.
    Other stages: covered if any photo exists."""
    if not stage.linear or not length_km or stage.qty_executed <= 0:
        has = any(e.stage_id == stage.id for e in officer_ev)
        return (1.0 if has else 0.0), [], []
    executed = geo.merge_ranges([(m.ch_from, m.ch_to) for m in measurements if m.stage_id == stage.id and m.ch_from is not None])
    pts = [e.chainage_km for e in officer_ev if e.stage_id == stage.id and e.chainage_km is not None]
    total, covered, gaps = 0.0, 0.0, []
    for a, b in geo.bins(length_km):
        pieces = [(max(a, x), min(b, y)) for x, y in executed if min(b, y) > max(a, x) + 1e-6]
        if not pieces:
            continue
        overlap = sum(y - x for x, y in pieces)
        total += overlap
        if any(a - 1e-6 <= p <= b + 1e-6 for p in pts):
            covered += overlap
        else:
            gaps.extend(pieces)
    return (covered / total if total else 0.0), geo.merge_ranges(gaps), executed


def work_flags(session: Session, work: Work, today: date, dup_index=None) -> dict:
    stages = session.exec(select(Stage).where(Stage.work_id == work.id).order_by(Stage.seq)).all()
    evidence = session.exec(select(Evidence).where(Evidence.work_id == work.id)).all()
    issues = session.exec(select(Issue).where(Issue.work_id == work.id)).all()
    checklist = session.exec(select(UsabilityItem).where(UsabilityItem.work_id == work.id)).all()
    mbs = session.exec(select(Measurement).where(Measurement.work_id == work.id)).all()
    bills = session.exec(select(Bill).where(Bill.work_id == work.id)).all()
    tests = session.exec(select(QualityTest).where(QualityTest.work_id == work.id)).all()

    planned = planned_progress(stages, plan_date(work, today))
    actual = actual_progress(stages)
    financial = paid_pct(bills, work.sanctioned_lakh)  # disbursement recorded, not bills raised
    check_measured = check_measured_progress(stages, mbs)
    last_rep = session.exec(select(ProgressReport).where(ProgressReport.work_id == work.id)
                            .order_by(ProgressReport.report_date.desc(), ProgressReport.id.desc())).first()
    reported = last_rep.physical_pct if last_rep else 0.0
    officer_ev = [e for e in evidence if e.source == "officer"]
    flags, coverage = [], {}
    active = work.status in ("SANCTIONED", "IN_PROGRESS")

    evidenced = 0.0
    for s in stages:
        frac, gaps, executed = stage_coverage(s, officer_ev, mbs, work.length_km)
        coverage[s.id] = {"covered": round(frac, 3), "gaps": gaps, "executed": executed}
        evidenced += s.weight * s.progress / 100 * frac
        sn, sh = s.name, hi("stage", s.name)
        if s.progress > 0 and frac == 0:
            flags.append(_flag("STAGE_NO_EVIDENCE", 2, f"Stage '{sn}' reported {s.progress:.0f}% done with no site evidence.",
                               f"चरण '{sh}' {s.progress:.0f}% पूरा बताया गया, पर कोई साइट साक्ष्य नहीं।", "JE"))
        elif gaps:
            r = geo.fmt_ranges(gaps)
            flags.append(_flag("EVIDENCE_GAP", 2, f"'{sn}': no site photo for km {r} of the measured stretch.",
                               f"'{sh}': मापे गए हिस्से में किमी {r} की कोई साइट फोटो नहीं।", "JE"))
    evidenced = r1(evidenced)

    if active:
        slip = planned - actual
        if slip >= SLIP_WARN:
            d = next((i for i in issues if i.category == "delay" and i.status not in TERMINAL), None)
            holder = session.get(Officer, d.owner_id) if d and d.owner_id else None
            flags.append(_flag("SCHEDULE_SLIP", 3 if slip >= SLIP_HIGH else 2,
                               f"Behind plan by {slip:.0f} points (planned {planned:.0f}%, actual {actual:.0f}%)." +
                               (f" Recorded hold-up: {d.title}." if d else " No hold-up reason recorded."),
                               f"योजना से {slip:.0f} अंक पीछे (नियोजित {planned:.0f}%, वास्तविक {actual:.0f}%)।" +
                               (f" दर्ज बाधा: {hi('reason', d.reason_code)}।" if d else " कोई बाधा कारण दर्ज नहीं।"),
                               holder.role if holder else "JE", holder.id if holder else None))
        if today > due_date(work):
            n = (today - due_date(work)).days
            ext = " (after time extension)" if work.revised_end else ""
            ext_hi = " (समय-वृद्धि के बाद भी)" if work.revised_end else ""
            flags.append(_flag("PAST_DEADLINE", 3, f"Past scheduled completion by {n} days{ext}.", f"निर्धारित समाप्ति तिथि से {n} दिन अधिक हो गए{ext_hi}।", "EE"))
        last = max((e.captured_at for e in officer_ev), default=None)
        if (today - work.start_date).days > STALE_DAYS and (last is None or (today - last.date()).days > STALE_DAYS):
            if last is None:
                flags.append(_flag("STALE_EVIDENCE", 1, "In progress but no site evidence ever uploaded.", "काम चल रहा है, पर अब तक कोई साइट साक्ष्य नहीं।", "JE"))
            else:
                n = (today - last.date()).days
                flags.append(_flag("STALE_EVIDENCE", 1, f"In progress but no site evidence for {n} days.", f"काम चल रहा है, पर {n} दिनों से कोई साइट साक्ष्य नहीं।", "JE"))

    if financial - evidenced >= FIN_GAP:
        same = round(evidenced) == round(actual)
        flags.append(_flag("FIN_AHEAD", 3,
                           f"{financial:.0f}% of the money is paid, but only {evidenced:.0f}% of the work " +
                           ("is done." if same else f"has site photos (reported {actual:.0f}%)."),
                           f"स्वीकृत राशि का {financial:.0f}% भुगतान हो चुका है, पर केवल {evidenced:.0f}% काम " +
                           ("हुआ है।" if same else f"का साइट साक्ष्य है (बताया गया {actual:.0f}%)।"), "EE"))

    unchecked = {m.id for m in mbs if m.checked_by is None}
    bad = [b for b in bills if b.status in ("AUTHORIZED", "PAID") and unchecked & set(json.loads(b.mb_ids))]
    if bad:
        nos = ", ".join(str(b.bill_no) for b in bad)
        amt = sum(b.amount_lakh for b in bad)
        word = "bill" if len(bad) == 1 else "bills"
        flags.append(_flag("BILL_UNCHECKED", 3,
                           f"{word.capitalize()} {nos} (₹{amt:.1f} lakh) paid before the AE re-measured the work.",
                           f"आरए बिल {nos} (₹{amt:.1f} लाख) का भुगतान उन मापों पर हुआ जिनकी सहायक अभियंता ने जाँच-माप नहीं की।", "AE"))

    by_stage = {s.id: s for s in stages}
    for t in tests:
        s = by_stage[t.stage_id]
        if t.passed is False:
            linked = session.get(Issue, t.issue_id) if t.issue_id else None
            if linked is None or linked.status not in TERMINAL:
                flags.append(_flag("TEST_FAILED", 3,
                                   f"{t.name} on '{s.name}' failed: {t.result:g} {t.unit} against {spec_text(t)}.",
                                   f"'{hi('stage', s.name)}' पर {hi('test', t.name)} विफल: {t.result:g} {t.unit}, मानक {spec_text(t, True)}।", "EE"))
    for s in stages:
        missing = [t for t in tests if t.stage_id == s.id and t.result is None]
        if missing and s.progress >= TEST_DUE_PCT:
            flags.append(_flag("TESTS_MISSING", 2,
                               f"'{s.name}' is {s.progress:.0f}% done but required tests are not on record: {', '.join(t.name for t in missing)}.",
                               f"'{hi('stage', s.name)}' {s.progress:.0f}% पूरा, पर आवश्यक परीक्षण दर्ज नहीं: {', '.join(hi('test', t.name) for t in missing)}।", "JE"))
    for s in stages:
        prev, pending = hold_pending(stages, tests, s)
        if s.qty_executed > 0 and pending:
            flags.append(_flag("HOLD_BYPASSED", 3,
                               f"'{s.name}' was started before the tests on '{prev.name}' were passed.",
                               f"होल्ड पॉइंट का उल्लंघन: '{hi('stage', prev.name)}' के परीक्षण पास होने से पहले '{hi('stage', s.name)}' की माप दर्ज हुई।", "AE"))

    for i in issues:
        if i.source == "citizen" and i.status == "REPORTED" and (today - i.created_at.date()).days > ACK_DAYS:
            n = (today - i.created_at.date()).days
            flags.append(_flag("UNACKED_REPORTS", 2, f"Resident report {i.ticket} unacknowledged for {n} days.",
                               f"निवासी की शिकायत {i.ticket} {n} दिनों से स्वीकार नहीं की गई।", "JE"))
        elif i.status not in TERMINAL and i.due_date and i.due_date < today:
            esc = escalation(session, i, work, today)
            owner = esc["escalated_to"] or (session.get(Officer, i.owner_id) if i.owner_id else None)
            en = f"{i.ticket} '{i.title}' overdue by {esc['days']} days."
            hn = f"{i.ticket} '{i.title}' {esc['days']} दिन से लंबित।"
            if esc["escalated_to"]:
                en += f" Escalated to {owner.role} {owner.name}."
                hn += f" {hi('role', owner.role)} {owner.name} तक बढ़ाया गया।"
            flags.append(_flag("OVERDUE_ACTION", 2, en, hn, owner.role if owner else "EE", owner.id if owner else None))

    recent = [i for i in issues if i.source == "citizen" and (today - i.created_at.date()).days <= REPEAT_WINDOW]
    if len(recent) >= REPEAT_N:
        flags.append(_flag("REPEAT_COMPLAINTS", 2, f"{len(recent)} resident reports in the last {REPEAT_WINDOW} days.",
                           f"पिछले {REPEAT_WINDOW} दिनों में {len(recent)} निवासी शिकायतें।", "AE"))

    if work.status == "REPORTED_COMPLETE":
        unchk = [c.item for c in checklist if c.passed is not True]
        defects = [i for i in issues if i.status in OPEN_VERIFIED]
        reports = [i for i in issues if i.status not in TERMINAL and i.status not in OPEN_VERIFIED]
        if unchk or defects or reports:
            en, hn = [], []
            if unchk:
                en.append(f"usability items not passed: {', '.join(unchk)}")
                hn.append(f"उपयोगिता जाँच बाकी: {', '.join(hi('check', c) for c in unchk)}")
            if defects:
                en.append(f"{len(defects)} verified defect(s) open")
                hn.append(f"{len(defects)} सत्यापित दोष खुले")
            if reports:
                en.append(f"{len(reports)} resident report(s) not yet examined")
                hn.append(f"{len(reports)} निवासी शिकायतों की जाँच बाकी")
            flags.append(_flag("COMPLETE_NOT_USABLE", 3, "Claimed complete, but " + "; ".join(en) + ".",
                               "पूरा बताया गया, पर " + "; ".join(hn) + "।", "EE"))

    for pc in session.exec(select(PostCheck).where(PostCheck.work_id == work.id)).all():
        if pc.done_on is None and pc.due_date < today:
            n = (today - pc.due_date).days
            flags.append(_flag("POSTCHECK_OVERDUE", 2, f"Post-monsoon re-check was due {pc.due_date.strftime('%d %b %Y')} and is {n} days late.",
                               f"मानसून बाद की पुनः जाँच {pc.due_date.strftime('%d %b %Y')} तक होनी थी, {n} दिन देर।", "AE"))
        elif pc.done_on and pc.passed is False:
            flags.append(_flag("POSTCHECK_FAILED", 3, f"Post-monsoon re-check found problems: {pc.note}",
                               f"मानसून बाद की जाँच में समस्या मिली: {pc.note}", "EE"))
    if work.status == "USABLE_VERIFIED":
        votes = session.exec(select(UsabilityVote).where(UsabilityVote.work_id == work.id)).all()
        recent = [v for v in votes if (today - v.at.date()).days <= 90]
        no = sum(1 for v in recent if not v.usable)
        if no >= 2 and no / len(recent) >= .2:
            flags.append(_flag("RESIDENTS_NOT_USABLE", 2, f"{no} of {len(recent)} residents say this work is not usable for them (last 90 days).",
                               f"पिछले 90 दिनों में {len(recent)} में से {no} निवासियों ने कहा कि यह कार्य उनके काम का नहीं।", "AE"))

    dup_index = dup_index if dup_index is not None else duplicate_photo_index(session)
    for e in evidence:
        if e.id in dup_index:
            codes = ", ".join(sorted(dup_index[e.id]))
            flags.append(_flag("DUPLICATE_PHOTO", 3, f"Photo '{e.caption}' matches a photo filed under {codes}.",
                               f"फोटो '{e.caption}' कार्य {codes} में लगी फोटो से मेल खाती है।", "AE"))
        if e.source == "officer" and e.in_geofence is False:
            flags.append(_flag("OUTSIDE_SITE", 2, f"Photo '{e.caption}' was geotagged outside the work site.",
                               f"फोटो '{e.caption}' कार्य स्थल से बाहर जियोटैग हुई।", "AE"))

    by_role = {"JE": work.je_id, "AE": work.ae_id, "EE": work.ee_id}
    for f in flags:
        oid = f.pop("owner_id") or by_role.get(f["next_action_by"])
        o = session.get(Officer, oid) if oid else None
        f["next_person"] = o.name if o else None
    flags.sort(key=lambda f: -f["severity"])
    return {"planned": planned, "actual": actual, "evidenced": evidenced, "financial": financial,
            "reported": reported, "check_measured": check_measured,
            "flags": flags, "score": sum(f["severity"] for f in flags), "coverage": coverage}


def spec_text(t: QualityTest, hindi=False) -> str:
    if t.kind == "passfail":
        return "पास होना आवश्यक" if hindi else "must pass"
    if t.spec_min is not None and t.spec_max is not None:
        return f"{t.spec_min:g}–{t.spec_max:g} {t.unit}"
    if t.spec_min is not None:
        return f"न्यूनतम {t.spec_min:g} {t.unit}" if hindi else f"min {t.spec_min:g} {t.unit}"
    return f"अधिकतम {t.spec_max:g} {t.unit}" if hindi else f"max {t.spec_max:g} {t.unit}"


def evaluate_test(t: QualityTest, result: float) -> bool:
    if t.kind == "passfail":
        return result >= 1
    return (t.spec_min is None or result >= t.spec_min) and (t.spec_max is None or result <= t.spec_max)
