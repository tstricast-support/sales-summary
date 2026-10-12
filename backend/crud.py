from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN
from sqlalchemy import func, and_,inspect,text
from sqlalchemy.orm import joinedload
import models, schemas

DEPARTMENTS = [
    ("DD ENGINEERING", "dd-engineering"), ("I LAB", "i-lab"), ("I LAB STD", "i-lab-std"),
    ("I PHOTOBOOK", "i-photobook"), ("TRICAST", "tricast"),
]


def seed_departments(db):
    for name, slug in DEPARTMENTS:
        if not db.query(models.Department).filter_by(slug=slug).first():
            db.add(models.Department(name=name, slug=slug, logo_path=f"/logos/{slug}.png"))
    db.commit()


def upsert_record(db, d: schemas.RecordIn, commit=True):
    dept = db.query(models.Department).filter_by(slug=d.department_slug).first()
    if not dept:
        raise LookupError("Unknown department")
    rec = db.query(models.DailyRecord).filter_by(department_id=dept.id, record_date=d.record_date).first()
    if rec is None:
        rec = models.DailyRecord(department_id=dept.id, record_date=d.record_date, sales_amount=d.sales_amount,
                                 collection_amount=d.collection_amount, submitted_by=d.submitted_by)
        db.add(rec); db.flush()
        db.add(models.AuditLog(record_id=rec.id, changed_by=d.submitted_by, action_type="CREATE",
                               new_sales=d.sales_amount, new_collection=d.collection_amount,
                               department_slug=dept.slug, department_name=dept.name, record_date=rec.record_date))
    elif rec.sales_amount != d.sales_amount or rec.collection_amount != d.collection_amount:
        db.add(models.AuditLog(record_id=rec.id, changed_by=d.submitted_by, action_type="UPDATE",
                               old_sales=rec.sales_amount, new_sales=d.sales_amount,
                               old_collection=rec.collection_amount, new_collection=d.collection_amount,
                               department_slug=dept.slug, department_name=dept.name, record_date=rec.record_date))
        rec.sales_amount, rec.collection_amount, rec.submitted_by = d.sales_amount, d.collection_amount, d.submitted_by
    if commit:
        db.commit(); db.refresh(rec)
    else:
        db.flush()
    return rec

def bulk_upsert(db, b: schemas.BulkIn):
    if b.month:
        start = date(b.year, b.month, 1)
        end = date(b.year + (b.month == 12), b.month % 12 + 1, 1) - timedelta(days=1)
    else:
        start, end = date(b.year, 1, 1), date(b.year, 12, 31)
    end = min(end, date.today())
    if start > end:
        raise ValueError("That period is in the future")
    n = (end - start).days + 1
    q = Decimal("0.01")
    sp = (b.sales_amount / n).quantize(q, ROUND_DOWN)
    cp = (b.collection_amount / n).quantize(q, ROUND_DOWN)
    for i in range(n):
        last = i == n - 1
        upsert_record(db, schemas.RecordIn(
            department_slug=b.department_slug, record_date=start + timedelta(days=i),
            sales_amount=b.sales_amount - sp * (n - 1) if last else sp,
            collection_amount=b.collection_amount - cp * (n - 1) if last else cp,
            submitted_by=b.submitted_by), commit=False)
    db.commit()
    return n


def list_records(db, start, end, slug=None):
    q = (db.query(models.DailyRecord).options(joinedload(models.DailyRecord.department))
         .join(models.Department).filter(models.DailyRecord.record_date.between(start, end)))
    if slug:
        q = q.filter(models.Department.slug == slug)
    return q.order_by(models.DailyRecord.record_date, models.Department.id).all()


def summary(db, start, end):
    R, D = models.DailyRecord, models.Department
    rows = (db.query(D.slug, D.name, func.coalesce(func.sum(R.sales_amount), 0), func.coalesce(func.sum(R.collection_amount), 0))
            .outerjoin(R, and_(R.department_id == D.id, R.record_date.between(start, end)))
            .group_by(D.id).order_by(D.id).all())
    series = (db.query(R.record_date, func.sum(R.sales_amount), func.sum(R.collection_amount))
              .filter(R.record_date.between(start, end)).group_by(R.record_date).order_by(R.record_date).all())
    depts = [{"slug": s, "name": n, "sales": float(a), "collection": float(c)} for s, n, a, c in rows]
    return {"totals": {"sales": sum(x["sales"] for x in depts), "collection": sum(x["collection"] for x in depts)},
            "departments": depts,
            "series": [{"date": str(d), "sales": float(a), "collection": float(c)} for d, a, c in series]}


def audit(db, start, end, slug=None):
    A = models.AuditLog
    q = db.query(A).filter(A.record_date.between(start, end))
    if slug:
        q = q.filter(A.department_slug == slug)
    f = lambda v: None if v is None else float(v)
    return [{"id": a.id, "timestamp": a.timestamp.isoformat(), "changed_by": a.changed_by, "action_type": a.action_type,
             "department": a.department_name, "record_date": str(a.record_date),
             "old_sales": f(a.old_sales), "new_sales": f(a.new_sales),
             "old_collection": f(a.old_collection), "new_collection": f(a.new_collection)}
            for a in q.order_by(A.timestamp.desc()).limit(500).all()]

def add_damage(db, d: schemas.DamageIn):
    rec = models.DamageRecord(record_date=d.record_date, department_slug=d.department_slug,
                              printing_damage=d.printing_damage,
                              accubind_damage=d.accubind_damage, binding_damage=d.binding_damage,
                              damage_value=d.damage_value, submitted_by=d.submitted_by)
    db.add(rec); db.commit(); db.refresh(rec)
    return rec


def list_damages(db, department=None, limit=1000):
    q = db.query(models.DamageRecord)
    if department:
        q = q.filter(models.DamageRecord.department_slug == department)
    return (q
            .order_by(models.DamageRecord.record_date.desc(), models.DamageRecord.id.desc())
            .limit(limit).all())

def update_damage(db, damage_id: int, d: schemas.DamageIn):
    rec = db.query(models.DamageRecord).get(damage_id)
    if not rec:
        raise LookupError("Damage entry not found")
    rec.record_date, rec.printing_damage = d.record_date, d.printing_damage
    rec.accubind_damage, rec.binding_damage, rec.submitted_by = d.accubind_damage, d.binding_damage, d.submitted_by
    rec.damage_value = d.damage_value
    db.commit(); db.refresh(rec)
    return rec


def migrate_damages(db):
    """Adds department_slug / damage_value to the old damage_records table.
    Existing rows become I Photobook rows. Safe to run on every startup."""
    insp = inspect(db.get_bind())
    if "damage_records" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("damage_records")}
    if "department_slug" not in cols:
        db.execute(text("ALTER TABLE damage_records ADD COLUMN department_slug VARCHAR(50) NOT NULL DEFAULT 'i-photobook'"))
    if "damage_value" not in cols:
        db.execute(text("ALTER TABLE damage_records ADD COLUMN damage_value NUMERIC(14,2) NOT NULL DEFAULT 0"))
    db.commit()
    

def delete_damage(db, damage_id: int):
    rec = db.query(models.DamageRecord).get(damage_id)
    if not rec:
        raise LookupError("Damage entry not found")
    db.delete(rec); db.commit()


def delete_record(db, record_id: int):
    rec = db.query(models.DailyRecord).get(record_id)
    if not rec:
        raise LookupError("Record not found")
    dept = rec.department
    db.add(models.AuditLog(record_id=rec.id, changed_by=rec.submitted_by, action_type="DELETE",
                           old_sales=rec.sales_amount, old_collection=rec.collection_amount,
                           department_slug=dept.slug, department_name=dept.name, record_date=rec.record_date))
    db.commit()
    db.delete(rec); db.commit()  

def list_categories(db):
    return db.query(models.ProjectCategory).order_by(models.ProjectCategory.name).all()


def get_or_create_category(db, name: str):
    name = " ".join(name.split())
    cat = db.query(models.ProjectCategory).filter(func.lower(models.ProjectCategory.name) == name.lower()).first()
    if not cat:
        cat = models.ProjectCategory(name=name)
        db.add(cat); db.flush()
    return cat


def add_category(db, c: schemas.CategoryIn):
    cat = get_or_create_category(db, c.name)
    db.commit(); db.refresh(cat)
    return cat

def update_category(db, category_id: int, c: schemas.CategoryIn):
    cat = db.query(models.ProjectCategory).get(category_id)
    if not cat:
        raise LookupError("Category not found")
    dup = (db.query(models.ProjectCategory)
           .filter(func.lower(models.ProjectCategory.name) == c.name.lower(), models.ProjectCategory.id != category_id)
           .first())
    if dup:
        raise ValueError("Another category already has this name")
    cat.name = c.name
    db.commit(); db.refresh(cat)
    return cat

def list_suppliers(db, category_id: int | None = None):
    q = db.query(models.ProjectSupplier)
    if category_id:
        q = q.filter_by(category_id=category_id)
    return q.order_by(models.ProjectSupplier.name).all()


def get_or_create_supplier(db, category_id: int, name: str):
    name = " ".join(name.split())
    sup = (db.query(models.ProjectSupplier).filter_by(category_id=category_id)
           .filter(func.lower(models.ProjectSupplier.name) == name.lower()).first())
    if not sup:
        sup = models.ProjectSupplier(category_id=category_id, name=name)
        db.add(sup); db.flush()
    return sup


def add_supplier(db, s: schemas.SupplierIn):
    if not db.query(models.ProjectCategory).get(s.category_id):
        raise LookupError("Unknown category")
    sup = get_or_create_supplier(db, s.category_id, s.name)
    db.commit(); db.refresh(sup)
    return sup

def update_supplier(db, supplier_id: int, s: schemas.SupplierIn):
    sup = db.query(models.ProjectSupplier).get(supplier_id)
    if not sup:
        raise LookupError("Supplier not found")
    if not db.query(models.ProjectCategory).get(s.category_id):
        raise LookupError("Unknown category")
    dup = (db.query(models.ProjectSupplier)
           .filter_by(category_id=s.category_id)
           .filter(func.lower(models.ProjectSupplier.name) == s.name.lower(), models.ProjectSupplier.id != supplier_id)
           .first())
    if dup:
        raise ValueError("Another supplier already has this name in that category")
    sup.category_id, sup.name = s.category_id, s.name
    db.commit(); db.refresh(sup)
    return sup

def delete_category(db, category_id: int):
    cat = db.query(models.ProjectCategory).get(category_id)
    if not cat:
        raise LookupError("Category not found")
    if db.query(models.ProjectSupplier).filter_by(category_id=category_id).first():
        raise ValueError("Remove all suppliers in this category first.")
    db.delete(cat)
    db.commit()


def delete_supplier(db, supplier_id: int):
    sup = db.query(models.ProjectSupplier).get(supplier_id)
    if not sup:
        raise LookupError("Supplier not found")
    if db.query(models.ProjectExpense).filter_by(supplier_id=supplier_id).first():
        raise ValueError("This supplier has expense entries. Delete those entries first.")
    db.delete(sup)
    db.commit()

def list_projects(db):
    return (db.query(models.ProjectExpense)
            .options(joinedload(models.ProjectExpense.supplier).joinedload(models.ProjectSupplier.category))
            .order_by(models.ProjectExpense.expense_date.desc(), models.ProjectExpense.id.desc()).all())


def add_project(db, p: schemas.ProjectIn):
    if not db.query(models.ProjectSupplier).get(p.supplier_id):
        raise LookupError("Unknown supplier")
    rec = models.ProjectExpense(supplier_id=p.supplier_id, cost=p.cost, expense_date=p.expense_date, description=p.description)
    db.add(rec); db.commit(); db.refresh(rec)
    return rec


def update_project(db, project_id: int, p: schemas.ProjectIn):
    rec = db.query(models.ProjectExpense).get(project_id)
    if not rec:
        raise LookupError("Project entry not found")
    if not db.query(models.ProjectSupplier).get(p.supplier_id):
        raise LookupError("Unknown supplier")
    rec.supplier_id, rec.cost, rec.expense_date, rec.description = p.supplier_id, p.cost, p.expense_date, p.description
    db.commit(); db.refresh(rec)
    return rec


def delete_project(db, project_id: int):
    rec = db.query(models.ProjectExpense).get(project_id)
    if not rec:
        raise LookupError("Project entry not found")
    db.delete(rec); db.commit()


def migrate_projects(db):
    """One-time migration: the old project_expenses table stored a flat
    good_name text field. Move that data under a 'General' category /
    per-name supplier, then drop the old column. Safe to call on every
    startup — it no-ops once the migration has already run."""
    bind = db.get_bind()
    insp = inspect(bind)
    if "project_expenses" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("project_expenses")}
    if "good_name" not in cols:
        return  # already migrated
    if "supplier_id" not in cols:
        db.execute(text("ALTER TABLE project_expenses ADD COLUMN supplier_id INTEGER"))
        db.commit()
    general = get_or_create_category(db, "General")
    db.flush()
    rows = db.execute(text("SELECT id, good_name FROM project_expenses WHERE supplier_id IS NULL")).fetchall()
    cache = {}
    for rid, gname in rows:
        key = (gname or "Unnamed").strip().lower()
        if key not in cache:
            cache[key] = get_or_create_supplier(db, general.id, (gname or "Unnamed").strip())
            db.flush()
        db.execute(text("UPDATE project_expenses SET supplier_id = :sid WHERE id = :rid"),
                   {"sid": cache[key].id, "rid": rid})
    db.commit()
    db.execute(text("ALTER TABLE project_expenses ALTER COLUMN supplier_id SET NOT NULL"))
    db.execute(text("ALTER TABLE project_expenses DROP COLUMN good_name"))
    db.commit()

def migrate_audit_logs(db):
    """One-time migration: audit_logs used to require a live daily_records
    row via a plain (no-action) FK, so deleting a record with history
    crashed. Denormalize department/date onto the audit row and relax the
    FK to ON DELETE SET NULL. Safe to call on every startup."""
    bind = db.get_bind()
    insp = inspect(bind)
    if "audit_logs" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("audit_logs")}
    if "department_slug" not in cols:
        db.execute(text("ALTER TABLE audit_logs ADD COLUMN department_slug VARCHAR(50)"))
    if "department_name" not in cols:
        db.execute(text("ALTER TABLE audit_logs ADD COLUMN department_name VARCHAR(100)"))
    if "record_date" not in cols:
        db.execute(text("ALTER TABLE audit_logs ADD COLUMN record_date DATE"))
    db.commit()
    db.execute(text("""
        UPDATE audit_logs a SET department_slug = d.slug, department_name = d.name, record_date = r.record_date
        FROM daily_records r JOIN departments d ON d.id = r.department_id
        WHERE a.record_id = r.id AND a.record_date IS NULL
    """))
    db.execute(text("ALTER TABLE audit_logs ALTER COLUMN record_id DROP NOT NULL"))
    db.execute(text("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_record_id_fkey"))
    db.execute(text("ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_record_id_fkey "
                     "FOREIGN KEY (record_id) REFERENCES daily_records(id) ON DELETE SET NULL"))
    db.commit()

def add_push_subscription(db, s: schemas.PushSubscriptionIn):
    existing = db.query(models.PushSubscription).filter_by(endpoint=s.endpoint).first()
    if existing:
        existing.p256dh, existing.auth, existing.label, existing.role = s.keys["p256dh"], s.keys["auth"], s.label, s.role
    else:
        db.add(models.PushSubscription(endpoint=s.endpoint, p256dh=s.keys["p256dh"],
                                        auth=s.keys["auth"], label=s.label, role=s.role))
    db.commit()

# ───────────── cheques ─────────────
# The company releases cheques twice a day.
RELEASE_SLOTS = {"MORNING": (10, 0, "10:00 AM"), "EVENING": (15, 30, "3:30 PM")}
CHEQUE_DAILY_HOUR = 9        # "N days before" and "overdue" alerts are sent from 9:00 am
CHEQUE_STILL_PENDING_MIN = 30  # minutes after the release time, if the cheque is still not marked Used


def slot_label(slot):
    return RELEASE_SLOTS.get(slot, RELEASE_SLOTS["MORNING"])[2]


def release_at(c):
    """The exact moment this cheque is released (Sri Lanka time)."""
    h, m, _ = RELEASE_SLOTS.get(c.release_slot, RELEASE_SLOTS["MORNING"])
    return datetime(c.cheque_date.year, c.cheque_date.month, c.cheque_date.day, h, m, tzinfo=schemas.LK_TZ)


def _cheque_event(db, rec, action, by, old_date=None, new_date=None, old_slot=None, new_slot=None, note=None):
    db.add(models.ChequeEvent(cheque_id=rec.id, action=action, by=by, old_date=old_date, new_date=new_date,
                              old_slot=old_slot, new_slot=new_slot, note=note))


def _reset_cheque_reminders(rec):
    rec.alert_stage = 0
    rec.notified_before = rec.notified_due = False
    rec.last_overdue_on = None


def list_cheques(db):
    rows = db.query(models.Cheque).all()
    slot_order = {"MORNING": 0, "EVENING": 1}
    return sorted(rows, key=lambda r: (r.cheque_date, slot_order.get(r.release_slot, 0), r.id))


def add_cheque(db, d: schemas.ChequeIn):
    rec = models.Cheque(payee_name=d.payee_name, cheque_no=d.cheque_no, amount=d.amount, cheque_date=d.cheque_date,
                        original_date=d.cheque_date, release_slot=d.release_slot, remind_days_before=d.remind_days_before,
                        remind_minutes_before=d.remind_minutes_before, note=d.note, created_by=d.by)
    db.add(rec); db.flush()
    _cheque_event(db, rec, "CREATED", d.by, new_date=d.cheque_date, new_slot=d.release_slot)
    db.commit(); db.refresh(rec)
    return rec


def _get_cheque(db, cheque_id):
    rec = db.query(models.Cheque).get(cheque_id)
    if not rec:
        raise LookupError("Cheque not found")
    return rec


def update_cheque(db, cheque_id: int, d: schemas.ChequeIn):
    """Edits name / number / amount / note / reminders. The DATE and RELEASE TIME are changed only
    through reschedule_cheque, so every change of them is logged."""
    rec = _get_cheque(db, cheque_id)
    if rec.status != "PENDING":
        raise ValueError("This cheque is closed. Reopen it first to edit it.")
    if d.remind_days_before != rec.remind_days_before or d.remind_minutes_before != rec.remind_minutes_before:
        _reset_cheque_reminders(rec)
    rec.payee_name, rec.cheque_no, rec.amount, rec.note = d.payee_name, d.cheque_no, d.amount, d.note
    rec.remind_days_before, rec.remind_minutes_before = d.remind_days_before, d.remind_minutes_before
    _cheque_event(db, rec, "EDITED", d.by)
    db.commit(); db.refresh(rec)
    return rec


def reschedule_cheque(db, cheque_id: int, d: schemas.ChequeRescheduleIn):
    rec = _get_cheque(db, cheque_id)
    if rec.status != "PENDING":
        raise ValueError("This cheque is closed. Reopen it first to change its date.")
    new_slot = d.new_slot or rec.release_slot
    if d.new_date == rec.cheque_date and new_slot == rec.release_slot:
        raise ValueError("That is already the cheque date and release time.")
    old_date, old_slot = rec.cheque_date, rec.release_slot
    rec.cheque_date, rec.release_slot = d.new_date, new_slot
    _reset_cheque_reminders(rec)                  # new date / time => alarms start again
    _cheque_event(db, rec, "RESCHEDULED", d.by, old_date=old_date, new_date=d.new_date,
                  old_slot=old_slot, new_slot=new_slot, note=d.reason)
    db.commit(); db.refresh(rec)
    return rec


def set_cheque_status(db, cheque_id: int, d: schemas.ChequeStatusIn):
    rec = _get_cheque(db, cheque_id)
    if d.status == rec.status:
        raise ValueError(f"This cheque is already {rec.status.lower()}.")
    action = {"DONE": "DONE", "CANCELLED": "CANCELLED", "PENDING": "REOPENED"}[d.status]
    rec.status = d.status
    rec.closed_at = None if d.status == "PENDING" else datetime.now(timezone.utc)
    _reset_cheque_reminders(rec)
    _cheque_event(db, rec, action, d.by, note=d.note)
    db.commit(); db.refresh(rec)
    return rec


def delete_cheque(db, cheque_id: int):
    rec = _get_cheque(db, cheque_id)
    db.delete(rec); db.commit()


def process_cheque_reminders(db, now=None):
    """Called every minute. Works like an alarm around each cheque's release time (10:00 am / 3:30 pm).
    For a PENDING cheque, in order, at most one alert per step (a missed step is skipped, never replayed):
      1. N days before, at 9:00 am          (N = remind_days_before, 0 = none)
      2. M minutes before the release time  (M = remind_minutes_before, 0 = none)
      3. exactly at the release time        ("release time NOW")
      4. 30 minutes after the release time, if it is still not marked Used
    After the cheque date has passed and it is still PENDING: one 'OVERDUE' alert every morning from 9:00 am.
    Marking it Used / Cancelled stops everything; changing its date or time starts the alarms again."""
    import notify
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(schemas.LK_TZ)
    today = local.date()
    rows = (db.query(models.Cheque).filter(models.Cheque.status == "PENDING",
                                           models.Cheque.cheque_date <= today + timedelta(days=30)).all())
    for c in rows:
        label = slot_label(c.release_slot)
        what = c.payee_name + (f" · cheque {c.cheque_no}" if c.cheque_no else "") + (f" · {c.amount:,.2f}" if c.amount else "")
        left = (c.cheque_date - today).days
        title = body = None
        if left < 0:                                             # date passed, still pending
            if local.hour >= CHEQUE_DAILY_HOUR and c.last_overdue_on != today:
                c.last_overdue_on = today
                title = f"Cheque OVERDUE ({-left} day{'s' if -left > 1 else ''})"
                body = f"{what} (was {c.cheque_date:%d/%m/%Y} {label}) - mark it Used or change the date"
        else:
            rel = release_at(c)
            steps = []
            if c.remind_days_before:
                day_before = datetime(c.cheque_date.year, c.cheque_date.month, c.cheque_date.day,
                                      CHEQUE_DAILY_HOUR, 0, tzinfo=schemas.LK_TZ) - timedelta(days=c.remind_days_before)
                steps.append((1, day_before))
            if c.remind_minutes_before:
                steps.append((2, rel - timedelta(minutes=c.remind_minutes_before)))
            steps.append((3, rel))
            steps.append((4, rel + timedelta(minutes=CHEQUE_STILL_PENDING_MIN)))
            due = [(n, t) for n, t in steps if t <= now and n > c.alert_stage]
            if due:
                n = max(due)[0]
                c.alert_stage = n
                if n == 1:
                    title = f"Cheque TODAY at {label}" if left == 0 else f"Cheque in {left} day{'s' if left > 1 else ''}"
                    body = f"{what} (release {c.cheque_date:%d/%m/%Y} {label})"
                elif n == 2:
                    mins = -(-int((rel - now).total_seconds()) // 60)   # whole minutes left, rounded up
                    title = f"Cheque release in {max(mins, 1)} min ({label})"
                    body = what
                elif n == 3:
                    title, body = f"Cheque release time NOW ({label})", what
                else:
                    title, body = "Cheque still NOT marked Used", f"{what} - was due at {label}"
        if title:
            db.commit()   # mark as sent first, so a crash can never cause a repeat storm
            notify.safe_notify(db, title=title, body=body, url="/admin/cheques",
                               roles=("admin", "hr"), url_by_role={"hr": "/hr/cheques"})


def migrate_hr(db):
    """Adds columns that newer versions need to tables created by an earlier version. Safe on every startup."""
    insp = inspect(db.get_bind())
    tables = set(insp.get_table_names())

    def add_missing(table, columns):
        if table not in tables:
            return  # table does not exist yet; create_all builds it with every column
        have = {col["name"] for col in insp.get_columns(table)}
        for name, ddl in columns.items():
            if name not in have:
                db.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        db.commit()

    add_missing("push_subscriptions", {"role": "VARCHAR(10) NOT NULL DEFAULT 'admin'"})
    add_missing("cheques", {
        "release_slot": "VARCHAR(8) NOT NULL DEFAULT 'MORNING'",
        "remind_minutes_before": "INTEGER NOT NULL DEFAULT 15",
        "alert_stage": "INTEGER NOT NULL DEFAULT 0",
    })
    add_missing("cheque_events", {"old_slot": "VARCHAR(8)", "new_slot": "VARCHAR(8)"})