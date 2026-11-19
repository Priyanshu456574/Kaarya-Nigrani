"""Synthetic but realistic demo data for Khagaria. All names, figures and test values are fictional and illustrative.
Positions are real: every work sits inside its correct block (see work_locations.json)."""
import io
import json
import math
import random
import shutil
from datetime import date, datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw
from sqlmodel import Session, SQLModel, select

from . import geo
from .db import MEDIA_DIR, engine, init_db
from .models import (Bill, Issue, Measurement, Officer, PostCheck, ProgressReport, QualityTest, Stage, TimeExtension,
                     UsabilityItem, UsabilityVote, Work)
from .workflow import create_issue, notify_status, transition

LOCATIONS = json.loads(Path(__file__).with_name("work_locations.json").read_text())

# (name, weight %, unit, quantity as a function of length_km, linear?)
STAGES = {
    "road": [("Earthwork & subgrade", 20, "km", lambda L: L, True), ("Granular sub-base / WBM", 25, "km", lambda L: L, True),
             ("Bituminous surface", 30, "km", lambda L: L, True), ("Side drains", 15, "km", lambda L: L, True),
             ("Approach & road furniture", 10, "item", lambda L: 8, False)],
    "drain": [("Excavation", 20, "km", lambda L: L, True), ("PCC bed", 20, "km", lambda L: L, True),
              ("Masonry / RCC walls", 35, "km", lambda L: L, True), ("Cover slabs", 15, "nos", lambda L: round(L * 1000 / 25), False),
              ("Outfall connection", 10, "item", lambda L: 1, False)],
    "building": [("Foundation", 20, "m³", lambda L: 120, False), ("Superstructure", 35, "m³", lambda L: 210, False),
                 ("Roofing", 15, "m²", lambda L: 260, False), ("Finishing", 15, "m²", lambda L: 900, False),
                 ("Water, power & toilets", 15, "item", lambda L: 12, False)],
    "culvert": [("Foundation", 30, "m³", lambda L: 18, False), ("Barrel / slab", 40, "m³", lambda L: 14, False),
                ("Wing walls & approaches", 30, "m³", lambda L: 22, False)],
}

# Required tests per stage: (name, kind, unit, min, max). Values are illustrative; a pilot takes them from the sanctioned specification.
TESTS = {
    "Earthwork & subgrade": [("Field density (compaction)", "numeric", "% of MDD", 97, None)],
    "Granular sub-base / WBM": [("Compacted layer thickness", "numeric", "mm", 75, None), ("Aggregate impact value", "numeric", "%", None, 30)],
    "Bituminous surface": [("Bitumen content", "numeric", "%", 4.5, 5.5), ("Core thickness", "numeric", "mm", 20, None)],
    "Side drains": [("Cube strength (M20, 28-day)", "numeric", "N/mm²", 20, None)],
    "PCC bed": [("Cube strength (M15, 28-day)", "numeric", "N/mm²", 15, None)],
    "Masonry / RCC walls": [("Mortar cube strength", "numeric", "N/mm²", 7.5, None)],
    "Cover slabs": [("Cube strength (M20, 28-day)", "numeric", "N/mm²", 20, None)],
    "Outfall connection": [("Outfall level check", "passfail", "", None, None)],
    "Foundation": [("Cube strength (M20, 28-day)", "numeric", "N/mm²", 20, None)],
    "Superstructure": [("Cube strength (M20, 28-day)", "numeric", "N/mm²", 20, None), ("Brick compressive strength", "numeric", "N/mm²", 7.5, None)],
    "Roofing": [("Cube strength (M20, 28-day)", "numeric", "N/mm²", 20, None)],
    "Water, power & toilets": [("Water supply pressure test", "passfail", "", None, None)],
    "Barrel / slab": [("Cube strength (M25, 28-day)", "numeric", "N/mm²", 25, None)],
}

CHECKLIST = {
    "road": ["Carriageway complete end to end", "Side drains flowing, no ponding",
             "Approach connections complete", "Signage and road furniture in place"],
    "drain": ["Continuous gradient, no standing water", "Outfall connected and clear", "Covers in place at crossings"],
    "building": ["Water supply working", "Electricity connected", "Toilets functional", "Accessible approach / ramp"],
    "culvert": ["Approaches levelled", "Waterway clear"],
}

PALETTE = {"road": (90, 90, 95), "drain": (110, 95, 70), "building": (160, 120, 90), "culvert": (120, 110, 100)}
BLOCK_FALLBACK = {"Khagaria": (25.502, 86.479)}


def make_photo(seed: int, label: str, kind: str) -> bytes:
    """Distinct synthetic placeholder image so perceptual hashing behaves realistically."""
    rnd = random.Random(seed)
    w, h = 640, 420
    img = Image.new("RGB", (w, h), (150 + rnd.randint(0, 60), 180 + rnd.randint(0, 50), 200 + rnd.randint(0, 40)))
    d = ImageDraw.Draw(img)
    horizon = rnd.randint(130, 220)
    d.rectangle([0, horizon, w, h], fill=(95 + rnd.randint(0, 40), 120 + rnd.randint(0, 40), 70))
    base = PALETTE.get(kind, (100, 100, 100))
    for _ in range(rnd.randint(4, 9)):
        x0, y0 = rnd.randint(0, w - 60), rnd.randint(horizon - 60, h - 40)
        x1, y1 = x0 + rnd.randint(40, 260), y0 + rnd.randint(20, 120)
        c = tuple(max(0, min(255, v + rnd.randint(-40, 40))) for v in base)
        (d.rectangle if rnd.random() < .6 else d.ellipse)([x0, y0, x1, y1], fill=c)
    d.rectangle([0, h - 34, w, h], fill=(0, 0, 0))
    d.text((10, h - 26), f"DEMO IMAGE (synthetic) - {label}"[:95], fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def at(day: date, hour=11) -> datetime:
    return datetime.combine(day, datetime.min.time()) + timedelta(hours=hour)


def seed(reset: bool = False):
    if reset:
        SQLModel.metadata.drop_all(engine)
        shutil.rmtree(MEDIA_DIR, ignore_errors=True)
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    from .main import save_evidence  # late import to avoid cycle

    T = date.today()
    rnd = random.Random(7)
    with Session(engine) as s:
        if s.exec(select(Work)).first():
            return

        def off(name, role, dept, block=None):
            o = Officer(name=name, role=role, department=dept, block=block)
            s.add(o)
            s.flush()
            return o

        off("District Magistrate", "DM", "District Administration")
        off("A. K. Verma", "DDC", "District Administration")
        ee_rwd = off("Er. Suresh Prasad", "EE", "RWD")
        ae_rwd_s = off("Er. Anjali Kumari", "AE", "RWD")
        ae_rwd_n = off("Er. Mohd. Irfan", "AE", "RWD")
        je_ravi = off("Er. Ravi Kumar", "JE", "RWD", "Gogri")
        je_pooja = off("Er. Pooja Singh", "JE", "RWD", "Alauli")
        je_amit = off("Er. Amit Raj", "JE", "RWD", "Parbatta")
        je_deepak = off("Er. Deepak Yadav", "JE", "RWD", "Chautham")
        ee_bcd = off("Er. Rakesh Ranjan", "EE", "BCD")
        ae_bcd = off("Er. Neha Bharti", "AE", "BCD")
        je_bcd = off("Er. Sunil Paswan", "JE", "BCD")
        ee_np = off("Er. Manoj Sinha", "EE", "Nagar Parishad")
        ae_np = off("Er. Vikash Kumar", "AE", "Nagar Parishad")
        je_np = off("Er. Rohit Mandal", "JE", "Nagar Parishad", "Khagaria")
        co_alauli = off("Rajesh Kumar", "CO", "Revenue", "Alauli")
        off("Kavita Devi", "BDO", "Rural Development", "Gogri")
        c_kosi = off("M/s Kosi Infra", "CONTRACTOR", "Contractor")
        c_ganga = off("M/s Ganga Constructions", "CONTRACTOR", "Contractor")
        c_bag = off("M/s Bagmati Builders", "CONTRACTOR", "Contractor")

        rwd_ae = {"Gogri": ae_rwd_s, "Parbatta": ae_rwd_s, "Beldaur": ae_rwd_s}
        rwd_je = {"Gogri": je_ravi, "Alauli": je_pooja, "Mansi": je_pooja, "Parbatta": je_amit,
                  "Beldaur": je_amit, "Chautham": je_deepak, "Khagaria": je_deepak}
        photo_seq = [1000]

        def photo(w, stage, caption, day, who, ch=None, seed_no=None, lat=None, lng=None, hour=11, purpose=None):
            photo_seq[0] += 1
            if lat is None:
                if ch is not None and w.alignment:
                    lat, lng = geo.point_at(json.loads(w.alignment), ch)
                    lat += rnd.uniform(-.00015, .00015)
                    lng += rnd.uniform(-.00015, .00015)
                else:
                    lat, lng = w.lat + rnd.uniform(-.0008, .0008), w.lng + rnd.uniform(-.0008, .0008)
            return save_evidence(s, w, upload=make_photo(seed_no or photo_seq[0], f"{w.code} {caption}", w.work_type),
                                 filename="p.jpg", kind="photo", caption=caption, stage_id=stage.id if stage else None,
                                 lat=lat, lng=lng, uploaded_by=who.id, source="officer", captured_at=at(day, hour),
                                 purpose=purpose or "progress")

        def make_work(code, name, wtype, dept, scheme, block, village, lakh, start_ago, dur, profile, contractor,
                      fin=None, no_photos=(), photo_upto=None, stale=False, unchecked=(), force=None,
                      missing_tests=(), fail_tests=None):
            loc = LOCATIONS.get(code, {"point": BLOCK_FALLBACK.get(block, (25.5, 86.5))})
            lat, lng = loc["point"]
            line = loc.get("line")
            L = loc.get("length_km", 0)
            if dept == "RWD":
                je, ae, ee = rwd_je[block], rwd_ae.get(block, ae_rwd_n), ee_rwd
            elif dept == "BCD":
                je, ae, ee = je_bcd, ae_bcd, ee_bcd
            else:
                je, ae, ee = je_np, ae_np, ee_np
            start = T - timedelta(days=start_ago)
            end = start + timedelta(days=dur)
            w = Work(code=code, name=name, work_type=wtype, department=dept, scheme=scheme, block=block,
                     village=village, lat=lat, lng=lng, sanctioned_lakh=lakh, contractor_id=contractor.id,
                     je_id=je.id, ae_id=ae.id, ee_id=ee.id, start_date=start, planned_end=end,
                     status="SANCTIONED" if start_ago <= 0 else "IN_PROGRESS", qr_token=code.lower().replace("-", ""),
                     length_km=L or None, alignment=json.dumps(line) if line else None,
                     geofence_m=150 if line else 400)
            s.add(w)
            s.flush()
            stages, cum = [], 0
            for i, (sname, wt, unit, qf, linear) in enumerate(STAGES[wtype]):
                ps = start + timedelta(days=round(dur * cum / 100))
                cum += wt
                pe = start + timedelta(days=round(dur * cum / 100))
                st = Stage(work_id=w.id, seq=i + 1, name=sname, weight=wt, planned_start=ps, planned_end=pe,
                           unit=unit, qty_sanctioned=round(qf(L), 2), linear=linear and bool(line))
                s.add(st)
                stages.append(st)
            s.flush()

            # executed fraction per stage
            frac = {}
            for st in stages:
                span = max((st.planned_end - st.planned_start).days, 1)
                pf = min(max((T - st.planned_start).days / span, 0), 1)
                if profile == "complete":
                    p = 1.0
                elif profile == "on_track":
                    p = pf * rnd.uniform(.92, 1.0)
                elif isinstance(profile, tuple):
                    p = min(max((T - timedelta(days=profile[1]) - st.planned_start).days / span, 0), 1)
                else:
                    p = 0.0
                if force and st.name in force:
                    p = force[st.name]
                frac[st.id] = round(p * 20) / 20

            # measurement book entries (2–3 per stage), dated inside the stage window
            mbs = []
            for st in stages:
                f = frac[st.id]
                if f <= 0:
                    continue
                q_total = round(st.qty_sanctioned * f, 2) if st.unit not in ("item", "nos") else max(1, round(st.qty_sanctioned * f))
                n = 1 if q_total < 2 and not st.linear else rnd.choice([2, 3])
                last_day = min(T - timedelta(days=3), st.planned_start + timedelta(days=max(1, round((st.planned_end - st.planned_start).days * f))))
                for k in range(n):
                    a, b = k / n, (k + 1) / n
                    day = st.planned_start + timedelta(days=round((last_day - st.planned_start).days * b))
                    qty = round(q_total * (b - a), 3) if st.unit not in ("item", "nos") else (round(q_total * b) - round(q_total * a))
                    if qty <= 0:
                        continue
                    m = Measurement(work_id=w.id, stage_id=st.id, entry_date=day, qty=qty, recorded_by=je.id,
                                    ch_from=round(L * f * a, 3) if st.linear else None, ch_to=round(L * f * b, 3) if st.linear else None)
                    if st.name not in unchecked:
                        m.checked_by, m.checked_on = ae.id, day + timedelta(days=4)
                    s.add(m)
                    mbs.append((m, st))
                st.qty_executed = round(q_total, 3)
                st.progress = round(min(100.0, st.qty_executed / st.qty_sanctioned * 100), 1)
                if st.progress >= 100:
                    st.completed_on = last_day
                s.add(st)
            s.flush()

            # RA bills: monthly, paying for the month's measurements, scaled so the total matches the paid share
            value = lambda m, st: lakh * st.weight / 100 * m.qty / st.qty_sanctioned
            actual = sum(st.weight * st.progress / 100 for st in stages)
            target = (fin if fin is not None else max(actual - 8, 0)) / 100 * lakh
            raw = sum(value(m, st) for m, st in mbs) or 1
            scale = target / raw
            bills, d, no = [], start + timedelta(days=30), 1
            pending = sorted(mbs, key=lambda x: x[0].entry_date)
            while d <= T and pending:
                batch = [x for x in pending if x[0].entry_date <= d - timedelta(days=5)]
                if batch:
                    amt = round(sum(value(m, st) for m, st in batch) * scale, 2)
                    if amt > 0:
                        bills.append(Bill(work_id=w.id, bill_no=no, bill_date=d, amount_lakh=amt, mb_ids=json.dumps([m.id for m, _ in batch]),
                                          status="PAID", paid_lakh=amt, paid_on=d + timedelta(days=12), payment_ref=f"SYN-{code}-{no:02d}",
                                          payment_source="illustrative_seed", submitted_by=contractor.id))
                        no += 1
                    pending = [x for x in pending if x not in batch]
                d += timedelta(days=30)
            for b in bills:
                s.add(b)

            # monthly progress reports from measurements and bills
            d = start + timedelta(days=30)
            while d <= T:
                phys = sum(st.weight * sum(m.qty for m, st2 in mbs if st2.id == st.id and m.entry_date <= d) / st.qty_sanctioned for st in stages)
                paid = sum(b.amount_lakh for b in bills if b.bill_date <= d) / lakh * 100
                s.add(ProgressReport(work_id=w.id, report_date=d, physical_pct=round(min(phys, 100), 1), financial_pct=round(paid, 1), reported_by=je.id))
                d += timedelta(days=30)
            if start_ago > 0:
                s.add(ProgressReport(work_id=w.id, report_date=T - timedelta(days=1), physical_pct=round(actual, 1),
                                     financial_pct=round(sum(b.amount_lakh for b in bills) / lakh * 100, 1), reported_by=je.id))

            # site photos: along the measured stretch for linear stages (one every ~0.4 km), 1–2 otherwise
            for st in stages:
                if frac[st.id] <= 0 or st.name in no_photos:
                    continue
                day0 = st.planned_start
                day1 = min(T - timedelta(days=1), st.planned_end)
                pick = lambda: min(day0 + timedelta(days=rnd.randint(0, max((day1 - day0).days, 1))), T - timedelta(days=1))
                if st.linear:  # one photo in every 0.5 km of the measured stretch, up to any deliberate gap
                    reach = L * frac[st.id]
                    upto = min(reach, (photo_upto or {}).get(st.name, reach))
                    for a, b in geo.bins(L):
                        if a >= reach - 1e-6:
                            break
                        ch = round((a + min(b, reach)) / 2, 2)
                        if ch <= upto:
                            day = min(pick(), T - timedelta(days=40)) if stale else pick()
                            photo(w, st, f"{st.name} at km {ch:.1f}", day, je, ch=ch)
                else:
                    for k in range(1 if frac[st.id] < .6 else 2):
                        day = min(pick(), T - timedelta(days=40)) if stale else pick()
                        photo(w, st, f"{st.name}, site photo {k + 1}", day, je)

            # quality tests: required per stage; recorded once the stage is underway
            for st in stages:
                for (tn, kind, unit, mn, mx) in TESTS.get(st.name, []):
                    t = QualityTest(work_id=w.id, stage_id=st.id, name=tn, kind=kind, unit=unit, spec_min=mn, spec_max=mx)
                    done = frac[st.id] >= .3 and (st.name, tn) not in missing_tests and st.name not in missing_tests
                    if done:
                        if fail_tests and (st.name, tn) in fail_tests:
                            t.result = fail_tests[(st.name, tn)]
                        elif kind == "passfail":
                            t.result = 1
                        else:
                            lo = mn if mn is not None else (mx * .6)
                            hi_ = mx if mx is not None else (mn * 1.25)
                            t.result = round(rnd.uniform(lo + (hi_ - lo) * .15, hi_ - (hi_ - lo) * .1), 1)
                        t.passed = (t.result >= 1) if kind == "passfail" else ((mn is None or t.result >= mn) and (mx is None or t.result <= mx))
                        t.tested_on = min(T - timedelta(days=2), st.planned_start + timedelta(days=max(1, (min(T, st.planned_end) - st.planned_start).days // 2)))
                        t.tested_by = je.id if kind != "numeric" or "Cube" not in tn else ae.id
                        t.lab = "Field test" if tn in ("Field density (compaction)", "Compacted layer thickness", "Core thickness", "Outfall level check", "Water supply pressure test") else "District quality control lab"
                        if st.linear and L:
                            t.chainage_km = round(L * frac[st.id] * rnd.uniform(.2, .8), 2)
                    s.add(t)
            for item in CHECKLIST[wtype]:
                s.add(UsabilityItem(work_id=w.id, item=item))
            s.flush()
            return w, stages, dict(je=je, ae=ae, ee=ee)

        def stage(stages, name):
            return next(x for x in stages if x.name == name)

        # ---- Story 1: road claimed complete; drains and approach unproven, bitumen photos stop at km 1.8, bill paid on unchecked MB ----
        w1, st1, p1 = make_work("GOG-R-014", "Gogri Bazaar – Rampur road (3.0 km)", "road", "RWD", "MMGSY", "Gogri", "Rampur",
                                120.0, 240, 230, "complete", c_kosi, fin=98, no_photos=("Side drains", "Approach & road furniture"),
                                photo_upto={"Bituminous surface": 1.8}, unchecked=("Side drains", "Approach & road furniture"),
                                missing_tests=("Side drains",))
        w1.status, w1.completion_claimed_on = "REPORTED_COMPLETE", T - timedelta(days=8)
        items1 = s.exec(select(UsabilityItem).where(UsabilityItem.work_id == w1.id)).all()
        e = photo(w1, stage(st1, "Bituminous surface"), "AE check of carriageway at km 0.5", T - timedelta(days=7), p1["ae"], ch=0.5, purpose="inspection")
        items1[0].passed, items1[0].verified_by, items1[0].verified_on, items1[0].evidence_id = True, p1["ae"].id, T - timedelta(days=7), e.id
        i1 = create_issue(s, work=w1, actor=None, source="citizen", category="usability",
                          title="School approach still kachcha, children walk through mud",
                          description="School approach still kachcha, children walk through mud. Road ends 200 m before the school gate.",
                          complainant_name="Mahesh Paswan", complainant_phone="9801234521", at=at(T - timedelta(days=5), 9))
        i1.supporters = 7
        notify_status(s, i1, at(T - timedelta(days=5), 9))

        # ---- Story 2: delayed road, land dispute owned by the Circle Officer, overdue and escalated ----
        w2, st2, p2 = make_work("ALA-R-007", "Alauli – Hardiya PCC road (1.8 km)", "road", "RWD", "MMGSY", "Alauli", "Hardiya",
                                86.5, 200, 220, ("lag", 120), c_ganga, fin=40, stale=True)
        i2 = create_issue(s, work=w2, actor=p2["je"], source="officer", category="delay", reason_code="LAND",
                          title="Raiyati land dispute at ch. 0.9–1.2 km; work stopped",
                          description="Two landowners have objected to the alignment between chainage 0.9 and 1.2 km. Work stopped mid-season. Needs measurement and settlement by the CO.",
                          stage_id=stage(st2, "Granular sub-base / WBM").id, at=at(T - timedelta(days=52)))
        transition(s, i2, "assign", p2["ee"], owner_id=co_alauli.id, due_date=T - timedelta(days=16),
                   note="CO Alauli to complete joint measurement with the amin and settle the objection.", at=at(T - timedelta(days=50)))

        # ---- Reference: full lifecycle closed, work certified usable ----
        w3, st3, p3 = make_work("BEL-R-005", "Beldaur – Tehri link road (2.2 km)", "road", "RWD", "PMGSY", "Beldaur", "Tehri",
                                98.0, 300, 250, "complete", c_bag, fin=100)
        w3.completion_claimed_on = T - timedelta(days=40)
        i3 = create_issue(s, work=w3, actor=None, source="citizen", category="usability",
                          title="Water collects near Tehri chowk after rain",
                          description="Water collects near Tehri chowk after rain, side drain seems blocked.",
                          complainant_name="Sunita Devi", complainant_phone="9701234540", at=at(T - timedelta(days=38), 8))
        notify_status(s, i3, at(T - timedelta(days=38), 8))
        transition(s, i3, "acknowledge", p3["je"], at=at(T - timedelta(days=37)))
        transition(s, i3, "examine", p3["ae"], at=at(T - timedelta(days=35)))
        e3 = photo(w3, stage(st3, "Side drains"), "Inspection: drain outlet blocked at chowk, km 1.4", T - timedelta(days=35), p3["ae"], ch=1.4, purpose="inspection")
        transition(s, i3, "verify", p3["ae"], evidence_id=e3.id, at=at(T - timedelta(days=35), 15),
                   note="Side drain outlet at Tehri chowk built 15 cm above invert level; water cannot exit. Defect confirmed.")
        transition(s, i3, "assign", p3["ee"], owner_id=c_bag.id, due_date=T - timedelta(days=15),
                   note="Contractor to re-lay 30 m outlet at correct level within defect liability.", at=at(T - timedelta(days=34)))
        e3b = photo(w3, stage(st3, "Side drains"), "Outlet re-laid at correct invert, km 1.4", T - timedelta(days=20), c_bag, ch=1.4, purpose="rectification")
        transition(s, i3, "rectified", c_bag, evidence_id=e3b.id, note="Outlet re-laid.", at=at(T - timedelta(days=20)))
        e3c = photo(w3, stage(st3, "Side drains"), "Post-rain check: no ponding at chowk", T - timedelta(days=14), p3["ee"], ch=1.4, purpose="reinspection")
        transition(s, i3, "close", p3["ee"], evidence_id=e3c.id, at=at(T - timedelta(days=14)),
                   note="Checked after 40 mm rain on site visit; no ponding. Closed.")
        for it in s.exec(select(UsabilityItem).where(UsabilityItem.work_id == w3.id)).all():
            x = photo(w3, None, f"Usability: {it.item}", T - timedelta(days=12), p3["ee"], purpose="completion")
            it.passed, it.verified_by, it.verified_on, it.evidence_id = True, p3["ee"].id, T - timedelta(days=12), x.id
        w3.status = "USABLE_VERIFIED"
        w3.certified_on, w3.dlp_end = T - timedelta(days=12), date(T.year + 5, T.month, min(T.day, 28))
        s.add(PostCheck(work_id=w3.id, due_date=date(T.year + (1 if T >= date(T.year, 6, 15) else 0), 10, 31)))
        for k in range(6):
            s.add(UsabilityVote(work_id=w3.id, usable=True, voter=f"seed-{k}", at=at(T - timedelta(days=10 - k))))

        # ---- the same photo filed under two drains ----
        w4, st4, p4 = make_work("KHG-D-021", "Station Road drain, Ward 12 (420 m)", "drain", "Nagar Parishad",
                                "15th Finance Commission", "Khagaria", "Ward 12", 38.0, 90, 150, "on_track", c_ganga)
        w5, st5, p5 = make_work("KHG-D-019", "Masjid Gali drain, Ward 7 (310 m)", "drain", "Nagar Parishad",
                                "15th Finance Commission", "Khagaria", "Ward 7", 27.5, 120, 150, "on_track", c_ganga)
        photo(w5, stage(st5, "Masonry / RCC walls"), "Masonry wall progress", T - timedelta(days=30), p5["je"], ch=0.1, seed_no=777)
        photo(w4, stage(st4, "Masonry / RCC walls"), "Masonry wall progress", T - timedelta(days=6), p4["je"], ch=0.1, seed_no=777)

        # ---- photo outside the site, and a hold point bypassed (bitumen laid before WBM tests) ----
        w6, st6, p6 = make_work("MAN-R-011", "Mansi – Thatha road strengthening (2.6 km)", "road", "RWD", "MMGSY",
                                "Mansi", "Thatha", 104.0, 110, 240, "on_track", c_kosi,
                                force={"Bituminous surface": 0.15}, missing_tests=(("Granular sub-base / WBM", "Compacted layer thickness"),))
        photo(w6, stage(st6, "Granular sub-base / WBM"), "WBM layer (geotag off-site)", T - timedelta(days=4), p6["je"],
              lat=w6.lat + .05, lng=w6.lng + .04)

        # ---- stale evidence + slip culvert ----
        wc, _, pc = make_work("CHA-C-002", "Culvert on Chautham – Malpa road (2 x 3 m)", "culvert", "RWD", "State Plan",
                              "Chautham", "Malpa", 18.5, 100, 120, ("lag", 45), c_bag, stale=True)
        s.add(TimeExtension(work_id=wc.id, old_end=wc.planned_end, new_end=wc.planned_end + timedelta(days=45), reason_code="FLOOD_SEASON",
                            note="Site under water for 6 weeks during the Kosi flood; working days lost as per site diary.",
                            approved_by=pc["ee"].id, approved_on=T - timedelta(days=30)))
        wc.revised_end = wc.planned_end + timedelta(days=45)

        # ---- repeat complaints on a drain; failed slab cube test linked to the verified defect ----
        w7, st7, p7 = make_work("GOG-D-004", "Gogri Haat drain (650 m)", "drain", "RWD", "State Plan",
                                "Gogri", "Gogri Haat", 44.0, 150, 180, "on_track", c_kosi,
                                fail_tests={("Cover slabs", "Cube strength (M20, 28-day)"): 16.2}, force={"Cover slabs": 0.6})
        for k, (txt, ago) in enumerate([("Drain slab cracked near fish market", 25),
                                        ("Open drain trench, no barricade, cattle fell in", 12),
                                        ("Construction waste dumped into drain", 3)]):
            ii = create_issue(s, work=w7, actor=None, source="citizen", category="safety" if k == 1 else "quality",
                              title=txt, description=txt + ".", at=at(T - timedelta(days=ago), 9))
            if k == 2:
                ii.supporters = 3
            if k == 0:
                transition(s, ii, "acknowledge", p7["je"], at=at(T - timedelta(days=24)))
                transition(s, ii, "examine", p7["ae"], at=at(T - timedelta(days=22)))
                ex = photo(w7, stage(st7, "Cover slabs"), "Inspection: slab crack measured", T - timedelta(days=22), p7["ae"], purpose="inspection")
                transition(s, ii, "verify", p7["ae"], evidence_id=ex.id, at=at(T - timedelta(days=22), 15),
                           note="Two cover slabs show through-cracks; 28-day cube strength 16.2 N/mm² against 20 required. Replace slabs.")
                transition(s, ii, "assign", p7["ee"], owner_id=c_kosi.id, due_date=T + timedelta(days=5),
                           note="Replace 2 slabs; submit fresh cube test report.", at=at(T - timedelta(days=21)))
                tst = s.exec(select(QualityTest).where(QualityTest.work_id == w7.id, QualityTest.stage_id == stage(st7, "Cover slabs").id)).first()
                tst.issue_id = ii.id
            if k == 1:
                transition(s, ii, "acknowledge", p7["je"], at=at(T - timedelta(days=11)))
                transition(s, ii, "examine", p7["ae"], at=at(T - timedelta(days=10)))
                ex = photo(w7, stage(st7, "Excavation"), "Inspection: barricading present along trench", T - timedelta(days=10), p7["ae"], ch=0.3, purpose="inspection")
                transition(s, ii, "reject", p7["ae"], evidence_id=ex.id, at=at(T - timedelta(days=10), 16),
                           note="Barricading found in place on inspection; incident occurred during a gap now closed. Contractor cautioned.")

        # ---- payments ahead of physical work ----
        make_work("PAR-R-009", "Parbatta – Kolwara road (2.0 km)", "road", "RWD", "MMGSY", "Parbatta", "Kolwara",
                  79.0, 160, 210, ("lag", 60), c_ganga, fin=72)

        # ---- failed core thickness: auto-raised verified defect ----
        w8, st8, p8 = make_work("CHA-R-010", "Chautham – Rohiyar road (3.4 km)", "road", "RWD", "PMGSY", "Chautham", "Rohiyar",
                                142.0, 180, 300, "on_track", c_kosi, fail_tests={("Bituminous surface", "Core thickness"): 15})
        ft = next(t for t in s.exec(select(QualityTest).where(QualityTest.work_id == w8.id)).all() if t.name == "Core thickness")
        fi = create_issue(s, work=w8, actor=p8["ae"], source="inspection", category="quality",
                          title="Core thickness 15 mm against 20 mm minimum",
                          description=f"Core thickness test at km {ft.chainage_km}: 15 mm against 20 mm minimum. Bituminous surface to be re-laid on the affected stretch.",
                          stage_id=ft.stage_id, evidence_id=photo(w8, stage(st8, "Bituminous surface"), f"Core sample at km {ft.chainage_km}",
                                                                  T - timedelta(days=9), p8["ae"], ch=ft.chainage_km, purpose="test_report").id,
                          at=at(T - timedelta(days=9)))
        ft.issue_id = fi.id

        w9, st9, p9 = make_work("ALA-R-003", "Alauli – Sahsi road (1.6 km)", "road", "RWD", "MMGSY", "Alauli", "Sahsi",
                                72.0, 520, 240, "complete", c_ganga, fin=100)
        w9.status, w9.completion_claimed_on = "USABLE_VERIFIED", T - timedelta(days=290)
        w9.certified_on = T - timedelta(days=280)
        w9.dlp_end = date(w9.certified_on.year + 5, w9.certified_on.month, min(w9.certified_on.day, 28))
        for it in s.exec(select(UsabilityItem).where(UsabilityItem.work_id == w9.id)).all():
            x = photo(w9, None, f"Usability: {it.item}", w9.certified_on, p9["ee"], purpose="completion")
            it.passed, it.verified_by, it.verified_on, it.evidence_id = True, p9["ee"].id, w9.certified_on, x.id
        s.add(PostCheck(work_id=w9.id, due_date=T - timedelta(days=12)))
        for k in range(12):
            s.add(UsabilityVote(work_id=w9.id, usable=k not in (2, 6, 9), voter=f"seed-{k}", at=at(T - timedelta(days=4 + k * 5))))

        make_work("PAR-B-003", "Govt. Middle School, Parbatta — 4 additional classrooms", "building", "BCD",
                  "Samagra Shiksha", "Parbatta", "Parbatta", 64.0, 140, 270, "on_track", c_bag)

        fillers = [
            ("KHG-B-006", "Anganwadi centre building, Sonmankhi", "building", "BCD", "ICDS", "Khagaria", "Sonmankhi", 14.5, 120, 200, "on_track", c_kosi),
            ("KHG-R-018", "Khagaria – Rahimpur road repair (1.4 km)", "road", "RWD", "Maintenance", "Khagaria", "Rahimpur", 32.0, 60, 120, "on_track", c_ganga),
            ("MAN-D-003", "Mansi bazaar drain (380 m)", "drain", "RWD", "State Plan", "Mansi", "Mansi Bazaar", 21.0, 80, 140, ("lag", 25), c_bag),
            ("BEL-B-002", "Health sub-centre building, Beldaur", "building", "BCD", "State Plan", "Beldaur", "Beldaur", 48.0, 210, 300, ("lag", 35), c_ganga),
            ("BEL-C-004", "Culvert at Pirnagra (1 x 2 m)", "culvert", "RWD", "MMGSY", "Beldaur", "Pirnagra", 9.0, 40, 90, "on_track", c_bag),
            ("ALA-D-002", "Alauli market drain (290 m)", "drain", "RWD", "15th Finance Commission", "Alauli", "Alauli", 17.5, 50, 120, "on_track", c_kosi),
            ("ALA-B-001", "Panchayat Sarkar Bhawan, Hardiya", "building", "BCD", "State Plan", "Alauli", "Hardiya", 112.0, -10, 365, "none", c_ganga),
            ("GOG-R-022", "Gogri – Jamalpur bypass link (1.1 km)", "road", "RWD", "State Plan", "Gogri", "Jamalpur", 51.0, -5, 200, "none", c_bag),
            ("PAR-C-006", "Culvert on Parbatta – Agwanpur road", "culvert", "RWD", "Maintenance", "Parbatta", "Agwanpur", 11.0, 70, 100, "on_track", c_kosi),
            ("KHG-D-024", "Collectorate campus storm drain (260 m)", "drain", "Nagar Parishad", "15th Finance Commission", "Khagaria", "Collectorate", 19.0, 30, 100, "on_track", c_bag),
        ]
        for f in fillers:
            make_work(*f)

        # illustrative approval trail for seeded bills: the EE authorised every one, but the AE only checked bills
        # whose measurements had been check-measured (the irregularity the BILL_UNCHECKED flag points at)
        s.flush()
        for b in s.exec(select(Bill)).all():
            w = s.get(Work, b.work_id)
            mbs = [s.get(Measurement, i) for i in json.loads(b.mb_ids)]
            if all(m.checked_by is not None for m in mbs):
                b.checked_by, b.checked_on = w.ae_id, b.bill_date + timedelta(days=3)
            b.authorized_by, b.authorized_on = w.ee_id, b.bill_date + timedelta(days=7)

        s.commit()


if __name__ == "__main__":
    seed(reset=True)
    print("Seeded.")
