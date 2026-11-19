"""Negative and positive tests for certification, evidence, closure, audit, security and money (v0.5)."""
import io
from datetime import date, timedelta

from test_stories import act, c, dm, oid, track_key, upload, work_by_code  # noqa: F401  (c is the fixture)

from app import config, main as main_mod
from app.auth import hash_password
from app.db import engine
from app.models import OfficerCredential
from app.seed import make_photo
from sqlmodel import Session


def H(u):
    return {"X-User": str(u)}


def resident_photo(c, w):
    r = c.post(f"/api/public/works/{w['qr_token']}/reports", data={"category": "quality", "description": "Cracks near the school"},
               files={"file": ("r.jpg", io.BytesIO(make_photo(199, "resident", "road")), "image/jpeg")})
    assert r.status_code == 200, r.text
    return next(e for e in work_by_code(c, w["code"])["evidence"] if e["source"] == "citizen")


def gog_people(c):
    return oid(c, "JE", "Ravi"), oid(c, "AE", "Anjali"), oid(c, "EE", "Suresh"), oid(c, "CONTRACTOR", "Kosi")


def assigned_repair(c):
    """A verified defect on GOG-R-014 assigned to the contractor; returns (work, issue_id, stage)."""
    je, ae, ee, k = gog_people(c)
    w = work_by_code(c, "GOG-R-014")
    st = next(s for s in w["stages"] if s["name"] == "Side drains")
    i = next(i for i in w["issues"] if i["status"] == "REPORTED")
    assert act(c, i["id"], je, "acknowledge").status_code == 200
    assert act(c, i["id"], ae, "examine").status_code == 200
    e = upload(c, w["id"], ae, "Inspection", st["id"], w["lat"], w["lng"], 70, "inspection")
    assert act(c, i["id"], ae, "verify", note="Approach not built.", evidence_id=e["id"]).status_code == 200
    assert act(c, i["id"], ee, "assign", owner_id=k, due_date=str(date.today() + timedelta(days=9))).status_code == 200
    return w, i["id"], st


# ---------------- certification ----------------

def test_41_percent_work_cannot_be_claimed_ticked_or_certified(c):
    w = work_by_code(c, "ALA-D-002")
    assert 41 <= w["actual"] <= 42
    je, ae, ee = w["people"]["je"]["id"], w["people"]["ae"]["id"], w["people"]["ee"]["id"]
    r = c.post(f"/api/works/{w['id']}/claim-complete", headers=H(je))
    assert r.status_code == 409 and {b["code"] for b in r.json()["detail"]["blockers"]} == {"STAGE_NOT_MEASURED"}
    item = w["checklist"][0]
    ev = upload(c, w["id"], ee, "Looks fine", None, w["lat"], w["lng"], 71, "completion")
    assert c.post(f"/api/works/{w['id']}/checklist/{item['id']}", json={"passed": True, "evidence_id": ev["id"]},
                  headers=H(ee)).status_code == 409
    r = c.post(f"/api/works/{w['id']}/certify", headers=H(ee))
    assert r.status_code == 409 and "STAGE_INCOMPLETE" in {b["code"] for b in r.json()["detail"]["blockers"]}
    assert work_by_code(c, "ALA-D-002")["status"] == "IN_PROGRESS"


def test_checklist_rejects_invalid_foreign_and_resident_evidence(c):
    je, ae, ee, k = gog_people(c)
    w = work_by_code(c, "GOG-R-014")
    item = next(i for i in w["checklist"] if not i["passed"])
    url = f"/api/works/{w['id']}/checklist/{item['id']}"
    assert c.post(url, json={"passed": True, "evidence_id": 999999}, headers=H(ee)).json()["detail"] == "Evidence 999999 does not exist"
    other = work_by_code(c, "GOG-D-004")
    foreign = upload(c, other["id"], ee, "other work", None, other["lat"], other["lng"], 72, "completion")
    assert "another work" in c.post(url, json={"passed": True, "evidence_id": foreign["id"]}, headers=H(ee)).json()["detail"]
    resident = resident_photo(c, w)
    assert "allegation" in c.post(url, json={"passed": True, "evidence_id": resident["id"]}, headers=H(ee)).json()["detail"]
    je_photo = upload(c, w["id"], je, "JE photo", None, w["lat"], w["lng"], 73, "completion")
    assert c.post(url, json={"passed": True, "evidence_id": je_photo["id"]}, headers=H(ee)).status_code == 400  # not his own


def test_inspection_cannot_cite_another_works_evidence(c):
    je, ae, ee, k = gog_people(c)
    w = work_by_code(c, "GOG-R-014")
    i = next(i for i in w["issues"] if i["status"] == "REPORTED")
    act(c, i["id"], je, "acknowledge")
    act(c, i["id"], ae, "examine")
    other = work_by_code(c, "GOG-D-004")
    foreign = upload(c, other["id"], ae, "other", None, other["lat"], other["lng"], 74, "inspection")
    r = act(c, i["id"], ae, "verify", note="defect", evidence_id=foreign["id"])
    assert r.status_code == 400 and "another work" in r.json()["detail"]
    progress = upload(c, w["id"], ae, "progress photo", None, w["lat"], w["lng"], 75, "progress")
    assert act(c, i["id"], ae, "verify", note="defect", evidence_id=progress["id"]).status_code == 400  # wrong purpose


def test_contractor_cannot_verify_own_work(c):
    w, iid, st = assigned_repair(c)
    je, ae, ee, k = gog_people(c)
    fix = upload(c, w["id"], k, "fixed", st["id"], w["lat"], w["lng"], 76, "rectification")
    assert act(c, iid, k, "rectified", evidence_id=fix["id"]).status_code == 200
    mine = upload(c, w["id"], k, "my check", st["id"], w["lat"], w["lng"], 77, "rectification")
    assert act(c, iid, k, "close", evidence_id=mine["id"]).status_code == 403
    assert c.post(f"/api/works/{w['id']}/evidence", data={"caption": "x", "purpose": "reinspection"}, headers=H(k),
                  files={"file": ("x.jpg", io.BytesIO(make_photo(78, "x", "road")), "image/jpeg")}).status_code == 403
    m = next(m for s in w["stages"] for m in s["measurements"] if m["checked_by"] is None)
    assert c.post(f"/api/measurements/{m['id']}/check", headers=H(k)).status_code == 403


def test_closure_needs_a_fresh_independent_reinspection(c):
    w, iid, st = assigned_repair(c)
    je, ae, ee, k = gog_people(c)
    fix = upload(c, w["id"], k, "fixed", st["id"], w["lat"], w["lng"], 80, "rectification")
    assert act(c, iid, k, "rectified", evidence_id=fix["id"]).status_code == 200
    assert act(c, iid, ae, "close").status_code == 400  # no evidence
    r = act(c, iid, ae, "close", evidence_id=fix["id"])  # the repair photo itself
    assert r.status_code == 400
    jep = upload(c, w["id"], je, "JE photo", st["id"], w["lat"], w["lng"], 81, "inspection")
    assert "captured yourself" in act(c, iid, ae, "close", evidence_id=jep["id"]).json()["detail"]
    same = upload(c, w["id"], ae, "same file again", st["id"], w["lat"], w["lng"], 80, "reinspection")  # identical bytes
    assert act(c, iid, ae, "close", evidence_id=same["id"]).status_code == 400
    fresh = upload(c, w["id"], ae, "re-inspection", st["id"], w["lat"], w["lng"], 82, "reinspection")
    assert act(c, iid, ae, "close", evidence_id=fresh["id"]).status_code == 200


def test_failed_reinspection_returns_for_rework_then_closes(c):
    w, iid, st = assigned_repair(c)
    je, ae, ee, k = gog_people(c)
    fix = upload(c, w["id"], k, "fixed", st["id"], w["lat"], w["lng"], 83, "rectification")
    act(c, iid, k, "rectified", evidence_id=fix["id"])
    assert act(c, iid, ae, "reopen", note="Still ponding").status_code == 400  # needs re-inspection evidence
    bad = upload(c, w["id"], ae, "still ponding", st["id"], w["lat"], w["lng"], 84, "reinspection")
    r = act(c, iid, ae, "reopen", note="Still ponding at km 1.4", evidence_id=bad["id"])
    assert r.status_code == 200 and r.json()["status"] == "ACTION_ASSIGNED" and r.json()["owner"]["id"] == k
    fix2 = upload(c, w["id"], k, "fixed again", st["id"], w["lat"], w["lng"], 85, "rectification")
    assert act(c, iid, k, "rectified", evidence_id=fix2["id"]).status_code == 200
    ok = upload(c, w["id"], ae, "now flowing", st["id"], w["lat"], w["lng"], 86, "reinspection")
    r = act(c, iid, ae, "close", evidence_id=ok["id"])
    assert r.status_code == 200
    assert [e["action"] for e in r.json()["events"]][-4:] == ["rectified", "reopen", "rectified", "close"]
    assert [e["action"] for e in r.json()["events"]].count("rectified") == 2  # history preserved


def test_duplicate_and_stale_transitions_are_rejected(c):
    je, ae, ee, k = gog_people(c)
    w = work_by_code(c, "GOG-R-014")
    i = next(i for i in w["issues"] if i["status"] == "REPORTED")
    assert act(c, i["id"], je, "acknowledge", expected_status="REPORTED").status_code == 200
    assert act(c, i["id"], je, "acknowledge").status_code == 409
    assert act(c, i["id"], je, "examine", expected_status="REPORTED").status_code == 409  # stale screen
    m = next(m for s in w["stages"] for m in s["measurements"] if m["checked_by"] is None)
    assert c.post(f"/api/measurements/{m['id']}/check", headers=H(ae)).status_code == 200
    assert c.post(f"/api/measurements/{m['id']}/check", headers=H(ae)).status_code == 409


def test_appeal_reopens_closure_for_a_different_officer(c):
    w = work_by_code(c, "BEL-R-005")
    closed = next(i for i in w["issues"] if i["status"] == "CLOSED")
    key = track_key(closed["ticket"])
    url = f"/api/public/track/{closed['ticket']}/appeal"
    assert c.post(url, json={"key": "wrong", "reason": "Water still collects after rain"}).status_code == 404
    assert c.post(url, json={"key": key, "reason": "no"}).status_code == 400
    r = c.post(url, json={"key": key, "reason": "Water still collects at the chowk after rain"})
    assert r.status_code == 200
    w = work_by_code(c, "BEL-R-005")
    i = next(x for x in w["issues"] if x["ticket"] == closed["ticket"])
    assert i["status"] == "APPEALED" and i["appeals"] == 1
    assert w["certification"]["blockers"]  # an open appeal shows up as an open issue
    closer = next(e for e in closed["events"] if e["action"] == "close")["actor"]
    ee = w["people"]["ee"]
    assert closer.endswith(ee["name"])
    assert act(c, i["id"], ee["id"], "examine").status_code == 403  # the officer who closed it cannot re-decide
    assert act(c, i["id"], w["people"]["ae"]["id"], "examine").status_code == 200
    pub = c.get(f"/api/public/track/{closed['ticket']}?key={key}").json()
    assert pub["issue"]["status"] == "UNDER_EXAMINATION" and any("appeal" in s["text"] for s in pub["sms"])


# ---------------- quality tests and audit ----------------

def test_retest_keeps_the_original_result_on_record(c):
    w = work_by_code(c, "GOG-R-014")
    je, ae, ee, k = gog_people(c)
    drains = next(s for s in w["stages"] if s["name"] == "Side drains")
    t = drains["tests"][0]
    ev = upload(c, w["id"], je, "Cube test", drains["id"], w["lat"], w["lng"], 90, "test_report")
    assert c.post(f"/api/tests/{t['id']}", json={"result": 17.5, "evidence_id": ev["id"]}, headers=H(je)).json()["passed"] is False
    assert c.post(f"/api/tests/{t['id']}", json={"result": 22, "evidence_id": ev["id"]}, headers=H(je)).status_code == 400
    assert c.post(f"/api/tests/{t['id']}", json={"result": 22, "evidence_id": ev["id"], "reason": "Retest"}, headers=H(je)).status_code == 400
    ev2 = upload(c, w["id"], je, "Cube retest", drains["id"], w["lat"], w["lng"], 91, "test_report")
    r = c.post(f"/api/tests/{t['id']}", json={"result": 22, "evidence_id": ev2["id"], "reason": "Retest after slab replacement"}, headers=H(je))
    assert r.json()["passed"] is True
    hist = [a for a in work_by_code(c, "GOG-R-014")["audit"] if a["entity"] == "test" and a["entity_id"] == t["id"]]
    assert [a["action"] for a in hist] == ["record", "retest"]
    assert hist[1]["before"]["result"] == 17.5 and hist[1]["reason"].startswith("Retest")
    assert work_by_code(c, "GOG-R-014", k)["audit"] is None  # audit trail is internal


def test_test_evidence_must_match_the_stage(c):
    w = work_by_code(c, "GOG-R-014")
    je = gog_people(c)[0]
    drains = next(s for s in w["stages"] if s["name"] == "Side drains")
    other_stage = next(s for s in w["stages"] if s["name"] == "Bituminous surface")
    ev = upload(c, w["id"], je, "wrong stage", other_stage["id"], w["lat"], w["lng"], 92, "test_report")
    r = c.post(f"/api/tests/{drains['tests'][0]['id']}", json={"result": 25, "evidence_id": ev["id"]}, headers=H(je))
    assert r.status_code == 400 and "different stage" in r.json()["detail"]


def test_claim_can_be_returned_and_reclaimed_with_audit(c):
    w = work_by_code(c, "GOG-R-014")
    je, ae, ee, k = gog_people(c)
    assert c.post(f"/api/works/{w['id']}/return-claim", json={"reason": "short"}, headers=H(ae)).status_code == 400
    assert c.post(f"/api/works/{w['id']}/return-claim", json={"reason": "Drains not check-measured yet"}, headers=H(ae)).status_code == 200
    assert work_by_code(c, "GOG-R-014")["status"] == "IN_PROGRESS"
    assert c.post(f"/api/works/{w['id']}/claim-complete", headers=H(je)).status_code == 200  # all quantities measured
    acts = [a["action"] for a in work_by_code(c, "GOG-R-014")["audit"] if a["entity"] == "work"]
    assert acts == ["return_claim", "claim_complete"]


# ---------------- scope and money ----------------

def test_scope_changes_only_through_an_audited_revision(c):
    w = work_by_code(c, "ALA-D-002")
    ee, je = w["people"]["ee"]["id"], w["people"]["je"]["id"]
    st = next(s for s in w["stages"] if s["name"] == "Cover slabs")
    body = {"stage_id": st["id"], "new_qty": 8, "reason": "Two crossings dropped after joint inspection", "order_ref": "EE/RWD/2026/114"}
    assert c.post(f"/api/works/{w['id']}/revisions", json=body, headers=H(je)).status_code == 403
    assert c.post(f"/api/works/{w['id']}/revisions", json={**body, "reason": ""}, headers=H(ee)).status_code == 422
    assert c.post(f"/api/works/{w['id']}/revisions", json={**body, "order_ref": ""}, headers=H(ee)).status_code == 422
    assert c.post(f"/api/works/{w['id']}/revisions", json=body, headers=H(ee)).status_code == 200
    w2 = work_by_code(c, "ALA-D-002")
    sanc = next(s for s in w2["sanction"]["stages"] if s["id"] == st["id"])
    assert sanc["qty_sanctioned"] == 8 and sanc["qty_original"] == 12
    assert w2["revisions"][0]["order_ref"] == "EE/RWD/2026/114"
    assert any(a["action"] == "scope_revision" and a["before"]["qty_sanctioned"] == 12 for a in w2["audit"])
    # a revision cannot make a 41% work certifiable on its own
    assert w2["certification"]["eligible"] is False


def test_bill_is_not_payment(c):
    w = work_by_code(c, "GOG-R-014")
    je, ae, ee, k = gog_people(c)
    paid_before = w["finance"]["paid_lakh"]
    billed = {i for b in w["bills"] for i in b["mb_ids"]}
    free = [m for s in w["stages"] for m in s["measurements"] if m["id"] not in billed]
    if not free:  # make a fresh measurement entry by revising scope up and measuring it
        st = next(s for s in w["stages"] if s["name"] == "Approach & road furniture")
        c.post(f"/api/works/{w['id']}/revisions", json={"stage_id": st["id"], "new_qty": st["qty_sanctioned"] + 1,
               "reason": "Extra signboard at school ordered", "order_ref": "EE/RWD/2026/120"}, headers=H(ee))
        assert c.post(f"/api/works/{w['id']}/measurements", json={"stage_id": st["id"], "qty": 1}, headers=H(je)).status_code == 200
        w = work_by_code(c, "GOG-R-014")
        free = [m for s in w["stages"] for m in s["measurements"] if m["id"] not in billed]
    mb = free[0]["id"]
    r = c.post(f"/api/works/{w['id']}/bills", json={"amount_lakh": 1.2, "mb_ids": [mb]}, headers=H(k))
    assert r.status_code == 200, r.text
    bill = r.json()
    assert c.post(f"/api/works/{w['id']}/bills", json={"amount_lakh": 1.0, "mb_ids": [mb]}, headers=H(k)).status_code == 409  # double billing
    pay = {"paid_lakh": 1.2, "payment_ref": "PFMS-TEST-1"}
    assert c.post(f"/api/bills/{bill['id']}/payment", json=pay, headers=H(ee)).status_code == 409  # only a bill, not authorised
    assert work_by_code(c, "GOG-R-014")["finance"]["paid_lakh"] == paid_before
    assert c.post(f"/api/bills/{bill['id']}/check", headers=H(ae)).status_code == 409  # its measurement is unchecked
    assert c.post(f"/api/measurements/{mb}/check", headers=H(ae)).status_code == 200
    assert c.post(f"/api/bills/{bill['id']}/authorize", headers=H(ee)).status_code == 409  # not checked yet
    assert c.post(f"/api/bills/{bill['id']}/check", headers=H(ae)).status_code == 200
    assert c.post(f"/api/bills/{bill['id']}/authorize", headers=H(ee)).status_code == 200
    assert c.post(f"/api/bills/{bill['id']}/payment", json={**pay, "paid_lakh": 5}, headers=H(ee)).status_code == 400
    assert c.post(f"/api/bills/{bill['id']}/payment", json=pay, headers=H(ee)).status_code == 200
    assert c.post(f"/api/bills/{bill['id']}/payment", json=pay, headers=H(ee)).status_code == 409  # twice
    f = work_by_code(c, "GOG-R-014")["finance"]
    assert abs(f["paid_lakh"] - paid_before - 1.2) < 1e-6 and "manual_entry" in f["sources"] and f["verified_source"] is False


# ---------------- security and privacy ----------------

def test_private_media_needs_a_signed_link(c):
    w = work_by_code(c, "GOG-R-014")
    resident = resident_photo(c, w)
    assert "sig=" in resident["url"]
    name = resident["url"].split("?")[0]
    assert c.get(name).status_code == 403
    assert c.get(resident["url"]).status_code == 200
    assert c.get(resident["url"].replace("sig=", "sig=0")).status_code == 403
    public = next(e for e in w["evidence"] if e["source"] == "officer" and e["purpose"] == "progress")
    assert "sig=" not in public["url"] and c.get(public["url"]).status_code == 200
    for probe in ("/media/..%2Fkaarya.db", "/..%2F..%2Fbackend%2Fapp%2Fconfig.py", "/%2e%2e/%2e%2e/backend/app/config.py"):
        r = c.get(probe)
        assert r.status_code == 404 or (b"KN_SECRET" not in r.content and not r.content.startswith(b"SQLite"))
    assert c.get("/media/" + "a" * 32 + ".jpg").status_code == 404


def test_uploads_are_checked_by_content_and_size(c, monkeypatch):
    w = work_by_code(c, "GOG-R-014")
    je = gog_people(c)[0]
    post = lambda data, name="x.jpg": c.post(f"/api/works/{w['id']}/evidence", data={"caption": "x"}, headers=H(je),
                                             files={"file": (name, io.BytesIO(data), "image/jpeg")})
    assert post(b"<?php echo 1; ?>").status_code == 400
    assert post(b"MZ\x90\x00 not an image", "evil.exe").status_code == 400
    assert post(b"\xff\xd8\xff" + b"0" * 50).status_code == 400  # claims JPEG, does not decode
    monkeypatch.setattr(config, "MAX_IMAGE_BYTES", 1000)
    assert post(make_photo(93, "big", "road")).status_code == 413


def test_pilot_mode_rejects_persona_headers_and_reset(c, monkeypatch):
    monkeypatch.setattr(config, "DEMO", False)
    monkeypatch.setattr(config, "MODE", "pilot")
    with Session(engine) as s:
        from app.models import Officer
        from sqlmodel import select
        ee = s.exec(select(Officer).where(Officer.role == "EE")).first()
        s.add(OfficerCredential(officer_id=ee.id, pw_hash=hash_password("correct horse battery")))
        s.commit()
        ee_id = ee.id
    assert c.get("/api/dashboard", headers={"X-User": str(ee_id)}).status_code == 401  # impersonation
    assert c.post("/api/demo/reset").status_code == 403
    assert c.post("/api/auth/login", json={"officer_id": ee_id, "password": "wrong"}).status_code == 401
    tok = c.post("/api/auth/login", json={"officer_id": ee_id, "password": "correct horse battery"}).json()["token"]
    assert c.get("/api/dashboard", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    assert c.get("/api/dashboard", headers={"Authorization": f"Bearer {tok[:-2]}xx"}).status_code == 401
    assert c.get("/api/meta").json()["officers"] == []  # no staff directory for anonymous callers


def test_other_departments_records_are_closed(c):
    meta = c.get("/api/meta").json()["officers"]
    bcd_ee = next(o["id"] for o in meta if o["role"] == "EE" and o["department"] == "BCD")
    w = work_by_code(c, "GOG-R-014")
    assert c.get(f"/api/works/{w['id']}", headers=H(bcd_ee)).status_code == 403
    assert c.post(f"/api/works/{w['id']}/certify", headers=H(bcd_ee)).status_code == 403
    assert c.get(f"/api/works/{w['id']}/certification", headers=H(bcd_ee)).status_code == 403


def test_public_abuse_controls(c, monkeypatch):
    w = work_by_code(c, "GOG-R-014")
    ticket = next(i["ticket"] for i in w["issues"] if i["source"] == "citizen" and i["status"] == "REPORTED")
    assert c.post(f"/api/public/issues/{ticket}/support", json={"phone": "9812345678"}).status_code == 200
    assert c.post(f"/api/public/issues/{ticket}/support", json={"phone": "+91 98123 45678"}).status_code == 409
    assert c.post(f"/api/public/issues/{ticket}/support", json={}).status_code == 200  # this device, no phone
    assert c.post(f"/api/public/issues/{ticket}/support", json={}).status_code == 409
    assert c.post(f"/api/public/issues/{ticket}/support", json={"phone": "12"}).status_code == 400
    bel = work_by_code(c, "BEL-R-005")
    before = bel["votes"]
    for _ in range(5):
        assert c.post(f"/api/public/works/{bel['qr_token']}/usable", json={"usable": False}).status_code == 200
    after = work_by_code(c, "BEL-R-005")["votes"]
    assert after["no"] == before["no"] + 1 and after["yes"] == before["yes"]
    monkeypatch.setitem(config.RATE_LIMITS, "report", 2)
    main_mod._hits.clear()
    send = lambda: c.post(f"/api/public/works/{w['qr_token']}/reports", data={"category": "quality", "description": "Cracks on the road"})
    assert send().status_code == 200 and send().status_code == 200
    assert send().status_code == 429


def test_track_key_protects_progress_and_public_view_stays_anonymous(c):
    w = work_by_code(c, "GOG-R-014")
    ticket = next(i["ticket"] for i in w["issues"] if i["source"] == "citizen")
    assert c.get(f"/api/public/track/{ticket}?key=guess").status_code == 404
    pub = c.get(f"/api/public/works/{w['qr_token']}").json()
    assert "track_key" not in str(pub) and track_key(ticket) not in str(pub)
    assert all("track_key" not in i for i in w["issues"])  # officers never see it either


def test_hindi_text_is_present_for_flags_and_blockers(c):
    w = work_by_code(c, "GOG-R-014")
    assert all(f["message_hi"] and any("ऀ" <= ch <= "ॿ" for ch in f["message_hi"]) for f in w["flags"])
    assert all(b["message_hi"] for b in w["certification"]["blockers"])


def test_land_dispute_escalation_decision_and_resolution(c):
    w = work_by_code(c, "ALA-R-007")
    hold = next(i for i in w["issues"] if i["category"] == "delay")
    ddc, co, je = oid(c, "DDC", "Verma"), oid(c, "CO", ""), w["people"]["je"]["id"]
    d = c.get("/api/dashboard", headers=dm(c)).json()
    item = next(x for x in d["decisions"] if x["work"]["code"] == "ALA-R-007" and x["kind"] == "escalation")
    assert item["owner"]["role"] == "CO" and item["escalated_to"]["role"] == "DDC" and item["overdue_days"] > 14
    assert act(c, hold["id"], je, "direct", note="x", due_date=str(date.today() + timedelta(days=7))).status_code == 403
    assert act(c, hold["id"], ddc, "direct", note="CO to complete joint measurement with amin", due_date=str(date.today() - timedelta(days=1))).status_code == 400
    r = act(c, hold["id"], ddc, "direct", note="CO to finish joint measurement with the amin by Friday; SDO to attend.",
            due_date=str(date.today() + timedelta(days=7)))
    assert r.status_code == 200 and r.json()["overdue_days"] == 0 and r.json()["owner"]["role"] == "CO"
    order = c.post(f"/api/works/{w['id']}/evidence", data={"caption": "Settlement order", "purpose": "document", "kind": "document"},
                   headers=H(co), files={"file": ("o.pdf", io.BytesIO(b"%PDF-1.4 synthetic settlement order"), "application/pdf")})
    assert order.status_code == 200, order.text
    assert act(c, hold["id"], co, "rectified", evidence_id=order.json()["id"], note="Objection settled; land handed over").status_code == 200
    ae = w["people"]["ae"]["id"]
    site = upload(c, w["id"], ae, "Site clear at ch 0.9-1.2", None, w["lat"], w["lng"], 95, "reinspection")
    r = act(c, hold["id"], ae, "close", evidence_id=site["id"], note="Alignment clear; work can resume")
    assert r.status_code == 200
    assert [e["action"] for e in r.json()["events"]][-3:] == ["direct", "rectified", "close"]
    assert not any(x["work"]["code"] == "ALA-R-007" and x["kind"] == "escalation"
                   for x in c.get("/api/dashboard", headers=dm(c)).json()["decisions"])
