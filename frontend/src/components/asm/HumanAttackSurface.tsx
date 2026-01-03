import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SeverityBadge } from "./SeverityBadge";
import { RiskGauge } from "./RiskGauge";
import { EmptyState } from "./EmptyState";
import {
  Search,
  Download,
  Users,
  Mail,
  AlertTriangle,
  Shield,
  Eye,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Send,
  Lock,
  Github,
  Linkedin,
} from "lucide-react";
import { motion } from "framer-motion";

const employees = [
  { id: 1, name: "John Doe", email: "john.doe@company.com", department: "Engineering", exposedEmails: 3, breachedPasswords: 2, socialExposure: "high", riskScore: 85, phishingProb: 78 },
  { id: 2, name: "Sarah Miller", email: "sarah.m@company.com", department: "Marketing", exposedEmails: 1, breachedPasswords: 0, socialExposure: "medium", riskScore: 45, phishingProb: 52 },
  { id: 3, name: "Mike Johnson", email: "mike.j@company.com", department: "Sales", exposedEmails: 5, breachedPasswords: 3, socialExposure: "high", riskScore: 92, phishingProb: 88 },
  { id: 4, name: "Emily Chen", email: "emily.c@company.com", department: "Engineering", exposedEmails: 0, breachedPasswords: 0, socialExposure: "low", riskScore: 15, phishingProb: 22 },
  { id: 5, name: "David Wilson", email: "david.w@company.com", department: "Finance", exposedEmails: 2, breachedPasswords: 1, socialExposure: "medium", riskScore: 58, phishingProb: 61 },
  { id: 6, name: "Lisa Brown", email: "lisa.b@company.com", department: "HR", exposedEmails: 4, breachedPasswords: 2, socialExposure: "high", riskScore: 76, phishingProb: 72 },
];

export function HumanAttackSurface() {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEmployees = employees.filter(
    (emp) =>
      emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = {
    totalEmployees: employees.length,
    atRisk: employees.filter(e => e.riskScore >= 60).length,
    breachedPasswords: employees.reduce((sum, e) => sum + e.breachedPasswords, 0),
    exposedEmails: employees.reduce((sum, e) => sum + e.exposedEmails, 0),
  };

  const getSocialExposureColor = (level: string) => {
    switch (level) {
      case "high": return "text-destructive bg-destructive/10";
      case "medium": return "text-warning bg-warning/10";
      default: return "text-success bg-success/10";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Human Attack Surface</h2>
          <p className="text-sm text-muted-foreground">Monitor employee exposure and credential risks</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
          <Button variant="gradient">
            <RefreshCw className="w-4 h-4 mr-2" />
            Scan Now
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Total Employees", value: stats.totalEmployees, icon: Users, variant: "default" as const },
          { label: "At Risk", value: stats.atRisk, icon: AlertTriangle, variant: "critical" as const },
          { label: "Breached Passwords", value: stats.breachedPasswords, icon: Lock, variant: "warning" as const },
          { label: "Exposed Emails", value: stats.exposedEmails, icon: Mail, variant: "warning" as const },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`p-5 rounded-xl border ${
              stat.variant === "critical" ? "border-destructive/30 bg-destructive/5" :
              stat.variant === "warning" ? "border-warning/30 bg-warning/5" : "border-border bg-card"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <stat.icon className={`w-5 h-5 ${
                stat.variant === "critical" ? "text-destructive" :
                stat.variant === "warning" ? "text-warning" : "text-primary"
              }`} />
            </div>
            <div className="text-2xl font-bold text-foreground">{stat.value}</div>
            <div className="text-sm text-muted-foreground">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Phishing Probability Chart */}
      <div className="grid lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="card-elevated p-6"
        >
          <h3 className="font-semibold text-foreground mb-4">Phishing Risk Distribution</h3>
          <div className="flex justify-center mb-4">
            <RiskGauge score={68} size="lg" />
          </div>
          <div className="text-center text-sm text-muted-foreground">
            Average phishing probability across organization
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="text-center p-2 bg-success/10 rounded-lg">
              <div className="text-lg font-bold text-success">2</div>
              <div className="text-xs text-muted-foreground">Low Risk</div>
            </div>
            <div className="text-center p-2 bg-warning/10 rounded-lg">
              <div className="text-lg font-bold text-warning">2</div>
              <div className="text-xs text-muted-foreground">Medium</div>
            </div>
            <div className="text-center p-2 bg-destructive/10 rounded-lg">
              <div className="text-lg font-bold text-destructive">2</div>
              <div className="text-xs text-muted-foreground">High Risk</div>
            </div>
          </div>
        </motion.div>

        {/* Social Exposure */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 card-elevated p-6"
        >
          <h3 className="font-semibold text-foreground mb-4">Social Media Exposure</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <Linkedin className="w-5 h-5 text-[#0A66C2]" />
                <span className="font-medium">LinkedIn</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Profiles Found</span>
                  <span className="font-medium">42</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Sensitive Info Exposed</span>
                  <span className="font-medium text-warning">12</span>
                </div>
              </div>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <Github className="w-5 h-5" />
                <span className="font-medium">GitHub</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Public Repos</span>
                  <span className="font-medium">28</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Leaked Secrets</span>
                  <span className="font-medium text-destructive">3</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search employees..."
          className="pl-10"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Employee List */}
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/30">
              <tr className="text-left text-sm text-muted-foreground">
                <th className="p-4 font-medium">Employee</th>
                <th className="p-4 font-medium">Department</th>
                <th className="p-4 font-medium">Exposed Emails</th>
                <th className="p-4 font-medium">Breached PWs</th>
                <th className="p-4 font-medium">Social Exposure</th>
                <th className="p-4 font-medium">Risk Score</th>
                <th className="p-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <motion.tr
                  key={employee.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="border-t border-border hover:bg-muted/20 transition-colors"
                >
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-medium text-primary">
                          {employee.name.split(" ").map(n => n[0]).join("")}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{employee.name}</div>
                        <div className="text-xs text-muted-foreground">{employee.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">{employee.department}</td>
                  <td className="p-4">
                    {employee.exposedEmails > 0 ? (
                      <span className="text-warning font-medium">{employee.exposedEmails}</span>
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    )}
                  </td>
                  <td className="p-4">
                    {employee.breachedPasswords > 0 ? (
                      <span className="text-destructive font-medium">{employee.breachedPasswords}</span>
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    )}
                  </td>
                  <td className="p-4">
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${getSocialExposureColor(employee.socialExposure)}`}>
                      {employee.socialExposure}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-10 h-2 rounded-full overflow-hidden bg-muted`}>
                        <div
                          className={`h-full rounded-full ${
                            employee.riskScore >= 70 ? "bg-destructive" :
                            employee.riskScore >= 40 ? "bg-warning" : "bg-success"
                          }`}
                          style={{ width: `${employee.riskScore}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">{employee.riskScore}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Mark as Safe">
                        <Shield className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Request Password Reset">
                        <Lock className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Notify Employee">
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredEmployees.length === 0 && (
          <EmptyState
            icon={Users}
            title="No employees found"
            description="No employees match your search criteria."
          />
        )}
      </div>
    </div>
  );
}
