import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./EmptyState";
import { StatCard } from "./StatCard";
import {
  Cloud,
  RefreshCw,
  AlertTriangle,
  Shield,
  Lock,
  Database,
} from "lucide-react";
import { fetchCloudResources, type AsmCloudResource } from "@/lib/services/asm";

export function CloudAttackSurface() {
  const [loading, setLoading] = useState(true);
  const [resources, setResources] = useState<AsmCloudResource[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchCloudResources({ page: 1, page_size: 500 });
      setResources(res.items || []);
    } catch (e) {
      setResources([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const total = resources.length;
    const publicCount = resources.filter(r => (r.access_status || "").toLowerCase() === "public").length;
    const privateCount = resources.filter(r => (r.access_status || "").toLowerCase() === "private").length;
    const unknownCount = total - publicCount - privateCount;
    return { total, publicCount, privateCount, unknownCount };
  }, [resources]);

  const providers = useMemo(() => {
    return Array.from(new Set(resources.map(r => r.service))).filter(Boolean);
  }, [resources]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center h-[400px]">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Cloud className="w-5 h-5 text-primary" />
              Cloud Assets
            </h2>
            <p className="text-sm text-muted-foreground">Discovered cloud resources from ASM Deep scans</p>
          </div>
          <Button variant="outline" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
        <EmptyState
          icon={Cloud}
          title="No cloud resources yet"
          description="Run a Deep discovery with cloud exposure detection enabled."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Cloud className="w-5 h-5 text-primary" />
            Cloud Assets
          </h2>
          <p className="text-sm text-muted-foreground">Real-time cloud resources discovered by ASM</p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <StatCard label="Total Resources" value={stats.total} icon={Database} />
        <StatCard label="Public" value={stats.publicCount} icon={AlertTriangle} variant="critical" />
        <StatCard label="Private" value={stats.privateCount} icon={Shield} variant="warning" />
        <StatCard label="Unknown" value={stats.unknownCount} icon={Lock} />
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Providers: {providers.length > 0 ? providers.join(", ") : "—"}
          </div>
          <div className="text-sm text-muted-foreground">{resources.length} resources</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/30 border-b border-border">
              <tr className="text-left text-sm text-muted-foreground">
                <th className="p-4 font-medium">Provider</th>
                <th className="p-4 font-medium">Type</th>
                <th className="p-4 font-medium">Resource</th>
                <th className="p-4 font-medium">Access</th>
                <th className="p-4 font-medium">Region</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-4">{r.service}</td>
                  <td className="p-4">{r.resource_type}</td>
                  <td className="p-4 font-mono text-sm">{r.resource_name}</td>
                  <td className="p-4">
                    {r.access_status || "unknown"}
                  </td>
                  <td className="p-4">{r.region || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
