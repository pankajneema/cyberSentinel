import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
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
  ExternalLink,
  History,
  Calendar,
  Target,
  Slack,
  Mail,
  Filter,
  ArrowUpRight,
  PlayCircle,
  PauseCircle,
  XCircle,
  UserPlus,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/use-toast";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Analyst" | "Reader";
  status: "active" | "pending" | "offline";
  avatar?: string;
  tasksAssigned: number;
  tasksCompleted: number;
  lastActive: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed" | "overdue";
  assignee: TeamMember;
  createdAt: string;
  dueDate: string;
  completedAt?: string;
  asset?: string;
  messages: TaskMessage[];
}

interface TaskMessage {
  id: string;
  sender: string;
  message: string;
  timestamp: string;
  platform: "internal" | "slack" | "jira" | "email";
}

const mockTeamMembers: TeamMember[] = [
  { id: "1", name: "John Smith", email: "john@company.com", role: "Admin", status: "active", tasksAssigned: 12, tasksCompleted: 8, lastActive: "Now" },
  { id: "2", name: "Sarah Johnson", email: "sarah@company.com", role: "Analyst", status: "active", tasksAssigned: 18, tasksCompleted: 15, lastActive: "5 min ago" },
  { id: "3", name: "Mike Chen", email: "mike@company.com", role: "Analyst", status: "offline", tasksAssigned: 10, tasksCompleted: 10, lastActive: "2 hours ago" },
  { id: "4", name: "Emily Davis", email: "emily@company.com", role: "Reader", status: "pending", tasksAssigned: 5, tasksCompleted: 2, lastActive: "1 day ago" },
];

const mockTasks: Task[] = [
  {
    id: "1",
    title: "Patch CVE-2024-1234 on web server",
    description: "Critical vulnerability requires immediate attention",
    priority: "critical",
    status: "in_progress",
    assignee: mockTeamMembers[1],
    createdAt: "2024-01-10T10:00:00",
    dueDate: "2024-01-12T18:00:00",
    asset: "api.company.com",
    messages: [
      { id: "1", sender: "John Smith", message: "Assigned this critical task - needs immediate attention", timestamp: "2024-01-10T10:05:00", platform: "internal" },
      { id: "2", sender: "Sarah Johnson", message: "Working on it now, will update in 2 hours", timestamp: "2024-01-10T11:30:00", platform: "slack" },
    ],
  },
  {
    id: "2",
    title: "Update TLS configuration",
    description: "Upgrade to TLS 1.3 across all endpoints",
    priority: "high",
    status: "pending",
    assignee: mockTeamMembers[2],
    createdAt: "2024-01-09T14:00:00",
    dueDate: "2024-01-15T18:00:00",
    asset: "*.company.com",
    messages: [
      { id: "1", sender: "John Smith", message: "Please prioritize after current task", timestamp: "2024-01-09T14:05:00", platform: "jira" },
    ],
  },
  {
    id: "3",
    title: "Review firewall rules",
    description: "Audit and optimize current firewall configuration",
    priority: "medium",
    status: "completed",
    assignee: mockTeamMembers[0],
    createdAt: "2024-01-05T09:00:00",
    dueDate: "2024-01-08T18:00:00",
    completedAt: "2024-01-07T16:30:00",
    messages: [
      { id: "1", sender: "Mike Chen", message: "Completed review, found 3 redundant rules", timestamp: "2024-01-07T16:30:00", platform: "internal" },
    ],
  },
  {
    id: "4",
    title: "Fix SQL injection vulnerability",
    description: "Address SQLi in login form",
    priority: "critical",
    status: "overdue",
    assignee: mockTeamMembers[3],
    createdAt: "2024-01-01T10:00:00",
    dueDate: "2024-01-05T18:00:00",
    messages: [],
  },
];

const integrations = [
  { id: "slack", name: "Slack", icon: Slack, connected: true, workspace: "#security-alerts" },
  { id: "jira", name: "Jira", icon: ExternalLink, connected: true, workspace: "SEC-Project" },
  { id: "email", name: "Email", icon: Mail, connected: true, workspace: "notifications@company.com" },
];

export default function Team() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isAssignTaskOpen, setIsAssignTaskOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [messagePlatform, setMessagePlatform] = useState<string>("internal");

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedTask) return;
    
    toast({
      title: "Message Sent",
      description: `Message sent via ${messagePlatform === "slack" ? "Slack" : messagePlatform === "jira" ? "Jira" : messagePlatform === "email" ? "Email" : "Internal"}`,
    });
    setNewMessage("");
  };

  const handleAssignTask = (memberId: string) => {
    toast({
      title: "Task Assigned",
      description: "Task has been assigned successfully",
    });
    setIsAssignTaskOpen(false);
  };

  const filteredTasks = mockTasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         task.assignee.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || task.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical": return "bg-destructive/10 text-destructive border-destructive/20";
      case "high": return "bg-warning/10 text-warning border-warning/20";
      case "medium": return "bg-accent/10 text-accent border-accent/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-success/10 text-success";
      case "in_progress": return "bg-primary/10 text-primary";
      case "overdue": return "bg-destructive/10 text-destructive";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return CheckCircle2;
      case "in_progress": return PlayCircle;
      case "overdue": return AlertCircle;
      default: return PauseCircle;
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case "slack": return Slack;
      case "jira": return ExternalLink;
      case "email": return Mail;
      default: return MessageSquare;
    }
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
                  <Input type="email" placeholder="colleague@company.com" />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select defaultValue="analyst">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin - Full access</SelectItem>
                      <SelectItem value="analyst">Analyst - View and edit</SelectItem>
                      <SelectItem value="reader">Reader - View only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="outline" onClick={() => setIsInviteOpen(false)}>Cancel</Button>
                  <Button variant="gradient" onClick={() => { setIsInviteOpen(false); toast({ title: "Invitation Sent" }); }}>
                    Send Invitation
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={isAssignTaskOpen} onOpenChange={setIsAssignTaskOpen}>
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
                  <Input placeholder="Enter task title" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea placeholder="Describe the task..." rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Assign To</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select member" />
                      </SelectTrigger>
                      <SelectContent>
                        {mockTeamMembers.map(member => (
                          <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select defaultValue="medium">
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
                    <Input type="date" />
                  </div>
                  <div className="space-y-2">
                    <Label>Related Asset</Label>
                    <Input placeholder="e.g., api.company.com" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notify Via</Label>
                  <div className="flex gap-2">
                    {integrations.filter(i => i.connected).map(integration => (
                      <Button key={integration.id} variant="outline" size="sm" className="gap-2">
                        <integration.icon className="w-4 h-4" />
                        {integration.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="outline" onClick={() => setIsAssignTaskOpen(false)}>Cancel</Button>
                  <Button variant="gradient" onClick={() => handleAssignTask("")}>
                    <Send className="w-4 h-4 mr-2" />
                    Assign Task
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="tasks" className="space-y-6">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="members">Team Members</TabsTrigger>
          <TabsTrigger value="history">Task History</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
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
              {filteredTasks.map((task, index) => {
                const StatusIcon = getStatusIcon(task.status);
                return (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`card-elevated p-4 cursor-pointer transition-all hover:shadow-lg ${selectedTask?.id === task.id ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setSelectedTask(task)}
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
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem><Edit className="w-4 h-4 mr-2" /> Edit Task</DropdownMenuItem>
                          <DropdownMenuItem><CheckCircle2 className="w-4 h-4 mr-2" /> Mark Complete</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive"><Trash2 className="w-4 h-4 mr-2" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <h4 className="font-semibold text-foreground mb-1">{task.title}</h4>
                    <p className="text-sm text-muted-foreground mb-3">{task.description}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                            {task.assignee.name.split(' ').map(n => n[0]).join('')}
                          </AvatarFallback>
                        </Avatar>
                        <span>{task.assignee.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Due: {new Date(task.dueDate).toLocaleDateString()}
                      </div>
                    </div>
                    {task.messages.length > 0 && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <MessageSquare className="w-3 h-3" />
                        {task.messages.length} message{task.messages.length > 1 ? 's' : ''}
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
                        Created: {new Date(selectedTask.createdAt).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        Due: {new Date(selectedTask.dueDate).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10">
                    <AnimatePresence>
                      {selectedTask.messages.map((msg, index) => {
                        const PlatformIcon = getPlatformIcon(msg.platform);
                        return (
                          <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className="flex gap-3"
                          >
                            <Avatar className="w-8 h-8 shrink-0">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {msg.sender.split(' ').map(n => n[0]).join('')}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm text-foreground">{msg.sender}</span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  <PlatformIcon className="w-3 h-3 mr-1" />
                                  {msg.platform}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(msg.timestamp).toLocaleString()}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground bg-card p-3 rounded-lg">
                                {msg.message}
                              </p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                    {selectedTask.messages.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
                        <p>No messages yet</p>
                      </div>
                    )}
                  </div>

                  {/* Message Input */}
                  <div className="p-4 border-t border-border bg-card">
                    <div className="flex gap-2 mb-2">
                      {integrations.filter(i => i.connected).map(integration => (
                        <Button
                          key={integration.id}
                          variant={messagePlatform === integration.id ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => setMessagePlatform(integration.id)}
                          className="gap-1.5"
                        >
                          <integration.icon className="w-4 h-4" />
                          {integration.name}
                        </Button>
                      ))}
                      <Button
                        variant={messagePlatform === "internal" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setMessagePlatform("internal")}
                        className="gap-1.5"
                      >
                        <MessageSquare className="w-4 h-4" />
                        Internal
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder={`Send message via ${messagePlatform}...`}
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      />
                      <Button variant="gradient" onClick={handleSendMessage}>
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
        <TabsContent value="members" className="space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {mockTeamMembers.map((member, index) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="card-elevated p-4"
              >
                <div className="flex items-start justify-between mb-4">
                  <Avatar className="w-12 h-12">
                    <AvatarFallback className="bg-primary/10 text-primary font-medium">
                      {member.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      member.status === 'active' ? 'bg-success' :
                      member.status === 'pending' ? 'bg-warning' : 'bg-muted-foreground'
                    }`} />
                    {member.role === "Admin" && <Crown className="w-4 h-4 text-warning" />}
                  </div>
                </div>
                <h4 className="font-semibold text-foreground">{member.name}</h4>
                <p className="text-sm text-muted-foreground mb-3">{member.email}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                  <span>{member.role}</span>
                  <span>{member.lastActive}</span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Task Progress</span>
                    <span className="text-foreground font-medium">{member.tasksCompleted}/{member.tasksAssigned}</span>
                  </div>
                  <Progress value={(member.tasksCompleted / member.tasksAssigned) * 100} className="h-1.5" />
                </div>
              </motion.div>
            ))}
          </div>
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
              {mockTasks.map((task) => (
                <div key={task.id} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={getPriorityColor(task.priority)} >
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
                          Created: {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                        {task.completedAt && (
                          <span className="flex items-center gap-1 text-success">
                            <CheckCircle2 className="w-4 h-4" />
                            Completed: {new Date(task.completedAt).toLocaleDateString()}
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

        {/* Integrations Tab */}
        <TabsContent value="integrations" className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            {integrations.map((integration, index) => (
              <motion.div
                key={integration.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="card-elevated p-4"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <integration.icon className="w-6 h-6 text-primary" />
                  </div>
                  <Badge variant={integration.connected ? "secondary" : "outline"}>
                    {integration.connected ? "Connected" : "Not Connected"}
                  </Badge>
                </div>
                <h4 className="font-semibold text-foreground mb-1">{integration.name}</h4>
                <p className="text-sm text-muted-foreground mb-4">{integration.workspace}</p>
                <Button variant="outline" size="sm" className="w-full">
                  {integration.connected ? "Configure" : "Connect"}
                </Button>
              </motion.div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}