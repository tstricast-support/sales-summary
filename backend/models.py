from sqlalchemy import Column, Integer, String, Date, Numeric, DateTime, Boolean, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from database import Base

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
    role = Column(String(10), nullable=False, default="admin", server_default="admin")  # admin | hr
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Cheque(Base):
    """A cheque HR has noted. cheque_date = the date it will be released / presented."""
    __tablename__ = "cheques"
    id = Column(Integer, primary_key=True)
    payee_name = Column(String(150), nullable=False, index=True)
    cheque_no = Column(String(30))
    amount = Column(Numeric(14, 2))
    cheque_date = Column(Date, nullable=False, index=True)       # current release date
    original_date = Column(Date, nullable=False)                 # first date it was noted for
    status = Column(String(10), nullable=False, default="PENDING", server_default="PENDING", index=True)  # PENDING | DONE | CANCELLED
    remind_days_before = Column(Integer, nullable=False, default=1, server_default="1")
    release_slot = Column(String(8), nullable=False, default="MORNING", server_default="MORNING")  # MORNING 10:00 am | EVENING 3:30 pm
    remind_minutes_before = Column(Integer, nullable=False, default=15, server_default="15")       # alarm before the release time
    alert_stage = Column(Integer, nullable=False, default=0, server_default="0")                   # last alert sent for the current date/time
    note = Column(String(300))
    notified_before = Column(Boolean, nullable=False, default=False, server_default="false")
    notified_due = Column(Boolean, nullable=False, default=False, server_default="false")
    last_overdue_on = Column(Date)                               # one overdue nudge per day
    closed_at = Column(DateTime(timezone=True))
    created_by = Column(String(60), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    events = relationship("ChequeEvent", cascade="all, delete-orphan", lazy="selectin", order_by="ChequeEvent.id")

    @property
    def reschedule_count(self):
        return sum(1 for e in self.events if e.action == "RESCHEDULED")


class ChequeEvent(Base):
    """History of what happened to a cheque (who changed the date, who marked it used...)."""
    __tablename__ = "cheque_events"
    id = Column(Integer, primary_key=True)
    cheque_id = Column(Integer, ForeignKey("cheques.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String(15), nullable=False)   # CREATED | EDITED | RESCHEDULED | DONE | CANCELLED | REOPENED
    old_date = Column(Date)
    new_date = Column(Date)
    old_slot = Column(String(8))
    new_slot = Column(String(8))
    note = Column(String(300))
    by = Column(String(60), nullable=False)
    at = Column(DateTime(timezone=True), server_default=func.now())