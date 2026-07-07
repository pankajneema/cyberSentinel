# Shared ownership guard: fetch a row by id scoped to the caller's tenant or
# raise 404 (cross-tenant misses are 404, never 403 — no existence leaks).

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def get_owned_or_404(
    db: AsyncSession, model, obj_id: str, org_id: str, *,
    detail: str = "Not found", org_column: str = "org_id", extra_criteria=(),
):
    """Return the `model` row with the given id belonging to `org_id`
    (or, via `org_column`, another scoping column such as user_id), else 404
    with the caller's exact `detail` string."""
    stmt = select(model).where(
        model.id == obj_id,
        getattr(model, org_column) == org_id,
        *extra_criteria,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail=detail)
    return row
