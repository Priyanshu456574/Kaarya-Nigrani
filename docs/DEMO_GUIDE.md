# Demo guide (about 9 minutes)

All records are synthetic. Reset the demo before each run:
- **Live server:** run `curl -X POST localhost:8000/api/demo/reset`.
- **Serverless demo:** reload the page.

Change roles with the "Acting as" picker. In the serverless demo, the guide button (bottom right) does the switching for you.

## 0. Opening line (15 s)
"A work marked complete on paper is not treated as complete. Kaarya Nigrani traces every work from approved scope to site, to independently verified quality, to a decision, to a usable result."

## Demo 1: Completed on paper, questionable on site (GOG-R-014). About 3 minutes

1. **District Magistrate.** The page opens with four numbers, then **Works with problems**, beside the district map. Each work says what is wrong and who acts next; tap a block to filter. Scroll down to **Needs your decision today**: three items, each in one line (what to decide, which work, who has it, days late). "Open" goes straight to the evidence.
2. Open GOG-R-014. The **Overview** tab shows four numbers: planned, reported (yellow, a claim), checked by the engineer (green or red, a fact) and paid. Under them is one sentence: **"Reported 100% done, but the engineer has checked only 75%."**
3. **Can it be certified usable?** It says **"Not yet"**, with five plain lines: parts not re-measured, photos missing, a test not done, a complaint open, usability checks pending. The exact technical list sits under "See details". Say: "The system will not let anyone certify until these are done."
4. **Money** tab. Two numbers: **Bills raised** and **Actually paid**. A red line says that some of the payment was approved without the AE checking the bill, and a note says these are sample payment records. The bill-by-bill steps sit under "See bill steps", for the officers who process bills.
5. **AE Anjali Kumari.** In her task list, open "Check-measure before the next payment" and press Check-measure on two entries. The verified figure rises; the warning remains until every entry is checked.

## Demo 2: Resident complaint to independently verified closure. About 4 minutes

1. **Resident view** (in Hindi by default). Choose "Report a problem", then Gogri, then Gogri Bazaar – Rampur road. Pick a category, type "Drain missing near the school" and send.
   - The receipt shows the **ticket number and a private tracking code**.
   - Press **Check status**: it shows "Report received (not yet checked)".
   - Say: "The ticket number alone does not open this page, so nobody can read someone else's complaint by guessing numbers."
2. **JE Ravi Kumar:** Acknowledge. A simulated SMS is sent.
3. **AE Anjali Kumari:** Start examination. Show the rule, then record the finding:
   - try "Record verified defect": it asks for *her* inspection photo, because a resident photo is an allegation, not proof;
   - attach a photo and write the finding.
4. **EE Suresh Prasad:** Assign the repair to M/s Kosi Infra with a date.
5. **Contractor M/s Kosi Infra:**
   - Show that he sees only his works.
   - No residents' names, no reports still under examination, no integrity checks.
   - Report the repair with his own photo.
6. **AE Anjali Kumari:** "Re-inspect the repair on site". Show three refusals:
   - the contractor's photo is refused;
   - the same file uploaded again is refused;
   - "send back for rework" also needs her photo.

   Attach a fresh photo and close.
7. **Resident:** open the tracking page. The page says "Checked on site by another officer and closed", and every SMS is listed. Show the **appeal** box: "If the closure is wrong, one tap reopens it for a *different* officer."

## Demo 3: Administrative delay and accountable intervention (ALA-R-007). About 2 minutes

1. **DM:** the top decision is "Hold-up past its deadline: decide":
   - land dispute;
   - owner: Circle Officer;
   - 16 days overdue;
   - escalated to the DDC.
2. **DDC A. K. Verma:** open the hold-up and choose **Record decision and new deadline**. Write "CO to finish joint measurement with the amin by Friday; SDO to attend", with a date 7 days out. Escalation resets, and the instruction is on the issue history.
3. **Circle Officer:** the CO sees only this hold-up, with no bills, tests or measurements. Report it resolved and attach the settlement order as a PDF.
4. **AE:** re-inspect the site with a photo and close. The decision queue no longer lists ALA-R-007.

## Closing (30 s)
- **Evidence:** every decision cites typed evidence from the right person, on the right work and stage.
- **Independence:** no one verifies their own work.
- **Money:** bills are not payments.
- **Privacy:** residents are protected by a private code, and contractors never see allegations about them.
- **Same rules in the browser demo:** an automated parity check confirms it (257 requests, 0 differences).

## If asked
- **"Is this connected to PFMS / SSO / SMS?"** No. These are labelled adapters. See PILOT_READINESS.md.
- **"What stops a fake geotag?"** Nothing in this prototype. Geotags are stored as "sent by the phone (not independently verified)", and photo evidence alone never certifies a work.
