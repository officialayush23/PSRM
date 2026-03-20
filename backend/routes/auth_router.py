# backend/routes/auth_router.py

import re
from typing import Optional

import firebase_admin
from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import auth as firebase_auth, credentials
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import settings
from db import get_db
from dependencies import get_current_user
from models import City, User
from schemas import TokenData

if not firebase_admin._apps:
    cred = credentials.Certificate(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)

router = APIRouter(prefix="/auth", tags=["Auth"])


# ── Schemas ───────────────────────────────────────────────────────

class FirebaseTokenRequest(BaseModel):
    id_token:           str
    full_name:          Optional[str] = None
    city_code:          Optional[str] = None
    preferred_language: Optional[str] = "hi"


class UpdateMeRequest(BaseModel):
    full_name:          Optional[str] = None
    phone:              Optional[str] = None
    preferred_language: Optional[str] = None
    email_opt_in:       Optional[bool] = None
    twilio_opt_in:      Optional[bool] = None


class AuthResponse(BaseModel):
    user_id:     str
    role:        str
    email:       Optional[str]
    phone:       Optional[str]
    full_name:   str
    city_id:     Optional[str]
    is_new_user: bool


# ── Helpers ───────────────────────────────────────────────────────

def _verify_firebase_token(id_token: str) -> dict:
    try:
        return firebase_auth.verify_id_token(id_token)
    except firebase_auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Firebase token has expired")
    except firebase_auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid Firebase token")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {exc}")


def _resolve_city(db: Session, city_code: Optional[str]) -> City:
    if city_code:
        city = db.query(City).filter(City.city_code == city_code.strip().upper()).first()
        if not city:
            raise HTTPException(status_code=400, detail=f"Unknown city_code: {city_code}")
        return city
    city = db.query(City).order_by(City.created_at.asc()).first()
    if not city:
        raise HTTPException(status_code=500, detail="No cities configured in database")
    return city


def _provider_label(sign_in_provider: str) -> str:
    return {
        "password":   "password",
        "phone":      "phone_otp",
        "google.com": "google",
        "apple.com":  "apple",
    }.get(sign_in_provider, sign_in_provider)


def _user_response(user: User, is_new: bool) -> AuthResponse:
    return AuthResponse(
        user_id=str(user.id),
        role=user.role,
        email=user.email,
        phone=user.phone,
        full_name=user.full_name,
        city_id=str(user.city_id) if user.city_id else None,
        is_new_user=is_new,
    )


# ── Routes ────────────────────────────────────────────────────────

@router.post("/signup", response_model=AuthResponse)
def signup(payload: FirebaseTokenRequest, db: Session = Depends(get_db)):
    decoded      = _verify_firebase_token(payload.id_token)
    firebase_uid = decoded["uid"]
    email        = (decoded.get("email") or "").strip().lower() or None
    phone        = decoded.get("phone_number") or None
    provider     = _provider_label(decoded.get("firebase", {}).get("sign_in_provider", "password"))
    display_name = (
        payload.full_name or decoded.get("name") or email or phone or "Citizen"
    ).strip()

    existing = db.query(User).filter(User.auth_uid == firebase_uid).first()
    if existing:
        return _user_response(existing, is_new=False)

    if email and db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    city = _resolve_city(db, payload.city_code)

    user = User(
        auth_uid           = firebase_uid,
        auth_provider      = provider,
        email              = email,
        phone              = phone,
        full_name          = display_name,
        preferred_language = (payload.preferred_language or "hi").strip(),
        city_id            = city.id,
        role               = "citizen",
        is_active          = True,
        is_verified        = True,
        twilio_opt_in      = True,
        email_opt_in       = True,
        extra_meta         = {},
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_response(user, is_new=True)


@router.post("/login", response_model=AuthResponse)
def login(payload: FirebaseTokenRequest, db: Session = Depends(get_db)):
    decoded      = _verify_firebase_token(payload.id_token)
    firebase_uid = decoded["uid"]
    email        = (decoded.get("email") or "").strip().lower() or None
    phone        = decoded.get("phone_number") or None
    provider     = _provider_label(decoded.get("firebase", {}).get("sign_in_provider", "password"))

    user = db.query(User).filter(User.auth_uid == firebase_uid).first()

    if not user:
        # Auto-provision — valid Firebase user but no DB row yet
        city = _resolve_city(db, payload.city_code)
        display_name = (decoded.get("name") or email or phone or "Citizen").strip()
        user = User(
            auth_uid=firebase_uid, auth_provider=provider,
            email=email, phone=phone, full_name=display_name,
            preferred_language=(payload.preferred_language or "hi").strip(),
            city_id=city.id, role="citizen",
            is_active=True, is_verified=True,
            twilio_opt_in=True, email_opt_in=True, extra_meta={},
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return _user_response(user, is_new=True)

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    if user.auth_provider != provider:
        user.auth_provider = provider
        db.commit()

    return _user_response(user, is_new=False)


@router.get("/me")
def me(current_user: TokenData = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == current_user.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user_id":           str(user.id),
        "email":             user.email,
        "phone":             user.phone,
        "full_name":         user.full_name,
        "role":              user.role,
        "city_id":           str(user.city_id) if user.city_id else None,
        "is_active":         user.is_active,
        "auth_provider":     user.auth_provider,
        "preferred_language": user.preferred_language,
        "email_opt_in":      user.email_opt_in,
        "twilio_opt_in":     user.twilio_opt_in,
    }


@router.patch("/me")
def update_me(
    payload: UpdateMeRequest,
    current_user: TokenData = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == current_user.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.phone is not None:
        user.phone = payload.phone or None
    if payload.preferred_language is not None:
        user.preferred_language = payload.preferred_language
    if payload.email_opt_in is not None:
        user.email_opt_in = payload.email_opt_in
    if payload.twilio_opt_in is not None:
        user.twilio_opt_in = payload.twilio_opt_in

    db.commit()
    db.refresh(user)

    return {
        "user_id":            str(user.id),
        "full_name":          user.full_name,
        "phone":              user.phone,
        "preferred_language": user.preferred_language,
        "email_opt_in":       user.email_opt_in,
        "twilio_opt_in":      user.twilio_opt_in,
    }