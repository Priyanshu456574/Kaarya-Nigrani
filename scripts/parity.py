"""API ↔ demo-engine parity check.

Seeds a fresh synthetic database, exports it as the demo snapshot, bundles frontend/src/demo/engine.js for Node,
then sends the same requests to both and compares status codes and the business fields of every response.
Finally compares, for every officer, the dashboard, task list and each visible work.

    python scripts/parity.py            (from the repo root; needs Python deps and Node 18+)
Exit code 0 = identical, 1 = differences (printed)."""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP = Path(tempfile.mkdtemp())
os.environ["KN_DB_URL"] = f"sqlite:///{TMP}/parity.db"
os.environ["KN_MEDIA_DIR"] = str(TMP / "media")
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import make_photo, seed  # noqa: E402

seed(reset=True)
subprocess.run([sys.executable, str(ROOT / "backend" / "export_snapshot.py")], cwd=ROOT / "backend", check=True,
               env={**os.environ}, stdout=subprocess.DEVNULL)
subprocess.run([sys.executable, str(ROOT / "frontend" / "scripts" / "build_demo_media.py"), str(TMP / "media")],
               cwd=ROOT / "frontend", check=True, stdout=subprocess.DEVNULL)
bundle = TMP / "driver.mjs"
subprocess.run(["npx", "esbuild", "scripts/parity_driver.mjs", "--bundle", "--platform=node", "--format=esm",
                "--log-level=error", f"--outfile={bundle}"], cwd=ROOT / "frontend", check=True)
node = subprocess.Popen(["node", str(bundle)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
api = TestClient(app)
diffs, steps = [], [0]


def photo(n):
    f = TMP / f"up{n}.jpg"
    f.write_bytes(make_photo(n, f"parity {n}", "road"))
    return f


def call(m, p, b=None, u=None, files=None, form=False):
    steps[0] += 1
    h = {"X-User": str(u)} if u else {}
    if files or form:
        r = api.post("/api" + p, data={k: str(v) for k, v in (b or {}).items()}, headers=h,
                     files={k: (Path(f).name, open(f, "rb"), "application/octet-stream") for k, f in (files or {}).items()})
    elif m == "GET":
        r = api.get("/api" + p, headers=h)
    else:
        r = api.post("/api" + p, json=b or {}, headers=h)
    node.stdin.write(json.dumps({"m": m, "p": p, "b": b or {}, "u": u, "files": {k: str(v) for k, v in (files or {}).items()}}) + "\n")
    js = json.loads(node.stdout.readline())
    a_status = 200 if r.status_code == 200 else r.status_code
    if a_status != js["status"]:
        diffs.append(f"{m} {p} as {u}: API {a_status} {r.text[:160]} | engine {js['status']} {json.dumps(js['body'])[:160]}")
    return r.json() if r.headers.get("content-type", "").startswith("application/json") else {}, js["body"]


def project_work(w):
    if not isinstance(w, dict) or "code" not in w:
        return w
    return {k: w.get(k) for k in ("code", "status", "actual", "planned", "evidenced", "financial", "reported", "check_measured", "score")} | {
        "flags": sorted(f["code"] for f in w.get("flags", [])),
        "blockers": sorted(b["code"] for b in (w.get("certification") or {}).get("blockers", [])),
        "issues": sorted((i["ticket"], i["status"], (i.get("owner") or {}).get("id"), tuple(i.get("actions", []))) for i in w.get("issues", [])),
        "finance": w.get("finance"), "access": w.get("access"), "can_certify": w.get("can_certify"),
        "checklist": [(c["id"], c["passed"], c["evidence_id"]) for c in w.get("checklist", [])],
        "bills": [(b["bill_no"], b["status"], b.get("paid_lakh")) for b in w.get("bills", [])],
        "audit": None if w.get("audit") is None else [(a["entity"], a["action"], a["reason"]) for a in w["audit"]],
        "stages": [(s["name"], s["qty_sanctioned"], s["qty_executed"], s["covered"]) for s in w.get("stages", [])],
    }


def first_diff(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b), key=str):
            d = first_diff(a.get(k, "<missing>"), b.get(k, "<missing>"), f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        if len(a) != len(b):
            return f"{path}: len {len(a)} vs {len(b)}: {json.dumps(a, default=str)[:200]} | {json.dumps(b, default=str)[:200]}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    return None if a == b else f"{path}: API {json.dumps(a, default=str)[:200]} | engine {json.dumps(b, default=str)[:200]}"


def compare(label, a, b):
    a, b = json.loads(json.dumps(a, default=list)), json.loads(json.dumps(b, default=list))
    d = first_diff(a, b)
    if d:
        diffs.append(f"{label} {d}")


def get(path, u, proj=lambda x: x):
    a, b = call("GET", path, u=u)
    compare(f"GET {path} as {u}", proj(a), proj(b))
    return a


officers = {(o["role"], o["name"]): o["id"] for o in api.get("/api/meta").json()["officers"]}
oid = lambda role, part: next(v for (r, n), v in officers.items() if r == role and part in n)
DM = oid("DM", "")
works = {w["code"]: w for w in api.get("/api/dashboard", headers={"X-User": str(DM)}).json()["works"]}
je, ae, ee, k = oid("JE", "Ravi"), oid("AE", "Anjali"), oid("EE", "Suresh"), oid("CONTRACTOR", "Kosi")
G = works["GOG-R-014"]["id"]
gw = api.get(f"/api/works/{G}", headers={"X-User": str(DM)}).json()
n = [600]


def up(work_id, user, purpose="progress", stage=None, lat=None, lng=None, same=None, kind="photo"):
    n[0] += 1
    b = {"caption": f"p{n[0]}", "purpose": purpose, "kind": kind}
    if stage:
        b["stage_id"] = stage
    if lat is not None:
        b.update(lat=lat, lng=lng)
    a, e = call("POST", f"/works/{work_id}/evidence", b, user, files={"file": photo(same or n[0])})
    compare("upload id", a.get("id"), e.get("id"))
    return a.get("id")


def act(iid, user, action, **kw):
    a, e = call("POST", f"/issues/{iid}/actions", {"action": action, **kw}, user)
    return a


# --- scenario 1: negative checks on GOG-R-014 and ALA-D-002 ---
A = works["ALA-D-002"]["id"]
aw = api.get(f"/api/works/{A}", headers={"X-User": str(DM)}).json()
call("POST", f"/works/{A}/claim-complete", u=aw["people"]["je"]["id"])
call("POST", f"/works/{A}/certify", u=aw["people"]["ee"]["id"])
item = next(c for c in gw["checklist"] if not c["passed"])
call("POST", f"/works/{G}/checklist/{item['id']}", {"passed": True, "evidence_id": 999999}, ee)
call("POST", f"/works/{G}/certify", u=ee)
call("POST", f"/works/{G}/certify", u=ae)
st = {s["name"]: s for s in gw["stages"]}
drains = st["Side drains"]["id"]
# resident report with a photo
a, e = call("POST", f"/public/works/{gw['qr_token']}/reports", {"category": "usability", "description": "Drain missing near school", "phone": "9000000000"},
            files={"file": photo(1)})
compare("ticket", a.get("ticket"), e.get("ticket"))
ticket = a["ticket"]
gw = api.get(f"/api/works/{G}", headers={"X-User": str(DM)}).json()
iid = next(i["id"] for i in gw["issues"] if i["ticket"] == ticket)
act(iid, k, "acknowledge")
act(iid, je, "acknowledge", expected_status="REPORTED")
act(iid, je, "acknowledge")
act(iid, je, "examine")
resident = next(x["id"] for x in gw["evidence"] if x["source"] == "citizen")
act(iid, ae, "verify", note="drain", evidence_id=resident)
prog = up(G, ae, "progress", drains)
act(iid, ae, "verify", note="drain", evidence_id=prog)
insp = up(G, ae, "inspection", drains, gw["lat"], gw["lng"])
act(iid, ae, "verify", note="Side drain absent for 800 m", evidence_id=insp)
act(iid, ee, "assign", owner_id=k, due_date=str(date.today() + timedelta(days=12)))
fix = up(G, k, "rectification", drains)
up(G, k, "reinspection", drains)  # contractor may not file re-inspections
act(iid, k, "rectified", evidence_id=fix)
act(iid, k, "close", evidence_id=fix)
act(iid, ae, "close", evidence_id=fix)
same = up(G, ae, "reinspection", drains, same=n[0] - 1)
act(iid, ae, "close", evidence_id=same)
bad = up(G, ae, "reinspection", drains)
act(iid, ae, "reopen", note="Still ponding", evidence_id=bad)
fix2 = up(G, k, "rectification", drains)
act(iid, k, "rectified", evidence_id=fix2)
ok = up(G, ae, "reinspection", drains)
act(iid, ae, "close", evidence_id=ok)

# --- scenario 2: full legitimate certification ---
gw = api.get(f"/api/works/{G}", headers={"X-User": str(DM)}).json()
for s in gw["stages"]:
    for m_ in s["measurements"]:
        if m_["checked_by"] is None:
            call("POST", f"/measurements/{m_['id']}/check", u=ae)
from app import geo  # noqa: E402
for s in gw["stages"]:
    if s["linear"]:
        for a0, b0 in s["gaps"]:
            x = a0
            while x < b0 - 1e-6:
                lat, lng = geo.point_at(gw["line"], min(x + 0.25, b0 - 0.01))
                up(G, je, "progress", s["id"], lat, lng)
                x += 0.5
    elif s["covered"] == 0:
        up(G, je, "progress", s["id"], gw["lat"], gw["lng"])
for s in gw["stages"]:
    for t in s["tests"]:
        if t["result"] is None:
            ev = up(G, je, "test_report", s["id"])
            call("POST", f"/tests/{t['id']}", {"result": (t["spec_min"] or 1) + 1, "evidence_id": ev}, je)
            call("POST", f"/tests/{t['id']}", {"result": 1, "evidence_id": ev, "reason": "retest"}, je)
old = next(i for i in gw["issues"] if i["status"] == "REPORTED")
appr = st["Approach & road furniture"]["id"]
act(old["id"], je, "acknowledge"); act(old["id"], ae, "examine")
act(old["id"], ae, "verify", note="Approach not built", evidence_id=up(G, ae, "inspection", appr))
act(old["id"], ee, "assign", owner_id=k, due_date=str(date.today() + timedelta(days=9)))
act(old["id"], k, "rectified", evidence_id=up(G, k, "rectification", appr))
act(old["id"], ee, "close", evidence_id=up(G, ee, "reinspection", appr))
get(f"/works/{G}", DM, project_work)
for c in api.get(f"/api/works/{G}", headers={"X-User": str(DM)}).json()["checklist"]:
    if not c["passed"]:
        call("POST", f"/works/{G}/checklist/{c['id']}", {"passed": True, "evidence_id": up(G, je, "completion")}, ee)
        call("POST", f"/works/{G}/checklist/{c['id']}", {"passed": True, "evidence_id": up(G, ee, "completion")}, ee)
call("POST", f"/works/{G}/certify", u=ee)

# --- scenario 3: scope revision, bills, appeal, land dispute, public abuse controls ---
call("POST", f"/works/{A}/revisions", {"stage_id": next(s["id"] for s in aw["stages"] if s["name"] == "Cover slabs"), "new_qty": 8,
                                        "reason": "Two crossings dropped", "order_ref": "EE/RWD/1"}, aw["people"]["je"]["id"])
call("POST", f"/works/{A}/revisions", {"stage_id": next(s["id"] for s in aw["stages"] if s["name"] == "Cover slabs"), "new_qty": 8,
                                        "reason": "Two crossings dropped after inspection", "order_ref": "EE/RWD/1"}, aw["people"]["ee"]["id"])
aje = aw["people"]["je"]["id"]
mbstage = next(s for s in aw["stages"] if s["name"] == "Cover slabs")
call("POST", f"/works/{A}/measurements", {"stage_id": mbstage["id"], "qty": 2}, aje)
aw2 = api.get(f"/api/works/{A}", headers={"X-User": str(DM)}).json()
billed = {i for b in aw2["bills"] for i in b["mb_ids"]}
free = [m_["id"] for s in aw2["stages"] for m_ in s["measurements"] if m_["id"] not in billed]
ac = aw2["people"]["contractor"]["id"]
a, e = call("POST", f"/works/{A}/bills", {"amount_lakh": 0.9, "mb_ids": free[:1]}, ac)
bid = a.get("id")
call("POST", f"/works/{A}/bills", {"amount_lakh": 0.9, "mb_ids": free[:1]}, ac)
call("POST", f"/bills/{bid}/payment", {"paid_lakh": 0.9, "payment_ref": "PFMS-1"}, aw["people"]["ee"]["id"])
call("POST", f"/bills/{bid}/check", u=aw["people"]["ae"]["id"])
call("POST", f"/measurements/{free[0]}/check", u=aw["people"]["ae"]["id"])
call("POST", f"/bills/{bid}/check", u=aw["people"]["ae"]["id"])
call("POST", f"/bills/{bid}/authorize", u=aw["people"]["ee"]["id"])
call("POST", f"/bills/{bid}/payment", {"paid_lakh": 0.9, "payment_ref": "PFMS-1"}, aw["people"]["ee"]["id"])
B = works["BEL-R-005"]["id"]
bw = api.get(f"/api/works/{B}", headers={"X-User": str(DM)}).json()
closed = next(i for i in bw["issues"] if i["status"] == "CLOSED")
from sqlmodel import Session, select  # noqa: E402
from app.db import engine as dbe  # noqa: E402
from app.models import Issue  # noqa: E402
with Session(dbe) as s_:
    key = s_.exec(select(Issue).where(Issue.ticket == closed["ticket"])).first().track_key
call("GET", f"/public/track/{closed['ticket']}?key=nope")
call("POST", f"/public/track/{closed['ticket']}/appeal", {"key": key, "reason": "Water still collects after rain"})
act(closed["id"], bw["people"]["ee"]["id"], "examine")
act(closed["id"], bw["people"]["ae"]["id"], "examine")
call("POST", f"/public/issues/{ticket}/support", {"phone": "9812345678"})
call("POST", f"/public/issues/{ticket}/support", {"phone": "9812345678"})
R = works["ALA-R-007"]["id"]
rw = api.get(f"/api/works/{R}", headers={"X-User": str(DM)}).json()
hold = next(i for i in rw["issues"] if i["category"] == "delay")
ddc, co = oid("DDC", "Verma"), oid("CO", "")
act(hold["id"], ddc, "direct", note="Finish the joint measurement", due_date=str(date.today() + timedelta(days=7)))

# --- final state, for every officer ---
for (role, name), u in officers.items():
    get("/dashboard", u, lambda d: d if not isinstance(d, dict) or "works" not in d else {
        "works": [project_work(w) for w in d["works"]], "totals": d["totals"], "scope": d["scope"],
        "decisions": [(x["kind"], x["work"]["code"], x.get("code"), x["level"]) for x in d["decisions"]],
        "escalated": [(x["ticket"], x["to"]["id"]) for x in d["escalated"]], "holdups": d["holdups"]})
    get("/tasks", u, lambda ts: [(t["kind"], t["work"]["code"], t["title"], t["priority"]) for t in ts] if isinstance(ts, list) else ts)
    dash = api.get("/api/dashboard", headers={"X-User": str(u)}).json()
    for w in dash.get("works", []):
        get(f"/works/{w['id']}", u, project_work)

node.stdin.close()
node.wait()
shutil.rmtree(TMP, ignore_errors=True)
print(f"{steps[0]} requests compared, {len(officers)} officers")
if diffs:
    print(f"{len(diffs)} DIFFERENCES:")
    for d in diffs[:60]:
        print(" -", d)
    sys.exit(1)
print("PARITY OK: API and demo engine agree on every response")
