# Pilot readiness

## Safe for the synthetic competition demo (now)
- **Demo mode** (`KN_MODE=demo`, the default):
  - synthetic seed data only;
  - persona switcher;
  - reset endpoint;
  - a "synthetic data" banner on every officer page.
- **The serverless browser demo** runs the same rules as the API, as checked by `scripts/parity.py`.
- **All workflows in DEMO_GUIDE.md** are reproducible after a reset.

## Suitable for a controlled pilot after the steps below (one block, one department, a few works)
These pieces are built and tested:
- the certification engine;
- the evidence validator;
- independent closure;
- appeals;
- the audit trail;
- the bill pipeline;
- signed media;
- upload checks;
- pilot authentication (`KN_MODE=pilot`).

Before going live:
1. **Configuration:**
   - set `KN_MODE=pilot`;
   - set `KN_SECRET` (32+ random characters);
   - set `KN_ALLOWED_ORIGINS`;
   - set `KN_VOTER_SALT`;
   - point `KN_DB_URL` at Postgres.

   Demo data is never seeded in pilot mode.
2. **Accounts:** create officer records, then run `python -m app.auth set-password <id> <password>` for each officer as interim sign-in.
3. **Real data:** enter real works with their sanctioned stages, quantities, specifications and checklist items. Have the EE confirm each one.
4. **Infrastructure:**
   - put the app behind HTTPS (nginx or the NIC gateway);
   - enable the gateway's rate limiter, since the built-in limiter keeps counts in memory on one server;
   - move media to protected storage with backups.
5. **Database:** replace the additive auto-migration with Alembic migrations and take nightly database backups.

## Needs official approval, integration, data validation or security review
| Item | Why | What exists today |
|---|---|---|
| State SSO / e-Pramaan / OTP login | Real identity and leaver handling | Signed-token foundation, `OfficerCredential` table, sign-in screen |
| SMS gateway (DLT-registered templates) | Real acknowledgements | Simulated SMS log with Hindi and English templates |
| PFMS / treasury payment feed | Verified disbursement | Manual payment entry labelled "not bank-verified" |
| e-procurement and scheme MIS import | Avoid double entry of sanction and BOQ | Manual sanction record and scope revisions |
| Approved quality specifications per work type | Test limits must match the department's specifications | Illustrative limits in the seed |
| Usability checklist per work type | Must be agreed by the departments | Proposed lists |
| Escalation periods and appeal policy | Administrative decision | 7 / 14 days; 30-day window, 2 appeals |
| Verified geolocation | Device geotags can be spoofed | Stored as `device_claimed`; never sufficient on their own |
| Offline field capture | Connectivity at sites | Not implemented |
| Data protection review (DPDP Act 2023) | Resident phone numbers and media | Phone numbers visible only to handling engineers and DM/DDC; private media behind signed links |
| Independent security assessment | Required before real records | Internal tests only (see TEST_REPORT.md); no external audit has been done |
| Row-level locking on Postgres | Concurrent approvals at scale | Status checks plus HTTP 409 on stale or duplicate actions |
