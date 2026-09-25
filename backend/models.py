from sqlalchemy import Column, Integer, String, Date, Numeric, DateTime, ForeignKey, UniqueConstraint, func
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
    record_id = Column(Integer, ForeignKey("daily_records.id"), nullable=False, index=True)
    changed_by = Column(String(60), nullable=False)
    action_type = Column(String(10), nullable=False)  # CREATE | UPDATE
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