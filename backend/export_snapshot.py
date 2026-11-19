"""Export the seeded database for the serverless demo (frontend/src/demo/snapshot.json)."""
import json
from datetime import date
from sqlmodel import Session, select
from app.db import engine
from app import models as m

TABLES = [("officers", m.Officer), ("works", m.Work), ("stages", m.Stage), ("reports", m.ProgressReport),
          ("evidence", m.Evidence), ("issues", m.Issue), ("events", m.IssueEvent), ("checklist", m.UsabilityItem),
          ("measurements", m.Measurement), ("bills", m.Bill), ("tests", m.QualityTest),
          ("extensions", m.TimeExtension), ("postchecks", m.PostCheck), ("inspections", m.Inspection),
          ("votes", m.UsabilityVote), ("notifications", m.Notification), ("revisions", m.ScopeRevision),
          ("audit", m.AuditEvent), ("supports", m.SupportRecord)]
out = {"today": date.today().isoformat()}
with Session(engine) as s:
    for name, cls in TABLES:
        out[name] = [r.model_dump(mode="json") for r in s.exec(select(cls)).all()]
import os
import sys
target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "src", "demo", "snapshot.json")
json.dump(out, open(target, "w"), separators=(",", ":"))
print({k: len(v) for k, v in out.items() if isinstance(v, list)})
