from datetime import datetime, timedelta, timezone
from typing import Optional, Dict
import hashlib

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext

from config.settings import settings  # 👈 recommended
from utils.database import get_db as _get_db_dep

# -------------------------------------------------------------------
# Config
# -------------------------------------------------------------------
SECRET_KEY = settings.SECRET_KEY
ALGORITHM = settings.JWT_ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES

# -------------------------------------------------------------------
# Security
# -------------------------------------------------------------------
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)

# auto_error=False so a MISSING token returns 401 (session) rather than 403,
# keeping 403 reserved for RBAC denials (which must NOT log the user out).
security = HTTPBearer(auto_error=False)

# -------------------------------------------------------------------
# Password utils (CPU only → safe in async)
def _prehash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


# -------------------------------------------------------------------
def hash_password(password: str) -> str:
    return pwd_context.hash(_prehash_password(password))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(_prehash_password(plain_password), hashed_password)

# -------------------------------------------------------------------
# JWT utils
# -------------------------------------------------------------------
async def create_access_token(
    data: Dict[str, str],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Create JWT access token
    """
    to_encode = data.copy()

    expire = datetime.now(timezone.utc) + (
        expires_delta
        if expires_delta
        else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode,
        SECRET_KEY,
        algorithm=ALGORITHM
    )
    return encoded_jwt

# -------------------------------------------------------------------
# Dependency: Get current user
# -------------------------------------------------------------------
async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db=Depends(_get_db_dep),
):
    """
    Validate the bearer token and return a user payload.

    Supabase is the current identity provider, so we verify the Supabase JWT
    first (ES256 via JWKS, or legacy HS256). The user's REAL role + org come from
    the `member_profiles` table (not the token's app_metadata), so every legacy
    route gets correct RBAC. A legacy HS256 app token is accepted as a fallback.
    `user_id` is the Supabase `sub`.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
        )
    token = credentials.credentials

    # 1) Supabase token (the real identity now)
    try:
        from utils.supabase_auth import verify_supabase_jwt

        claims = await verify_supabase_jwt(token)
        sub = claims.get("sub")
        email = claims.get("email") or (claims.get("user_metadata", {}) or {}).get("email")

        # Resolve the real role + org from member_profiles (provision on first sight).
        role = "reader"
        org_id = None
        try:
            from utils.identity_sync import sync_profile_and_org

            profile = await sync_profile_and_org(
                db,
                supabase_user_id=sub,
                email=email,
                full_name=(claims.get("user_metadata", {}) or {}).get("full_name", email),
                role="reader",
            )
            role = profile.role
            org_id = profile.org_id
        except Exception:
            # Identity tables not ready — fall back to token role.
            role = (claims.get("app_metadata") or {}).get("role", "reader")

        return {
            "email": email,
            "user_id": sub,
            "role": role,
            "org_id": org_id,
            "supabase": True,
        }
    except HTTPException:
        # Supabase is the sole identity provider. The legacy app-issued HS256
        # fallback was removed: it returned a payload with no org_id/role (so a
        # forged token defaulted to reader + self-scoped data) and was an
        # unnecessary token-forgery surface if SECRET_KEY were ever set.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )
