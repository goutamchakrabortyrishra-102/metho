# Backend Patch Code (FastAPI): Stable Member Registration

Use this patch in the backend repository to make member registration stable and aligned with frontend.

## 1) Pydantic schema (dob optional, address optional)

```python
# sql_app/schemas.py
from pydantic import BaseModel, Field
from typing import Optional

class RegisterRequest(BaseModel):
    name: str
    email: str  # username/login id
    phone: str
    password: str
    pan_no: str
    dob: Optional[str] = None
    sponsor_code: Optional[str] = None
    address: Optional[str] = None
```

## 2) DB constraints (unique phone + unique username)

```python
# sql_app/models.py
from sqlalchemy import Column, Integer, String, DateTime, func, Boolean, Text
from sql_app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    email = Column(String(120), unique=True, index=True, nullable=False)  # username
    phone = Column(String(20), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    pan_no = Column(String(10), nullable=False)
    dob = Column(String(20), nullable=True)
    sponsor_code = Column(String(40), nullable=True)
    address = Column(Text, nullable=True)
    role = Column(String(30), default="member", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

## 3) Registration service logic (deterministic validation)

```python
# sql_app/routers/auth.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from sql_app.database import get_db
from sql_app import models, schemas
from passlib.context import CryptContext

router = APIRouter(prefix="/api/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def normalize_phone(raw: str) -> str:
    return "".join(ch for ch in (raw or "") if ch.isdigit())


def is_valid_pan(p: str) -> bool:
    import re
    return bool(re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", (p or "").upper().strip()))


@router.post("/register")
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    username = (payload.email or "").strip()
    phone = normalize_phone(payload.phone)
    pan_no = (payload.pan_no or "").strip().upper()

    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if len(phone) < 10 or len(phone) > 15:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    if not is_valid_pan(pan_no):
        raise HTTPException(status_code=400, detail="Invalid PAN format")
    if len(payload.password or "") < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    existing_username = db.query(models.User).filter(func.lower(models.User.email) == username.lower()).first()
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already registered")

    existing_phone = db.query(models.User).filter(models.User.phone == phone).first()
    if existing_phone:
        raise HTTPException(status_code=400, detail="Phone already registered")

    if payload.sponsor_code:
        sponsor = db.query(models.User).filter(models.User.member_code == payload.sponsor_code.strip().upper()).first()
        if not sponsor:
            raise HTTPException(status_code=400, detail="Invalid sponsor code")

    user = models.User(
        name=(payload.name or "").strip(),
        email=username,
        phone=phone,
        password_hash=pwd_context.hash(payload.password),
        pan_no=pan_no,
        dob=(payload.dob or "").strip() or None,
        sponsor_code=(payload.sponsor_code or "").strip().upper() or None,
        address=(payload.address or "").strip() or None,
        role="member",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Return shape should match frontend expectation.
    # If you use JWT, include token and user object.
    token = "<generate-jwt-here>"
    return {
        "token": token,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "role": user.role,
        },
    }
```

## 4) Keep one canonical route and alias safely

```python
# sql_app/main.py
from fastapi import FastAPI
from sql_app.routers import auth

app = FastAPI()
app.include_router(auth.router)  # /api/auth/register

@app.post("/api/register")
def register_alias(payload: auth.schemas.RegisterRequest, db=Depends(auth.get_db)):
    # Delegate to same logic to avoid divergence.
    return auth.register(payload, db)
```

## 5) Error handling rule
- Do not return plain text for 500.
- Return structured JSON with correlation id.

```python
{"detail":"Internal server error","trace_id":"..."}
```

## 6) Smoke tests (must pass)
1. New unique username + phone => 200
2. Same username => 400 Username already registered
3. Same phone => 400 Phone already registered
4. Invalid PAN => 400 Invalid PAN format
5. Invalid sponsor => 400 Invalid sponsor code
6. dob omitted => 200 (optional)

