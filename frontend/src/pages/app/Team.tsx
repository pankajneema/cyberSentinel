import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Users,
  Plus,
  Search,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  MoreVertical,
  Crown,
  Trash2,
  Edit,
  Shield,
  History,
  Calendar,
  Target,
  PlayCircle,
  PauseCircle,
  UserPlus,
  UserCog,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import {
  createInvite,
  changeMemberRole,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  TeamInvite as ApiTeamInvite,
  TeamMember as ApiTeamMember,
} from "@/lib/services/team";
import { useMe } from "@/hooks/useMe";
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  getTaskMessages,
  createTaskMessage,
} from "@/lib/services/tasks";

interface TaskAssignee {
  id: string;
  name: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed" | "overdue";
  assignee: TaskAssignee;
  createdAt: string;
  dueDate: string;
  completedAt?: string;
  asset?: string;
  messageCount: number;
}

interface TaskMessage {
  id: string;
  sender: string;
  message: string;
  timestamp: string;
  platform: string;
}

const ROLE_OPTIONS = ["owner", "admin", "analyst", "reader"] as const;
const INVITE_ROLE_OPTIONS = ["admin", "analyst", "reader"] as const;

const BUILTIN_ROLES: { name: string; description: string }[] = [
  { name: "Owner", description: "Full access plus billing and organization ownership." },
  { name: "Admin", description: "Manage team members and all organization data." },
  { name: "Analyst", description: "Edit assets and scans, but cannot manage the team." },
  { name: "Reader", description: "Read-only access to assets, scans, and reports." },
];

export default function Team() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isAssignTaskOpen, setIsAssignTaskOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [teamMembers, setTeamMembers] = useState<ApiTeamMember[]>([]);
  const [teamInvites, setTeamInvites] = useState<ApiTeamInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("reader");
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const { me, role: currentRole } = useMe();
  const isSuperadmin = false;
  const currentUserId = me?.user_id;

  // Task message panel
  const [taskMessages, setTaskMessages] = useState<TaskMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Assign task form
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskAssignee, setTaskAssignee] = useState<string>("");
  const [taskPriority, setTaskPriority] = useState<string>("medium");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskAsset, setTaskAsset] = useState("");
  const [isSavingTask, setIsSavingTask] = useState(false);

  // Edit task dialog
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<string>("medium");
  const [editStatus, setEditStatus] = useState<string>("pending");
  const [editDueDate, setEditDueDate] = useState("");
  const [editAsset, setEditAsset] = useState("");

  const isAdmin = currentRole === "admin" || currentRole === "owner";
  const canInvite = isAdmin || isSuperadmin;

  const pendingInvites = useMemo(
    () => teamInvites.filter((invite) => invite.status === "pending"),
    [teamInvites]
  );

  const mapTask = (a: any): Task => ({
    id: String(a.id),
    title: a.title,
    description: a.description || "",
    priority: a.priority || "medium",
    status: a.status || "pending",
    assignee: {
      id: a.assignee_id || "",
      name: a.assignee_name || "Unassigned",
    },
    createdAt: a.created_at || "",
    dueDate: a.due_date || "",
    completedAt: a.completed_at || undefined,
    asset: a.asset_name,
    messageCount: Array.isArray(a.messages) ? a.messages.length : 0,
  });

  const loadTasks = async () => {
    try {
      const res: any = await listTasks({ page_size: 50 });
      const items: any[] = Array.isArray(res) ? res : res?.items ?? [];
      setTasks(items.map(mapTask));
    } catch {
      setTasks([]);
    }
  };

  const loadTeamData = async () => {
    try {
      setIsLoadingTeam(true);
      const [members, invites] = await Promise.all([listMembers(), listInvites()]);
      setTeamMembers(members);
      setTeamInvites(invites);
      await loadTasks();
    } catch (error) {
      toast({
        title: "Failed to load team data",
        description: "Please refresh and try again.",
      });
    } finally {
      setIsLoadingTeam(false);
    }
  };

  useEffect(() => {
    void loadTeamData();
  }, []);


  const loadMessages = async (taskId: string) => {
    try {
      setIsLoadingMessages(true);
      const res: any = await getTaskMessages(taskId);
      const items: any[] = Array.isArray(res) ? res : [];
      setTaskMessages(
        items.map((m) => ({
          id: String(m.id),
          sender: m.sender || m.sender_name || "Unknown",
          message: m.message,
          timestamp: m.timestamp || m.created_at || "",
          platform: m.platform || "internal",
        }))
      );
    } catch {
      setTaskMessages([]);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
    void loadMessages(task.id);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedTask) return;
    try {
      setIsSendingMessage(true);
      await createTaskMessage(selectedTask.id, {
        message: newMessage.trim(),
        platform: "internal",
      });
      setNewMessage("");
      await loadMessages(selectedTask.id);
      await loadTasks();
    } catch {
      toast({ title: "Failed to send message", description: "Please try again." });
    } finally {
      setIsSendingMessage(false);
    }
  };

  const resetAssignForm = () => {
    setTaskTitle("");
    setTaskDescription("");
    setTaskAssignee("");
    setTaskPriority("medium");
    setTaskDueDate("");
    setTaskAsset("");
  };

  const handleAssignTask = async () => {
    if (!taskTitle.trim()) {
      toast({ title: "Title required", description: "Enter a task title." });
      return;
    }
    try {
      setIsSavingTask(true);
      const assignee = teamMembers.find((m) => m.id === taskAssignee);
      await createTask({
        title: taskTitle.trim(),
        description: taskDescription.trim() || undefined,
        priority: taskPriority as any,
        assignee_id: taskAssignee || undefined,
        assignee_name: assignee?.name,
        due_date: taskDueDate || undefined,
        asset_name: taskAsset.trim() || undefined,
      });
      toast({ title: "Task assigned", description: `"${taskTitle.trim()}" created.` });
      resetAssignForm();
      setIsAssignTaskOpen(false);
      await loadTasks();
    } catch {
      toast({ title: "Failed to assign task", description: "Please try again." });
    } finally {
      setIsSavingTask(false);
    }
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditPriority(task.priority);
    setEditStatus(task.status);
    setEditDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
    setEditAsset(task.asset || "");
  };

  const handleUpdateTask = async () => {
    if (!editingTask) return;
    if (!editTitle.trim()) {
      toast({ title: "Title required", description: "Enter a task title." });
      return;
    }
    try {
      setIsSavingTask(true);
      await updateTask(editingTask.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
        priority: editPriority as any,
        status: editStatus as any,
        due_date: editDueDate || undefined,
        asset_name: editAsset.trim() || undefined,
      });
      toast({ title: "Task updated" });
      setEditingTask(null);
      await loadTasks();
    } catch {
      toast({ title: "Failed to update task", description: "Please try again." });
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleCompleteTask = async (task: Task) => {
    try {
      await updateTask(task.id, { status: "completed" });
      toast({ title: "Task marked complete" });
      await loadTasks();
    } catch {
      toast({ title: "Failed to update task", description: "Please try again." });
    }
  };

  const handleDeleteTask = async (task: Task) => {
    if (!window.confirm(`Delete task "${task.title}"? This cannot be undone.`)) return;
    try {
      await deleteTask(task.id);
      toast({ title: "Task deleted" });
      if (selectedTask?.id === task.id) setSelectedTask(null);
      await loadTasks();
    } catch {
      toast({ title: "Failed to delete task", description: "Please try again." });
    }
  };

  const handleInviteMember = async () => {
    if (!inviteEmail.trim()) {
      toast({ title: "Email required", description: "Enter a valid email to invite." });
      return;
    }
    try {
      await createInvite({ email: inviteEmail.trim(), role: inviteRole });
      toast({ title: "Invitation sent", description: `Invitation sent to ${inviteEmail.trim()}.` });
      setInviteEmail("");
      setInviteRole("reader");
      setIsInviteOpen(false);
      await loadTeamData();
    } catch (error) {
      toast({ title: "Invite failed", description: "Could not send invite." });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeMember(memberId);
      toast({ title: "Member removed" });
      await loadTeamData();
    } catch (error) {
      toast({ title: "Remove failed", description: "Could not remove member." });
    }
  };

  const handleChangeRole = async (memberId: string, role: string) => {
    try {
      await changeMemberRole(memberId, role);
      toast({ title: "Role updated", description: `Member is now ${role}.` });
      await loadTeamData();
    } catch (error) {
      toast({ title: "Update failed", description: "Could not change role." });
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await revokeInvite(inviteId);
      toast({ title: "Invite revoked" });
      await loadTeamData();
    } catch (error) {
      toast({ title: "Revoke failed", description: "Could not revoke invite." });
    }
  };

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.assignee.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || task.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical":
        return "bg-destructive/10 text-destructive border-destructive/20";
      case "high":
        return "bg-warning/10 text-warning border-warning/20";
      case "medium":
        return "bg-accent/10 text-accent border-accent/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-success/10 text-success";
      case "in_progress":
        return "bg-primary/10 text-primary";
      case "overdue":
        return "bg-destructive/10 text-destructive";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return CheckCircle2;
      case "in_progress":
        return PlayCircle;
      case "overdue":
        return AlertCircle;
      default:
        return PauseCircle;
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Team Management</h1>
          <p className="text-muted-foreground">Manage tasks, assignments, and team communication</p>
        </div>
        <div className="flex gap-2">
          {canInvite && (
            <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Invite Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite Team Member</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Email Address</Label>
                    <Input
                      type="email"
                      placeholder="colleague@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INVITE_ROLE_OPTIONS.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role.charAt(0).toUpperCase() + role.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button variant="outline" onClick={() => setIsInviteOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="gradient" onClick={handleInviteMember}>
                      Send Invitation
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
          <Dialog
            open={isAssignTaskOpen}
            onOpenChange={(open) => {
              setIsAssignTaskOpen(open);
              if (!open) resetAssignForm();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="gradient">
                <Plus className="w-4 h-4 mr-2" />
                Assign Task
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Assign New Task</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Task Title</Label>
                  <Input
                    placeholder="Enter task title"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    placeholder="Describe the task..."
                    rows={3}
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Assign To</Label>
                    <Select value={taskAssignee} onValueChange={setTaskAssignee}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select member" />
                      </SelectTrigger>
                      <SelectContent>
                        {teamMembers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select value={taskPriority} onValueChange={setTaskPriority}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Due Date</Label>
                    <Input
                      type="date"
                      value={taskDueDate}
                      onChange={(e) => setTaskDueDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Related Asset</Label>
                    <Input
                      placeholder="e.g., api.company.com"
                      value={taskAsset}
                      onChange={(e) => setTaskAsset(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="outline" onClick={() => setIsAssignTaskOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="gradient" onClick={handleAssignTask} disabled={isSavingTask}>
                    <Send className="w-4 h-4 mr-2" />
                    {isSavingTask ? "Assigning..." : "Assign Task"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Edit Task Dialog */}
      <Dialog open={!!editingTask} onOpenChange={(open) => !open && setEditingTask(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Task Title</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={editPriority} onValueChange={setEditPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Related Asset</Label>
                <Input value={editAsset} onChange={(e) => setEditAsset(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setEditingTask(null)}>
                Cancel
              </Button>
              <Button variant="gradient" onClick={handleUpdateTask} disabled={isSavingTask}>
                {isSavingTask ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="tasks" className="space-y-6">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="members">Team Members</TabsTrigger>
          <TabsTrigger value="history">Task History</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks or assignees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Task List */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Task Cards */}
            <div className="space-y-3">
              {filteredTasks.length === 0 && (
                <div className="card-elevated p-8 text-center text-muted-foreground">
                  <Target className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>{isLoadingTeam ? "Loading tasks..." : "No tasks found."}</p>
                </div>
              )}
              {filteredTasks.map((task, index) => {
                const StatusIcon = getStatusIcon(task.status);
                return (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`card-elevated p-4 cursor-pointer transition-all hover:shadow-lg ${
                      selectedTask?.id === task.id ? "ring-2 ring-primary" : ""
                    }`}
                    onClick={() => handleSelectTask(task)}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={getPriorityColor(task.priority)}>
                          {task.priority}
                        </Badge>
                        <Badge className={getStatusColor(task.status)}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {task.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditTask(task);
                            }}
                          >
                            <Edit className="w-4 h-4 mr-2" /> Edit Task
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCompleteTask(task);
                            }}
                          >
                            <CheckCircle2 className="w-4 h-4 mr-2" /> Mark Complete
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteTask(task);
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <h4 className="font-semibold text-foreground mb-1">{task.title}</h4>
                    <p className="text-sm text-muted-foreground mb-3">{task.description}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                            {task.assignee.name.split(" ").map((n) => n[0]).join("")}
                          </AvatarFallback>
                        </Avatar>
                        <span>{task.assignee.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Due: {formatDate(task.dueDate)}
                      </div>
                    </div>
                    {task.messageCount > 0 && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <MessageSquare className="w-3 h-3" />
                        {task.messageCount} message{task.messageCount > 1 ? "s" : ""}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Task Detail / Message Panel */}
            <div className="card-elevated p-0 overflow-hidden">
              {selectedTask ? (
                <div className="flex flex-col h-[600px]">
                  {/* Task Header */}
                  <div className="p-4 border-b border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className={getPriorityColor(selectedTask.priority)}>
                        {selectedTask.priority}
                      </Badge>
                      {selectedTask.asset && (
                        <Badge variant="outline">
                          <Target className="w-3 h-3 mr-1" />
                          {selectedTask.asset}
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-semibold text-foreground text-lg">{selectedTask.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{selectedTask.description}</p>
                    <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        Created: {formatDate(selectedTask.createdAt)}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        Due: {formatDate(selectedTask.dueDate)}
                      </div>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10">
                    <AnimatePresence>
                      {taskMessages.map((msg, index) => (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="flex gap-3"
                        >
                          <Avatar className="w-8 h-8 shrink-0">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                              {msg.sender.split(" ").map((n) => n[0]).join("")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm text-foreground">{msg.sender}</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                <MessageSquare className="w-3 h-3 mr-1" />
                                {msg.platform}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ""}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground bg-card p-3 rounded-lg">
                              {msg.message}
                            </p>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {!isLoadingMessages && taskMessages.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
                        <p>No messages yet</p>
                      </div>
                    )}
                    {isLoadingMessages && (
                      <div className="text-center py-8 text-muted-foreground">Loading messages...</div>
                    )}
                  </div>

                  {/* Message Input */}
                  <div className="p-4 border-t border-border bg-card">
                    <div className="flex gap-2 mb-2">
                      <Button variant="secondary" size="sm" className="gap-1.5" disabled>
                        <MessageSquare className="w-4 h-4" />
                        Internal
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Send an internal message..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                      />
                      <Button
                        variant="gradient"
                        onClick={handleSendMessage}
                        disabled={isSendingMessage}
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[600px] text-muted-foreground">
                  <div className="text-center">
                    <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="font-medium">Select a task to view details</p>
                    <p className="text-sm">Click on any task to see messages and history</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Team Members Tab */}
        <TabsContent value="members" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                Team Members
                {isSuperadmin && <Badge variant="outline" className="text-xs">Owner</Badge>}
              </h3>
              <p className="text-sm text-muted-foreground">Active members in your organization</p>
            </div>
            <span className="text-sm text-muted-foreground">
              {isLoadingTeam ? "Loading..." : `${teamMembers.length} members`}
            </span>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {teamMembers.map((member, index) => {
              const canManage = canInvite && member.id !== currentUserId && !member.is_superadmin;
              return (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06 }}
                  className="card-elevated p-4"
                >
                  <div className="flex items-start justify-between mb-4">
                    <Avatar className="w-12 h-12">
                      {member.avatar_url && <AvatarImage src={member.avatar_url} alt={member.name} />}
                      <AvatarFallback className="bg-primary/10 text-primary font-medium">
                        {member.name?.split(" ").map((n) => n[0]).join("") || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          member.status === "active" ? "bg-success" : "bg-muted-foreground"
                        }`}
                      />
                      {member.is_superadmin && <Crown className="w-4 h-4 text-warning" />}
                      {member.is_superadmin && (
                        <Badge variant="outline" className="text-xs">Owner</Badge>
                      )}
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <UserCog className="w-4 h-4 mr-2" />
                                Change role
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {ROLE_OPTIONS.map((role) => (
                                  <DropdownMenuItem
                                    key={role}
                                    disabled={member.role === role}
                                    onClick={() => handleChangeRole(member.id, role)}
                                  >
                                    <span className="capitalize">{role}</span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleRemoveMember(member.id)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Remove Member
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  <h4 className="font-semibold text-foreground">{member.name}</h4>
                  <p className="text-sm text-muted-foreground mb-3">{member.email}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="capitalize">
                      {member.is_superadmin ? "Super Admin" : member.role}
                    </span>
                    <span className="capitalize">{member.status}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {canInvite && (
            <div className="card-elevated">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-foreground">Pending Invites</h4>
                  <p className="text-sm text-muted-foreground">Awaiting acceptance</p>
                </div>
                <Badge variant="outline">{pendingInvites.length}</Badge>
              </div>
              <div className="divide-y divide-border">
                {pendingInvites.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No pending invites.</div>
                ) : (
                  pendingInvites.map((invite) => (
                    <div key={invite.id} className="p-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-foreground">{invite.email}</p>
                        <p className="text-xs text-muted-foreground capitalize">{invite.role}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">
                          {invite.status}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRevokeInvite(invite.id)}
                        >
                          Revoke
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Task History Tab */}
        <TabsContent value="history" className="space-y-4">
          <div className="card-elevated overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                Task History
              </h3>
            </div>
            <div className="divide-y divide-border">
              {tasks.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">No tasks yet.</div>
              )}
              {tasks.map((task) => (
                <div key={task.id} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={getPriorityColor(task.priority)}>
                          {task.priority}
                        </Badge>
                        <span className="font-medium text-foreground truncate">{task.title}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          {task.assignee.name}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          Created: {formatDate(task.createdAt)}
                        </span>
                        {task.completedAt && (
                          <span className="flex items-center gap-1 text-success">
                            <CheckCircle2 className="w-4 h-4" />
                            Completed: {formatDate(task.completedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge className={getStatusColor(task.status)}>
                      {task.status.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Roles Tab — read-only reference of built-in roles */}
        <TabsContent value="roles" className="space-y-4">
          <div className="card-elevated">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Built-in Roles
              </h3>
              <p className="text-sm text-muted-foreground">
                Roles are fixed. Assign one to each member from the Team Members tab.
              </p>
            </div>
            <div className="divide-y divide-border">
              {BUILTIN_ROLES.map((role) => (
                <div key={role.name} className="p-4 flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5">{role.name}</Badge>
                  <p className="text-sm text-muted-foreground">{role.description}</p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
