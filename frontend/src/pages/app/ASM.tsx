import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radar, LayoutDashboard, Network, Cloud, Users, GitBranch, FileSearch, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ASMOverview } from "@/components/asm/ASMOverview";
import { SubdomainDiscovery } from "@/components/asm/SubdomainDiscovery";
import { CloudAttackSurface } from "@/components/asm/CloudAttackSurface";
import { HumanAttackSurface } from "@/components/asm/HumanAttackSurface";
import { AttackSurfaceGraph } from "@/components/asm/AttackSurfaceGraph";
import { ScanManager } from "@/components/asm/DiscoveryManager";
import { ASMSettings } from "@/components/asm/ASMSettings";
import { motion } from "framer-motion";

const tabs = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "subdomains", label: "Subdomains", icon: Network },
  { value: "cloud", label: "Cloud", icon: Cloud },
  { value: "human", label: "Human", icon: Users },
  { value: "graph", label: "Graph", icon: GitBranch },
  { value: "scans", label: "Scan Management", icon: FileSearch },
  { value: "settings", label: "Settings", icon: Settings },
];

export default function ASM() {
  const [activeTab, setActiveTab] = useState("overview");
  const navigate = useNavigate();

  const handleGoToScans = () => {
    setActiveTab("scans");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-heading font-bold text-foreground flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Radar className="w-6 h-6 text-primary" />
            </div>
            Attack Surface Management
          </h1>
          <p className="text-muted-foreground mt-1">Discover and monitor your external attack surface</p>
        </div>
        <Button
          variant="gradient"
          size="lg"
          onClick={handleGoToScans}
          className="shrink-0"
        >
          <FileSearch className="w-4 h-4" />
          Scan Management
        </Button>
      </motion.div>

      {/* Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-2">
          <TabsList className="inline-flex h-auto p-1.5 bg-muted/50 rounded-2xl w-auto min-w-full sm:min-w-0 gap-1">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="px-4 py-2.5 text-sm rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm flex items-center gap-2 transition-all"
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Tab Contents */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-6"
        >
          <TabsContent value="overview" className="mt-0">
            <ASMOverview onNavigateToScans={handleGoToScans} onNavigateToReports={() => navigate('/app/reports')} />
          </TabsContent>
          <TabsContent value="subdomains" className="mt-0">
            <SubdomainDiscovery />
          </TabsContent>
          <TabsContent value="cloud" className="mt-0">
            <CloudAttackSurface />
          </TabsContent>
          <TabsContent value="human" className="mt-0">
            <HumanAttackSurface />
          </TabsContent>
          <TabsContent value="graph" className="mt-0">
            <AttackSurfaceGraph />
          </TabsContent>
          <TabsContent value="scans" className="mt-0">
            <ScanManager />
          </TabsContent>
          <TabsContent value="settings" className="mt-0">
            <ASMSettings />
          </TabsContent>
        </motion.div>
      </Tabs>
    </div>
  );
}