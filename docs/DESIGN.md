# Kaarya Nigrani — design spec (v0.1)

*Kaarya Nigrani* (कार्य निगरानी, "works monitoring"): public-works progress, quality monitoring and public feedback for District Administration, Khagaria. Problem Statement 2.

## 1. Principles
1. **The work–stage is the unit of truth.** Every photo, measurement, test, inspection note and complaint hangs off one work and one construction stage. District views are aggregations, never separate data entry.
2. **Reported ≠ verified.** A resident report or a photo is a *reported concern*. Only a technical officer (AE/EE), recording inspection evidence, can turn it into a *verified finding*. The two are labelled differently everywhere, including the public page.
3. **Every open item has one owner and one due date.** The next action is always visible.
4. **"Complete" means usable.** A work is certified only when its usability checklist passes and no verified defect is open.
5. **Flags explain themselves.** Prioritisation is rule-based and transparent ("financial 98% vs physical 71%"), so officers can defend it in review meetings.
6. **Technical judgement stays with engineers.** The system records, routes and reminds; it never grades quality itself.

## 2. Data model
```
Officer(id, name, role, department, block)
  role ∈ JE, AE, EE, CONTRACTOR, CO, BDO, DDC, DM

Work(id, code, name, work_type, department, scheme, block, village,
     lat, lng, geofence_m, sanctioned_lakh, contractor_id, je_id, ae_id, ee_id,
     start_date, planned_end, status, qr_token, completion_claimed_on)
  status: SANCTIONED → IN_PROGRESS → REPORTED_COMPLETE → USABLE_VERIFIED

Stage(id, work_id, seq, name, weight, planned_start, planned_end, progress%, completed_on)
ProgressReport(id, work_id, report_date, physical_pct, financial_pct, note, reported_by)
Evidence(id, work_id, stage_id, issue_id?, kind, caption, file, lat, lng,
         captured_at, uploaded_by, source, phash, in_geofence)
  kind ∈ photo, measurement, test_report, inspection_note
Issue(id, ticket, work_id, stage_id?, source, category, reason_code?, title,
      description, status, owner_id, due_date, finding, complainant_name,
      complainant_phone [never public])
  source ∈ citizen, officer, inspection   category ∈ quality, usability, delay, safety
IssueEvent(id, issue_id, at, actor_id, actor_label, from_status, to_status, note, evidence_id)
UsabilityItem(id, work_id, item, passed?, verified_by, verified_on, evidence_id)
```

## 3. Issue lifecycle
```
REPORTED ─ack→ ACKNOWLEDGED ─examine→ UNDER_EXAMINATION ─┬─verify→ VERIFIED ─assign→ ACTION_ASSIGNED ─rectified→ RECTIFIED ─close→ CLOSED
                                                         └─reject→ NOT_SUBSTANTIATED (terminal, reason recorded)
                                                                         RECTIFIED ─reopen→ ACTION_ASSIGNED
```
| Action | Allowed roles | Must record |
|---|---|---|
| acknowledge | JE, AE, EE | examining officer, due date (default +7 days) |
| examine | JE, AE, EE | — |
| verify / reject | AE, EE | inspection evidence + written finding |
| assign | AE, EE, DM, DDC | owner + due date |
| rectified | owner, JE, CONTRACTOR | evidence of rectification |
| close | AE, EE (not the person who marked it rectified) | verification evidence |
| reopen | AE, EE | reason |

* A resident report always starts at **REPORTED**.
* An AE/EE who raises an issue *with inspection evidence* creates it directly as **VERIFIED** (an inspection finding).
* Delay issues carry a reason code: LAND, UTILITY, FUNDS, CONTRACTOR, DESIGN_CHANGE, FLOOD_SEASON, MATERIAL, OTHER. The owner can be outside the works department, e.g. a Circle Officer for land.

## 4. Completion
* A JE **claims completion** → REPORTED_COMPLETE.
* An EE **certifies usable** → USABLE_VERIFIED, only if every usability item has passed (each with evidence) and every issue on the work is closed or examined and not substantiated, so no resident concern is left unexamined.

## 5. Flags (computed live)
| Code | Rule | Severity |
|---|---|---|
| SCHEDULE_SLIP | planned progress today − actual ≥ 15 pts (≥ 30 high) | 2–3 |
| PAST_DEADLINE | today > planned_end and not complete | 3 |
| FIN_AHEAD | latest financial % − physical % ≥ 15 | 3 |
| STAGE_NO_EVIDENCE | stage progress > 0 but no officer evidence for that stage | 2 |
| STALE_EVIDENCE | in progress, no officer evidence for 21 days | 1 |
| UNACKED_REPORTS | resident report not acknowledged within 3 days | 2 |
| OVERDUE_ACTION | open issue past due date | 2 |
| REPEAT_COMPLAINTS | ≥ 3 resident reports in 60 days | 2 |
| COMPLETE_NOT_USABLE | claimed complete but checklist failing/unchecked or verified issue open | 3 |
| DUPLICATE_PHOTO | photo perceptual hash matches a photo on a different work | 3 |
| OUTSIDE_SITE | photo geotag outside the work's geofence | 2 |

The intervention score is the sum of severities. Every flag names who should act next.

## 6. Public channel
* A QR code on the site board opens `/w/<qr_token>`, showing the work, its status, and resident reports with their verification state.
* A resident report needs a category, a description, and optionally a photo and name/phone. It returns ticket **KGR-YYYY-NNNN**, trackable at `/track/<ticket>`.
* Phone numbers are visible only to the engineers handling the report and the DM/DDC. Public timelines show the status and the officer's note, never internal identities beyond role.

## 6a. Who sees what (`backend/app/access.py`)
Principle: **facts are public, work is need-to-know.** Every officer endpoint needs a login; scope is checked on reads and writes.

| Person | Works they can open | What is held back |
|---|---|---|
| Public | All, as the site-board view | Suspicion flags, internal notes, personal details, inspection plans |
| DM / DDC | All | Nothing |
| EE | Their department | Nothing |
| AE | Works they supervise | Nothing (sees this week's surprise pick on their works before it happens) |
| JE | Works assigned to them | Suspicion flags (duplicate or off-site photo, unchecked bills, payments ahead, hold bypassed); surprise picks until done |
| Contractor | Their own contracts | Complainant identity, residents' photos and voice notes, reports not yet examined, suspicion flags, surprise picks, other contractors' works |
| CO / BDO | Works where they own or acted on a hold-up | Bills, tests, measurement book, complainant identity; sees only their own issues |

Three things have stricter rules than "need-to-know":
1. **Complainant identity** (name, phone, voice note): only the handling engineers and the DM/DDC. This protects residents from pressure.
2. **Surprise inspection picks**: only the assigned AE and the DM/DDC, and the JE/EE after it is done. A pick that leaks stops being a surprise.
3. **Suspicion flags**: internal to AE/EE/DM/DDC until examined. They are leads, not findings, so they are not shown to the people they are about.

Opening a work outside one's scope returns 403, and the interface says so in plain words with a link to the public page.

## 7. Out of scope for the demo (pilot items)
* Real SSO/OTP login. The demo uses a role switcher.
* SMS/WhatsApp gateways. The demo shows the acknowledgement on screen.
* Import from scheme MIS / e-procurement.
* Offline sync.


## 7. v0.5 integrity rules (summary)

**Work status machine** (server-enforced):
- SANCTIONED → IN_PROGRESS → REPORTED_COMPLETE → USABLE_VERIFIED.
- REPORTED_COMPLETE → IN_PROGRESS when the AE/EE returns a claim with a reason.
- Claiming needs every stage measured to its current sanctioned quantity.
- Certifying needs `certification.blockers()` to be empty: authority, quantities, check-measured quantities, photo coverage, tests, open issues and checklist evidence.

**Issue lifecycle additions:**
- RECTIFIED → CLOSED needs a re-inspection by an AE/EE who is neither the rectifier nor the uploader of the repair evidence. The evidence must be their own, newer than the repair, and not the same or a near-identical file.
- RECTIFIED → ACTION_ASSIGNED (rework) needs the same kind of evidence and a note.
- CLOSED or NOT_SUBSTANTIATED → APPEALED, by the resident with their tracking code, within 30 days and at most twice. APPEALED → UNDER_EXAMINATION, by anyone except the officer who decided it.
- ACTION_ASSIGNED → ACTION_ASSIGNED (`direct`): the DM/DDC record an instruction and a new deadline.

**Evidence purposes accepted per step:**

| Step | Purposes accepted | Who must have uploaded it |
|---|---|---|
| verify | inspection, test_report, reinspection | an engineer |
| reject | inspection, reinspection | an engineer |
| rectified | rectification, progress, completion, document | the contractor, if the contractor reports it |
| close, reopen | reinspection, inspection | the actor (AE/EE) |
| checklist tick | inspection, completion, reinspection | the actor (AE/EE) |
| test result | test_report, inspection | an engineer; must be filed under the same stage |

**Money:** a bill goes SUBMITTED → CHECKED (AE, only when every cited measurement is check-measured) → AUTHORIZED (EE of the work) → PAID (EE or DDC, amount up to the bill, reference required, source `manual_entry`). `financial` counts PAID only.
