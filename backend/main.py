import io, os
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from fastapi import FastAPI, Depends, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy.orm import Session
import crud, models, schemas
from database import engine, Base, get_db, SessionLocal

ADMIN_KEY = os.getenv("ADMIN_KEY", "")


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        crud.seed_departments(db)
        crud.migrate_projects(db)
    yield


app = FastAPI(title="Summary API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")],
                   allow_methods=["*"], allow_headers=["*"])


def admin_only(x_admin_key: str = Header(default="")):
    if ADMIN_KEY and x_admin_key != ADMIN_KEY:
        raise HTTPException(401, "Admin key required")


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
        return crud.upsert_record(db, data)
    except LookupError as e:
        raise HTTPException(404, str(e))

@app.get("/api/damages", response_model=list[schemas.DamageOut])
def damages(db: Session = Depends(get_db)):
    return crud.list_damages(db)


@app.post("/api/damages", response_model=schemas.DamageOut)
def add_damage(data: schemas.DamageIn, db: Session = Depends(get_db)):
    return crud.add_damage(db, data)

def check_edit_window(created_at):
    if created_at and (datetime.now(timezone.utc) - created_at.replace(tzinfo=timezone.utc)).total_seconds() > 86400:
        raise HTTPException(403, "This entry is more than 24 hours old and can no longer be edited or deleted here.")


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
        return {"days": crud.bulk_upsert(db, data)}
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
