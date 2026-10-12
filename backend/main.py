import asyncio, io, os
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from fastapi import FastAPI, Depends, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy.orm import Session
import crud, models, schemas, notify
from database import engine, Base, get_db, SessionLocal

ADMIN_KEY = os.getenv("ADMIN_KEY", "")
HR_KEY = os.getenv("HR_KEY", "")   # optional passcode for the HR cheque page; leave unset for no passcode

# mirrors the frontend's PAGES grouping in App.jsx, just for building notification links
PAGE_FOR_SLUG = {
    "dd-engineering": "dd-engineering",
    "i-lab": "i-lab-photobook",
    "i-photobook": "i-lab-photobook",
    "i-lab-std": "i-lab-std",
    "tricast": "tricast",
}


def run_reminders():
    with SessionLocal() as db:
        crud.process_cheque_reminders(db)


async def reminder_loop():
    while True:
        try:
            await asyncio.to_thread(run_reminders)
        except Exception as e:
            print("reminder run failed:", e)
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        crud.seed_departments(db)
        crud.migrate_projects(db)
        crud.migrate_audit_logs(db)
        crud.migrate_damages(db)
        crud.migrate_hr(db)
    reminder_task = asyncio.create_task(reminder_loop())
    yield
    reminder_task.cancel()


app = FastAPI(title="Summary API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")],
                   allow_methods=["*"], allow_headers=["*"])


def admin_only(x_admin_key: str = Header(default="")):
    if ADMIN_KEY and x_admin_key != ADMIN_KEY:
        raise HTTPException(401, "Admin key required")


def hr_access(x_hr_key: str = Header(default=""), x_admin_key: str = Header(default="")):
    """Cheque pages: open to admin and HR. If HR_KEY is set on the server, the HR passcode
    (or the admin key, when one is set) is required; if HR_KEY is not set, no passcode is needed."""
    if HR_KEY and x_hr_key != HR_KEY and not (ADMIN_KEY and x_admin_key == ADMIN_KEY):
        raise HTTPException(401, "Passcode required")


def check_range(start: date, end: date):
    if start > end:
        raise HTTPException(422, "Start date must be before end date")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/departments", response_model=list[schemas.DepartmentOut])
def departments(db: Session = Depends(get_db)):
    return db.query(models.Department).order_by(models.Department.id).all()


@app.get("/api/records", response_model=list[schemas.RecordOut])
def records(start: date, end: date, department: str | None = None, db: Session = Depends(get_db)):
    check_range(start, end)
    return crud.list_records(db, start, end, department)


@app.post("/api/records", response_model=schemas.RecordOut)
def save_record(data: schemas.RecordIn, db: Session = Depends(get_db)):
    try:
        rec = crud.upsert_record(db, data)
        page = PAGE_FOR_SLUG.get(rec.department.slug, rec.department.slug)
        notify.safe_notify(
            db,
            title=f"{rec.department.name} — daily update",
            body=f"Sales {rec.sales_amount} / Collection {rec.collection_amount} — {rec.submitted_by}",
            url=f"/department/{page}?tab={rec.department.slug}&admin=1",
        )
        return rec
    except LookupError as e:
        raise HTTPException(404, str(e))
    
@app.get("/api/damages", response_model=list[schemas.DamageOut])
def damages(department: str | None = None, db: Session = Depends(get_db)):
    return crud.list_damages(db, department)


@app.post("/api/damages", response_model=schemas.DamageOut)
def add_damage(data: schemas.DamageIn, db: Session = Depends(get_db)):
    rec = crud.add_damage(db, data)
    notify.safe_notify(
        db,
        title=f"{data.department_slug.replace('-', ' ').upper()} — damage entry added",
        body=(f"Printing {data.printing_damage} / Accubind {data.accubind_damage} / Binding {data.binding_damage} — {data.submitted_by}"
              if data.department_slug == "i-photobook" else f"Damage {data.damage_value} — {data.submitted_by}"),
        url=f"/department/{data.department_slug}-damage?admin=1",
    )
    return rec

def check_edit_window(created_at):
    if created_at and (datetime.now(timezone.utc) - created_at.replace(tzinfo=timezone.utc)).total_seconds() > 86400:
        raise HTTPException(403, "This entry is more than 24 hours old and can no longer be edited or deleted here.")


@app.get("/api/push/public-key")
def push_public_key():
    return {"key": os.getenv("VAPID_PUBLIC_KEY", "")}


@app.post("/api/push/subscribe")
def push_subscribe(data: schemas.PushSubscriptionIn, db: Session = Depends(get_db),
                   x_admin_key: str = Header(default=""), x_hr_key: str = Header(default="")):
    if data.role == "hr":
        hr_access(x_hr_key, x_admin_key)   # HR phones subscribe with the HR passcode (when one is set)
    else:
        admin_only(x_admin_key)
    crud.add_push_subscription(db, data)
    return {"status": "ok"}

@app.put("/api/damages/{damage_id}", response_model=schemas.DamageOut)
def edit_damage(damage_id: int, data: schemas.DamageIn, db: Session = Depends(get_db)):
    rec = db.query(models.DamageRecord).get(damage_id)
    if not rec:
        raise HTTPException(404, "Damage entry not found")
    check_edit_window(rec.created_at)
    return crud.update_damage(db, damage_id, data)


@app.delete("/api/damages/{damage_id}")
def remove_damage(damage_id: int, db: Session = Depends(get_db)):
    rec = db.query(models.DamageRecord).get(damage_id)
    if not rec:
        raise HTTPException(404, "Damage entry not found")
    check_edit_window(rec.created_at)
    crud.delete_damage(db, damage_id)
    return {"ok": True}


@app.delete("/api/records/{record_id}")
def remove_record(record_id: int, db: Session = Depends(get_db)):
    rec = db.query(models.DailyRecord).get(record_id)
    if not rec:
        raise HTTPException(404, "Record not found")
    check_edit_window(rec.created_at)
    crud.delete_record(db, record_id)
    return {"ok": True}


# ── Admin-only: no 24-hour restriction ──
@app.delete("/api/admin/records/{record_id}")
def admin_remove_record(record_id: int, db: Session = Depends(get_db)):
    try:
        crud.delete_record(db, record_id)
        return {"ok": True}
    except LookupError as e:
        raise HTTPException(404, str(e))


@app.delete("/api/admin/damages/{damage_id}")
def admin_remove_damage(damage_id: int, db: Session = Depends(get_db)):
    try:
        crud.delete_damage(db, damage_id)
        return {"ok": True}
    except LookupError as e:
        raise HTTPException(404, str(e))

@app.get("/api/project-categories", response_model=list[schemas.CategoryOut])
def project_categories(db: Session = Depends(get_db)):
    return crud.list_categories(db)


@app.post("/api/project-categories", response_model=schemas.CategoryOut)
def add_project_category(data: schemas.CategoryIn, db: Session = Depends(get_db)):
    return crud.add_category(db, data)


@app.get("/api/project-suppliers", response_model=list[schemas.SupplierOut])
def project_suppliers(category_id: int | None = None, db: Session = Depends(get_db)):
    return crud.list_suppliers(db, category_id)


@app.post("/api/project-suppliers", response_model=schemas.SupplierOut)
def add_project_supplier(data: schemas.SupplierIn, db: Session = Depends(get_db)):
    try:
        return crud.add_supplier(db, data)
    except LookupError as e:
        raise HTTPException(404, str(e))

@app.put("/api/project-categories/{category_id}", response_model=schemas.CategoryOut)
def edit_project_category(category_id: int, data: schemas.CategoryIn, db: Session = Depends(get_db)):
    try:
        return crud.update_category(db, category_id, data)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.put("/api/project-suppliers/{supplier_id}", response_model=schemas.SupplierOut)
def edit_project_supplier(supplier_id: int, data: schemas.SupplierIn, db: Session = Depends(get_db)):
    try:
        return crud.update_supplier(db, supplier_id, data)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))

@app.delete("/api/project-categories/{category_id}")
def delete_project_category(category_id: int, db: Session = Depends(get_db)):
    try:
        crud.delete_category(db, category_id)
        return {"status": "ok"}
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.delete("/api/project-suppliers/{supplier_id}")
def delete_project_supplier(supplier_id: int, db: Session = Depends(get_db)):
    try:
        crud.delete_supplier(db, supplier_id)
        return {"status": "ok"}
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))

@app.get("/api/projects", response_model=list[schemas.ProjectOut])
def projects(db: Session = Depends(get_db)):
    return crud.list_projects(db)


@app.post("/api/projects", response_model=schemas.ProjectOut)
def add_project(data: schemas.ProjectIn, db: Session = Depends(get_db)):
    try:
        return crud.add_project(db, data)
    except LookupError as e:
        raise HTTPException(404, str(e))

@app.put("/api/projects/{project_id}", response_model=schemas.ProjectOut)
def edit_project(project_id: int, data: schemas.ProjectIn, db: Session = Depends(get_db)):
    try:
        return crud.update_project(db, project_id, data)
    except LookupError as e:
        raise HTTPException(404, str(e))


@app.delete("/api/projects/{project_id}")
def remove_project(project_id: int, db: Session = Depends(get_db)):
    try:
        crud.delete_project(db, project_id)
        return {"ok": True}
    except LookupError as e:
        raise HTTPException(404, str(e))

@app.post("/api/records/bulk")
def save_bulk(data: schemas.BulkIn, db: Session = Depends(get_db)):
    try:
        days = crud.bulk_upsert(db, data)
        dept = db.query(models.Department).filter_by(slug=data.department_slug).first()
        page = PAGE_FOR_SLUG.get(data.department_slug, data.department_slug)
        period = f"{data.year}-{data.month:02d}" if data.month else str(data.year)
        notify.safe_notify(
            db,
            title=f"{dept.name} — {period} update",
            body=f"Sales {data.sales_amount:,.2f} / Collection {data.collection_amount:,.2f} — {data.submitted_by}",
            url=f"/department/{page}?tab={data.department_slug}&admin=1",
        )
        return {"days": days}
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))

@app.get("/api/summary", dependencies=[Depends(admin_only)])
def summary(start: date, end: date, db: Session = Depends(get_db)):
    check_range(start, end)
    return crud.summary(db, start, end)


@app.get("/api/audit", dependencies=[Depends(admin_only)])
def audit(start: date, end: date, department: str | None = None, db: Session = Depends(get_db)):
    check_range(start, end)
    return crud.audit(db, start, end, department)


@app.get("/api/export", dependencies=[Depends(admin_only)])
def export(start: date, end: date, department: str | None = None, db: Session = Depends(get_db)):
    check_range(start, end)
    rows = crud.list_records(db, start, end, department)
    wb = Workbook(); ws = wb.active; ws.title = "Sales & Collections"
    ws.append(["Date", "Department", "Sales", "Collection", "Submitted by", "Last updated"])
    for c in ws[1]:
        c.font = Font(bold=True)
    for r in rows:
        ws.append([r.record_date, r.department.name, float(r.sales_amount), float(r.collection_amount),
                   r.submitted_by, r.updated_at.strftime("%Y-%m-%d %H:%M") if r.updated_at else ""])
    n = len(rows) + 1
    ws.append(["TOTAL", "", f"=SUM(C2:C{n})", f"=SUM(D2:D{n})"])
    for c in ws[n + 1]:
        c.font = Font(bold=True)
    for col, w in zip("ABCDEF", (12, 20, 16, 16, 20, 18)):
        ws.column_dimensions[col].width = w
    for row in ws.iter_rows(min_row=2, min_col=3, max_col=4):
        for c in row:
            c.number_format = "#,##0.00"
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    name = f"summary_{department or 'all'}_{start}_{end}.xlsx"
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ───────────── Cheques (admin + HR) ─────────────
@app.get("/api/cheques", response_model=list[schemas.ChequeOut], dependencies=[Depends(hr_access)])
def cheques(db: Session = Depends(get_db)):
    return crud.list_cheques(db)


@app.post("/api/cheques", response_model=schemas.ChequeOut, dependencies=[Depends(hr_access)])
def add_cheque(data: schemas.ChequeIn, db: Session = Depends(get_db)):
    return crud.add_cheque(db, data)


@app.put("/api/cheques/{cheque_id}", response_model=schemas.ChequeOut, dependencies=[Depends(hr_access)])
def edit_cheque(cheque_id: int, data: schemas.ChequeIn, db: Session = Depends(get_db)):
    try:
        return crud.update_cheque(db, cheque_id, data)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/api/cheques/{cheque_id}/reschedule", response_model=schemas.ChequeOut, dependencies=[Depends(hr_access)])
def reschedule_cheque(cheque_id: int, data: schemas.ChequeRescheduleIn, db: Session = Depends(get_db)):
    try:
        return crud.reschedule_cheque(db, cheque_id, data)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/api/cheques/{cheque_id}/status", response_model=schemas.ChequeOut, dependencies=[Depends(hr_access)])
def cheque_status(cheque_id: int, data: schemas.ChequeStatusIn, db: Session = Depends(get_db)):
    try:
        return crud.set_cheque_status(db, cheque_id, data)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.delete("/api/cheques/{cheque_id}", dependencies=[Depends(hr_access)])
def remove_cheque(cheque_id: int, db: Session = Depends(get_db)):
    try:
        crud.delete_cheque(db, cheque_id)
        return {"ok": True}
    except LookupError as e:
        raise HTTPException(404, str(e))