from datetime import date, timedelta
from decimal import Decimal, ROUND_DOWN
from sqlalchemy import func, and_
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
                               new_sales=d.sales_amount, new_collection=d.collection_amount))
    elif rec.sales_amount != d.sales_amount or rec.collection_amount != d.collection_amount:
        db.add(models.AuditLog(record_id=rec.id, changed_by=d.submitted_by, action_type="UPDATE",
                               old_sales=rec.sales_amount, new_sales=d.sales_amount,
                               old_collection=rec.collection_amount, new_collection=d.collection_amount))
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
    A, R = models.AuditLog, models.DailyRecord
    q = (db.query(A).options(joinedload(A.record).joinedload(R.department)).join(R).join(models.Department)
         .filter(R.record_date.between(start, end)))
    if slug:
        q = q.filter(models.Department.slug == slug)
    f = lambda v: None if v is None else float(v)
    return [{"id": a.id, "timestamp": a.timestamp.isoformat(), "changed_by": a.changed_by, "action_type": a.action_type,
             "department": a.record.department.name, "record_date": str(a.record.record_date),
             "old_sales": f(a.old_sales), "new_sales": f(a.new_sales),
             "old_collection": f(a.old_collection), "new_collection": f(a.new_collection)}
            for a in q.order_by(A.timestamp.desc()).limit(500).all()]

def add_damage(db, d: schemas.DamageIn):
    rec = models.DamageRecord(record_date=d.record_date, printing_damage=d.printing_damage,
                              accubind_damage=d.accubind_damage, binding_damage=d.binding_damage,
                              submitted_by=d.submitted_by)
    db.add(rec); db.commit(); db.refresh(rec)
    return rec


def list_damages(db, limit=300):
    return (db.query(models.DamageRecord)
            .order_by(models.DamageRecord.record_date.desc(), models.DamageRecord.id.desc())
            .limit(limit).all())

def update_damage(db, damage_id: int, d: schemas.DamageIn):
    rec = db.query(models.DamageRecord).get(damage_id)
    if not rec:
        raise LookupError("Damage entry not found")
    rec.record_date, rec.printing_damage = d.record_date, d.printing_damage
    rec.accubind_damage, rec.binding_damage, rec.submitted_by = d.accubind_damage, d.binding_damage, d.submitted_by
    db.commit(); db.refresh(rec)
    return rec


def delete_damage(db, damage_id: int):
    rec = db.query(models.DamageRecord).get(damage_id)
    if not rec:
        raise LookupError("Damage entry not found")
    db.delete(rec); db.commit()


def delete_record(db, record_id: int):
    rec = db.query(models.DailyRecord).get(record_id)
    if not rec:
        raise LookupError("Record not found")
    db.delete(rec); db.commit()
    

def list_projects(db):
    return db.query(models.ProjectExpense).order_by(models.ProjectExpense.expense_date.desc(), models.ProjectExpense.id.desc()).all()


def add_project(db, p: schemas.ProjectIn):
    rec = models.ProjectExpense(good_name=p.good_name, cost=p.cost, expense_date=p.expense_date)
    db.add(rec); db.commit(); db.refresh(rec)
    return rec


def update_project(db, project_id: int, p: schemas.ProjectIn):
    rec = db.query(models.ProjectExpense).get(project_id)
    if not rec:
        raise LookupError("Project entry not found")
    rec.good_name, rec.cost, rec.expense_date = p.good_name, p.cost, p.expense_date
    db.commit(); db.refresh(rec)
    return rec


def delete_project(db, project_id: int):
    rec = db.query(models.ProjectExpense).get(project_id)
    if not rec:
        raise LookupError("Project entry not found")
    db.delete(rec); db.commit()