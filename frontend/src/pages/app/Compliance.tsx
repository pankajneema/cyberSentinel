import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpenCheck, BookText, ClipboardList, FileCheck2, LayoutDashboard,
  ScrollText, ShieldAlert, ShieldCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { CADashboard } from "@/components/ca/CADashboard";
import { FrameworkPicker } from "@/components/ca/FrameworkPicker";
import { ControlsTable } from "@/components/ca/ControlsTable";
import { EvidenceTable } from "@/components/ca/EvidenceTable";
import { GapAnalysis } from "@/components/ca/GapAnalysis";
import { PolicyManager } from "@/components/ca/PolicyManager";
import { AuditManager } from "@/components/ca/AuditManager";
import { getMe } from "@/lib/services/auth";

const tabs = [
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "frameworks", label: "Frameworks", icon: BookOpenCheck },
  { value: "controls", label: "Controls", icon: ClipboardList },
  { value: "evidence", label: "Evidence", icon: FileCheck2 },
  { value: "gaps", label: "Gaps & Remediation", icon: ShieldAlert },
  { value: "policies", label: "Policies", icon: BookText },
  { value: "audits", label: "Audits", icon: ScrollText },
];

export default function Compliance() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [currentRole, setCurrentRole] = useState<string>("reader");
  const canWrite = currentRole !== "reader";
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  useEffect(() => {
    let mounted = true;
    getMe()
      .then((p) => { if (mounted) setCurrentRole(p.role ?? "reader"); })
      .catch(() => { if (mounted) setCurrentRole("reader"); });
    return () => { mounted = false; };
  }, []);

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-heading font-bold text-foreground flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            Compliance & Audit
          </h1>
          <p className="text-muted-foreground mt-1">
            Live compliance posture, powered by your own scans — evidence collected once, applied across frameworks
          </p>
        </div>
      </motion.div>

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

        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-6"
        >
          <TabsContent value="dashboard" className="mt-0">
            <CADashboard
              canWrite={canWrite}
              onNavigateToFrameworks={() => setActiveTab("frameworks")}
              onNavigateToGaps={() => setActiveTab("gaps")}
            />
          </TabsContent>
          <TabsContent value="frameworks" className="mt-0">
            <FrameworkPicker canWrite={isAdmin} />
          </TabsContent>
          <TabsContent value="controls" className="mt-0">
            <ControlsTable canWrite={isAdmin} />
          </TabsContent>
          <TabsContent value="evidence" className="mt-0">
            <EvidenceTable canWrite={canWrite} isAdmin={isAdmin} />
          </TabsContent>
          <TabsContent value="gaps" className="mt-0">
            <GapAnalysis canWrite={canWrite} />
          </TabsContent>
          <TabsContent value="policies" className="mt-0">
            <PolicyManager canWrite={canWrite} />
          </TabsContent>
          <TabsContent value="audits" className="mt-0">
            <AuditManager isAdmin={isAdmin} />
          </TabsContent>
        </motion.div>
      </Tabs>
    </div>
  );
}
