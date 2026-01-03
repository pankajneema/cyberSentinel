import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bug, LayoutDashboard, FileSearch, AlertTriangle, Server, Ticket, Settings } from "lucide-react";
import { motion } from "framer-motion";
import { VSDashboard } from "@/components/vs/VSDashboard";
import { VSScanManager } from "@/components/vs/VSScanManager";
import { VSFindings } from "@/components/vs/VSFindings";
import { VSAssetView } from "@/components/vs/VSAssetView";
import { VSRemediation } from "@/components/vs/VSRemediation";
import { VSSettings } from "@/components/vs/VSSettings";

const tabs = [
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "scans", label: "Scan Manager", icon: FileSearch },
  { value: "findings", label: "Findings", icon: AlertTriangle },
  { value: "assets", label: "Asset View", icon: Server },
  { value: "remediation", label: "Remediation", icon: Ticket },
  { value: "settings", label: "Settings", icon: Settings },
];

export default function VS() {
  const [activeTab, setActiveTab] = useState("dashboard");

  const handleNavigateToScans = () => setActiveTab("scans");
  const handleNavigateToFindings = () => setActiveTab("findings");

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
            <div className="p-2 rounded-xl bg-secondary/10">
              <Bug className="w-6 h-6 text-secondary" />
            </div>
            Vulnerability Scanning
          </h1>
          <p className="text-muted-foreground mt-1">Detect, prioritize, and remediate security vulnerabilities</p>
        </div>
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
          <TabsContent value="dashboard" className="mt-0">
            <VSDashboard onNavigateToScans={handleNavigateToScans} onNavigateToFindings={handleNavigateToFindings} />
          </TabsContent>
          <TabsContent value="scans" className="mt-0">
            <VSScanManager />
          </TabsContent>
          <TabsContent value="findings" className="mt-0">
            <VSFindings />
          </TabsContent>
          <TabsContent value="assets" className="mt-0">
            <VSAssetView />
          </TabsContent>
          <TabsContent value="remediation" className="mt-0">
            <VSRemediation />
          </TabsContent>
          <TabsContent value="settings" className="mt-0">
            <VSSettings />
          </TabsContent>
        </motion.div>
      </Tabs>
    </div>
  );
}