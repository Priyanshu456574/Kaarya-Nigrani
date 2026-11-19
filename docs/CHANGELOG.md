# Changelog

## v0.5.1 (14 Nov 2026): plainer screens for non-technical officials
No rules changed; only what officials see.
- **Work page:** four numbers (planned, reported, checked by engineer, paid) and one plain-language sentence replace the three-column panel.
- **Certification panel:** "Can it be certified usable?" shows up to eight short plain reasons. The exact technical list is under "See details". Certifying asks for confirmation.
- **Money:** two numbers (Bills raised, Actually paid) plus one warning line. Bill steps are folded away.
- **Decision list:** three items, one line each (what, which work, who has it, days late). The work name is shown instead of the code.
- **Hidden until needed:** the scope-changes panel appears only when there is a change or the user can make one. History of decisions is folded.
- **Plainer warnings**, worded the same in the API and the demo, for example "Bills 7, 8 paid before the AE re-measured the work". The district list is renamed "Works with problems".

## v0.5 (14 Nov 2026): integrity, security and PS2 completeness

### Added
- **Certification and claims:**
  - Certification Eligibility Engine (`app/certification.py`) and `GET /api/works/{id}/certification`;
  - `POST /works/{id}/return-claim`, so the AE/EE can send a completion claim back with a reason.
- **Evidence:** typed evidence purposes and provenance (`app/evidence.py`), plus signed private-media links.
- **Closure and appeals:**
  - independent re-inspection rules for closing a repair, and rework that needs evidence;
  - resident appeals (`APPEALED` status) and `POST /api/public/track/{ticket}/appeal`;
  - DM/DDC `direct` action, to record a decision with a new deadline.
- **Money and scope:**
  - bill pipeline: `POST /works/{id}/bills` and `/bills/{id}/check|authorize|payment`;
  - approved scope revisions (`POST /works/{id}/revisions`), keeping the original quantity.
- **Audit:** append-only `AuditEvent` covering measurements, check-measures, tests and retests, the checklist, claims, certification, extensions, bills and revisions.
- **Pilot mode** (`KN_MODE=pilot`): signed bearer tokens, `POST /api/auth/login`, and `python -m app.auth set-password`.
- **Public endpoints:** rate limits, phone validation, and one support or opinion per voter.
- **Dashboard and progress figures:**
  - `decisions[]` on the dashboard;
  - `reported` and `check_measured` progress on every work;
  - `check_measured` on the public page.
- **UI:**
  - Approved / Reported / Verified panel;
  - certification readiness panel;
  - money pipeline;
  - revisions;
  - decision record;
  - decision queue;
  - tracking code and appeal form;
  - pilot sign-in;
  - demo banner.
- **Tests and tooling:**
  - 22 new backend tests (`tests/test_integrity.py`, plus one new story test);
  - API ↔ demo parity harness (`scripts/parity.py`);
  - browser checks (`frontend/e2e/journeys.mjs`).

### Changed
- `financial` and `paid_pct` now count only bills with a recorded payment (`PAID`). Before, every bill counted.
- Bill status: `BILL_UNCHECKED` now applies only to authorised or paid bills.
- Rounding: progress figures use half-up rounding, identical to the browser.
- Claim: `claim-complete` needs every stage measured, and only the JE of the work can claim.
- Certify: `certify` needs the EE of the work and an empty blocker list.
- Test results: re-recording needs a reason and its own report, and the earlier result is kept.
- Checklist ticks: these need the checking officer's own inspection, completion or re-inspection evidence, and are only allowed after a claim.
- Contractor repairs: a contractor reporting a repair must attach their own evidence.
- Status labels: RECTIFIED is now "Repair submitted, awaiting independent re-inspection"; CLOSED is now "Closed after independent re-inspection".
- Seed:
  - bills are labelled illustrative and paid;
  - evidence has purposes;
  - the BEL-R-005 repair photo is the contractor's own;
  - there are 22 works (the README said 21).

### Security fixes
- Path traversal in the app catch-all route: it could serve source code and the database. The route is now contained to `dist/`.
- `/media` was public. Private files now need a signed, expiring link.
- Uploads are checked by content (magic bytes and image decode) and size; filenames are generated.
- `X-User` is rejected outside demo mode; `/api/demo/reset` is disabled outside demo mode.
- Tracking requires a random per-report key, and a wrong key looks exactly like an unknown ticket.

### Breaking API changes
- `GET /api/public/track/{ticket}` now needs `?key=`. Report responses include `track_key`.
- `POST /api/works/{id}/evidence`:
  - needs a file;
  - accepts `purpose`, which is restricted per role;
  - `kind` is limited to photo, test_report or document.
- Issue actions `close` and `reopen` reject evidence that is not the actor's own new re-inspection.
- Claim and certify errors return `detail: {message, blockers[]}` instead of a string.
- `/api/meta` returns `mode`, and in pilot mode the officer list is empty for anonymous callers.
- Schema: new tables and columns are added automatically on startup (additive only).
