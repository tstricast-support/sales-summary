import re
from datetime import date, datetime, timedelta
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

class DamageIn(BaseModel):
    record_date: date
    printing_damage: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    accubind_damage: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    binding_damage: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
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
        if v > date.today() + timedelta(days=1):
            raise ValueError("Future dates are not allowed")
        return v


class DamageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    record_date: date
    printing_damage: float
    accubind_damage: float
    binding_damage: float
    submitted_by: str
    created_at: datetime | None = None