# routes/internal_vs.py
#
# INTERNAL VS endpoints — called by the Go scan worker over an authenticated
# internal channel (X-Internal-Token = CONTROL_PLANE_TOKEN, the same shared
# secret that already gates the control-plane). NOT reachable by end users.
#
# The credential-materialize endpoint decrypts a stored VS credential just in
# time for an authenticated scan. The plaintext is returned ONLY over this
# internal channel, is never persisted, and every access is audit-logged.

from __future__ import annotations

import hmac
import logging
import os

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from utils.database import get_db
from models.vs_models import VsCredential
from models.tenancy_models import AuditLog

logger = logging.getLogger("cybersentinel.internal_vs")
router = APIRouter(prefix="/api/v1/internal/vs", tags=["Internal (VS)"])


async def _require_internal_token(x_internal_token: str = Header(default="")):
    expected = os.getenv("CONTROL_PLANE_TOKEN", "")
    if not expected:
        # Fail closed: without a configured shared secret this endpoint would be
        # an unauthenticated credential-disclosure vector.
        raise HTTPException(status_code=503, detail="internal token not configured")
    if not hmac.compare_digest(x_internal_token or "", expected):
        raise HTTPException(status_code=401, detail="unauthorized")


class MaterializeRequest(BaseModel):
    credential_id: str
    org_id: str


@router.post("/credential", dependencies=[Depends(_require_internal_token)])
async def materialize_credential(payload: MaterializeRequest,
                                 db: AsyncSession = Depends(get_db)):
    """Return the decrypted credential for an authenticated scan. Internal only."""
    cred = (await db.execute(select(VsCredential).where(
        VsCredential.id == payload.credential_id,
        VsCredential.org_id == payload.org_id))).scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=404, detail="credential not found")

    from utils.crypto import decrypt_secret
    try:
        secret = decrypt_secret(cred.secret_ciphertext)
    except Exception as e:  # noqa: BLE001 - do not leak crypto details
        logger.error("credential decrypt failed for %s: %s", cred.id, e)
        raise HTTPException(status_code=500, detail="credential could not be decrypted")

    # Audit every materialization (who: system/worker, what: which credential).
    db.add(AuditLog(org_id=payload.org_id, actor_user_id=None,
                    action="vs.credential.materialized", target=cred.id,
                    meta={"cred_type": cred.cred_type, "via": "scan-worker"}))
    await db.commit()

    return {"cred_type": cred.cred_type, "username": cred.username, "secret": secret}
