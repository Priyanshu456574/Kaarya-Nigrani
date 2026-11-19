"""Append-only audit trail for decisions on works. Rows are only ever inserted."""
import json
from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from .models import AuditEvent, Officer


def record(session: Session, *, work_id: Optional[int], entity: str, entity_id: Optional[int], action: str,
           actor: Optional[Officer], before: Optional[dict] = None, after: Optional[dict] = None,
           reason: str = "", evidence_id: Optional[int] = None, at: Optional[datetime] = None) -> AuditEvent:
    ev = AuditEvent(work_id=work_id, entity=entity, entity_id=entity_id, action=action,
                    actor_id=actor.id if actor else None, actor_role=actor.role if actor else None,
                    before=json.dumps(before or {}, default=str), after=json.dumps(after or {}, default=str),
                    reason=reason, evidence_id=evidence_id, at=at or datetime.now().replace(microsecond=0))
    session.add(ev)
    return ev


def history(session: Session, work_id: int, entity: Optional[str] = None, entity_id: Optional[int] = None):
    q = select(AuditEvent).where(AuditEvent.work_id == work_id)
    if entity:
        q = q.where(AuditEvent.entity == entity)
    if entity_id is not None:
        q = q.where(AuditEvent.entity_id == entity_id)
    rows = session.exec(q.order_by(AuditEvent.at, AuditEvent.id)).all()
    return [{"id": r.id, "entity": r.entity, "entity_id": r.entity_id, "action": r.action, "actor_id": r.actor_id,
             "actor_role": r.actor_role, "before": json.loads(r.before), "after": json.loads(r.after),
             "reason": r.reason, "evidence_id": r.evidence_id, "at": r.at.isoformat()} for r in rows]
