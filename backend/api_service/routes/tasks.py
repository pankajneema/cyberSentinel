"""
Tasks route (org-scoped, Supabase identity).

Team tasks and their message threads are persisted in PostgreSQL and scoped to
the caller's organization. Every query filters by `user.org_id`; a task (or its
messages) belonging to another org is invisible (404). Reads and writes are open
to all authenticated members of the org — tasks carry no per-role restriction.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from utils.database import get_db
from utils.supabase_auth import CurrentUser, get_current_user
from utils.tenancy import require_org
from models.task_models import Task as TaskModel, TaskMessage as TaskMessageModel

router = APIRouter(prefix="/api/v1/tasks", tags=["Tasks"])


# ---------------------------------------------------------------------------
# Response models (shapes preserved exactly for the frontend Team page).
# ---------------------------------------------------------------------------
class TaskMessage(BaseModel):
    id: str
    sender: str
    message: str
    timestamp: str
    platform: Literal["internal", "slack", "jira", "email"] = "internal"


class Task(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    priority: Literal["critical", "high", "medium", "low"] = "medium"
    status: Literal["pending", "in_progress", "completed", "overdue"] = "pending"
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    created_at: str
    due_date: Optional[str] = None
    completed_at: Optional[str] = None
    asset_name: Optional[str] = None
    messages: List[TaskMessage] = []


class TaskListResponse(BaseModel):
    items: List[Task]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _messages_for(db: AsyncSession, task_id: str, org_id: str) -> List[dict]:
    rows = (
        await db.execute(
            select(TaskMessageModel)
            .filter(
                TaskMessageModel.task_id == task_id,
                TaskMessageModel.org_id == org_id,
            )
            .order_by(TaskMessageModel.created_at.asc())
        )
    ).scalars().all()
    return [m.to_dict() for m in rows]


async def _get_owned_task(db: AsyncSession, task_id: str, org_id: str) -> TaskModel:
    task = (
        await db.execute(
            select(TaskModel).filter(
                TaskModel.id == task_id,
                TaskModel.org_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    q: Optional[str] = Query(default=None, description="Search by title or assignee"),
    status: Optional[str] = Query(default=None),
    priority: Optional[str] = Query(default=None),
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)

    query = select(TaskModel).filter(TaskModel.org_id == org_id)
    if q:
        like = f"%{q}%"
        query = query.filter(
            TaskModel.title.ilike(like) | TaskModel.assignee_name.ilike(like)
        )
    if status:
        query = query.filter(TaskModel.status == status)
    if priority:
        query = query.filter(TaskModel.priority == priority)

    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar() or 0

    page = max(page, 1)
    query = query.order_by(TaskModel.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(query)).scalars().all()

    items: List[Task] = []
    for t in rows:
        msgs = await _messages_for(db, t.id, org_id)
        items.append(Task(**t.to_dict(messages=msgs)))

    return TaskListResponse(items=items, total=total, page=page, page_size=page_size)


class TaskCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    priority: Literal["critical", "high", "medium", "low"] = "medium"
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    due_date: Optional[str] = None
    asset_name: Optional[str] = None


@router.post("", response_model=Task)
async def create_task(
    payload: TaskCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    task = TaskModel(
        org_id=org_id,
        user_id=user.user_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        status="pending",
        assignee_id=payload.assignee_id,
        assignee_name=payload.assignee_name,
        due_date=payload.due_date,
        asset_name=payload.asset_name,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return Task(**task.to_dict(messages=[]))


@router.get("/{task_id}", response_model=Task)
async def get_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    task = await _get_owned_task(db, task_id, org_id)
    msgs = await _messages_for(db, task.id, org_id)
    return Task(**task.to_dict(messages=msgs))


class TaskUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[Literal["critical", "high", "medium", "low"]] = None
    status: Optional[Literal["pending", "in_progress", "completed", "overdue"]] = None
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    due_date: Optional[str] = None
    asset_name: Optional[str] = None


@router.patch("/{task_id}", response_model=Task)
async def update_task(
    task_id: str,
    payload: TaskUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    task = await _get_owned_task(db, task_id, org_id)

    data = payload.dict(exclude_unset=True)
    # Auto-set completed_at when marking complete.
    if data.get("status") == "completed" and not task.completed_at:
        task.completed_at = datetime.utcnow().isoformat()
    for key, value in data.items():
        setattr(task, key, value)

    await db.commit()
    await db.refresh(task)
    msgs = await _messages_for(db, task.id, org_id)
    return Task(**task.to_dict(messages=msgs))


@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    task = await _get_owned_task(db, task_id, org_id)
    await db.delete(task)
    await db.commit()
    return {"message": "Task deleted successfully"}


class MessageCreateRequest(BaseModel):
    message: str
    platform: Literal["internal", "slack", "jira", "email"] = "internal"


@router.get("/{task_id}/messages", response_model=List[TaskMessage])
async def list_messages(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    await _get_owned_task(db, task_id, org_id)  # 404 if not in this org
    msgs = await _messages_for(db, task_id, org_id)
    return [TaskMessage(**m) for m in msgs]


@router.post("/{task_id}/messages", response_model=TaskMessage)
async def create_message(
    task_id: str,
    payload: MessageCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    await _get_owned_task(db, task_id, org_id)  # 404 if not in this org

    msg = TaskMessageModel(
        task_id=task_id,
        org_id=org_id,
        sender=user.email or "System",
        message=payload.message,
        platform=payload.platform,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return TaskMessage(**msg.to_dict())
