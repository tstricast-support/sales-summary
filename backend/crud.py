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
        existing.p256dh, existing.auth, existing.label = s.keys["p256dh"], s.keys["auth"], s.label
    else:
        db.add(models.PushSubscription(endpoint=s.endpoint, p256dh=s.keys["p256dh"],
                                        auth=s.keys["auth"], label=s.label))
    db.commit()

# ───────────── credits (money given / taken on credit) ─────────────
def list_credits(db):
    return db.query(models.Credit).order_by(models.Credit.due_at.asc(), models.Credit.id.asc()).all()


def _skip_past_months(rec):
    """Monthly credits only alert for FUTURE due dates, never for months that already passed."""
    k = rec.current_k(datetime.now(timezone.utc)) if rec.repeat_monthly else -1
    rec.last_due_k = rec.last_before_k = k


def add_credit(db, c: schemas.CreditIn):
    rec = models.Credit(direction=c.direction, party_name=c.party_name, amount=c.amount,
                        credit_date=c.credit_date, due_at=c.due_at,
                        remind_before_hours=c.remind_before_hours, note=c.note,
                        repeat_monthly=c.repeat_monthly, monthly_amount=c.monthly_amount)
    _skip_past_months(rec)
    db.add(rec); db.commit(); db.refresh(rec)
    return rec


def update_credit(db, credit_id: int, c: schemas.CreditIn):
    rec = db.query(models.Credit).get(credit_id)
    if not rec:
        raise LookupError("Credit not found")
    if c.amount < rec.paid:
        raise ValueError("Amount cannot be less than what has already been paid")
    schedule_changed = (c.due_at != rec.due_at or c.remind_before_hours != rec.remind_before_hours
                        or c.repeat_monthly != rec.repeat_monthly)
    rec.direction, rec.party_name, rec.amount = c.direction, c.party_name, c.amount
    rec.credit_date, rec.due_at, rec.remind_before_hours, rec.note = c.credit_date, c.due_at, c.remind_before_hours, c.note
    rec.repeat_monthly, rec.monthly_amount = c.repeat_monthly, c.monthly_amount
    if schedule_changed:
        rec.notified_before = rec.notified_due = False   # new schedule => reminders start again
        rec.last_overdue_on = None
        _skip_past_months(rec)
    db.commit(); db.refresh(rec)
    return rec


def delete_credit(db, credit_id: int):
    rec = db.query(models.Credit).get(credit_id)
    if not rec:
        raise LookupError("Credit not found")
    db.delete(rec); db.commit()


def add_credit_payment(db, credit_id: int, p: schemas.CreditPaymentIn):
    rec = db.query(models.Credit).get(credit_id)
    if not rec:
        raise LookupError("Credit not found")
    if p.amount > rec.balance:
        raise ValueError(f"Payment is more than the remaining balance ({rec.balance})")
    db.add(models.CreditPayment(credit_id=credit_id, amount=p.amount, paid_at=p.paid_at, note=p.note))
    db.commit(); db.refresh(rec)
    return rec


def delete_credit_payment(db, payment_id: int):
    pay = db.query(models.CreditPayment).get(payment_id)
    if not pay:
        raise LookupError("Payment not found")
    rec = db.query(models.Credit).get(pay.credit_id)
    db.delete(pay); db.commit(); db.refresh(rec)
    return rec


def process_credit_reminders(db, now=None):
    """Called every minute by the background loop in main.py.
    One-off credit : 'coming up' push, 'due now' push, then one 'overdue' push per day (from 9am).
    Monthly credit : every month, a 'coming up' push and a 'due' push, until fully paid."""
    import notify
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(schemas.LK_TZ)
    rows = (db.query(models.Credit)
            .filter(models.Credit.due_at <= now + timedelta(days=31)).all())
    for c in rows:
        if c.is_settled:
            continue
        who = "Collect from" if c.direction == "GIVEN" else "Pay to"
        title = body = None

        if c.repeat_monthly:
            inst = f"instalment {c.monthly_amount:,.2f}, " if c.monthly_amount else ""
            line = f"{who} {c.party_name}: {inst}balance {c.balance:,.2f}"
            k = c.current_k(now)
            if k > c.last_due_k:
                c.last_due_k = c.last_before_k = k
                title, body = "Monthly credit due", f"{line} (due {c.occurrence(k):%d/%m/%Y %I:%M %p})"
            elif c.remind_before_hours and c.last_before_k < k + 1 \
                    and now >= c.occurrence(k + 1) - timedelta(hours=c.remind_before_hours):
                c.last_before_k = k + 1
                title, body = "Monthly credit due soon", f"{line} (due {c.occurrence(k + 1):%d/%m/%Y %I:%M %p})"
        else:
            due = c.due_at if c.due_at.tzinfo else c.due_at.replace(tzinfo=timezone.utc)
            due_local = due.astimezone(schemas.LK_TZ)
            when = due_local.strftime("%d/%m/%Y %I:%M %p")
            line = f"{who} {c.party_name}: {c.balance:,.2f}"
            if now >= due:
                if not c.notified_due:
                    c.notified_due = c.notified_before = True
                    title, body = "Credit due now", f"{line} (due {when})"
                elif local.date() > due_local.date() and local.hour >= 9 and c.last_overdue_on != local.date():
                    c.last_overdue_on = local.date()
                    title, body = "Credit OVERDUE", f"{line} (was due {when})"
            elif c.remind_before_hours and not c.notified_before and now >= due - timedelta(hours=c.remind_before_hours):
                c.notified_before = True
                title, body = "Credit due soon", f"{line} (due {when})"

        if title:
            db.commit()   # mark as sent first, so a crash can never cause a repeat storm
            notify.safe_notify(db, title=title, body=body, url="/admin/credits")


def migrate_credits(db):
    """Adds the monthly-instalment columns to a credits table created by an earlier version.
    Safe to call on every startup - it does nothing once the columns exist."""
    insp = inspect(db.get_bind())
    if "credits" not in insp.get_table_names():
        return  # table does not exist yet; create_all builds it with every column
    have = {col["name"] for col in insp.get_columns("credits")}
    wanted = {
        "repeat_monthly": "BOOLEAN NOT NULL DEFAULT false",
        "monthly_amount": "NUMERIC(14,2)",
        "last_due_k": "INTEGER NOT NULL DEFAULT -1",
        "last_before_k": "INTEGER NOT NULL DEFAULT -1",
    }
    for name, ddl in wanted.items():
        if name not in have:
            db.execute(text(f"ALTER TABLE credits ADD COLUMN {name} {ddl}"))
    db.commit()