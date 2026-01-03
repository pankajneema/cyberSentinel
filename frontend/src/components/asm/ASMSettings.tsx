import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Settings,
  Bell,
  Shield,
  AlertTriangle,
  Zap,
  Tag,
  X,
  Plus,
  Save,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";

export function ASMSettings() {
  const [criticalThreshold, setCriticalThreshold] = useState([80]);
  const [highThreshold, setHighThreshold] = useState([60]);
  const [mediumThreshold, setMediumThreshold] = useState([40]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">ASM Settings</h2>
          <p className="text-sm text-muted-foreground">Configure your attack surface management preferences</p>
        </div>
        <Button variant="gradient">
          <Save className="w-4 h-4 mr-2" />
          Save Changes
        </Button>
      </div>

      <Tabs defaultValue="scoring">
        <TabsList>
          <TabsTrigger value="scoring">Risk Scoring</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="suppression">Suppression</TabsTrigger>
          <TabsTrigger value="grouping">Asset Grouping</TabsTrigger>
        </TabsList>

        <TabsContent value="scoring" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Risk Score Thresholds
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Configure the score thresholds for severity classification
            </p>

            <div className="space-y-8">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-destructive font-medium">Critical Threshold</Label>
                  <span className="text-sm font-mono bg-destructive/10 text-destructive px-2 py-0.5 rounded">
                    ≥ {criticalThreshold[0]}
                  </span>
                </div>
                <Slider
                  value={criticalThreshold}
                  onValueChange={setCriticalThreshold}
                  min={0}
                  max={100}
                  step={5}
                  className="[&_[role=slider]]:bg-destructive"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-warning font-medium">High Threshold</Label>
                  <span className="text-sm font-mono bg-warning/10 text-warning px-2 py-0.5 rounded">
                    ≥ {highThreshold[0]}
                  </span>
                </div>
                <Slider
                  value={highThreshold}
                  onValueChange={setHighThreshold}
                  min={0}
                  max={100}
                  step={5}
                  className="[&_[role=slider]]:bg-warning"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-accent font-medium">Medium Threshold</Label>
                  <span className="text-sm font-mono bg-accent/10 text-accent px-2 py-0.5 rounded">
                    ≥ {mediumThreshold[0]}
                  </span>
                </div>
                <Slider
                  value={mediumThreshold}
                  onValueChange={setMediumThreshold}
                  min={0}
                  max={100}
                  step={5}
                  className="[&_[role=slider]]:bg-accent"
                />
              </div>
            </div>

            <div className="mt-6 p-4 bg-muted/30 rounded-lg">
              <div className="text-sm font-medium mb-2">Preview</div>
              <div className="flex gap-2">
                <span className="text-xs px-3 py-1 bg-destructive/10 text-destructive rounded-full">
                  Critical: {criticalThreshold[0]}-100
                </span>
                <span className="text-xs px-3 py-1 bg-warning/10 text-warning rounded-full">
                  High: {highThreshold[0]}-{criticalThreshold[0] - 1}
                </span>
                <span className="text-xs px-3 py-1 bg-accent/10 text-accent rounded-full">
                  Medium: {mediumThreshold[0]}-{highThreshold[0] - 1}
                </span>
                <span className="text-xs px-3 py-1 bg-success/10 text-success rounded-full">
                  Low: 0-{mediumThreshold[0] - 1}
                </span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4">Scoring Factors</h3>
            <div className="space-y-4">
              {[
                { label: "CVSS Score Weight", value: 40 },
                { label: "Exploitability Weight", value: 25 },
                { label: "Asset Criticality Weight", value: 20 },
                { label: "Exposure Level Weight", value: 15 },
              ].map((factor) => (
                <div key={factor.label} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{factor.label}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${factor.value}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono w-10 text-right">{factor.value}%</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Notification Rules
            </h3>

            <div className="space-y-4">
              {[
                { label: "Critical findings", description: "Notify immediately for critical severity findings", enabled: true },
                { label: "High findings", description: "Notify for high severity findings", enabled: true },
                { label: "New assets discovered", description: "Alert when new assets are found", enabled: true },
                { label: "Scan completed", description: "Notify when scans finish", enabled: false },
                { label: "Daily summary", description: "Send daily digest of findings", enabled: true },
                { label: "Weekly report", description: "Send weekly executive summary", enabled: true },
              ].map((rule) => (
                <div key={rule.label} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">{rule.label}</div>
                    <div className="text-sm text-muted-foreground">{rule.description}</div>
                  </div>
                  <Switch defaultChecked={rule.enabled} />
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4">Notification Channels</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Email Recipients</Label>
                <Input placeholder="security@company.com, ciso@company.com" />
              </div>
              <div className="space-y-2">
                <Label>Slack Webhook URL</Label>
                <Input placeholder="https://hooks.slack.com/..." type="password" />
              </div>
              <div className="space-y-2">
                <Label>Microsoft Teams Webhook</Label>
                <Input placeholder="https://outlook.office.com/webhook/..." type="password" />
              </div>
            </div>
          </motion.div>
        </TabsContent>

        <TabsContent value="automation" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Auto-Remediation
            </h3>

            <div className="space-y-4">
              {[
                { label: "Auto-create Jira tickets", description: "Automatically create tickets for critical findings", enabled: true },
                { label: "Auto-assign findings", description: "Assign findings to asset owners automatically", enabled: true },
                { label: "Auto-verify fixes", description: "Re-scan after fixes are marked complete", enabled: true },
                { label: "Auto-close stale findings", description: "Close findings not seen in 30 days", enabled: false },
              ].map((rule) => (
                <div key={rule.label} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">{rule.label}</div>
                    <div className="text-sm text-muted-foreground">{rule.description}</div>
                  </div>
                  <Switch defaultChecked={rule.enabled} />
                </div>
              ))}
            </div>
          </motion.div>
        </TabsContent>

        <TabsContent value="suppression" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-primary" />
              Suppression Rules
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Define rules to automatically suppress false positives or accepted risks
            </p>

            <div className="space-y-4">
              {[
                { pattern: "*.internal.company.com", reason: "Internal assets - accepted risk", expires: "Never" },
                { pattern: "CVE-2021-44228", reason: "Mitigated via WAF", expires: "2024-06-01" },
                { pattern: "dev-*", reason: "Development environment", expires: "Never" },
              ].map((rule, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-mono text-sm text-foreground">{rule.pattern}</div>
                    <div className="text-xs text-muted-foreground">{rule.reason} • Expires: {rule.expires}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-4 p-4 border border-dashed border-border rounded-lg">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Pattern</Label>
                  <Input placeholder="*.example.com or CVE-XXXX-XXXXX" />
                </div>
                <div className="space-y-2">
                  <Label>Expiration</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select expiration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Never</SelectItem>
                      <SelectItem value="30d">30 days</SelectItem>
                      <SelectItem value="90d">90 days</SelectItem>
                      <SelectItem value="1y">1 year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Label>Reason</Label>
                <Textarea placeholder="Reason for suppression..." />
              </div>
              <Button variant="outline" className="mt-4">
                <Plus className="w-4 h-4 mr-2" />
                Add Rule
              </Button>
            </div>
          </motion.div>
        </TabsContent>

        <TabsContent value="grouping" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Tag className="w-5 h-5 text-primary" />
              Asset Grouping Rules
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Automatically group and tag assets based on patterns
            </p>

            <div className="space-y-4">
              {[
                { pattern: "*.prod.*", tags: ["production", "critical"], group: "Production" },
                { pattern: "*.dev.*", tags: ["development"], group: "Development" },
                { pattern: "api.*", tags: ["api", "external"], group: "APIs" },
                { pattern: "10.0.0.*", tags: ["internal", "network"], group: "Internal Network" },
              ].map((rule, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-mono text-sm text-foreground">{rule.pattern}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">Group: {rule.group}</span>
                      <span className="text-muted-foreground">•</span>
                      {rule.tags.map((tag) => (
                        <span key={tag} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Button variant="outline" className="mt-4">
              <Plus className="w-4 h-4 mr-2" />
              Add Grouping Rule
            </Button>
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
