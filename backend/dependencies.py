# backend/dependencies.py
import jwt
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from config import settings
from schemas import TokenData
from db import get_db
from models import User
from sqlalchemy.orm import Session

security = HTTPBearer()

def _decode_local_token(token: str):
    return jwt.decode(
        token,
        settings.AUTH_JWT_SECRET,
        algorithms=[settings.AUTH_JWT_ALGORITHM],
    )


def _decode_supabase_token(token: str):
    if not settings.SUPABASE_JWT_SECRET:
        raise jwt.InvalidTokenError("SUPABASE_JWT_SECRET not configured")

    return jwt.decode(
        token,
        settings.SUPABASE_JWT_SECRET,
        algorithms=["HS256", "ES256", "RS256"],
        audience="authenticated",
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db),
) -> TokenData:
    token = credentials.credentials
    try:
        payload = _decode_local_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        try:
            payload = _decode_supabase_token(token)
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token has expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid authentication token")

    user_id = payload.get("sub") or payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    role = payload.get("role") or user.role
    return TokenData(user_id=user.id, role=role)