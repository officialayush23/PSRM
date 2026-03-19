import base64
import hashlib
import hmac
import os
import re
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from config import settings
from db import get_db
from dependencies import get_current_user
from models import City, User
from schemas import AuthResponse, SignInRequest, SignUpRequest, TokenData

router = APIRouter(prefix="/auth", tags=["Auth"])

PASSWORD_ITERATIONS = 390000
PASSWORD_REGEX = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{8,}$")


def _hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def _verify_password(password: str, stored: str) -> bool:
    try:
        algo, iteration_str, salt_b64, digest_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iteration_str)
        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected = base64.b64decode(digest_b64.encode("ascii"))
    except Exception:
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _issue_access_token(user: User) -> tuple[str, int]:
    expires_seconds = settings.AUTH_ACCESS_TOKEN_EXPIRE_MINUTES * 60
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "email": user.email,
        "type": "access",
        "exp": int(expires_at.timestamp()),
        "iat": int(datetime.now(timezone.utc).timestamp()),
    }
    token = jwt.encode(payload, settings.AUTH_JWT_SECRET, algorithm=settings.AUTH_JWT_ALGORITHM)
    return token, expires_seconds


def _resolve_city_id(db: Session, city_code: str | None):
    if city_code:
        city = db.query(City).filter(City.city_code == city_code.strip()).first()
        if not city:
            raise HTTPException(status_code=400, detail="Invalid city_code")
        return city.id

    first_city = db.query(City).order_by(City.created_at.asc()).first()
    return first_city.id if first_city else None


def _validate_password_strength(password: str) -> None:
    if not PASSWORD_REGEX.match(password):
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 characters and include letters and numbers",
        )


@router.post("/signup", response_model=AuthResponse)
def signup(payload: SignUpRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    _validate_password_strength(payload.password)
    city_id = _resolve_city_id(db, payload.city_code)
    password_hash = _hash_password(payload.password)

    user = User(
        city_id=city_id,
        email=email,
        full_name=payload.full_name.strip(),
        preferred_language=(payload.preferred_language or "hi").strip(),
        role="citizen",
        is_active=True,
        is_verified=True,
        auth_provider="password",
        extra_meta={"password_hash": password_hash},
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    token, expires_in = _issue_access_token(user)
    return AuthResponse(
        access_token=token,
        expires_in=expires_in,
        user_id=user.id,
        role=user.role,
        email=user.email or "",
        full_name=user.full_name,
    )


@router.post("/login")
def login(payload: SignInRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    meta = user.extra_meta or {}
    stored_hash = meta.get("password_hash") if isinstance(meta, dict) else None
    if not stored_hash or not _verify_password(payload.password, stored_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token, expires_in = _issue_access_token(user)
    return AuthResponse(
        access_token=token,
        expires_in=expires_in,
        user_id=user.id,
        role=user.role,
        email=user.email or "",
        full_name=user.full_name,
    )


@router.get("/me")
def me(current_user: TokenData = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == current_user.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user_id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
    }
