import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings,
  Shield,
  Clock,
  Bell,
  Key,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Save,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function VSSettings() {
  const [settings, setSettings] = useState({
    severityThresholds: {
      critical: 9.0,
      high: 7.0,
      medium: 4.0,
    },
    slaHours: {
      critical: 24,
      high: 72,
      medium: 168,
      low: 720,
    },
    notifications: {
      criticalFindings: true,
      scanComplete: true,
      slaWarning: true,
      weeklyDigest: false,
    },
    scanning: {
      maxConcurrent: 3,
      timeout: 30,
      retryAttempts: 2,
    },
    falsePositive: {
      autoSuppress: false,
      suppressDays: 30,
    },
  });

  const handleSave = () => {
    toast({ title: "Settings Saved", description: "Your scan settings have been updated" });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Scan Settings</h2>
          <p className="text-sm text-muted-foreground">Configure vulnerability scanning preferences</p>
        </div>
        <Button variant="gradient" onClick={handleSave}>
          <Save className="w-4 h-4 mr-2" />
          Save Changes
        </Button>
      </div>

      {/* Severity Thresholds */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card rounded-2xl border border-border p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-primary/10">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Severity Thresholds</h3>
            <p className="text-sm text-muted-foreground">CVSS score thresholds for severity classification</p>
          </div>
        </div>
        <div className="space-y-6">
          {[
            { label: "Critical", key: "critical", color: "text-destructive", min: 8, max: 10 },
            { label: "High", key: "high", color: "text-warning", min: 5, max: 9 },
            { label: "Medium", key: "medium", color: "text-accent", min: 2, max: 7 },
          ].map((threshold) => (
            <div key={threshold.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className={threshold.color}>{threshold.label}</Label>
                <span className="text-sm font-mono">
                  ≥ {settings.severityThresholds[threshold.key as keyof typeof settings.severityThresholds].toFixed(1)}
                </span>
              </div>
              <Slider
                value={[settings.severityThresholds[threshold.key as keyof typeof settings.severityThresholds]]}
                min={threshold.min}
                max={threshold.max}
                step={0.1}
                onValueChange={([value]) => setSettings({
                  ...settings,
                  severityThresholds: { ...settings.severityThresholds, [threshold.key]: value }
                })}
              />
            </div>
          ))}
        </div>
      </motion.div>

      {/* SLA Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-card rounded-2xl border border-border p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-accent/10">
            <Clock className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">SLA Configuration</h3>
            <p className="text-sm text-muted-foreground">Remediation time limits by severity</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            { label: "Critical", key: "critical", color: "border-destructive/30" },
            { label: "High", key: "high", color: "border-warning/30" },
            { label: "Medium", key: "medium", color: "border-accent/30" },
            { label: "Low", key: "low", color: "border-success/30" },
          ].map((sla) => (
            <div key={sla.key} className={cn("p-4 rounded-xl border-2", sla.color)}>
              <Label className="text-sm mb-2 block">{sla.label} SLA (hours)</Label>
              <Input
                type="number"
                value={settings.slaHours[sla.key as keyof typeof settings.slaHours]}
                onChange={(e) => setSettings({
                  ...settings,
                  slaHours: { ...settings.slaHours, [sla.key]: parseInt(e.target.value) || 0 }
                })}
              />
            </div>
          ))}
        </div>
      </motion.div>

      {/* Notifications */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-card rounded-2xl border border-border p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-secondary/10">
            <Bell className="w-5 h-5 text-secondary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Notifications</h3>
            <p className="text-sm text-muted-foreground">Configure alert preferences</p>
          </div>
        </div>
        <div className="space-y-4">
          {[
            { label: "Critical findings detected", key: "criticalFindings", description: "Alert when critical vulnerabilities are found" },
            { label: "Scan completion", key: "scanComplete", description: "Notify when scans finish" },
            { label: "SLA warning", key: "slaWarning", description: "Alert before SLA deadline" },
            { label: "Weekly digest", key: "weeklyDigest", description: "Summary of findings each week" },
          ].map((notification) => (
            <div key={notification.key} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div>
                <div className="font-medium text-sm">{notification.label}</div>
                <div className="text-xs text-muted-foreground">{notification.description}</div>
              </div>
              <Switch
                checked={settings.notifications[notification.key as keyof typeof settings.notifications]}
                onCheckedChange={(checked) => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, [notification.key]: checked }
                })}
              />
            </div>
          ))}
        </div>
      </motion.div>

      {/* Scan Performance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-card rounded-2xl border border-border p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-primary/10">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Scan Performance</h3>
            <p className="text-sm text-muted-foreground">Tune scanning behavior</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Max Concurrent Scans</Label>
            <Select 
              value={settings.scanning.maxConcurrent.toString()}
              onValueChange={(v) => setSettings({
                ...settings,
                scanning: { ...settings.scanning, maxConcurrent: parseInt(v) }
              })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 5, 10].map(n => (
                  <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Timeout (minutes)</Label>
            <Input
              type="number"
              value={settings.scanning.timeout}
              onChange={(e) => setSettings({
                ...settings,
                scanning: { ...settings.scanning, timeout: parseInt(e.target.value) || 30 }
              })}
            />
          </div>
          <div className="space-y-2">
            <Label>Retry Attempts</Label>
            <Select 
              value={settings.scanning.retryAttempts.toString()}
              onValueChange={(v) => setSettings({
                ...settings,
                scanning: { ...settings.scanning, retryAttempts: parseInt(v) }
              })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3, 5].map(n => (
                  <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </motion.div>

      {/* False Positive Management */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-card rounded-2xl border border-border p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-warning/10">
            <AlertTriangle className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">False Positive Management</h3>
            <p className="text-sm text-muted-foreground">Suppress recurring false positives</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
            <div>
              <div className="font-medium text-sm">Auto-suppress repeated findings</div>
              <div className="text-xs text-muted-foreground">Automatically suppress findings marked as false positive</div>
            </div>
            <Switch
              checked={settings.falsePositive.autoSuppress}
              onCheckedChange={(checked) => setSettings({
                ...settings,
                falsePositive: { ...settings.falsePositive, autoSuppress: checked }
              })}
            />
          </div>
          {settings.falsePositive.autoSuppress && (
            <div className="space-y-2 pl-4">
              <Label>Suppression Duration (days)</Label>
              <Input
                type="number"
                value={settings.falsePositive.suppressDays}
                onChange={(e) => setSettings({
                  ...settings,
                  falsePositive: { ...settings.falsePositive, suppressDays: parseInt(e.target.value) || 30 }
                })}
                className="max-w-[200px]"
              />
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}