from datetime import datetime, timedelta, timezone

from .crm_identity import find_lead_by_phone
from .models import CRMFollowUp, CRMLead, CRMLeadActivity, CRMTask, User

ADMIN_ROLES = {"super_admin", "company_admin", "admin"}


def record_lifecycle_event(
    db,
    lead: CRMLead | None,
    event_type: str,
    message: str,
    followup_notes: str = "",
    followup_days: int = 1,
) -> CRMLead | None:
    if not lead:
        return None
    duplicate = db.query(CRMLeadActivity).filter(
        CRMLeadActivity.lead_id == lead.id,
        CRMLeadActivity.activity_type == event_type,
    ).first()
    if duplicate:
        return lead
    activity = CRMLeadActivity(lead_id=lead.id, activity_type=event_type, message=message)
    db.add(activity)
    if followup_notes:
        pending = db.query(CRMFollowUp).filter(
            CRMFollowUp.lead_id == lead.id,
            CRMFollowUp.status == "Pending",
        ).first()
        if not pending:
            due_at = datetime.now(timezone.utc) + timedelta(days=max(0, followup_days))
            db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=due_at, status="Pending", notes=followup_notes))
            lead.next_follow_up_at = due_at
            lead.follow_up_status = "Pending"
        due_at = pending.scheduled_at if pending and pending.scheduled_at else datetime.now(timezone.utc) + timedelta(days=max(0, followup_days))
        task_exists = db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.title == followup_notes, CRMTask.status.in_(["Pending", "In Progress"])).first()
        assignee_id = lead.assigned_user_id or db.query(User.id).filter(User.role.in_(ADMIN_ROLES), User.is_active.is_(True)).order_by(User.created_at.asc()).scalar()
        if assignee_id and not task_exists:
            db.add(CRMTask(
                title=followup_notes,
                description=message,
                due_at=due_at,
                status="Pending",
                priority="High",
                lead_id=lead.id,
                assigned_user_id=assignee_id,
                created_by_user_id=assignee_id,
            ))
    db.commit()
    if lead.source in {"whatsapp", "facebook"}:
        from .whatsapp_ai import create_suggestion_for_activity
        # The caller's request session remains open; use the activity ID after commit
        # so the AI worker can read the durable event in its own session.
        create_suggestion_for_activity(activity.id)
    return lead


def record_lifecycle_event_by_phone(db, phone: str, event_type: str, message: str, followup_notes: str = "", followup_days: int = 1) -> CRMLead | None:
    return record_lifecycle_event(db, find_lead_by_phone(db, phone), event_type, message, followup_notes, followup_days)
