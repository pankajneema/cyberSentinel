# Shared pagination helpers.
#
# `page_params` is the canonical page/page_size dependency (promoted from
# routes/ca.py). Endpoints with different historical clamp behaviour (ASM's
# bare ints with an inline >100 clamp, reports' limit/offset style) keep their
# own parameters to preserve the exact inputs they accept today.

from fastapi import Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


def page_params(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    return page, page_size


async def paginate(
    db: AsyncSession, stmt, page: int, page_size: int,
    order_by=None, serialize=lambda row: row.to_dict(),
) -> dict:
    """Count + fetch one page of `stmt`, returning the standard envelope
    {items, total, page, page_size}. `order_by` (column expression(s)) is
    applied to the page query only."""
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    page_stmt = stmt.order_by(*order_by) if order_by is not None else stmt
    rows = (await db.execute(
        page_stmt.limit(page_size).offset((page - 1) * page_size)
    )).scalars().all()
    return {"items": [serialize(r) for r in rows], "total": total,
            "page": page, "page_size": page_size}
