# Kaarya Nigrani (कार्य निगरानी)

A prototype for **District Administration Khagaria, Problem Statement 2: public works progress, quality monitoring and public feedback.**

It links each work's approved scope and schedule to physical and financial progress, stage-wise site evidence, inspection findings and corrective action. It also gives residents a QR-code channel for reporting concerns, which keeps *reported concerns* clearly separate from *verified findings*.

> All works, people and figures in the demo data are **synthetic**. Photos are generated placeholders labelled "DEMO IMAGE".
>
> The map is real: block boundaries are Census 2011 sub-districts with LGD codes ([datta07/INDIAN-SHAPEFILES](https://github.com/datta07/INDIAN-SHAPEFILES)); rivers, the national highway and railways come from [Natural Earth](https://www.naturalearthdata.com/) 1:10m. Each demo work sits inside its correct block. The live app also draws OpenStreetMap tiles underneath.
>
> `npx vite build -c vite.demo.config.js` builds a serverless version with an in-browser engine (`src/demo/engine.js`) and a step-by-step demo guide.

## Run it

Requirements: Python 3.11+ and Node 18+.

```bash
# 1. Backend (API + serves the built app)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --port 8000          # demo data loads automatically on first run

# 2. Frontend: build once
cd ../frontend
npm install
npm run build                              # backend now serves it at http://localhost:8000
```

Open **http://localhost:8000** for the officer view and **http://localhost:8000/public** for the resident view.

For live frontend development, run `npm run dev` (port 5173, proxies `/api` to 8000).

* **Reset the demo data** before each rehearsal: `curl -X POST localhost:8000/api/demo/reset`, or `python -m app.seed` from `backend/`.
* **Run the tests:**
  * `cd backend && python -m pytest -q`: 43 tests covering the demo stories, certification, evidence, closure, audit, money, security and privacy.
  * `python scripts/parity.py` (from the repo root): checks that the API and the in-browser demo engine give identical answers.
  * `node frontend/e2e/journeys.mjs http://localhost:8000`: browser checks with Playwright. Add `demo` and the static URL to check the serverless build.

  Exact results are in `docs/TEST_REPORT.md`.
* **Demo or pilot mode:** the default `KN_MODE=demo` uses synthetic data and the persona switcher. `KN_MODE=pilot` needs `KN_SECRET` (32+ characters), rejects persona headers, disables reset, never seeds demo data and asks officers to sign in. Create passwords with `python -m app.auth set-password <officer_id> <password>`. See `docs/PILOT_READINESS.md`.
* **Use it from a phone on the same Wi-Fi:** run uvicorn with `--host 0.0.0.0` and open `http://<laptop-ip>:8000`. The QR code on each work page then points to that address.

## Built for officers, not technologists (v0.5.1)
* **Every work page opens with four numbers and one plain sentence**, for example "Reported 100% done, but the engineer has checked only 75%."
* **"Can it be certified usable?"** answers yes, or "Not yet", with at most a few plain lines. The exact technical list is under "See details".
* **Money shows two numbers**, Bills raised and Actually paid. The bill-by-bill steps are folded away for the officers who process bills.
* **The DM's decision list shows three items**, each in one line: what to decide, which work, who has it, and how many days late.
* **Panels with nothing to show are hidden.** History of decisions stays folded until opened. Certifying asks for confirmation.
* **The same plain wording is used in Hindi.**

## What's new in v0.5: integrity you can defend

* **Certification Eligibility Engine.** A work is certified only when:
  * every stage is measured and check-measured;
  * every test has passed;
  * every measured stretch has site photos;
  * no issue or appeal is open;
  * each usability item is backed by the AE/EE's own evidence;
  * the EE of that work signs.

  The work page shows the same list the server enforces. Payment is reported separately and is never a condition.
* **Evidence with purpose and provenance.** Each upload records:
  * its work and stage;
  * its purpose: inspection, re-inspection, repair, completion, test report, progress or document;
  * the uploader and their role;
  * the upload time;
  * its SHA-256 hash;
  * its coordinate source (geotags are recorded as "sent by the phone", not verified).

  Decisions reject evidence that is missing, from another work, a resident upload, filed for the wrong purpose, from the wrong person or reused.
* **Independent closure.** Only an AE/EE who did not do the repair can close it, with their own new photo taken after the repair. A failed re-inspection sends the issue back for rework. Residents can appeal a closure, and a different officer then examines it.
* **Approved, Reported, Verified.** The work page puts the three side by side, and the gap between reported and check-measured progress is shown in red.
* **Money tells the truth.** Bills go submitted → checked by the AE → authorised by the EE → payment recorded. Only recorded payments count as spent, and every payment shows its source ("illustrative" or "manual entry, not bank-verified").
* **The DM's decision queue.** Each item shows what to decide, why, who holds it, since when, its due date and how far it has escalated, with a one-tap path to the evidence. The DM/DDC can record a decision and a new deadline.
* **Security.**
  * Pilot-mode sign-in.
  * Signed, expiring links for private media.
  * Uploads checked by content and size.
  * A private tracking code for residents.
  * One support and one opinion per person.
  * Rate limits on public endpoints.
  * A path-traversal hole in the app route was fixed.
* **Append-only decision record.** Covers claims, check-measures, tests and retests, checklist ticks, certification, extensions, bills and scope revisions.

See `docs/IMPLEMENTATION_REPORT.md`, `docs/PS2_COMPLIANCE_MATRIX.md`, `docs/DEMO_GUIDE.md`, `docs/TEST_REPORT.md`, `docs/PILOT_READINESS.md` and `docs/CHANGELOG.md`.

## Who it is for, and how that shaped it (v0.3)
| Person | Their reality | What they see |
|---|---|---|
| Junior Engineer | On site, on a phone, poor network, many works | **My tasks**: only their own to-dos, most urgent first, one button each |
| Assistant / Executive Engineer | Approvals and checks between site visits | **My tasks**: check-measure, examine, assign, certify, surprise inspections |
| Contractor | Wants to be paid; a few works | Only the repairs assigned to them, with a due date |
| Circle Officer / BDO | Not a works specialist | Only the hold-up they own, in plain words |
| DM / DDC | A short review meeting | Four numbers, the top 5 decisions, then detail on request |
| Resident | Hindi, may not read well, may not own a smartphone | Three big choices, speak instead of type, SMS at every step, help at the Panchayat Bhawan |

Design rules that follow from this:
* **Show the next action, not the database.** Everyone except the DM lands on a task list built from open issues and flags addressed to them.
* **One step at a time.** Work pages use tabs, and stage details stay folded unless something needs a look. The resident report is three short steps.
* **Fewer duplicates, louder voices.** Before filing, residents see open reports on that work and can join one ("same problem").
* **Plain words, both languages,** chosen once and kept across screens.

## Who sees what (v0.4)
Facts are public; work is need-to-know. Each person opens only the works they are named on, and three things get stricter rules.

| Person | Opens | Does not see |
|---|---|---|
| Resident / public | Every work, as its site board | Suspicion flags, internal notes, personal details, inspection plans |
| DM / DDC | Every work | — |
| EE | Their department's works | — |
| AE | The works they supervise | — |
| JE | Their assigned works | Photo and bill integrity checks (these go to the AE/EE first); surprise picks until done |
| Contractor | Their own contracts | Who complained, residents' photos and voice notes, reports still being checked, integrity checks, surprise picks, other contractors' works |
| CO / BDO | Only works where they own a hold-up | Bills, tests, measurement book, who complained |

* **Who complained** is shown only to the engineers handling the report and to the DM/DDC, so no one can pressure a resident.
* **Surprise inspection picks** are seen only by the assigned AE and the DM/DDC until the visit is done.
* **Suspicion flags** (same photo on two works, photo off site, bill on unchecked measurements) are leads, not findings, so they stay with AE/EE/DM until examined.

The rules live in `backend/app/access.py` and are mirrored in the demo engine. Opening a work outside one's scope shows a plain "not one of your responsibilities" page with a link to its public view. Rules are in `docs/DESIGN.md` §6a.

## What's new in v0.3
* Task list per person (`GET /api/tasks`), including escalated items and weekly surprise inspections (2 picked by risk, 1 at random).
* Time extensions: the EE records a new date, a reason and a justification. The original date stays visible and the plan is stretched to match.
* After completion: a defect liability date, a mandatory post-monsoon re-check (a failed re-check raises a defect), and residents' "is it usable?" answers.
* Resident: choose a block, a three-step report with a voice note, "same problem" joining, SMS on every status change (simulated), and no-smartphone options.

## What's new in v0.2
* **Quality test register with hold points.** Each stage lists its required tests with specification limits. These values are illustrative; a pilot takes them from the sanctioned specification. A failed result automatically raises a verified defect for the EE. A stage cannot be measured until the tests of the stage it sits on have passed (e.g. bitumen waits on the WBM thickness test).
* **Roads and drains as lines with chainage.** Each photo's chainage is worked out from its GPS position. The site is a 150 m corridor along the alignment. "Backed by site photos" is computed per 0.5 km of measured stretch, and gaps are drawn in red on the map.
* **Progress from the measurement book.** The JE records quantities (with chainage for linear stages) and the AE check-measures them. Running-account bills are linked to measurement entries. Bills paid on unchecked entries are flagged.
* **District view of hold-ups and escalation.** Hold-ups are grouped by reason. Overdue items escalate automatically: owner for 1–7 days, then their supervisor until 14 days, then the DDC. A "Copy meeting summary" button produces the review note.
* **Hindi / English switch** across officer and resident screens. Flags are generated in both languages.

## What is where

```
docs/DESIGN.md            data model, issue lifecycle, flag rules (read this first)
backend/app/models.py     Work, Stage, ProgressReport, Evidence, Issue, IssueEvent, UsabilityItem
backend/app/workflow.py   the only place issue status can change; role and evidence rules
backend/app/flags.py      transparent rule-based flags (English + Hindi) + named owner for each
backend/app/access.py     who may open which work, and what each person sees on it
backend/app/geo.py        chainage from GPS, coverage bins
shared/terms_hi.json      Hindi terms shared by backend and frontend
frontend/src/strings.js   officer interface text in English and Hindi
backend/app/certification.py  the certification gate (claim and certify blockers, money reported separately)
backend/app/evidence.py   upload checks, provenance, signed media, the evidence validator
backend/app/auth.py       demo persona header vs pilot sign-in tokens
backend/app/audit.py      append-only decision record
backend/app/config.py     KN_MODE, secrets, limits
backend/app/main.py       API (officer + public endpoints, QR codes)
backend/app/seed.py       22 synthetic works across all 7 blocks with the demo stories built in
scripts/parity.py         API vs demo-engine parity check
frontend/e2e/journeys.mjs browser checks of the main journeys
frontend/src/pages        Dashboard (review), WorkDetail, MyActions, PublicHome, PublicWork, Track
```

## Demo script

The 9-minute script, covering DM, JE, AE, EE, contractor, Circle Officer, DDC and resident across three stories, is in **`docs/DEMO_GUIDE.md`**. The serverless build has the same steps in its built-in guide.

## Pilot items (not in this prototype)
* State SSO / OTP. Pilot mode has interim password sign-in with signed tokens.
* SMS gateway (simulated today), plus an IVR or missed-call channel.
* PFMS / treasury feed. Payments are manual entries labelled "not bank-verified".
* Import from existing scheme MIS and e-procurement, to avoid double entry.
* Offline capture with later sync. Not implemented.
* Postgres with Alembic migrations: set `KN_DB_URL`. Today's auto-migration only adds tables and columns.

Full list: `docs/PILOT_READINESS.md`.
