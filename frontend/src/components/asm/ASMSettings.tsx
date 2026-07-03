import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
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
import { getAsmSettings, updateAsmSettings } from "@/lib/services/asm";
import { useToast } from "@/hooks/use-toast";

export function ASMSettings() {
  const { toast } = useToast();
  const [criticalThreshold, setCriticalThreshold] = useState([80]);
  const [highThreshold, setHighThreshold] = useState([60]);
  const [mediumThreshold, setMediumThreshold] = useState([40]);
  const [initialSettings, setInitialSettings] = useState<any>(null);
  const [notificationRules, setNotificationRules] = useState({
    high_exposure: true,
    medium_exposure: true,
    new_assets: true,
    discovery_completed: false,
    daily_summary: true,
    weekly_report: true,
    email_recipients: "",
    slack_webhook: "",
    teams_webhook: "",
  });
  const [automationRules, setAutomationRules] = useState({
    auto_create_tickets: true,
    auto_assign_assets: true,
    auto_verify_changes: true,
    auto_archive_stale: false,
  });
  const [suppressionRules, setSuppressionRules] = useState<Array<{ pattern: string; reason: string; expires: string }>>([]);
  const [groupingRules, setGroupingRules] = useState<Array<{ pattern: string; group: string; tags: string[] }>>([]);
  const [newSuppression, setNewSuppression] = useState({ pattern: "", reason: "", expires: "never" });
  const [newGrouping, setNewGrouping] = useState({ pattern: "", group: "", tags: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await getAsmSettings();
        const thresholds = res.settings?.thresholds;
        if (thresholds) {
          setCriticalThreshold([thresholds.critical ?? 80]);
          setHighThreshold([thresholds.high ?? 60]);
          setMediumThreshold([thresholds.medium ?? 40]);
        }
        const notifications = res.settings?.notifications;
        if (notifications) {
          setNotificationRules((prev) => ({ ...prev, ...notifications }));
        }
        const automation = res.settings?.automation;
        if (automation) {
          setAutomationRules((prev) => ({ ...prev, ...automation }));
        }
        const suppression = res.settings?.suppression;
        if (Array.isArray(suppression)) {
          setSuppressionRules(suppression);
        }
        const grouping = res.settings?.grouping;
        if (Array.isArray(grouping)) {
          setGroupingRules(grouping);
        }
        setInitialSettings(res.settings || {});
      } catch (e: any) {
        toast({
          title: "Failed to load settings",
          description: e?.message ?? "Could not load ASM settings",
          variant: "destructive",
        });
      }
    };
    loadSettings();
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        thresholds: {
          critical: criticalThreshold[0],
          high: highThreshold[0],
          medium: mediumThreshold[0],
        },
        notifications: notificationRules,
        automation: automationRules,
        suppression: suppressionRules,
        grouping: groupingRules,
      };
      await updateAsmSettings(payload);
      setInitialSettings(payload);
      toast({ title: "Settings saved", description: "ASM exposure thresholds updated" });
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message ?? "Could not save ASM settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const currentSettings = useMemo(() => ({
    thresholds: {
      critical: criticalThreshold[0],
      high: highThreshold[0],
      medium: mediumThreshold[0],
    },
    notifications: notificationRules,
    automation: automationRules,
    suppression: suppressionRules,
    grouping: groupingRules,
  }), [criticalThreshold, highThreshold, mediumThreshold, notificationRules, automationRules, suppressionRules, groupingRules]);

  const isDirty = initialSettings
    ? JSON.stringify(currentSettings) !== JSON.stringify(initialSettings)
    : false;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="scoring">
        <div className="flex items-center justify-between gap-4">
          <TabsList className="inline-flex gap-1.5 bg-card/80 border border-border p-1.5 rounded-2xl whitespace-nowrap shadow-sm">
            <TabsTrigger value="scoring">Exposure Scoring</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="automation">Automation</TabsTrigger>
            <TabsTrigger value="suppression">Suppression</TabsTrigger>
            <TabsTrigger value="grouping">Asset Grouping</TabsTrigger>
          </TabsList>
          {isDirty && (
            <Button variant="gradient" onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </div>

        <TabsContent value="scoring" forceMount className="mt-6 space-y-6 data-[state=inactive]:hidden">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Exposure Score Thresholds
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Configure exposure thresholds for severity classification
            </p>

            <div className="space-y-8">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-destructive font-medium">Critical Exposure</Label>
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
                  <Label className="text-warning font-medium">High Exposure</Label>
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
                  <Label className="text-accent font-medium">Medium Exposure</Label>
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
            <h3 className="font-semibold text-foreground mb-1">Exposure Signals</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Indicative weighting of the factors the exposure model considers — reference only, not editable here.
            </p>
            <div className="space-y-4">
              {[
                { label: "Internet-facing assets", value: 30 },
                { label: "Open ports & services", value: 25 },
                { label: "SSL/TLS issues", value: 15 },
                { label: "Public cloud resources", value: 15 },
                { label: "Admin or backup endpoints", value: 10 },
                { label: "API surface exposure", value: 5 },
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

        <TabsContent value="notifications" forceMount className="mt-6 space-y-6 data-[state=inactive]:hidden">
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
                { key: "high_exposure", label: "High exposure assets", description: "Notify immediately for high exposure assets" },
                { key: "medium_exposure", label: "Medium exposure assets", description: "Notify for medium exposure assets" },
                { key: "new_assets", label: "New assets discovered", description: "Alert when new assets are found" },
                { key: "discovery_completed", label: "Discovery completed", description: "Notify when discovery runs finish" },
              ].map((rule) => (
                <div key={rule.key} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">{rule.label}</div>
                    <div className="text-sm text-muted-foreground">{rule.description}</div>
                  </div>
                  <Switch
                    checked={(notificationRules as any)[rule.key]}
                    onCheckedChange={(checked) =>
                      setNotificationRules((prev) => ({ ...prev, [rule.key]: checked }))
                    }
                  />
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
                <Input
                  placeholder="security@company.com, ciso@company.com"
                  value={notificationRules.email_recipients}
                  onChange={(e) => setNotificationRules((prev) => ({ ...prev, email_recipients: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Slack Webhook URL</Label>
                <Input
                  placeholder="https://hooks.slack.com/..."
                  type="password"
                  value={notificationRules.slack_webhook}
                  onChange={(e) => setNotificationRules((prev) => ({ ...prev, slack_webhook: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Microsoft Teams Webhook</Label>
                <Input
                  placeholder="https://outlook.office.com/webhook/..."
                  type="password"
                  value={notificationRules.teams_webhook}
                  onChange={(e) => setNotificationRules((prev) => ({ ...prev, teams_webhook: e.target.value }))}
                />
              </div>
            </div>
          </motion.div>
        </TabsContent>

        <TabsContent value="automation" forceMount className="mt-6 space-y-6 data-[state=inactive]:hidden">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Automation
            </h3>

            <div className="space-y-4">
              {[
                { key: "auto_create_tickets", label: "Auto-create Jira tickets", description: "Automatically create tickets for high exposure assets" },
                { key: "auto_assign_assets", label: "Auto-assign assets", description: "Assign assets to owners automatically" },
                { key: "auto_verify_changes", label: "Auto-verify exposure changes", description: "Re-discover after exposure changes are marked complete" },
                { key: "auto_archive_stale", label: "Auto-archive stale assets", description: "Archive assets not seen in 30 days" },
              ].map((rule) => (
                <div key={rule.key} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">{rule.label}</div>
                    <div className="text-sm text-muted-foreground">{rule.description}</div>
                  </div>
                  <Switch
                    checked={(automationRules as any)[rule.key]}
                    onCheckedChange={(checked) =>
                      setAutomationRules((prev) => ({ ...prev, [rule.key]: checked }))
                    }
                  />
                </div>
              ))}
            </div>
          </motion.div>
        </TabsContent>

        <TabsContent value="suppression" forceMount className="mt-6 space-y-6 data-[state=inactive]:hidden">
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
              Define rules to suppress noisy or non-actionable exposure signals
            </p>

            <div className="space-y-4">
              {suppressionRules.map((rule, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-mono text-sm text-foreground">{rule.pattern}</div>
                    <div className="text-xs text-muted-foreground">{rule.reason} • Expires: {rule.expires}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => setSuppressionRules((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-4 p-4 border border-dashed border-border rounded-lg">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Pattern</Label>
                  <Input
                    placeholder="*.example.com or CVE-XXXX-XXXXX"
                    value={newSuppression.pattern}
                    onChange={(e) => setNewSuppression((prev) => ({ ...prev, pattern: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Expiration</Label>
                  <Select value={newSuppression.expires} onValueChange={(v) => setNewSuppression((prev) => ({ ...prev, expires: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select expiration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Never">Never</SelectItem>
                      <SelectItem value="30 days">30 days</SelectItem>
                      <SelectItem value="90 days">90 days</SelectItem>
                      <SelectItem value="1 year">1 year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Label>Reason</Label>
                <Textarea
                  placeholder="Reason for suppression..."
                  value={newSuppression.reason}
                  onChange={(e) => setNewSuppression((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </div>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  if (!newSuppression.pattern.trim()) return;
                  setSuppressionRules((prev) => [
                    ...prev,
                    {
                      pattern: newSuppression.pattern.trim(),
                      reason: newSuppression.reason.trim() || "No reason provided",
                      expires: newSuppression.expires || "Never",
                    },
                  ]);
                  setNewSuppression({ pattern: "", reason: "", expires: "Never" });
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Rule
              </Button>
            </div>
          </motion.div>
        </TabsContent>

        <TabsContent value="grouping" forceMount className="mt-6 space-y-6 data-[state=inactive]:hidden">
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
              {groupingRules.map((rule, i) => (
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => setGroupingRules((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-4 grid sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Pattern</Label>
                <Input
                  placeholder="*.prod.*"
                  value={newGrouping.pattern}
                  onChange={(e) => setNewGrouping((prev) => ({ ...prev, pattern: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Group</Label>
                <Input
                  placeholder="Production"
                  value={newGrouping.group}
                  onChange={(e) => setNewGrouping((prev) => ({ ...prev, group: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tags (comma separated)</Label>
                <Input
                  placeholder="production, critical"
                  value={newGrouping.tags}
                  onChange={(e) => setNewGrouping((prev) => ({ ...prev, tags: e.target.value }))}
                />
              </div>
            </div>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                if (!newGrouping.pattern.trim() || !newGrouping.group.trim()) return;
                setGroupingRules((prev) => [
                  ...prev,
                  {
                    pattern: newGrouping.pattern.trim(),
                    group: newGrouping.group.trim(),
                    tags: newGrouping.tags
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  },
                ]);
                setNewGrouping({ pattern: "", group: "", tags: "" });
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Grouping Rule
            </Button>
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
