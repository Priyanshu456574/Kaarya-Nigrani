"""Per-person task lists and the weekly surprise-inspection picks.

Tasks turn flags and open issues into "what do I need to do", so nobody has to read a dashboard to find their work."""
from datetime import date, timedelta

from sqlmodel import Session, select

from .flags import work_flags
from .models import Inspection, Issue, Officer, Work
from .workflow import TERMINAL, available_actions, escalation

# flag code -> (task in English, task in Hindi, tab to open)
FLAG_TASK = {
    "STAGE_NO_EVIDENCE": ("Add site photos", "साइट फोटो जोड़ें", "work"),
    "EVIDENCE_GAP": ("Add site photos for the missing stretch", "छूटे हिस्से की साइट फोटो जोड़ें", "work"),
    "STALE_EVIDENCE": ("Upload a current site photo", "ताज़ा साइट फोटो डालें", "work"),
    "TESTS_MISSING": ("Record the required tests", "आवश्यक परीक्षण दर्ज करें", "work"),
    "BILL_UNCHECKED": ("Check-measure before the next payment", "अगले भुगतान से पहले जाँच-माप करें", "work"),
    "HOLD_BYPASSED": ("Look into a hold-point breach", "होल्ड पॉइंट उल्लंघन देखें", "work"),
    "FIN_AHEAD": ("Review payments against evidence", "भुगतान बनाम साक्ष्य की समीक्षा करें", "money"),
    "SCHEDULE_SLIP": ("Record why the work is behind", "काम पीछे क्यों है, दर्ज करें", "issues"),
    "PAST_DEADLINE": ("Decide: time extension or action on contractor", "निर्णय लें: समय-वृद्धि या संवेदक पर कार्रवाई", "overview"),
    "COMPLETE_NOT_USABLE": ("Finish the usability check", "उपयोगिता जाँच पूरी करें", "overview"),
    "REPEAT_COMPLAINTS": ("Look at repeated complaints", "बार-बार की शिकायतें देखें", "issues"),
    "DUPLICATE_PHOTO": ("Check a photo used on two works", "दो कार्यों में लगी एक ही फोटो जाँचें", "work"),
    "OUTSIDE_SITE": ("Check a photo taken away from the site", "स्थल से बाहर ली गई फोटो जाँचें", "work"),
    "POSTCHECK_OVERDUE": ("Do the post-monsoon re-check", "मानसून बाद की पुनः जाँच करें", "overview"),
    "POSTCHECK_FAILED": ("Get defects repaired under liability", "दायित्व अवधि में दोष ठीक कराएँ", "overview"),
    "RESIDENTS_NOT_USABLE": ("Residents say it is not usable: inspect", "निवासी कहते हैं उपयोग योग्य नहीं: जाँच करें", "overview"),
}
SKIP_FLAGS = {"UNACKED_REPORTS", "OVERDUE_ACTION", "TEST_FAILED"}  # these already appear as issue tasks

ISSUE_TASK = {
    "REPORTED": ("Acknowledge a resident report", "निवासी की शिकायत स्वीकार करें"),
    "ACKNOWLEDGED": ("Examine on site", "स्थल पर जाँच करें"),
    "UNDER_EXAMINATION": ("Record your finding", "जाँच का निष्कर्ष दर्ज करें"),
    "VERIFIED": ("Assign the repair", "मरम्मत सौंपें"),
    "ACTION_ASSIGNED": ("Fix and report the repair", "मरम्मत कर सूचना दें"),
    "RECTIFIED": ("Re-inspect the repair on site", "मरम्मत की स्थल पर पुनः जाँच करें"),
    "APPEALED": ("Examine a resident's appeal", "निवासी की अपील की जाँच करें"),
}
PRIORITY = {3: "urgent", 2: "week", 1: "later"}
ORDER = {"urgent": 0, "week": 1, "later": 2}


def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for ch in s.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def weekly_picks(session: Session, today: date, summaries=None):
    """Two works picked by risk and one purely at random, so no work is ever safe from a surprise check."""
    week = iso_week(today)
    sunday = today + timedelta(days=6 - today.weekday())
    works = [w for w in session.exec(select(Work)).all() if w.status in ("IN_PROGRESS", "REPORTED_COMPLETE")]
    scores = summaries or {w.id: work_flags(session, w, today)["score"] for w in works}
    by_risk = sorted(works, key=lambda w: (-scores.get(w.id, 0), w.code))[:2]
    rest = [w for w in works if w not in by_risk]
    random_pick = min(rest, key=lambda w: fnv1a(f"{week}|{w.code}")) if rest else None
    out = []
    for w, why in [(x, "risk") for x in by_risk] + ([(random_pick, "random")] if random_pick else []):
        done = session.exec(select(Inspection).where(Inspection.work_id == w.id, Inspection.week == week)).first()
        out.append({"work": w, "reason": why, "week": week, "due": sunday, "assigned_to": w.ae_id, "done": done})
    return out


def _work(w):
    return {"id": w.id, "code": w.code, "name": w.name, "block": w.block}


def tasks_for(session: Session, me: Officer, today: date):
    tasks, seen = [], set()

    def add(t):
        k = (t["work"]["id"], t["title"], t.get("focus"))
        if k not in seen:
            seen.add(k)
            tasks.append(t)

    works = {w.id: w for w in session.exec(select(Work)).all()}
    flags_by_work = {w.id: work_flags(session, w, today) for w in works.values()}
    # 1. issues that are mine, or escalated to me
    for i in session.exec(select(Issue)).all():
        if i.status in TERMINAL:
            continue
        w = works[i.work_id]
        esc = escalation(session, i, w, today)
        mine = i.owner_id == me.id and available_actions(i, me)
        escalated_to_me = esc["escalated_to"] is not None and esc["escalated_to"].id == me.id
        if not (mine or escalated_to_me):
            continue
        if escalated_to_me and not mine:
            title, title_hi = "Escalated to you: follow up", "आप तक बढ़ाया गया: आगे बढ़ाएँ"
        elif i.status == "ACTION_ASSIGNED" and i.category == "delay":
            title, title_hi = "Resolve the hold-up", "बाधा दूर करें"
        else:
            title, title_hi = ISSUE_TASK[i.status]
        extra = f" (and {i.supporters} more residents)" if i.supporters else ""
        extra_hi = f" (और {i.supporters} निवासी)" if i.supporters else ""
        overdue = bool(i.due_date and i.due_date < today)
        add({"kind": "issue", "priority": "urgent" if overdue or escalated_to_me else "week", "work": _work(w),
             "title": title, "title_hi": title_hi, "detail": f"{i.ticket}: {i.title}{extra}", "detail_hi": f"{i.ticket}: {i.title}{extra_hi}",
             "tab": "issues", "focus": f"issue-{i.id}", "due_date": i.due_date.isoformat() if i.due_date else None,
             "overdue_days": esc["days"]})
    # 2. work-level flags addressed to me
    open_delay = {i.work_id for i in session.exec(select(Issue)).all() if i.category == "delay" and i.status not in TERMINAL}
    for w in works.values():
        f = flags_by_work[w.id]
        for fl in f["flags"]:
            if fl["code"] in SKIP_FLAGS or fl["next_person"] != me.name or fl["code"] not in FLAG_TASK:
                continue
            if fl["code"] == "SCHEDULE_SLIP" and w.id in open_delay:
                continue
            en, hn, tab = FLAG_TASK[fl["code"]]
            add({"kind": "flag", "code": fl["code"], "priority": PRIORITY[fl["severity"]], "work": _work(w),
                 "title": en, "title_hi": hn, "detail": fl["message"], "detail_hi": fl["message_hi"], "tab": tab, "focus": None,
                 "due_date": None, "overdue_days": 0})
    # 3. surprise inspections picked for me this week
    for p in weekly_picks(session, today, {k: v["score"] for k, v in flags_by_work.items()}):
        if p["assigned_to"] == me.id and not p["done"]:
            w = p["work"]
            why = ("picked because of its open flags" if p["reason"] == "risk" else "picked at random this week")
            why_hi = ("खुले चिह्नों के कारण चुना गया" if p["reason"] == "risk" else "इस सप्ताह बिना क्रम चुना गया")
            add({"kind": "inspection", "priority": "week", "work": _work(w), "title": "Surprise inspection this week",
                 "title_hi": "इस सप्ताह औचक निरीक्षण", "detail": f"Visit without notice and record what you find. This work was {why}.",
                 "detail_hi": f"बिना सूचना जाएँ और जो मिले दर्ज करें। यह कार्य {why_hi}।", "tab": "overview", "focus": "inspection",
                 "due_date": p["due"].isoformat(), "overdue_days": 0})
    tasks.sort(key=lambda t: (ORDER[t["priority"]], -(t["overdue_days"] or 0), t["work"]["code"]))
    return tasks
