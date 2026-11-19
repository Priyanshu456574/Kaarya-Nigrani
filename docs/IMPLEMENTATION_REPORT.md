# Implementation report (v0.5)

## What was broken in v0.4

Each item below was confirmed in code and, where possible, reproduced.

1. **Certification could be faked.** `claim_complete` accepted any work in progress, whatever its progress. `check_item` accepted any `evidence_id` without checking that it existed, belonged to the work or came from an engineer. `certify` only checked "checklist ticked and no open issues". So ALA-D-002, at 41.2% measured, could be claimed, ticked with evidence id 999999, and certified. Measurement, check-measurement, tests and photo coverage were never looked at.
2. **Closure was not independent.** `close` needed "evidence from the same work" and that the closer was not the rectifier, but any existing officer upload worked, including the contractor's repair photo. Rework (`reopen`) needed no evidence.
3. **Evidence had no purpose or provenance.** A progress photo could be cited as an inspection finding. An inspection finding raised by an AE through `raise_issue` could cite another work's evidence. Test results could cite evidence from a different stage.
4. **Identity was a header.** `X-User: <id>` was trusted in every mode, and `/api/demo/reset` wiped the database for anyone.
5. **All media was public.** `/media` was a static mount, so resident photos, voice notes and inspection files were served to anyone who had the filename. Uploads were not checked: any bytes were stored under the client's file extension.
6. **Path traversal in the app route.** The catch-all `/{path}` served `frontend/dist/<path>` without containing it inside `dist`. `GET /..%2F..%2Fbackend%2Fapp%2Fdb.py` returned source code, and the same route could return the SQLite database. This was reproduced against the v0.4 code.
7. **Tracking was guessable.** Tickets are sequential (`KGR-2026-0001`…), and the ticket number alone opened the full history and SMS log.
8. **Bills were counted as spent money.** `financial` was the sum of all bills. There was no difference between a bill submitted, checked, authorised and actually paid.
9. **Votes and supports had no limit.** "Same problem" and the usability opinion could be inflated without limit.
10. **No audit trail outside issues.** Test results were overwritten in place. Claims, checklist ticks, extensions and certifications left no who/why record.
11. **Rounding drift between the server and the demo.** Python's `round()` rounds halves to even while the browser rounds half up, so some works showed 36.2% on the server and 36.3% in the demo.

## What changed

### New modules (backend)
- **`app/certification.py`**: the Certification Eligibility Engine.
  - `claim_blockers()`: every stage must be measured to its current sanctioned quantity.
  - `blockers()`, which checks:
    - authority: only the EE of this work;
    - executed quantities;
    - AE check-measured quantities;
    - photo coverage per stage, and per 0.5 km bin on linear works;
    - every test recorded and passed;
    - no open issues of any kind, including appeals;
    - each checklist item passed with valid AE/EE evidence on this work.
  - `financial_status()` reports money separately and is never a condition of certification.
- **`app/evidence.py`**:
  - content-based upload checks (magic bytes, image decode, size limits per type);
  - generated filenames;
  - provenance fields;
  - signed, time-limited links for private media;
  - `require()`, the single validator used by every decision that cites evidence.
- **`app/auth.py`**:
  - demo mode keeps the persona header;
  - pilot mode rejects it, issues HMAC-signed bearer tokens after a PBKDF2 password check, and requires an active credential;
  - CLI: `python -m app.auth set-password`.
- **`app/audit.py`**: an append-only `AuditEvent` record (actor, role, before, after, reason, evidence, time).
- **`app/config.py`**: `KN_MODE` (demo/pilot), secrets, CORS, upload limits, rate limits and appeal window. Pilot mode refuses to start without a 32+ character `KN_SECRET`.

### Workflow (`workflow.py`)
- **Closing a repair** (`close`) now requires:
  - an AE/EE who is neither the rectifier nor the person who uploaded the repair evidence;
  - evidence filed as `reinspection`/`inspection`, uploaded by the closer, after the rectification;
  - evidence that is not the same record, the same SHA-256 or a near-identical perceptual hash.
- **Rework** (`reopen`) needs a note and re-inspection evidence, and goes back to whoever submitted the repair.
- **Appeals:** a new `APPEALED` status and an `appeal()` function.
  - Residents only, using their tracking code.
  - Within 30 days and at most twice.
  - The officer who decided the issue cannot examine, verify or reject the appeal.
- **DM/DDC decision** (`direct`): records an instruction, a new future deadline and optionally a new owner on an assigned matter. This resets escalation.
- **Repeat or stale clicks:** `expected_status` prevents double-clicks and stale screens from stepping an issue twice.
- **Assignment checks:**
  - a contractor can only be the work's own contractor;
  - due dates cannot be in the past.
- **Issue creation:** citizen issues get a random `track_key`, and officer findings cite validated evidence.

### API (`main.py`)
- **Certification endpoints:**
  - `GET /works/{id}/certification`;
  - `POST /works/{id}/return-claim`;
  - claim and certify return HTTP 409 with `{message, blockers[]}`.
- **Bill pipeline:**
  - `POST /works/{id}/bills`: the contractor cites measurement entries; no double billing; capped at the sanctioned amount;
  - `/bills/{id}/check`: AE, only when every cited entry is check-measured;
  - `/bills/{id}/authorize`: EE of the work;
  - `/bills/{id}/payment`: EE/DDC, with an amount up to the bill and a reference; labelled `manual_entry`.
- **Scope revisions** (`POST /works/{id}/revisions`):
  - EE only, with a reason and an order number;
  - the original quantity is kept;
  - cannot go below the measured quantity;
  - audited.
- **Uploads:** evidence purpose is restricted by role and access level (for example, contractors cannot file `reinspection`).
- **Tests:** a retest or correction needs a reason and its own report; the earlier result stays in the audit trail.
- **Duplicate actions refused (HTTP 409):** a second check-measure, payment, re-check or same-week inspection.
- **Public endpoints:**
  - per-device rate limits;
  - phone validation;
  - one support per phone or device;
  - one usability opinion per voter (a repeat updates it);
  - tracking needs `?key=`;
  - `POST /public/track/{ticket}/appeal`.
- **Pilot-only behaviour:**
  - `/auth/login`;
  - `/meta` hides the staff directory from anonymous callers;
  - reset is disabled;
  - demo data is never seeded.
- **Dashboard:** `decisions[]` lists what to decide, why, owner, escalated-to, level, age, due date, overdue days, last recorded note, and a deep link.
- `/media/{name}` and the app route are both contained and checked.

### Data model (`models.py`) and migration (`db.py`)
- **New tables:** `ScopeRevision`, `AuditEvent`, `SupportRecord`, `OfficerCredential`.
- **New columns:**
  - `Evidence`: purpose, upload time, uploader role, SHA-256, coordinate source, MIME type, public flag;
  - `Issue`: tracking key, decided by, appeals, closed time;
  - `Bill`: pipeline fields;
  - `Stage`: original quantity;
  - `UsabilityVote`: voter.
- `db.migrate()` adds missing tables and columns to an existing SQLite or Postgres database. It is additive only.

### Seed
- Evidence carries realistic purposes.
- In BEL-R-005 the contractor now uploads their own repair photo; before, they used the JE's photo, which the new rule correctly blocks.
- Existing bills are marked `PAID` with `payment_source = illustrative_seed` and `SYN-…` references.
- Votes carry voter ids.
- The two seeded certified works (BEL-R-005, ALA-R-003) pass the new engine apart from the status check.

### Demo engine (`frontend/src/demo/engine.js`)
Every rule above is mirrored: evidence validator, closure independence, appeal, `direct`, certification blockers, bills, revisions, audit, track keys, dedupe, upload content checks (magic bytes), rounding. `scripts/parity.py` drives the real API and the bundled engine in lockstep. In the final run it compared 257 requests plus all 20 officers' dashboards, task lists and work views, with 0 differences.

### Frontend
- **Work page:**
  - an Approved / Reported / Independently-verified panel (claims dashed, verified solid), with a warning when reported and check-measured progress differ by 10 or more points;
  - a "Ready to certify?" panel listing the server's blockers, with "Return claim" for the AE/EE;
  - the JE claim button is disabled, with reasons, while quantities are unmeasured.
- **Money tab:**
  - a pipeline from bills submitted to payment recorded;
  - per-role bill actions;
  - the source of each payment record shown;
  - scope revisions with an EE form;
  - an append-only decision record for AE/EE/DM/DDC only.
- **Issue card:**
  - each step uploads with the right evidence purpose;
  - rework needs evidence;
  - a Circle Officer or BDO can file a document;
  - the `direct` form;
  - `expected_status` is sent with every action.
- **Dashboard:** a "Needs your decision today" queue for DM/DDC/EE.
- **Resident pages:**
  - the receipt shows the ticket and tracking code;
  - tracking needs both;
  - appeal form;
  - "checked by another officer" note;
  - the check-measured share is shown on the public page;
  - a repeat "same problem" shows the server's message.
- **Other screens:**
  - a pilot sign-in screen, where the token is kept in memory only;
  - a demo banner on every officer page: "all works, people and figures are synthetic";
  - all new text is in English and Hindi.

## Architectural decisions
- **One eligibility function serves the UI and the gate.** The work page shows exactly what `certify` will enforce, so they cannot drift apart.
- **Evidence purpose is fixed by the step, not chosen by the user.** This removes a class of mis-filing without extra screens.
- **Payment is never a certification condition.** This follows the brief: engineering completion and financial clearance are reported side by side.
- **Signed media links rather than cookies.** They work with `<img src>`, expire, and need no session state. Public site photos (officer progress or completion) stay open, because the site board is public information.
- **Additive migration rather than Alembic** for this prototype. It keeps `uvicorn` startup a single step, and Alembic is listed as a pilot task.
- **New logic lives in separate modules.** Routes stay in `main.py` to keep the API stable; splitting it into routers is mechanical future work.

## Remaining limitations (honest list)
- No real SSO or OTP, SMS gateway, PFMS / treasury feed or e-procurement import. All are labelled as such in the UI and the docs.
- Geotags are device-claimed and are not verified independently.
- No offline capture or sync queue. Field users need connectivity for each action.
- The rate limiter keeps its counts in memory on one server. It is not shared across workers, and it resets on restart.
- SQLite by default. Concurrency is handled by status checks and HTTP 409s, not row locks; Postgres plus row locks are recommended for a pilot.
- Specification values, checklist items, escalation periods and appeal limits are reasoned proposals that need department approval.
- In the demo, private media is embedded in the page bundle, so signed links only apply to the server build.
- `main.py` is still about 1,250 lines.
