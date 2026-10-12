import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from decimal import Decimal
from pydantic import BaseModel, Field, field_validator, ConfigDict

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z .'\-]{1,59}$")


class RecordIn(BaseModel):
    department_slug: str
    record_date: date
    sales_amount: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    collection_amount: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    submitted_by: str

    @field_validator("submitted_by")
    @classmethod
    def valid_name(cls, v: str):
        v = " ".join(v.split())
        if not NAME_RE.match(v):
            raise ValueError("Name must be 2-60 characters: letters, spaces, . ' -")
        return v

    @field_validator("record_date")
    @classmethod
    def not_future(cls, v: date):
        if v > date.today() + timedelta(days=1):  # 1 day tolerance for time zones
            raise ValueError("Future dates are not allowed")
        return v


class RecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    department_slug: str
    record_date: date
    sales_amount: float
    collection_amount: float
    submitted_by: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slug: str
    logo_path: str | None = None

class BulkIn(BaseModel):
    department_slug: str
    year: int = Field(ge=2000, le=2100)
    month: int | None = Field(default=None, ge=1, le=12)  # None = whole year
    sales_amount: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    collection_amount: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    submitted_by: str

    @field_validator("submitted_by")
    @classmethod
    def valid_name(cls, v: str):
        v = " ".join(v.split())
        if not NAME_RE.match(v):
            raise ValueError("Name must be 2-60 characters: letters, spaces, . ' -")
        return v

DAMAGE_DEPARTMENTS = {"i-photobook", "dd-engineering", "i-lab-std"}


class DamageIn(BaseModel):
    record_date: date
    department_slug: str = "i-photobook"
    printing_damage: Decimal = Field(default=0, ge=0, max_digits=14, decimal_places=2)
    accubind_damage: Decimal = Field(default=0, ge=0, max_digits=14, decimal_places=2)
    binding_damage: Decimal = Field(default=0, ge=0, max_digits=14, decimal_places=2)
    damage_value: Decimal = Field(default=0, ge=0, max_digits=14, decimal_places=2)
    submitted_by: str

    @field_validator("department_slug")
    @classmethod
    def valid_department(cls, v: str):
        if v not in DAMAGE_DEPARTMENTS:
            raise ValueError("Unknown department for damages")
        return v

    @field_validator("submitted_by")
    @classmethod
    def valid_name(cls, v: str):
        v = " ".join(v.split())
        if not NAME_RE.match(v):
            raise ValueError("Name must be 2-60 characters: letters, spaces, . ' -")
        return v

    @field_validator("record_date")
    @classmethod
    def not_future(cls, v: date):
        if v > date.today() + timedelta(days=1):
            raise ValueError("Future dates are not allowed")
        return v


class DamageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    record_date: date
    department_slug: str
    printing_damage: float
    accubind_damage: float
    binding_damage: float
    damage_value: float
    submitted_by: str
    created_at: datetime | None = None

class CategoryIn(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def valid_name(cls, v: str):
        v = " ".join(v.split())
        if not (1 <= len(v) <= 150):
            raise ValueError("Category name must be 1-150 characters")
        return v


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class SupplierIn(BaseModel):
    category_id: int
    name: str

    @field_validator("name")
    @classmethod
    def valid_name(cls, v: str):
        v = " ".join(v.split())
        if not (1 <= len(v) <= 150):
            raise ValueError("Supplier name must be 1-150 characters")
        return v


class SupplierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    category_id: int
    name: str


class ProjectIn(BaseModel):
    supplier_id: int
    cost: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    expense_date: date = Field(default_factory=date.today)
    description: str | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    supplier_id: int
    supplier_name: str
    category_id: int
    category_name: str
    cost: float
    expense_date: date
    description: str | None = None
    updated_at: datetime | None = None

class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: dict  # {"p256dh": ..., "auth": ...}
    label: str | None = None
    role: Literal["admin", "hr"] = "admin"

LK_TZ = timezone(timedelta(hours=5, minutes=30))  # Sri Lanka has no daylight saving


# ───────────── cheques (HR + admin) ─────────────
def _clean_name(v: str):
    v = " ".join(v.split())
    if not NAME_RE.match(v):
        raise ValueError("Your name must be 2-60 characters: letters, spaces, . ' -")
    return v


class ChequeIn(BaseModel):
    payee_name: str
    cheque_no: str | None = Field(default=None, max_length=30)
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    cheque_date: date
    release_slot: Literal["MORNING", "EVENING"] = "MORNING"   # 10:00 am or 3:30 pm
    remind_days_before: int = Field(default=1, ge=0, le=30)
    remind_minutes_before: int = Field(default=15, ge=0, le=180)
    note: str | None = Field(default=None, max_length=300)
    by: str

    @field_validator("payee_name")
    @classmethod
    def valid_payee(cls, v: str):
        v = " ".join(v.split())
        if not (1 <= len(v) <= 150):
            raise ValueError("Name must be 1-150 characters")
        return v

    @field_validator("cheque_no")
    @classmethod
    def blank_no(cls, v):
        return (v or "").strip() or None

    @field_validator("by")
    @classmethod
    def valid_by(cls, v: str):
        return _clean_name(v)


class ChequeRescheduleIn(BaseModel):
    new_date: date
    new_slot: Literal["MORNING", "EVENING"] | None = None   # None = keep the current release time
    reason: str | None = Field(default=None, max_length=300)
    by: str

    @field_validator("by")
    @classmethod
    def valid_by(cls, v: str):
        return _clean_name(v)


class ChequeStatusIn(BaseModel):
    status: Literal["PENDING", "DONE", "CANCELLED"]
    note: str | None = Field(default=None, max_length=300)
    by: str

    @field_validator("by")
    @classmethod
    def valid_by(cls, v: str):
        return _clean_name(v)


class ChequeEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    action: str
    old_date: date | None = None
    new_date: date | None = None
    old_slot: str | None = None
    new_slot: str | None = None
    note: str | None = None
    by: str
    at: datetime | None = None


class ChequeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    payee_name: str
    cheque_no: str | None = None
    amount: float | None = None
    cheque_date: date
    original_date: date
    release_slot: str
    status: str
    remind_days_before: int
    remind_minutes_before: int
    note: str | None = None
    closed_at: datetime | None = None
    created_by: str
    reschedule_count: int
    events: list[ChequeEventOut] = []