# Test report (v0.5)

Run on 14 Nov 2026, Linux 6.18 (cloud container).
- **Runtimes:** Python 3.13.18, Node 22.23.4.
- **Libraries:** FastAPI 0.162.5, SQLModel 0.0.49, Pydantic 2.13.5, Vite 6.4.6.
- **Browser:** Playwright with Chromium (pre-installed).

Every result below was produced by an actual run, and every run passed.

## Baseline (v0.4, before any change)
| Command | Result |
|---|---|
| `cd backend && python -m pytest -q` | 21 passed (120.9 s) |
| `cd frontend && npm run lint` | 0 errors, 5 warnings |
| `cd frontend && npm run build` | success |

## Final (v0.5)
| Command | Result |
|---|---|
| `cd backend && python -m pytest -q` | **43 passed**, 0 failed (178.6 s). 2 deprecation warnings from FastAPI `on_event` |
| `python scripts/parity.py` (repo root) | **PARITY OK**: 257 requests compared, plus all 20 officers' dashboard, task list and every visible work view. 0 differences |
| `cd frontend && npm run lint` | **0 errors**, 4 warnings: 4 × `react-refresh/only-export-components`, which affects hot reload during development only |
| `cd frontend && npm run build` | success |
| `cd frontend && npx vite build --config vite.demo.config.js` | success (serverless demo) |
| `node frontend/e2e/journeys.mjs http://localhost:8000` (live API + built app) | **19/19** browser checks passed |
| `node frontend/e2e/journeys.mjs http://localhost:8090 demo` (static serverless build) | **12/12** browser checks passed. The 7 checks that need the API to switch personas are covered by the parity check instead |

## What the backend tests cover (43)
`tests/test_stories.py` has 22 tests. The original 21 were adapted to the stricter rules, plus one new legitimate-certification story:
- the three demo stories;
- delay ownership;
- hold points;
- failed test raises a verified defect;
- check-measure clears the unchecked-bill flag;
- chainage coverage;
- escalation to the DDC;
- per-person task lists;
- "same problem" with SMS;
- voice report privacy;
- time extension;
- post-monsoon re-check and votes;
- surprise inspection;
- who sees what (5 tests);
- **legitimate certification**: every blocker cleared step by step, then the EE certifies.

`tests/test_integrity.py` has 21 tests: the mandatory negative and positive tests listed below.

### Mandatory negative tests
| # | Requirement | Test |
|---|---|---|
| 1 | Certification at 41.2% blocked (claim, checklist tick and certify) | `test_41_percent_work_cannot_be_claimed_ticked_or_certified` |
| 2 | Invalid certification evidence ID | `test_checklist_rejects_invalid_foreign_and_resident_evidence` |
| 3 | Inspection citing another work's evidence | `test_inspection_cannot_cite_another_works_evidence` |
| 4 | Resident image used as technical verification | `test_checklist_rejects…`, `test_story_citizen_report_to_verified_closure` |
| 5 | Contractor self-verification | `test_contractor_cannot_verify_own_work` |
| 6 | Closure without a new independent inspection | `test_closure_needs_a_fresh_independent_reinspection` |
| 7 | Reuse of the rectification evidence (same record, or the same file uploaded again) | `test_closure_needs_a_fresh_independent_reinspection` |
| 8 | Officer impersonation in pilot mode | `test_pilot_mode_rejects_persona_headers_and_reset` |
| 9 | Another department's private records | `test_other_departments_records_are_closed`, `test_each_person_sees_only_their_works` |
| 10 | Private resident uploads without a signed link | `test_private_media_needs_a_signed_link` |
| 11 | Invalid or oversized uploads; path traversal | `test_uploads_are_checked_by_content_and_size`, `test_private_media_needs_a_signed_link` |
| 12 | Demo reset in pilot mode | `test_pilot_mode_rejects_persona_headers_and_reset` |
| 13 | Scope change without an audit record | `test_scope_changes_only_through_an_audited_revision` |
| 14 | A bill shown as disbursed | `test_bill_is_not_payment` |
| 15 | Duplicate or conflicting transitions | `test_duplicate_and_stale_transitions_are_rejected`, `test_bill_is_not_payment` (double payment, double billing) |
| 16 | Public voting abuse | `test_public_abuse_controls` |

### Mandatory positive tests
| Requirement | Test |
|---|---|
| Valid staged completion and claim | `test_claim_can_be_returned_and_reclaimed_with_audit` |
| Legitimate certification | `test_legitimate_certification_after_every_condition_is_met` |
| Quality test verification, failure and retest | `test_failed_test_raises_verified_defect`, `test_retest_keeps_the_original_result_on_record` |
| Resident report and acknowledgement | `test_story_citizen_report_to_verified_closure` |
| Inspection, assignment, rectification, independent closure | `test_story_citizen_report…`, `test_closure_needs…` |
| Re-inspection failure and rework | `test_failed_reinspection_returns_for_rework_then_closes` |
| Appeal and reopen | `test_appeal_reopens_closure_for_a_different_officer` |
| Role-specific task visibility | `test_each_person_gets_a_short_task_list`, the who-sees-what tests |
| District escalation, decision, resolution | `test_escalation_reaches_ddc`, `test_land_dispute_escalation_decision_and_resolution` |
| Hindi and English | `test_hindi_text_is_present_for_flags_and_blockers`; browser check "Hindi labels render" |
| Public privacy | `test_public_view_hides_private_data`, `test_track_key_protects_progress_and_public_view_stays_anonymous` |
| API and demo consistency | `scripts/parity.py` |

## Browser checks (`frontend/e2e/journeys.mjs`)
**Live server (19):**
- DM decision queue is visible and names the ALA-R-007 hold-up.
- Demo banner is shown.
- GOG-R-014 shows all three layers, and the reported vs check-measured gap.
- Certification is shown as blocked with the server's reasons.
- Money pipeline separates bills from payments; the illustrative-record label is shown.
- Hindi labels render.
- The contractor cannot see ALA-R-007 and has no decision record.
- The JE's claim button is disabled at 41%, with the reasons shown.
- The ticket alone does not open tracking; ticket plus code does.
- Tracking, dashboard, work page and money tab all fit at 360 px with no sideways scroll.
- No uncaught page errors.

**Serverless demo (12):** the subset that does not need persona switching through the API.

Screenshots from the last run are written to `frontend/e2e/out-*.png`. They are not included in the zip.

## Issues found by testing and fixed
- **Path traversal in the app route (v0.4).** Reproduced: `GET /..%2F..%2Fbackend%2Fapp%2Fdb.py` returned source code. Fixed, and covered by a test.
- **Bill responses empty after commit.** The ORM object expired on commit; it is now refreshed before returning.
- **Half-to-even rounding.** Python rounded halves to even, so some works showed 36.2% on the server and 36.3% in the demo. Both now round half up.
- **Money tab overflow at 360 px.** The bills table is now wrapped in a scroll container.
- **JE claim panel hidden below 50% progress.** It is now always shown while a work is in progress, with the reasons it cannot yet be claimed.
- **"Checked by AE" overstated the amount checked.** It counted by status; it now counts by recorded checker, so authorising without a check shows as a shortfall.

## Not verified
- **Real phones and cameras:** not tested on physical devices. Upload capture was tested with generated images.
- **Concurrency:** no test of true simultaneous requests or row locking. Stale and duplicate actions are tested sequentially.
- **Pilot mode end to end through the UI:** pilot authentication is tested at API level only; the sign-in screen built, but was not exercised in a browser run.
- **Keyboard and screen reader:** no automated accessibility audit (for example axe). Labels and roles were reviewed by hand only.
- **Load and performance:** not tested.
