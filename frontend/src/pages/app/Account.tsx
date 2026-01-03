import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
  User,
  Mail,
  Lock,
  Bell,
  Shield,
  CreditCard,
  Users,
  Building,
  Key,
  Smartphone,
  Globe,
  Trash2,
  Plus,
  Edit,
  Check,
  X,
  Crown,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const teamMembers = [
  { id: 1, name: "John Smith", email: "john@company.com", role: "Admin", status: "active", avatar: null },
  { id: 2, name: "Sarah Johnson", email: "sarah@company.com", role: "Analyst", status: "active", avatar: null },
  { id: 3, name: "Mike Chen", email: "mike@company.com", role: "Reader", status: "pending", avatar: null },
];

const billingHistory = [
  { id: 1, date: "Jan 1, 2024", description: "Pro Plan - Monthly", amount: "$299.00", status: "paid" },
  { id: 2, date: "Dec 1, 2023", description: "Pro Plan - Monthly", amount: "$299.00", status: "paid" },
  { id: 3, date: "Nov 1, 2023", description: "Pro Plan - Monthly", amount: "$299.00", status: "paid" },
];

export default function Account() {
  const [profile, setProfile] = useState({
    name: "John Smith",
    email: "john@company.com",
    company: "Acme Corp",
    role: "Security Manager",
    phone: "+1 (555) 123-4567",
  });

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    criticalOnly: false,
    weeklyDigest: true,
    slackNotifications: true,
    smsAlerts: false,
  });

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("analyst");

  const handleSaveProfile = () => {
    toast({
      title: "Profile Updated",
      description: "Your profile has been saved successfully.",
    });
  };

  const handleInvite = () => {
    toast({
      title: "Invitation Sent",
      description: `Invitation sent to ${inviteEmail}`,
    });
    setIsInviteOpen(false);
    setInviteEmail("");
  };

  const handleRemoveMember = (name: string) => {
    toast({
      title: "Member Removed",
      description: `${name} has been removed from the team.`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Account Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account, team, and billing</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-6">Personal Information</h3>
            <div className="flex items-start gap-6 mb-6">
              <Avatar className="w-20 h-20">
                <AvatarImage src="" />
                <AvatarFallback className="text-xl bg-primary text-primary-foreground">JS</AvatarFallback>
              </Avatar>
              <div>
                <Button variant="outline" size="sm">Change Photo</Button>
                <p className="text-xs text-muted-foreground mt-2">JPG, PNG or GIF. Max 2MB.</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input 
                  value={profile.name} 
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input 
                  type="email" 
                  value={profile.email}
                  onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Input 
                  value={profile.company}
                  onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Input 
                  value={profile.role}
                  onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input 
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select defaultValue="pst">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pst">Pacific Time (PST)</SelectItem>
                    <SelectItem value="est">Eastern Time (EST)</SelectItem>
                    <SelectItem value="utc">UTC</SelectItem>
                    <SelectItem value="ist">India Standard Time (IST)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <Button variant="gradient" onClick={handleSaveProfile}>
                Save Changes
              </Button>
            </div>
          </motion.div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4">Password</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Current Password</Label>
                <Input type="password" placeholder="••••••••" />
              </div>
              <div></div>
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input type="password" placeholder="••••••••" />
              </div>
              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <Input type="password" placeholder="••••••••" />
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <Button variant="outline" onClick={() => toast({ title: "Password Updated" })}>
                Update Password
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card-elevated p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-foreground">Two-Factor Authentication</h3>
                <p className="text-sm text-muted-foreground">Add an extra layer of security to your account</p>
              </div>
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">Not Enabled</Badge>
            </div>
            <Button variant="outline">
              <Smartphone className="w-4 h-4 mr-2" />
              Enable 2FA
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4">API Keys</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <Key className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">Production API Key</div>
                    <div className="text-xs text-muted-foreground">Created Dec 15, 2023</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm">Reveal</Button>
                  <Button variant="ghost" size="sm" className="text-destructive">Revoke</Button>
                </div>
              </div>
            </div>
            <Button variant="outline" className="mt-4">
              <Plus className="w-4 h-4 mr-2" />
              Generate New API Key
            </Button>
          </motion.div>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-6">Notification Preferences</h3>
            <div className="space-y-6">
              {[
                { key: "emailAlerts", label: "Email Alerts", description: "Receive security alerts via email", icon: Mail },
                { key: "criticalOnly", label: "Critical Only", description: "Only receive critical severity alerts", icon: Shield },
                { key: "weeklyDigest", label: "Weekly Digest", description: "Weekly summary of security findings", icon: Bell },
                { key: "slackNotifications", label: "Slack Notifications", description: "Send alerts to Slack channels", icon: Globe },
                { key: "smsAlerts", label: "SMS Alerts", description: "Receive SMS for critical alerts", icon: Smartphone },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{item.label}</div>
                      <div className="text-sm text-muted-foreground">{item.description}</div>
                    </div>
                  </div>
                  <Switch 
                    checked={notifications[item.key as keyof typeof notifications]}
                    onCheckedChange={(checked) => 
                      setNotifications({ ...notifications, [item.key]: checked })
                    }
                  />
                </div>
              ))}
            </div>
          </motion.div>
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-semibold text-foreground">Team Members</h3>
                <p className="text-sm text-muted-foreground">Manage access for your team</p>
              </div>
              <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
                <DialogTrigger asChild>
                  <Button variant="gradient">
                    <Plus className="w-4 h-4 mr-2" />
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
                          <SelectItem value="admin">Admin - Full access</SelectItem>
                          <SelectItem value="analyst">Analyst - View and edit</SelectItem>
                          <SelectItem value="reader">Reader - View only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                      <Button variant="outline" onClick={() => setIsInviteOpen(false)}>Cancel</Button>
                      <Button variant="gradient" onClick={handleInvite}>Send Invitation</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="space-y-3">
              {teamMembers.map((member) => (
                <div 
                  key={member.id}
                  className="flex items-center justify-between p-4 bg-muted/20 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {member.name.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{member.name}</span>
                        {member.role === "Admin" && <Crown className="w-4 h-4 text-warning" />}
                      </div>
                      <div className="text-sm text-muted-foreground">{member.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={member.status === "active" ? "secondary" : "outline"}>
                      {member.status}
                    </Badge>
                    <Select defaultValue={member.role.toLowerCase()}>
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="analyst">Analyst</SelectItem>
                        <SelectItem value="reader">Reader</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="text-destructive"
                      onClick={() => handleRemoveMember(member.name)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="font-semibold text-foreground">Current Plan</h3>
                <p className="text-sm text-muted-foreground">You are currently on the Pro plan</p>
              </div>
              <Badge className="bg-primary text-primary-foreground">Pro Plan</Badge>
            </div>
            <div className="grid sm:grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-muted/30 rounded-lg">
                <div className="text-2xl font-bold text-foreground">$299</div>
                <div className="text-sm text-muted-foreground">per month</div>
              </div>
              <div className="p-4 bg-muted/30 rounded-lg">
                <div className="text-2xl font-bold text-foreground">50</div>
                <div className="text-sm text-muted-foreground">assets included</div>
              </div>
              <div className="p-4 bg-muted/30 rounded-lg">
                <div className="text-2xl font-bold text-foreground">5</div>
                <div className="text-sm text-muted-foreground">team members</div>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="gradient">Upgrade to Enterprise</Button>
              <Button variant="outline">Manage Subscription</Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4">Payment Method</h3>
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="font-medium text-foreground">Visa ending in 4242</div>
                  <div className="text-sm text-muted-foreground">Expires 12/25</div>
                </div>
              </div>
              <Button variant="outline" size="sm">Update</Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4">Billing History</h3>
            <div className="space-y-3">
              {billingHistory.map((item) => (
                <div 
                  key={item.id}
                  className="flex items-center justify-between p-3 border-b border-border last:border-0"
                >
                  <div>
                    <div className="font-medium text-foreground">{item.description}</div>
                    <div className="text-sm text-muted-foreground">{item.date}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-foreground">{item.amount}</span>
                    <Badge variant="secondary" className="bg-success/10 text-success">
                      <Check className="w-3 h-3 mr-1" />
                      {item.status}
                    </Badge>
                    <Button variant="ghost" size="sm">Download</Button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
