# tasks.py
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Literal, Dict, Any
from datetime import datetime
import uuid

from utils.auth_utils import get_current_user

router = APIRouter(prefix="/api/v1/tasks", tags=["Tasks"])


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


tasks_db: Dict[str, Dict[str, Any]] = {}
messages_db: Dict[str, List[Dict[str, Any]]] = {}


def _seed_tasks_if_empty() -> None:
  if tasks_db:
    return

  now = datetime.utcnow().isoformat()
  example_tasks = [
    {
      "id": "1",
      "title": "Patch CVE-2024-1234 on web server",
      "description": "Critical vulnerability requires immediate attention",
      "priority": "critical",
      "status": "in_progress",
      "assignee_id": "2",
      "assignee_name": "Sarah Johnson",
      "created_at": now,
      "due_date": now,
      "completed_at": None,
      "asset_name": "api.company.com",
    },
    {
      "id": "2",
      "title": "Update TLS configuration",
      "description": "Upgrade to TLS 1.3 across all endpoints",
      "priority": "high",
      "status": "pending",
      "assignee_id": "3",
      "assignee_name": "Mike Chen",
      "created_at": now,
      "due_date": now,
      "completed_at": None,
      "asset_name": "*.company.com",
    },
  ]

  for t in example_tasks:
    tasks_db[t["id"]] = t
    messages_db[t["id"]] = []


@router.get("", response_model=TaskListResponse)
async def list_tasks(
  q: Optional[str] = Query(default=None, description="Search by title or assignee"),
  status: Optional[str] = Query(default=None),
  priority: Optional[str] = Query(default=None),
  page: int = 1,
  page_size: int = 50,
  current_user: dict = Depends(get_current_user),
):
  _seed_tasks_if_empty()

  items = list(tasks_db.values())

  if q:
    q_lower = q.lower()
    items = [
      t
      for t in items
      if q_lower in t["title"].lower()
      or (t.get("assignee_name") and q_lower in t["assignee_name"].lower())
    ]

  if status:
    items = [t for t in items if t.get("status") == status]

  if priority:
    items = [t for t in items if t.get("priority") == priority]

  total = len(items)
  start = max((page - 1) * page_size, 0)
  end = start + page_size

  enriched: List[Task] = []
  for t in items[start:end]:
    msgs = [TaskMessage(**m) for m in messages_db.get(t["id"], [])]
    enriched.append(Task(messages=msgs, **t))

  return TaskListResponse(items=enriched, total=total, page=page, page_size=page_size)


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
  payload: TaskCreateRequest, current_user: dict = Depends(get_current_user)
):
  _seed_tasks_if_empty()
  task_id = str(uuid.uuid4())
  now = datetime.utcnow().isoformat()

  record: Dict[str, Any] = {
    "id": task_id,
    "title": payload.title,
    "description": payload.description,
    "priority": payload.priority,
    "status": "pending",
    "assignee_id": payload.assignee_id,
    "assignee_name": payload.assignee_name,
    "created_at": now,
    "due_date": payload.due_date,
    "completed_at": None,
    "asset_name": payload.asset_name,
  }
  tasks_db[task_id] = record
  messages_db[task_id] = []
  return Task(messages=[], **record)


@router.get("/{task_id}", response_model=Task)
async def get_task(task_id: str, current_user: dict = Depends(get_current_user)):
  _seed_tasks_if_empty()
  task = tasks_db.get(task_id)
  if not task:
    raise HTTPException(status_code=404, detail="Task not found")
  msgs = [TaskMessage(**m) for m in messages_db.get(task_id, [])]
  return Task(messages=msgs, **task)


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
  task_id: str, payload: TaskUpdateRequest, current_user: dict = Depends(get_current_user)
):
  _seed_tasks_if_empty()
  task = tasks_db.get(task_id)
  if not task:
    raise HTTPException(status_code=404, detail="Task not found")

  data = payload.dict(exclude_unset=True)
  # Auto-set completed_at when marking complete
  if data.get("status") == "completed":
    data.setdefault("completed_at", datetime.utcnow().isoformat())

  task.update(data)
  tasks_db[task_id] = task
  msgs = [TaskMessage(**m) for m in messages_db.get(task_id, [])]
  return Task(messages=msgs, **task)


@router.delete("/{task_id}")
async def delete_task(task_id: str, current_user: dict = Depends(get_current_user)):
  _seed_tasks_if_empty()
  if task_id not in tasks_db:
    raise HTTPException(status_code=404, detail="Task not found")
  del tasks_db[task_id]
  messages_db.pop(task_id, None)
  return {"message": "Task deleted successfully"}


class MessageCreateRequest(BaseModel):
  message: str
  platform: Literal["internal", "slack", "jira", "email"] = "internal"


@router.get("/{task_id}/messages", response_model=List[TaskMessage])
async def list_messages(
  task_id: str, current_user: dict = Depends(get_current_user)
):
  _seed_tasks_if_empty()
  if task_id not in tasks_db:
    raise HTTPException(status_code=404, detail="Task not found")
  return [TaskMessage(**m) for m in messages_db.get(task_id, [])]


@router.post("/{task_id}/messages", response_model=TaskMessage)
async def create_message(
  task_id: str,
  payload: MessageCreateRequest,
  current_user: dict = Depends(get_current_user),
):
  _seed_tasks_if_empty()
  if task_id not in tasks_db:
    raise HTTPException(status_code=404, detail="Task not found")

  msg_id = str(uuid.uuid4())
  record = {
    "id": msg_id,
    "sender": current_user.get("name", "System"),
    "message": payload.message,
    "timestamp": datetime.utcnow().isoformat(),
    "platform": payload.platform,
  }
  messages_db.setdefault(task_id, []).append(record)
  return TaskMessage(**record)

