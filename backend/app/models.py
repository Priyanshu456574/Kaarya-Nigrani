from datetime import date, datetime
from typing import Optional

from pydantic import NaiveDatetime
from sqlmodel import Field, SQLModel


class Officer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    role: str  # JE, AE, EE, CONTRACTOR, CO, BDO, DDC, DM
    department: str
    block: Optional[str] = None


class Work(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    name: str
    work_type: str  # road, drain, building, culvert
    department: str
    scheme: str
    block: str
    village: str
    lat: float
    lng: float
    geofence_m: int = 400
    sanctioned_lakh: float
    contractor_id: Optional[int] = Field(default=None, foreign_key="officer.id")
    je_id: Optional[int] = Field(default=None, foreign_key="officer.id")
    ae_id: Optional[int] = Field(default=None, foreign_key="officer.id")
    ee_id: Optional[int] = Field(default=None, foreign_key="officer.id")
    start_date: date
    planned_end: date
    status: str = "IN_PROGRESS"  # SANCTIONED, IN_PROGRESS, REPORTED_COMPLETE, USABLE_VERIFIED
    qr_token: str = Field(index=True, unique=True)
    completion_claimed_on: Optional[date] = None
    length_km: Optional[float] = None
    revised_end: Optional[date] = None  # latest approved time extension; planned_end stays as the original baseline
    certified_on: Optional[date] = None
    dlp_end: Optional[date] = None  # defect liability period: contractor must repair defects free until this date
    alignment: Optional[str] = None  # JSON [[lat, lng], ...] for roads and drains


class Stage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    seq: int
    name: str
    weight: float  # share of whole work, weights of a work sum to 100
    planned_start: date
    planned_end: date
    progress: float = 0  # 0..100, derived from measured quantity
    completed_on: Optional[date] = None
    unit: str = "%"
    qty_sanctioned: float = 100
    qty_executed: float = 0
    qty_original: Optional[float] = None  # sanctioned quantity before any approved scope revision
    linear: bool = False  # measured along the alignment (km / m), so evidence coverage is checked by chainage


class ProgressReport(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    report_date: date
    physical_pct: float
    financial_pct: float
    note: str = ""
    reported_by: Optional[int] = Field(default=None, foreign_key="officer.id")


class Evidence(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    stage_id: Optional[int] = Field(default=None, foreign_key="stage.id")
    issue_id: Optional[int] = Field(default=None, foreign_key="issue.id")
    kind: str = "photo"  # photo, measurement, test_report, inspection_note
    caption: str = ""
    file: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    captured_at: NaiveDatetime
    uploaded_by: Optional[int] = Field(default=None, foreign_key="officer.id")
    source: str = "officer"  # officer, citizen
    phash: Optional[str] = None
    in_geofence: Optional[bool] = None
    chainage_km: Optional[float] = None  # worked out from the geotag for linear works
    # provenance (v0.5)
    purpose: str = "progress"  # progress, inspection, reinspection, rectification, test_report, completion, citizen_report, document
    uploaded_at: Optional[NaiveDatetime] = None
    uploader_role: Optional[str] = None
    sha256: Optional[str] = None
    coord_source: str = "none"  # none, device_claimed (geotag sent by the phone; not independently verified)
    mime: Optional[str] = None
    public: bool = False  # only explicitly public media is served without a signed link


class Issue(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket: str = Field(index=True, unique=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    stage_id: Optional[int] = Field(default=None, foreign_key="stage.id")
    source: str  # citizen, officer, inspection
    category: str  # quality, usability, delay, safety
    reason_code: Optional[str] = None
    title: str
    description: str = ""
    status: str = "REPORTED"
    owner_id: Optional[int] = Field(default=None, foreign_key="officer.id")
    due_date: Optional[date] = None
    finding: Optional[str] = None
    created_at: NaiveDatetime
    complainant_name: Optional[str] = None
    complainant_phone: Optional[str] = None
    rectified_by: Optional[int] = None
    supporters: int = 0  # other residents who said "same problem"
    track_key: Optional[str] = None  # private tracking secret given only to the complainant
    decided_by: Optional[int] = None  # officer who closed / rejected it (cannot decide again on appeal)
    appeals: int = 0
    closed_at: Optional[NaiveDatetime] = None


class IssueEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    at: NaiveDatetime
    actor_id: Optional[int] = Field(default=None, foreign_key="officer.id")
    actor_label: str
    action: str
    from_status: Optional[str] = None
    to_status: str
    note: str = ""
    evidence_id: Optional[int] = Field(default=None, foreign_key="evidence.id")


class UsabilityItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    item: str
    passed: Optional[bool] = None
    verified_by: Optional[int] = Field(default=None, foreign_key="officer.id")
    verified_on: Optional[date] = None
    evidence_id: Optional[int] = Field(default=None, foreign_key="evidence.id")


class Measurement(SQLModel, table=True):
    """Measurement book entry by the JE; check-measured by the AE before it should be paid."""
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    stage_id: int = Field(foreign_key="stage.id")
    entry_date: date
    qty: float
    ch_from: Optional[float] = None
    ch_to: Optional[float] = None
    recorded_by: Optional[int] = Field(default=None, foreign_key="officer.id")
    checked_by: Optional[int] = Field(default=None, foreign_key="officer.id")
    checked_on: Optional[date] = None


class Bill(SQLModel, table=True):
    """Running-account bill paid to the contractor, against measurement entries."""
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    bill_no: int
    bill_date: date
    amount_lakh: float
    mb_ids: str = "[]"  # JSON list of Measurement ids covered
    # pipeline: SUBMITTED -> CHECKED (AE) -> AUTHORIZED (EE) -> PAID (disbursement recorded)
    status: str = "SUBMITTED"
    submitted_by: Optional[int] = None
    checked_by: Optional[int] = None
    checked_on: Optional[date] = None
    authorized_by: Optional[int] = None
    authorized_on: Optional[date] = None
    paid_on: Optional[date] = None
    paid_lakh: Optional[float] = None
    payment_ref: Optional[str] = None
    payment_source: Optional[str] = None  # illustrative_seed, manual_entry (never bank-verified in this prototype)
    recorded_by: Optional[int] = None


class QualityTest(SQLModel, table=True):
    """A required or recorded field / lab test with its specification."""
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    stage_id: int = Field(foreign_key="stage.id")
    name: str
    kind: str = "numeric"  # numeric, passfail
    unit: str = ""
    spec_min: Optional[float] = None
    spec_max: Optional[float] = None
    result: Optional[float] = None  # passfail: 1 pass, 0 fail
    passed: Optional[bool] = None
    chainage_km: Optional[float] = None
    tested_on: Optional[date] = None
    tested_by: Optional[int] = Field(default=None, foreign_key="officer.id")
    lab: Optional[str] = None
    evidence_id: Optional[int] = Field(default=None, foreign_key="evidence.id")
    issue_id: Optional[int] = Field(default=None, foreign_key="issue.id")


class TimeExtension(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    old_end: date
    new_end: date
    reason_code: str
    note: str = ""
    approved_by: Optional[int] = Field(default=None, foreign_key="officer.id")
    approved_on: date


class PostCheck(SQLModel, table=True):
    """Re-check of a completed work, e.g. after its first monsoon."""
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    kind: str = "post_monsoon"
    due_date: date
    done_on: Optional[date] = None
    done_by: Optional[int] = Field(default=None, foreign_key="officer.id")
    passed: Optional[bool] = None
    note: str = ""
    evidence_id: Optional[int] = Field(default=None, foreign_key="evidence.id")


class Inspection(SQLModel, table=True):
    """A completed surprise inspection (the weekly picks themselves are computed, not stored)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    week: str
    done_on: date
    done_by: Optional[int] = Field(default=None, foreign_key="officer.id")
    outcome: str  # ok, issues
    note: str = ""
    evidence_id: Optional[int] = Field(default=None, foreign_key="evidence.id")


class UsabilityVote(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    usable: bool
    at: NaiveDatetime
    voter: Optional[str] = None  # salted hash of phone or device; one vote per voter per work


class SupportRecord(SQLModel, table=True):
    """One 'same problem' per resident per report."""
    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    voter: str
    at: NaiveDatetime


class ScopeRevision(SQLModel, table=True):
    """Approved change to a stage's sanctioned quantity. The original stays on record."""
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: int = Field(foreign_key="work.id", index=True)
    stage_id: int = Field(foreign_key="stage.id")
    old_qty: float
    new_qty: float
    reason: str
    order_ref: str
    approved_by: int = Field(foreign_key="officer.id")
    approved_on: date


class AuditEvent(SQLModel, table=True):
    """Append-only record of decisions on works (issue steps are in IssueEvent)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    work_id: Optional[int] = Field(default=None, index=True)
    entity: str  # work, test, measurement, bill, checklist, stage, extension
    entity_id: Optional[int] = None
    action: str
    actor_id: Optional[int] = None
    actor_role: Optional[str] = None
    before: str = "{}"
    after: str = "{}"
    reason: str = ""
    evidence_id: Optional[int] = None
    at: NaiveDatetime


class OfficerCredential(SQLModel, table=True):
    """Pilot-mode password login (placeholder until the state SSO / OTP gateway is connected)."""
    officer_id: int = Field(primary_key=True, foreign_key="officer.id")
    pw_hash: str
    active: bool = True


class Notification(SQLModel, table=True):
    """SMS sent to a resident (simulated in the demo; an SMS gateway in a pilot)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket: str = Field(index=True)
    phone: str
    text: str
    text_hi: str
    sent_at: NaiveDatetime
