import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Radar, LayoutDashboard, GitBranch, FileSearch, FileText, Settings, Shield, ShieldAlert, Github, Boxes, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ASMOverview } from "@/components/asm/ASMOverview";
import { AttackSurfaceGraph } from "@/components/asm/AttackSurfaceGraph";
import { ScanManager } from "@/components/asm/DiscoveryManager";
import { ASMSettings } from "@/components/asm/ASMSettings";
import { DiscoveryRunsList } from "@/components/asm/DiscoveryRunsList";
import { ASMFindings } from "@/components/asm/ASMFindings";
import { IPGeoMap } from "@/components/asm/IPGeoMap";
import { ExposureSignals } from "@/components/asm/ExposureSignals";
import { RepoFindingsTab, SaasAppsTab, UserExposureTab } from "@/components/asm/ExtendedFindings";
import { motion } from "framer-motion";

const tabs = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "findings", label: "Findings", icon: Shield },
  { value: "repo_findings", label: "Repo Findings", icon: Github },
  { value: "saas_apps", label: "SaaS Apps", icon: Boxes },
  { value: "user_exposure", label: "User Exposure", icon: UserCircle },
  { value: "exposure", label: "Exposure", icon: ShieldAlert },
  { value: "scans", label: "Discovery", icon: FileSearch },
  { value: "reports", label: "Reports", icon: FileText },
  { value: "graph", label: "Graph", icon: GitBranch },
  { value: "geo_map", label: "Geo Map", icon: Radar },
  { value: "settings", label: "Settings", icon: Settings },
];

const tabMeta: Record<string, { title: string; description: string }> = {
  overview: {
    title: "ASM Overview",
    description: "Exposure summary across domains, IPs, cloud assets, and APIs",
  },
  scans: {
    title: "Discovery Management",
    description: "Create, run, and monitor discovery pipelines",
  },
  reports: {
    title: "Discovery Reports",
    description: "Review completed runs and export evidence",
  },
  findings: {
    title: "ASM Findings",
    description: "Explore subdomains, IPs, cloud assets, and deep scan results",
  },
  repo_findings: {
    title: "Repository Findings",
    description: "Leaked secrets and risky patterns across discovered repositories",
  },
  saas_apps: {
    title: "SaaS Applications",
    description: "Third-party SaaS applications discovered across your attack surface",
  },
  user_exposure: {
    title: "User Exposure",
    description: "Employee and service accounts exposed in breaches and leaks",
  },
  graph: {
    title: "Attack Surface Graph",
    description: "Visualize relationships across assets and discoveries",
  },
  geo_map: {
    title: "IP Geolocation Map",
    description: "Map discovered IP addresses by country, city, and ASN",
  },
  settings: {
    title: "ASM Settings",
    description: "Tune exposure thresholds and workflow preferences",
  },
};

export default function ASM() {
  const [searchParams, setSearchParams] = useSearchParams();
  const allowedTabs = useMemo(() => tabs.map((t) => t.value), []);
  const initialTab = searchParams.get("tab") || "overview";
  const [activeTab, setActiveTab] = useState(
    allowedTabs.includes(initialTab) ? initialTab : "overview"
  );
  const navigate = useNavigate();

  const handleGoToScans = () => {
    setActiveTab("scans");
    setSearchParams({ tab: "scans" }, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      {/* Tabs Navigation + Header (Sticky) */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          setSearchParams({ tab: value }, { replace: true });
        }}
        className="w-full"
      >
        <div className="sticky top-0 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 pb-4 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="overflow-x-auto pb-2">
            <TabsList className="inline-flex h-auto p-1.5 bg-card/80 border border-border rounded-2xl w-auto min-w-full sm:min-w-0 gap-1 shadow-sm">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="px-4 py-2.5 text-sm rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground flex items-center gap-2 transition-all"
                >
                  <tab.icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl border border-border bg-gradient-to-br from-primary/8 via-background to-background px-6 py-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <Radar className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground">
                  {tabMeta[activeTab]?.title || "Attack Surface Management"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {tabMeta[activeTab]?.description || "Discover, monitor, and prioritize your external attack surface"}
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Tab Contents */}
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          <TabsContent value="overview" forceMount className="mt-0 data-[state=inactive]:hidden">
            <ASMOverview onNavigateToScans={handleGoToScans} onNavigateToReports={() => navigate('/app/reports')} />
          </TabsContent>
          <TabsContent value="findings" forceMount className="mt-0 data-[state=inactive]:hidden">
            <ASMFindings />
          </TabsContent>
          <TabsContent value="repo_findings" forceMount className="mt-0 data-[state=inactive]:hidden">
            <RepoFindingsTab />
          </TabsContent>
          <TabsContent value="saas_apps" forceMount className="mt-0 data-[state=inactive]:hidden">
            <SaasAppsTab />
          </TabsContent>
          <TabsContent value="user_exposure" forceMount className="mt-0 data-[state=inactive]:hidden">
            <UserExposureTab />
          </TabsContent>
          <TabsContent value="exposure" forceMount className="mt-0 data-[state=inactive]:hidden">
            <ExposureSignals />
          </TabsContent>
          <TabsContent value="graph" forceMount className="mt-0 data-[state=inactive]:hidden">
            <AttackSurfaceGraph />
          </TabsContent>
          <TabsContent value="geo_map" forceMount className="mt-0 data-[state=inactive]:hidden">
            <IPGeoMap />
          </TabsContent>
          <TabsContent value="scans" forceMount className="mt-0 data-[state=inactive]:hidden">
            <ScanManager />
          </TabsContent>
          <TabsContent value="reports" forceMount className="mt-0 data-[state=inactive]:hidden">
              <DiscoveryRunsList />
          </TabsContent>
          <TabsContent value="settings" forceMount className="mt-0 data-[state=inactive]:hidden">
            <ASMSettings />
          </TabsContent>
        </motion.div>
      </Tabs>
    </div>
  );
}
