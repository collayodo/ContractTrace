"""Authentication and role permissions.

Callers send a signed bearer token. The token says who they are (sub) and which
role they hold (role). Their identity in the audit log comes from the token, never
from the request body.

Tokens are HS256 signed with AUTH_JWT_SECRET, which should live in Secret Manager.
When the team moves to Firebase Auth or Identity Platform, only verify_token()
needs to change; the roles, permissions and endpoint checks stay the same.

Fails closed: with no secret configured, every protected endpoint returns 503.
"""

import os
import time
from enum import StrEnum
from typing import Callable, Optional

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.audit import append_audit

ALGORITHM = "HS256"
MIN_SECRET_LENGTH = 32
MAX_USER_ID_LENGTH = 120


class Role(StrEnum):
    viewer = "viewer"
    reviewer = "reviewer"
    admin = "admin"


class Permission(StrEnum):
    contracts_read = "contracts:read"
    cases_read = "cases:read"
    audit_read = "audit:read"
    reconcile_run = "reconcile:run"
    case_investigate = "case:investigate"
    case_resolve = "case:resolve"
    ai_analyze = "ai:analyze"
    amendment_record = "amendment:record"


# The access matrix. Admins record amendments but cannot resolve cases, and
# reviewers resolve cases but cannot record amendments. Recording an amendment can
# clear a flag, so one person should not be able to do both.
ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.viewer: frozenset(
        {
            Permission.contracts_read,
            Permission.cases_read,
        }
    ),
    Role.reviewer: frozenset(
        {
            Permission.contracts_read,
            Permission.cases_read,
            Permission.audit_read,
            Permission.reconcile_run,
            Permission.case_investigate,
            Permission.case_resolve,
            Permission.ai_analyze,
        }
    ),
    Role.admin: frozenset(
        {
            Permission.contracts_read,
            Permission.cases_read,
            Permission.audit_read,
            Permission.reconcile_run,
            Permission.amendment_record,
        }
    ),
}

# Denied attempts at these are written to the audit log.
WRITE_PERMISSIONS = frozenset(
    {
        Permission.reconcile_run,
        Permission.case_investigate,
        Permission.case_resolve,
        Permission.ai_analyze,
        Permission.amendment_record,
    }
)


class Principal(BaseModel):
    user_id: str
    role: Role

    def can(self, permission: Permission) -> bool:
        return permission in ROLE_PERMISSIONS[self.role]


_bearer = HTTPBearer(auto_error=False)


def _secret() -> str:
    secret = os.getenv("AUTH_JWT_SECRET", "")
    if len(secret) < MIN_SECRET_LENGTH:
        raise HTTPException(
            status_code=503,
            detail=f"Authentication is not configured: AUTH_JWT_SECRET must be at least {MIN_SECRET_LENGTH} characters.",
        )
    return secret


def issue_token(user_id: str, role: Role | str, ttl_seconds: int = 3600, secret: Optional[str] = None) -> str:
    """Create a signed token. For local development and tests only."""
    now = int(time.time())
    return jwt.encode(
        {"sub": user_id, "role": Role(role).value, "iat": now, "exp": now + ttl_seconds},
        secret or _secret(),
        algorithm=ALGORITHM,
    )


def verify_token(token: str) -> Principal:
    secret = _secret()
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
        user_id = claims["sub"]
        if not isinstance(user_id, str) or not user_id.strip() or len(user_id) > MAX_USER_ID_LENGTH:
            raise ValueError("invalid subject")
        return Principal(user_id=user_id, role=Role(claims.get("role")))
    except (jwt.InvalidTokenError, ValueError, KeyError) as error:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error


def authenticate(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Principal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verify_token(credentials.credentials)


def require(permission: Permission) -> Callable[..., Principal]:
    def dependency(request: Request, principal: Principal = Depends(authenticate)) -> Principal:
        if principal.can(permission):
            return principal
        if permission in WRITE_PERMISSIONS:
            append_audit(
                request.app.state.store,
                actor=principal.user_id,
                action="permission_denied",
                target_type="endpoint",
                target_id=f"{request.method} {request.url.path}",
                details={"role": principal.role.value, "required_permission": permission.value},
            )
        raise HTTPException(status_code=403, detail="Your role is not allowed to do this")

    return dependency
