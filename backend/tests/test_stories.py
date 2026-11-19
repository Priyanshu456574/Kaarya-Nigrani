"""End-to-end checks of the three demo stories and the core rules."""
import io
import os
import tempfile
from datetime import date, timedelta

_tmp = tempfile.mkdtemp()
os.environ["KN_DB_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["KN_MEDIA_DIR"] = f"{_tmp}/media"

import shutil  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app import main as main_mod  # noqa: E402
from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Issue  # noqa: E402
from app.seed import make_photo, seed  # noqa: E402

_TEMPLATE = {}


@pytest.fixture()
def c():
    # seed once, then restore the seeded database and media before every test
    if not _TEMPLATE:
        seed(reset=True)
        engine.dispose()
        shutil.copy(f"{_tmp}/test.db", f"{_tmp}/template.db")
        shutil.copytree(f"{_tmp}/media", f"{_tmp}/template_media")
        _TEMPLATE["ok"] = True
    engine.dispose()
    shutil.copy(f"{_tmp}/template.db", f"{_tmp}/test.db")
    shutil.rmtree(f"{_tmp}/media", ignore_errors=True)
    shutil.copytree(f"{_tmp}/template_media", f"{_tmp}/media")
    main_mod._hits.clear()
    with TestClient(app) as client:
        yield client


def track_key(ticket):
    with Session(engine) as s:
        return s.exec(select(Issue).where(Issue.ticket == ticket)).first().track_key


def officers(c):
    return {(o["role"], o["name"]): o["id"] for o in c.get("/api/meta").json()["officers"]}


def oid(c, role, name_part):
    return next(v for (r, n), v in officers(c).items() if r == role and name_part in n)


def dm(c):
    return {"X-User": str(oid(c, "DM", ""))}


def work_by_code(c, code, user=None):
    w = next(w for w in c.get("/api/dashboard", headers=dm(c)).json()["works"] if w["code"] == code)
    return c.get(f"/api/works/{w['id']}", headers={"X-User": str(user)} if user else dm(c)).json()


def upload(c, work_id, user, caption, stage_id=None, lat=None, lng=None, seed_no=5, purpose="progress", kind="photo"):
    data = {"kind": kind, "caption": caption, "purpose": purpose}
    if stage_id:
        data["stage_id"] = str(stage_id)
    if lat is not None:
        data.update(lat=str(lat), lng=str(lng))
    r = c.post(f"/api/works/{work_id}/evidence", data=data, headers={"X-User": str(user)},
               files={"file": ("x.jpg", io.BytesIO(make_photo(seed_no, caption, "road")), "image/jpeg")})
    assert r.status_code == 200, r.text
    return r.json()


def act(c, issue_id, user, action, **kw):
    return c.post(f"/api/issues/{issue_id}/actions", json={"action": action, **kw}, headers={"X-User": str(user)})


def test_story_delay_explained_and_owned(c):
    w = work_by_code(c, "ALA-R-007")
    codes = {f["code"] for f in w["flags"]}
    assert {"SCHEDULE_SLIP", "OVERDUE_ACTION"} <= codes
    slip = next(f for f in w["flags"] if f["code"] == "SCHEDULE_SLIP")
    assert "land dispute" in slip["message"].lower()
    delay = next(i for i in w["issues"] if i["category"] == "delay")
    assert delay["owner"]["role"] == "CO" and delay["overdue"]
    dash = c.get("/api/dashboard", headers=dm(c)).json()
    assert dash["intervention"][0]["code"] == "GOG-R-014"


def test_story_citizen_report_to_verified_closure(c):
    w = work_by_code(c, "GOG-R-014")
    assert any(f["code"] == "COMPLETE_NOT_USABLE" for f in w["flags"])
    drains = next(s for s in w["stages"] if s["name"] == "Side drains")

    # resident reports via QR and receives a private tracking key
    r = c.post(f"/api/public/works/{w['qr_token']}/reports",
               data={"category": "usability", "description": "Paani bhar jaata hai, naali nahi bani", "phone": "9000000000"},
               files={"file": ("r.jpg", io.BytesIO(make_photo(99, "resident", "road")), "image/jpeg")})
    assert r.status_code == 200
    ticket, key = r.json()["ticket"], r.json()["track_key"]
    assert c.get(f"/api/public/track/{ticket}").status_code == 404  # the ticket number alone is not enough
    pub = c.get(f"/api/public/track/{ticket}?key={key}").json()
    assert pub["issue"]["status"] == "REPORTED" and pub["issue"]["verified"] is False
    assert "complainant_phone" not in pub["issue"]

    issue = next(i for i in work_by_code(c, "GOG-R-014")["issues"] if i["ticket"] == ticket)
    je, ae, ee = oid(c, "JE", "Ravi"), oid(c, "AE", "Anjali"), oid(c, "EE", "Suresh")
    contractor = oid(c, "CONTRACTOR", "Kosi")

    assert act(c, issue["id"], contractor, "acknowledge").status_code == 403
    assert act(c, issue["id"], je, "acknowledge").status_code == 200
    assert act(c, issue["id"], je, "examine").status_code == 200
    assert act(c, issue["id"], je, "verify", note="x", evidence_id=1).status_code == 403
    resident_ev = next(e for e in work_by_code(c, "GOG-R-014")["evidence"] if e["source"] == "citizen")
    assert act(c, issue["id"], ae, "verify", note="drain missing", evidence_id=resident_ev["id"]).status_code == 400
    insp = upload(c, w["id"], ae, "Inspection: side drain absent km 1.2-2.0", drains["id"], w["lat"], w["lng"], 11, "inspection")
    assert act(c, issue["id"], ae, "verify", note="Side drain not constructed for 800 m.", evidence_id=insp["id"]).status_code == 200
    assert act(c, issue["id"], ee, "assign", owner_id=contractor, due_date=str(date.today() + timedelta(days=20))).status_code == 200
    r = c.post(f"/api/works/{w['id']}/certify", headers={"X-User": str(ee)})
    assert r.status_code == 409 and "OPEN_ISSUES" in {b["code"] for b in r.json()["detail"]["blockers"]}

    fix = upload(c, w["id"], contractor, "Side drain constructed", drains["id"], w["lat"], w["lng"], 12, "rectification")
    assert act(c, issue["id"], contractor, "rectified", evidence_id=fix["id"]).status_code == 200
    chk = upload(c, w["id"], ae, "AE re-inspection: drain flowing", drains["id"], w["lat"], w["lng"], 13, "reinspection")
    assert act(c, issue["id"], ae, "close", evidence_id=chk["id"]).status_code == 200
    assert c.get(f"/api/public/track/{ticket}?key={key}").json()["issue"]["status"] == "CLOSED"


def test_legitimate_certification_after_every_condition_is_met(c):
    w = work_by_code(c, "GOG-R-014")
    je, ae, ee = oid(c, "JE", "Ravi"), oid(c, "AE", "Anjali"), oid(c, "EE", "Suresh")
    contractor = oid(c, "CONTRACTOR", "Kosi")
    codes = lambda: {b["code"] for b in work_by_code(c, "GOG-R-014")["certification"]["blockers"]}
    assert {"NOT_CHECK_MEASURED", "EVIDENCE_MISSING", "TEST_MISSING", "OPEN_ISSUES", "CHECK_NOT_PASSED"} <= codes()
    # 1. AE check-measures everything
    for s in w["stages"]:
        for m in s["measurements"]:
            if m["checked_by"] is None:
                assert c.post(f"/api/measurements/{m['id']}/check", headers={"X-User": str(ae)}).status_code == 200
    # 2. site evidence for every measured 0.5 km bin
    from app import geo
    for s in w["stages"]:
        if s["linear"]:
            for a, b in s["gaps"]:
                k = a
                while k < b - 1e-6:
                    lat, lng = geo.point_at(w["line"], min(k + 0.25, b - 0.01))
                    upload(c, w["id"], je, f"{s['name']} km {k}", s["id"], lat, lng, 300 + int(k * 10) + s["id"])
                    k += 0.5
        elif s["covered"] == 0:
            upload(c, w["id"], je, f"{s['name']} done", s["id"], w["lat"], w["lng"], 400 + s["id"])
    # 3. missing test, to specification
    for s in w["stages"]:
        for t in s["tests"]:
            if t["result"] is None:
                ev = upload(c, w["id"], je, f"{t['name']} report", s["id"], w["lat"], w["lng"], 500 + t["id"], "test_report")
                assert c.post(f"/api/tests/{t['id']}", json={"result": (t["spec_min"] or 1) + 1, "evidence_id": ev["id"]},
                              headers={"X-User": str(je)}).json()["passed"] is True
    # 4. the open resident report: examined, fixed, independently re-inspected
    old = next(i for i in work_by_code(c, "GOG-R-014")["issues"] if i["status"] == "REPORTED")
    approach = next(s for s in w["stages"] if s["name"] == "Approach & road furniture")
    assert act(c, old["id"], je, "acknowledge").status_code == 200
    assert act(c, old["id"], ae, "examine").status_code == 200
    e1 = upload(c, w["id"], ae, "Inspection: school approach unpaved", approach["id"], w["lat"], w["lng"], 40, "inspection")
    assert act(c, old["id"], ae, "verify", note="200 m approach not built.", evidence_id=e1["id"]).status_code == 200
    assert act(c, old["id"], ee, "assign", owner_id=contractor, due_date=str(date.today() + timedelta(days=15))).status_code == 200
    e2 = upload(c, w["id"], contractor, "Approach PCC laid", approach["id"], w["lat"], w["lng"], 41, "rectification")
    assert act(c, old["id"], contractor, "rectified", evidence_id=e2["id"]).status_code == 200
    e3 = upload(c, w["id"], ee, "EE re-inspection: approach complete", approach["id"], w["lat"], w["lng"], 42, "reinspection")
    assert act(c, old["id"], ee, "close", evidence_id=e3["id"]).status_code == 200
    # 5. usability checklist with the EE's own completion photos
    assert codes() == {"CHECK_NOT_PASSED"}
    for item in work_by_code(c, "GOG-R-014")["checklist"]:
        if not item["passed"]:
            e = upload(c, w["id"], ee, f"Usability: {item['item']}", None, w["lat"], w["lng"], 20 + item["id"], "completion")
            assert c.post(f"/api/works/{w['id']}/checklist/{item['id']}", json={"passed": True, "evidence_id": e["id"]},
                          headers={"X-User": str(ee)}).status_code == 200
    assert work_by_code(c, "GOG-R-014")["certification"]["eligible"] is True
    assert c.post(f"/api/works/{w['id']}/certify", headers={"X-User": str(oid(c, "AE", "Anjali"))}).status_code == 403
    assert c.post(f"/api/works/{w['id']}/certify", headers={"X-User": str(ee)}).status_code == 200
    after = work_by_code(c, "GOG-R-014")
    assert after["status"] == "USABLE_VERIFIED"
    assert any(a["action"] == "certify" for a in after["audit"])
    # payment is reported separately and was never a condition
    assert after["finance"]["paid_pct"] == 98.0 and after["finance"]["verified_source"] is False


def test_closer_must_differ_from_rectifier(c):
    w = work_by_code(c, "GOG-D-004")
    issue = next(i for i in w["issues"] if i["status"] == "ACTION_ASSIGNED")
    ae = oid(c, "AE", "Anjali")
    # AE is not owner/JE/contractor, so cannot mark rectified
    assert act(c, issue["id"], ae, "rectified", evidence_id=1).status_code == 403


def test_integrity_flags(c):
    assert any(f["code"] == "DUPLICATE_PHOTO" for f in work_by_code(c, "KHG-D-021")["flags"])
    assert any(f["code"] == "OUTSIDE_SITE" for f in work_by_code(c, "MAN-R-011")["flags"])
    assert any(f["code"] == "FIN_AHEAD" for f in work_by_code(c, "PAR-R-009")["flags"])
    assert not work_by_code(c, "ALA-B-001")["flags"]  # not started yet: nothing to flag
    assert work_by_code(c, "BEL-R-005")["flags"] == []


def test_public_view_hides_private_data(c):
    w = work_by_code(c, "GOG-R-014")
    pub = c.get(f"/api/public/works/{w['qr_token']}").json()
    text = str(pub)
    assert "98XXXXXX21" not in text and "Mahesh" not in text
    assert all(r["verified"] is False for r in pub["reports"] if r["status"] == "REPORTED")


def test_hold_point_blocks_measurement(c):
    w = work_by_code(c, "MAN-R-011")
    je = next(o["id"] for o in c.get("/api/meta").json()["officers"] if o["name"] == "Er. Pooja Singh")
    bit = next(s for s in w["stages"] if s["name"] == "Bituminous surface")
    assert bit["hold"] and "Compacted layer thickness" in bit["hold"]["tests"]
    r = c.post(f"/api/works/{w['id']}/measurements", json={"stage_id": bit["id"], "qty": 0.2, "ch_from": 0.4, "ch_to": 0.6},
               headers={"X-User": str(je)})
    assert r.status_code == 409 and "Hold point" in r.json()["detail"]
    # record the pending WBM test as passed, then measuring is allowed
    wbm = next(s for s in w["stages"] if s["name"] == "Granular sub-base / WBM")
    t = next(t for t in wbm["tests"] if t["result"] is None)
    ev = upload(c, w["id"], je, "Thickness test", wbm["id"], w["lat"], w["lng"], 50, "test_report")
    r = c.post(f"/api/tests/{t['id']}", json={"result": 80, "evidence_id": ev["id"]}, headers={"X-User": str(je)})
    assert r.json()["passed"] is True
    r = c.post(f"/api/works/{w['id']}/measurements", json={"stage_id": bit["id"], "qty": 0.2, "ch_from": 0.4, "ch_to": 0.6},
               headers={"X-User": str(je)})
    assert r.status_code == 200, r.text
    assert not any(f["code"] == "HOLD_BYPASSED" for f in work_by_code(c, "MAN-R-011")["flags"])


def test_failed_test_raises_verified_defect(c):
    w = work_by_code(c, "GOG-R-014")
    je, ee = oid(c, "JE", "Ravi"), oid(c, "EE", "Suresh")
    drains = next(s for s in w["stages"] if s["name"] == "Side drains")
    t = drains["tests"][0]
    ev = upload(c, w["id"], je, "Cube test report", drains["id"], w["lat"], w["lng"], 51, "test_report")
    r = c.post(f"/api/tests/{t['id']}", json={"result": 17.5, "evidence_id": ev["id"]}, headers={"X-User": str(je)})
    assert r.json()["passed"] is False and r.json()["issue"]
    issue = next(i for i in work_by_code(c, "GOG-R-014")["issues"] if i["ticket"] == r.json()["issue"])
    assert issue["status"] == "VERIFIED" and issue["owner"]["role"] == "EE"
    assert any(f["code"] == "TEST_FAILED" for f in work_by_code(c, "GOG-R-014")["flags"])


def test_check_measure_and_unchecked_bill(c):
    w = work_by_code(c, "GOG-R-014")
    assert any(f["code"] == "BILL_UNCHECKED" for f in w["flags"])
    je, ae = oid(c, "JE", "Ravi"), oid(c, "AE", "Anjali")
    pending = [m for s in w["stages"] for m in s["measurements"] if m["checked_by"] is None]
    assert pending
    assert c.post(f"/api/measurements/{pending[0]['id']}/check", headers={"X-User": str(je)}).status_code == 403
    for m in pending:
        assert c.post(f"/api/measurements/{m['id']}/check", headers={"X-User": str(ae)}).status_code == 200
    assert not any(f["code"] == "BILL_UNCHECKED" for f in work_by_code(c, "GOG-R-014")["flags"])


def test_chainage_coverage_and_gap(c):
    w = work_by_code(c, "GOG-R-014")
    bit = next(s for s in w["stages"] if s["name"] == "Bituminous surface")
    assert bit["gaps"] == [[2.0, 3.0]] and 0.6 < bit["covered"] < 0.7
    # a photo geotagged at km 2.4 gets its chainage from GPS and closes part of the gap
    from app import geo
    lat, lng = geo.point_at(w["line"], 2.4)
    ev = upload(c, w["id"], oid(c, "JE", "Ravi"), "Surface at km 2.4", bit["id"], lat, lng, 52)
    assert abs(ev["chainage_km"] - 2.4) < 0.02 and ev["in_geofence"] is True
    bit = next(s for s in work_by_code(c, "GOG-R-014")["stages"] if s["name"] == "Bituminous surface")
    assert bit["gaps"] == [[2.5, 3.0]]


def test_escalation_reaches_ddc(c):
    d = c.get("/api/dashboard", headers=dm(c)).json()
    esc = next(e for e in d["escalated"] if e["ticket"] == "KGR-2026-0002")
    assert esc["to"]["role"] == "DDC" and esc["owner"]["role"] == "CO"
    assert d["holdups"][0]["reason"] == "LAND"
    ddc = oid(c, "DDC", "Verma")
    w = work_by_code(c, "ALA-R-007")
    flag = next(f for f in w["flags"] if f["code"] == "OVERDUE_ACTION")
    assert "Escalated" in flag["message"] and "बढ़ाया" in flag["message_hi"]


def test_each_person_gets_a_short_task_list(c):
    co = oid(c, "CO", "Rajesh")
    tasks = c.get("/api/tasks", headers={"X-User": str(co)}).json()
    assert [t["title"] for t in tasks] == ["Resolve the hold-up"]
    ddc = oid(c, "DDC", "Verma")
    assert c.get("/api/tasks", headers={"X-User": str(ddc)}).json()[0]["title"].startswith("Escalated to you")
    je = oid(c, "JE", "Ravi")
    ts = c.get("/api/tasks", headers={"X-User": str(je)}).json()
    assert ts[0]["priority"] == "urgent" and ts[0]["title"] == "Acknowledge a resident report"
    assert all(len(c.get("/api/tasks", headers={"X-User": str(o["id"])}).json()) <= 8 for o in c.get("/api/meta").json()["officers"])


def test_same_problem_adds_voice_and_sends_sms(c):
    w = work_by_code(c, "GOG-R-014")
    ticket = next(i["ticket"] for i in w["issues"] if i["source"] == "citizen")
    r = c.post(f"/api/public/issues/{ticket}/support", json={"phone": "9812345678"})
    assert r.status_code == 200 and r.json()["supporters"] == 8 and r.json()["sms"][0]["to"] == "98XXXXXX78"
    # a status change now reaches the new supporter too
    je = oid(c, "JE", "Ravi")
    issue = next(i for i in work_by_code(c, "GOG-R-014")["issues"] if i["ticket"] == ticket)
    act(c, issue["id"], je, "acknowledge")
    track = c.get(f"/api/public/track/{ticket}?key={track_key(ticket)}").json()
    assert sum(1 for s in track["sms"] if s["to"] == "98XXXXXX78") == 2
    assert all("9812345678" not in s["to"] for s in track["sms"])


def test_voice_report_and_privacy(c):
    w = work_by_code(c, "GOG-D-004")
    r = c.post(f"/api/public/works/{w['qr_token']}/reports", data={"category": "safety", "phone": "9000000001"},
               files={"voice": ("v.webm", io.BytesIO(b"\x1a\x45\xdf\xa3" + b"0" * 64), "audio/webm")})
    assert r.status_code == 200, r.text
    t = r.json()["ticket"]
    officer_view = next(i for i in work_by_code(c, "GOG-D-004")["issues"] if i["ticket"] == t)
    assert officer_view["voice"] and officer_view["title"].startswith("Voice report")
    assert c.get(f"/api/public/track/{t}?key={r.json()['track_key']}").json()["issue"]["voice"] is None
    assert c.post(f"/api/public/works/{w['qr_token']}/reports", data={"category": "safety"}).status_code == 400


def test_time_extension_moves_due_date_and_plan(c):
    w = work_by_code(c, "PAR-R-009")
    ee = oid(c, "EE", "Suresh")
    slip_before = next(f for f in w["flags"] if f["code"] == "SCHEDULE_SLIP")
    new_end = str(date.fromisoformat(w["due_date"]) + timedelta(days=120))
    assert c.post(f"/api/works/{w['id']}/extensions", json={"new_end": new_end, "reason_code": "FLOOD_SEASON"},
                  headers={"X-User": str(ee)}).status_code == 400  # a reason in writing is required
    assert c.post(f"/api/works/{w['id']}/extensions", json={"new_end": new_end, "reason_code": "FLOOD_SEASON", "note": "Flooded 8 weeks"},
                  headers={"X-User": str(ee)}).status_code == 200
    w2 = work_by_code(c, "PAR-R-009")
    assert w2["due_date"] == new_end and w2["planned_end"] == w["planned_end"] and len(w2["extensions"]) == 1
    assert w2["planned"] < w["planned"]
    assert slip_before


def test_postcheck_and_resident_votes(c):
    w = work_by_code(c, "ALA-R-003")
    assert {"POSTCHECK_OVERDUE", "RESIDENTS_NOT_USABLE"} <= {f["code"] for f in w["flags"]}
    ae = oid(c, "AE", "Irfan")
    pc = next(p for p in w["postchecks"] if p["done_on"] is None)
    ev = upload(c, w["id"], ae, "Post-monsoon check", None, w["lat"], w["lng"], 60, "inspection")
    r = c.post(f"/api/postchecks/{pc['id']}", json={"passed": False, "note": "Edge break at km 0.8 after floods", "evidence_id": ev["id"]},
               headers={"X-User": str(ae)})
    assert r.status_code == 200
    w2 = work_by_code(c, "ALA-R-003")
    assert any(i["title"].startswith("Post-monsoon re-check") and i["status"] == "VERIFIED" for i in w2["issues"])
    assert c.post(f"/api/public/works/{w['qr_token']}/usable", json={"usable": True}).status_code == 200
    assert work_by_code(c, "ALA-R-003")["votes"]["yes"] == 10


def test_surprise_inspection(c):
    d = c.get("/api/dashboard", headers=dm(c)).json()
    picks = d["inspections"]
    assert len(picks) == 3 and sum(p["reason"] == "random" for p in picks) == 1
    pick = picks[0]
    ae = pick["assigned_to"]["id"]
    w = c.get(f"/api/works/{pick['work']['id']}", headers=dm(c)).json()
    ev = upload(c, w["id"], ae, "Surprise visit", None, w["lat"], w["lng"], 61, "inspection")
    assert c.post(f"/api/works/{w['id']}/inspection", json={"outcome": "ok", "evidence_id": ev["id"]}, headers={"X-User": str(ae)}).status_code == 200
    assert next(p for p in c.get("/api/dashboard", headers=dm(c)).json()["inspections"] if p["work"]["id"] == w["id"])["done"]["outcome"] == "ok"
    assert not any(t["kind"] == "inspection" and t["work"]["id"] == w["id"] for t in c.get("/api/tasks", headers={"X-User": str(ae)}).json())


# ---------- who sees what ----------

def test_officer_endpoints_need_login(c):
    w = work_by_code(c, "GOG-R-014")
    assert c.get("/api/dashboard").status_code == 401
    assert c.get(f"/api/works/{w['id']}").status_code == 401
    assert c.get("/api/issues").status_code == 401


def test_each_person_sees_only_their_works(c):
    ravi, kosi, co = oid(c, "JE", "Ravi"), oid(c, "CONTRACTOR", "Kosi"), oid(c, "CO", "")
    codes = lambda u: {w["code"] for w in c.get("/api/dashboard", headers={"X-User": str(u)}).json()["works"]}
    assert codes(ravi) == {"GOG-R-014", "GOG-D-004", "GOG-R-022"}
    assert "ALA-R-007" not in codes(kosi) and "GOG-R-014" in codes(kosi)
    assert codes(co) == {"ALA-R-007"}
    assert c.get("/api/dashboard", headers={"X-User": str(oid(c, "EE", "Rakesh"))}).json()["scope"] == "department"
    other = work_by_code(c, "ALA-R-007")
    assert c.get(f"/api/works/{other['id']}", headers={"X-User": str(ravi)}).status_code == 403
    assert c.post(f"/api/works/{other['id']}/evidence", data={"caption": "x"}, headers={"X-User": str(kosi)}).status_code == 403


def test_contractor_view_hides_people_suspicion_and_unexamined_reports(c):
    kosi = oid(c, "CONTRACTOR", "Kosi")
    w = work_by_code(c, "GOG-R-014", kosi)
    assert w["access"]["level"] == "contractor" and not w["access"]["complainant"]
    assert not {f["code"] for f in w["flags"]} & {"BILL_UNCHECKED", "DUPLICATE_PHOTO", "OUTSIDE_SITE", "FIN_AHEAD", "HOLD_BYPASSED"}
    assert all(i["status"] not in {"REPORTED", "ACKNOWLEDGED", "UNDER_EXAMINATION"} for i in w["issues"])
    assert all(i.get("complainant_phone") is None for i in w["issues"])
    assert all(e["source"] == "officer" for e in w["evidence"])
    full = work_by_code(c, "GOG-R-014")
    assert any(f["code"] == "BILL_UNCHECKED" for f in full["flags"])
    assert any(i["status"] == "REPORTED" and i["complainant_phone"] for i in full["issues"])
    # he cannot act on a report that was never given to him
    open_report = next(i for i in full["issues"] if i["status"] == "REPORTED")
    assert act(c, open_report["id"], kosi, "acknowledge").status_code == 403
    mine = c.get("/api/issues", headers={"X-User": str(kosi)}).json()
    assert all(i["owner"] and i["owner"]["id"] == kosi for i in mine if i["status"] == "ACTION_ASSIGNED")


def test_circle_officer_sees_only_the_hold_up(c):
    co = oid(c, "CO", "")
    w = work_by_code(c, "ALA-R-007", co)
    assert w["access"]["level"] == "limited" and w["access"]["tabs"] == ["overview", "issues"]
    assert w["bills"] == [] and all(s["tests"] == [] and s["measurements"] == [] for s in w["stages"])
    assert {i["category"] for i in w["issues"]} == {"delay"}
    assert {f["code"] for f in w["flags"]} <= {"SCHEDULE_SLIP", "PAST_DEADLINE"}


def test_je_sees_no_suspicion_flags_and_inspection_stays_secret(c):
    dash = c.get("/api/dashboard", headers=dm(c)).json()
    pick = dash["inspections"][0]
    w_dm = c.get(f"/api/works/{pick['work']['id']}", headers=dm(c)).json()
    assert w_dm["inspection"] is not None
    code = pick["work"]["code"]
    full = work_by_code(c, code)
    je = full["people"]["je"]["id"] if full["people"]["je"] else None
    if je:
        assert work_by_code(c, code, je)["inspection"] is None
    contractor = full["people"]["contractor"]["id"]
    assert work_by_code(c, code, contractor)["inspection"] is None
    assert c.get("/api/dashboard", headers={"X-User": str(oid(c, "JE", "Ravi"))}).json()["inspections"] is None
    man = work_by_code(c, "MAN-R-011", oid(c, "JE", "Pooja"))
    assert not {f["code"] for f in man["flags"]} & {"OUTSIDE_SITE", "HOLD_BYPASSED"}
    assert {"OUTSIDE_SITE"} <= {f["code"] for f in work_by_code(c, "MAN-R-011")["flags"]}
