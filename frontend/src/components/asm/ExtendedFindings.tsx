import { useEffect, useState } from "react";
import { Loader2, Github, Boxes, UserCircle, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/asm/SeverityBadge";
import { EmptyState } from "@/components/asm/EmptyState";
import {
  fetchRepoFindings,
  fetchSaasApps,
  fetchUserAccounts,
  type RepoFinding,
  type SaasApp,
  type UserAccount,
} from "@/lib/services/asm";
import { LucideIcon } from "lucide-react";

type Severity = "critical" | "high" | "medium" | "low" | "info";

function normalizeSeverity(value?: string): Severity {
  const s = (value || "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low" || s === "info") {
    return s;
  }
  return "info";
}

const rowTint: Record<Severity, string> = {
  critical: "bg-destructive/5",
  high: "bg-warning/5",
  medium: "bg-accent/5",
  low: "",
  info: "",
};

function FindingShell({
  icon: Icon,
  title,
  description,
  loading,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
      {loading ? (
        <div className="p-8 text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading findings...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="w-5 h-5 text-destructive mx-auto" />
          <div className="mt-2 text-sm font-medium text-foreground">Failed to load</div>
          <div className="text-xs text-muted-foreground mt-1">{error}</div>
        </div>
      ) : isEmpty ? (
        <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">{children}</div>
        </div>
      )}
    </div>
  );
}

export function RepoFindingsTab() {
  const [rows, setRows] = useState<RepoFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchRepoFindings()
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e) => {
        if (active) setError(e?.message || "Unable to fetch repo findings");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <FindingShell
      icon={Github}
      title="Repository Findings"
      description="Secrets, leaks, and risky patterns detected across discovered repositories"
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      emptyTitle="No repository findings"
      emptyDescription="Run a repository discovery to surface leaked secrets and risky commits."
    >
      <table className="w-full">
        <thead className="bg-muted/30 border-b border-border">
          <tr className="text-left text-sm text-muted-foreground">
            <th className="p-4 font-medium">Repository</th>
            <th className="p-4 font-medium">Type</th>
            <th className="p-4 font-medium">Rule</th>
            <th className="p-4 font-medium">Location</th>
            <th className="p-4 font-medium">Severity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sev = normalizeSeverity(r.severity);
            return (
              <tr key={r.id} className={`border-t border-border ${rowTint[sev]}`}>
                <td className="p-4 font-mono text-sm">{r.repo_url || "—"}</td>
                <td className="p-4">{r.finding_type || "—"}</td>
                <td className="p-4">{r.rule || "—"}</td>
                <td className="p-4 font-mono text-xs">
                  {r.file_path ? `${r.file_path}${r.line ? `:${r.line}` : ""}` : "—"}
                </td>
                <td className="p-4">
                  <SeverityBadge severity={sev} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </FindingShell>
  );
}

export function SaasAppsTab() {
  const [rows, setRows] = useState<SaasApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchSaasApps()
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e) => {
        if (active) setError(e?.message || "Unable to fetch SaaS apps");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <FindingShell
      icon={Boxes}
      title="SaaS Applications"
      description="Third-party SaaS applications discovered across your attack surface"
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      emptyTitle="No SaaS apps discovered"
      emptyDescription="Run a SaaS discovery to inventory third-party applications in use."
    >
      <table className="w-full">
        <thead className="bg-muted/30 border-b border-border">
          <tr className="text-left text-sm text-muted-foreground">
            <th className="p-4 font-medium">Application</th>
            <th className="p-4 font-medium">Vendor</th>
            <th className="p-4 font-medium">Category</th>
            <th className="p-4 font-medium">URL</th>
            <th className="p-4 font-medium">Discovery</th>
            <th className="p-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="p-4 font-medium">{r.app_name || "—"}</td>
              <td className="p-4">{r.vendor || "—"}</td>
              <td className="p-4">{r.category || "—"}</td>
              <td className="p-4 font-mono text-xs">{r.url || "—"}</td>
              <td className="p-4">{r.discovery_method || "—"}</td>
              <td className="p-4">
                <Badge variant="outline">{r.status || "unknown"}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </FindingShell>
  );
}

export function UserExposureTab() {
  const [rows, setRows] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchUserAccounts()
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e) => {
        if (active) setError(e?.message || "Unable to fetch user exposure");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <FindingShell
      icon={UserCircle}
      title="User Exposure"
      description="Employee and service accounts exposed in breaches and leaks"
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      emptyTitle="No exposed accounts"
      emptyDescription="Run a user discovery to detect breached employee or service accounts."
    >
      <table className="w-full">
        <thead className="bg-muted/30 border-b border-border">
          <tr className="text-left text-sm text-muted-foreground">
            <th className="p-4 font-medium">Email</th>
            <th className="p-4 font-medium">Source</th>
            <th className="p-4 font-medium">Breached</th>
            <th className="p-4 font-medium">Breaches</th>
            <th className="p-4 font-medium">Exposed Data</th>
            <th className="p-4 font-medium">Severity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sev = normalizeSeverity(r.severity);
            return (
              <tr key={r.id} className={`border-t border-border ${rowTint[sev]}`}>
                <td className="p-4 font-mono text-sm">{r.email || "—"}</td>
                <td className="p-4">{r.source || "—"}</td>
                <td className="p-4">
                  <Badge variant={r.breached ? "destructive" : "outline"}>
                    {r.breached ? "Yes" : "No"}
                  </Badge>
                </td>
                <td className="p-4">{r.breach_count ?? 0}</td>
                <td className="p-4 text-xs">{r.exposed_data || "—"}</td>
                <td className="p-4">
                  <SeverityBadge severity={sev} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </FindingShell>
  );
}
