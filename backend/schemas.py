import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from decimal import Decimal
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict

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
    label: str | None = None

LK_TZ = timezone(timedelta(hours=5, minutes=30))  # Sri Lanka has no daylight saving


def _aware(v: datetime) -> datetime:
    return v if v.tzinfo else v.replace(tzinfo=LK_TZ)


class CreditIn(BaseModel):
    direction: Literal["GIVEN", "TAKEN"]
    party_name: str
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    credit_date: datetime
    due_at: datetime
    remind_before_hours: int = Field(default=24, ge=0, le=720)
    note: str | None = Field(default=None, max_length=300)
    repeat_monthly: bool = False
    monthly_amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)

    @field_validator("party_name")
    @classmethod
    def valid_party(cls, v: str):
        v = " ".join(v.split())
        if not (1 <= len(v) <= 150):
            raise ValueError("Name must be 1-150 characters")
        return v

    @field_validator("credit_date", "due_at")
    @classmethod
    def with_tz(cls, v: datetime):
        return _aware(v)

    @model_validator(mode="after")
    def due_after_credit(self):
        if self.due_at < self.credit_date:
            raise ValueError("Due date/time cannot be before the credit date/time")
        return self


class CreditPaymentIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    paid_at: datetime
    note: str | None = Field(default=None, max_length=300)

    @field_validator("paid_at")
    @classmethod
    def with_tz(cls, v: datetime):
        return _aware(v)


class CreditPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    amount: float
    paid_at: datetime
    note: str | None = None


class CreditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    direction: str
    party_name: str
    amount: float
    paid: float
    balance: float
    is_settled: bool
    credit_date: datetime
    due_at: datetime
    next_due_at: datetime
    remind_before_hours: int
    note: str | None = None
    repeat_monthly: bool
    monthly_amount: float | None = None
    payments: list[CreditPaymentOut] = []