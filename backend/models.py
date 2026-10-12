import calendar
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import Column, Integer, String, Date, Numeric, DateTime, Boolean, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from database import Base

LK = timezone(timedelta(hours=5, minutes=30))  # Sri Lanka time, no daylight saving


def add_months(dt, k):
    """dt moved forward k months, keeping the day (31st -> last day of a short month)."""
    m = dt.month - 1 + k
    y, m = dt.year + m // 12, m % 12 + 1
    return dt.replace(year=y, month=m, day=min(dt.day, calendar.monthrange(y, m)[1]))


class Department(Base):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(50), unique=True, nullable=False, index=True)
    logo_path = Column(String(200))


class DailyRecord(Base):
    __tablename__ = "daily_records"
    __table_args__ = (UniqueConstraint("department_id", "record_date", name="uq_dept_date"),)
    id = Column(Integer, primary_key=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False, index=True)
    record_date = Column(Date, nullable=False, index=True)
    sales_amount = Column(Numeric(14, 2), nullable=False, default=0)
    collection_amount = Column(Numeric(14, 2), nullable=False, default=0)
    submitted_by = Column(String(60), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    department = relationship("Department")

    @property
    def department_slug(self):
        return self.department.slug


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    record_id = Column(Integer, ForeignKey("daily_records.id", ondelete="SET NULL"), nullable=True, index=True)
    department_slug = Column(String(50))
    department_name = Column(String(100))
    record_date = Column(Date)
    changed_by = Column(String(60), nullable=False)
    action_type = Column(String(10), nullable=False)  # CREATE | UPDATE | DELETE
    old_sales = Column(Numeric(14, 2))
    new_sales = Column(Numeric(14, 2))
    old_collection = Column(Numeric(14, 2))
    new_collection = Column(Numeric(14, 2))
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    record = relationship("DailyRecord")

class DamageRecord(Base):
    __tablename__ = "damage_records"
    id = Column(Integer, primary_key=True)
    record_date = Column(Date, nullable=False, index=True)
    printing_damage = Column(Numeric(14, 2), nullable=False, default=0)
    accubind_damage = Column(Numeric(14, 2), nullable=False, default=0)
    binding_damage = Column(Numeric(14, 2), nullable=False, default=0)
    department_slug = Column(String(50), nullable=False, default="i-photobook", server_default="i-photobook")
    damage_value = Column(Numeric(14, 2), nullable=False, default=0, server_default="0")
    submitted_by = Column(String(60), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ProjectCategory(Base):
    __tablename__ = "project_categories"
    id = Column(Integer, primary_key=True)
    name = Column(String(150), unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ProjectSupplier(Base):
    __tablename__ = "project_suppliers"
    __table_args__ = (UniqueConstraint("category_id", "name", name="uq_category_supplier"),)
    id = Column(Integer, primary_key=True)
    category_id = Column(Integer, ForeignKey("project_categories.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    category = relationship("ProjectCategory")


class ProjectExpense(Base):
    __tablename__ = "project_expenses"
    id = Column(Integer, primary_key=True)
    supplier_id = Column(Integer, ForeignKey("project_suppliers.id"), nullable=False, index=True)
    cost = Column(Numeric(14, 2), nullable=False, default=0)
    expense_date = Column(Date, nullable=False, index=True)
    description = Column(String(300))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    supplier = relationship("ProjectSupplier")

    @property
    def supplier_name(self):
        return self.supplier.name

    @property
    def category_id(self):
        return self.supplier.category_id

    @property
    def category_name(self):
        return self.supplier.category.name

class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id = Column(Integer, primary_key=True)
    endpoint = Column(String(500), unique=True, nullable=False)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(100), nullable=False)
    label = Column(String(60))  # which admin/device, optional
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Credit(Base):
    """Money lent out (GIVEN = they owe us) or money borrowed (TAKEN = we owe them)."""
    __tablename__ = "credits"
    id = Column(Integer, primary_key=True)
    direction = Column(String(5), nullable=False, index=True)          # GIVEN | TAKEN
    party_name = Column(String(150), nullable=False, index=True)
    amount = Column(Numeric(14, 2), nullable=False)
    credit_date = Column(DateTime(timezone=True), nullable=False)      # when the money changed hands
    due_at = Column(DateTime(timezone=True), nullable=False, index=True)  # when it must be settled
    remind_before_hours = Column(Integer, nullable=False, default=24, server_default="24")
    note = Column(String(300))
    notified_before = Column(Boolean, nullable=False, default=False, server_default="false")
    notified_due = Column(Boolean, nullable=False, default=False, server_default="false")
    last_overdue_on = Column(Date)                                     # one overdue nudge per day
    repeat_monthly = Column(Boolean, nullable=False, default=False, server_default="false")  # pays in monthly instalments
    monthly_amount = Column(Numeric(14, 2))                            # expected instalment (optional)
    last_due_k = Column(Integer, nullable=False, default=-1, server_default="-1")     # last monthly "due" alert sent
    last_before_k = Column(Integer, nullable=False, default=-1, server_default="-1")  # last monthly "coming up" alert sent
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    payments = relationship("CreditPayment", cascade="all, delete-orphan", lazy="selectin",
                            order_by="CreditPayment.paid_at")

    @property
    def paid(self):
        return sum((p.amount for p in self.payments), Decimal("0"))

    @property
    def balance(self):
        return self.amount - self.paid

    @property
    def is_settled(self):
        return self.balance <= 0

    def occurrence(self, k):
        """The k-th due moment. One-off credits only have k = 0; monthly ones repeat every month."""
        due = self.due_at if self.due_at.tzinfo else self.due_at.replace(tzinfo=timezone.utc)
        return add_months(due.astimezone(LK), k)

    def current_k(self, now):
        """Index of the latest monthly due moment that has already passed (-1 = none yet)."""
        k = -1
        while self.occurrence(k + 1) <= now:
            k += 1
        return k

    @property
    def next_due_at(self):
        if not self.repeat_monthly:
            return self.due_at
        return self.occurrence(self.current_k(datetime.now(timezone.utc)) + 1)


class CreditPayment(Base):
    """A (part-)repayment against a credit."""
    __tablename__ = "credit_payments"
    id = Column(Integer, primary_key=True)
    credit_id = Column(Integer, ForeignKey("credits.id", ondelete="CASCADE"), nullable=False, index=True)
    amount = Column(Numeric(14, 2), nullable=False)
    paid_at = Column(DateTime(timezone=True), nullable=False)
    note = Column(String(300))
    created_at = Column(DateTime(timezone=True), server_default=func.now())