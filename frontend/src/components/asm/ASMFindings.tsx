import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Cpu, ShieldCheck, Code2, Shield, FileArchive, GitCompare, Server, ArrowUpDown } from "lucide-react";
import { SubdomainDiscovery } from "@/components/asm/SubdomainDiscovery";
import { IPDiscovery } from "@/components/asm/IPDiscovery";
import { CloudAttackSurface } from "@/components/asm/CloudAttackSurface";
import {
  fetchPorts,
  fetchServices,
  fetchSSLCerts,
  fetchApiEndpoints,
  fetchAdminEndpoints,
  fetchBackupFiles,
  fetchChanges,
  type AsmPort,
  type AsmService,
  type AsmSSLCert,
  type AsmAPIEndpoint,
  type AsmAdminEndpoint,
  type AsmBackupFile,
  type AsmChange,
} from "@/lib/services/asm";

type TabKey =
  | "subdomains"
  | "ips"
  | "cloud_assets"
  | "ports"
  | "services"
  | "ssl"
  | "api"
  | "admin"
  | "backup"
  | "changes";

export function ASMFindings() {
  const [active, setActive] = useState<TabKey>("subdomains");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = async (tab: TabKey) => {
    if (tab === "subdomains" || tab === "ips" || tab === "cloud_assets") {
      setData([]);
      setLoading(false);
      setTotal(0);
      return;
    }
    setLoading(true);
    try {
      if (tab === "ports") {
        const res = await fetchPorts({ page, page_size: pageSize, q, sort_by: sortBy, sort_dir: sortDir });
        setData(res.items);
        setTotal(res.total);
      } else if (tab === "services") {
        const res = await fetchServices({ page, page_size: pageSize, q, sort_by: sortBy, sort_dir: sortDir });
        setData(res.items);
        setTotal(res.total);
      } else if (tab === "ssl") {
        const res = await fetchSSLCerts({ page, page_size: pageSize, q, sort_by: sortBy, sort_dir: sortDir });
        setData(res.items);
        setTotal(res.total);
      } else if (tab === "api") {
        const res = await fetchApiEndpoints({ page, page_size: pageSize, q, sort_by: sortBy, sort_dir: sortDir });
        setData(res.items);
        setTotal(res.total);
      } else if (tab === "admin") {
        const res = await fetchAdminEndpoints({ page, page_size: pageSize, q, sort_by: sortBy, sort_dir: sortDir });
        setData(res.items);
        setTotal(res.total);
      } else if (tab === "backup") {
        const res = await fetchBackupFiles({ page, page_size: pageSize, q, sort_by: sortBy, sort_dir: sortDir });
        setData(res.items);
        setTotal(res.total);
      } else if (tab === "changes") {
        const res = await fetchChanges({ page, page_size: pageSize, q, sort_by: sortBy, sort_dir: sortDir });
        setData(res.items);
        setTotal(res.total);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(active);
  }, [active, page, pageSize, q, sortBy, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [active]);

  const sortOptions = useMemo(() => {
    if (active === "ports") return [
      { value: "created_at", label: "Newest" },
      { value: "ip_address", label: "IP" },
      { value: "port", label: "Port" },
      { value: "protocol", label: "Protocol" },
      { value: "service", label: "Service" },
    ];
    if (active === "services") return [
      { value: "created_at", label: "Newest" },
      { value: "ip_address", label: "IP" },
      { value: "port", label: "Port" },
      { value: "service_name", label: "Service" },
    ];
    if (active === "ssl") return [
      { value: "created_at", label: "Newest" },
      { value: "host", label: "Host" },
      { value: "port", label: "Port" },
      { value: "valid_until", label: "Valid Until" },
    ];
    if (active === "api") return [
      { value: "created_at", label: "Newest" },
      { value: "url", label: "URL" },
      { value: "status_code", label: "Status" },
      { value: "method", label: "Method" },
    ];
    if (active === "admin") return [
      { value: "created_at", label: "Newest" },
      { value: "url", label: "URL" },
      { value: "status_code", label: "Status" },
    ];
    if (active === "backup") return [
      { value: "created_at", label: "Newest" },
      { value: "file_url", label: "URL" },
      { value: "file_extension", label: "Extension" },
      { value: "status", label: "Status" },
    ];
    if (active === "changes") return [
      { value: "created_at", label: "Newest" },
    ];
    return [{ value: "created_at", label: "Newest" }];
  }, [active]);

  const exportCurrent = () => {
    if (data.length === 0) return;
    const keys = Object.keys(data[0] || {});
    const lines = [
      keys.join(","),
      ...data.map((row) =>
        keys.map((k) => JSON.stringify(row[k] ?? "")).join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `asm-${active}-export.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const canExport =
    ["ports", "services", "ssl", "api", "admin", "backup", "changes"].includes(active) &&
    data.length > 0;

  return (
    <div className="space-y-4">
      <Tabs
        value={active}
        onValueChange={(v) => {
          if (v !== active) setActive(v as TabKey);
        }}
      >
        <div className="overflow-x-auto">
          <TabsList className="inline-flex gap-1.5 bg-card/80 border border-border p-1.5 rounded-2xl whitespace-nowrap shadow-sm">
            <TabsTrigger value="subdomains">Subdomains</TabsTrigger>
            <TabsTrigger value="ips">IPs</TabsTrigger>
            <TabsTrigger value="cloud_assets">Cloud</TabsTrigger>
            <TabsTrigger value="ports">Ports</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="ssl">SSL/TLS</TabsTrigger>
            <TabsTrigger value="api">APIs</TabsTrigger>
            <TabsTrigger value="admin">Admin</TabsTrigger>
            <TabsTrigger value="backup">Backup</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="subdomains" forceMount className="mt-3 data-[state=inactive]:hidden">
          <SubdomainDiscovery />
        </TabsContent>
        <TabsContent value="ips" forceMount className="mt-3 data-[state=inactive]:hidden">
          <IPDiscovery />
        </TabsContent>
        <TabsContent value="cloud_assets" forceMount className="mt-3 data-[state=inactive]:hidden">
          <CloudAttackSurface />
        </TabsContent>

        <TabsContent value="ports" forceMount className="mt-3 data-[state=inactive]:hidden">
          <FindingsDataPanel
            active={active}
            tab="ports"
            loading={loading}
            data={data}
            total={total}
            q={q}
            sortBy={sortBy}
            sortDir={sortDir}
            page={page}
            pageSize={pageSize}
            sortOptions={sortOptions}
            canExport={canExport}
            onExport={exportCurrent}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
            onSortBy={setSortBy}
            onSortDir={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            onPage={(p) => setPage(p)}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          >
            <PortsTable rows={data as AsmPort[]} />
          </FindingsDataPanel>
        </TabsContent>
        <TabsContent value="services" forceMount className="mt-3 data-[state=inactive]:hidden">
          <FindingsDataPanel
            active={active}
            tab="services"
            loading={loading}
            data={data}
            total={total}
            q={q}
            sortBy={sortBy}
            sortDir={sortDir}
            page={page}
            pageSize={pageSize}
            sortOptions={sortOptions}
            canExport={canExport}
            onExport={exportCurrent}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
            onSortBy={setSortBy}
            onSortDir={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            onPage={(p) => setPage(p)}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          >
            <ServicesTable rows={data as AsmService[]} />
          </FindingsDataPanel>
        </TabsContent>
        <TabsContent value="ssl" forceMount className="mt-3 data-[state=inactive]:hidden">
          <FindingsDataPanel
            active={active}
            tab="ssl"
            loading={loading}
            data={data}
            total={total}
            q={q}
            sortBy={sortBy}
            sortDir={sortDir}
            page={page}
            pageSize={pageSize}
            sortOptions={sortOptions}
            canExport={canExport}
            onExport={exportCurrent}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
            onSortBy={setSortBy}
            onSortDir={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            onPage={(p) => setPage(p)}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          >
            <SSLTable rows={data as AsmSSLCert[]} />
          </FindingsDataPanel>
        </TabsContent>
        <TabsContent value="api" forceMount className="mt-3 data-[state=inactive]:hidden">
          <FindingsDataPanel
            active={active}
            tab="api"
            loading={loading}
            data={data}
            total={total}
            q={q}
            sortBy={sortBy}
            sortDir={sortDir}
            page={page}
            pageSize={pageSize}
            sortOptions={sortOptions}
            canExport={canExport}
            onExport={exportCurrent}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
            onSortBy={setSortBy}
            onSortDir={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            onPage={(p) => setPage(p)}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          >
            <ApiTable rows={data as AsmAPIEndpoint[]} />
          </FindingsDataPanel>
        </TabsContent>
        <TabsContent value="admin" forceMount className="mt-3 data-[state=inactive]:hidden">
          <FindingsDataPanel
            active={active}
            tab="admin"
            loading={loading}
            data={data}
            total={total}
            q={q}
            sortBy={sortBy}
            sortDir={sortDir}
            page={page}
            pageSize={pageSize}
            sortOptions={sortOptions}
            canExport={canExport}
            onExport={exportCurrent}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
            onSortBy={setSortBy}
            onSortDir={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            onPage={(p) => setPage(p)}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          >
            <AdminTable rows={data as AsmAdminEndpoint[]} />
          </FindingsDataPanel>
        </TabsContent>
        <TabsContent value="backup" forceMount className="mt-3 data-[state=inactive]:hidden">
          <FindingsDataPanel
            active={active}
            tab="backup"
            loading={loading}
            data={data}
            total={total}
            q={q}
            sortBy={sortBy}
            sortDir={sortDir}
            page={page}
            pageSize={pageSize}
            sortOptions={sortOptions}
            canExport={canExport}
            onExport={exportCurrent}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
            onSortBy={setSortBy}
            onSortDir={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            onPage={(p) => setPage(p)}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          >
            <BackupTable rows={data as AsmBackupFile[]} />
          </FindingsDataPanel>
        </TabsContent>
        <TabsContent value="changes" forceMount className="mt-3 data-[state=inactive]:hidden">
          <FindingsDataPanel
            active={active}
            tab="changes"
            loading={loading}
            data={data}
            total={total}
            q={q}
            sortBy={sortBy}
            sortDir={sortDir}
            page={page}
            pageSize={pageSize}
            sortOptions={sortOptions}
            canExport={canExport}
            onExport={exportCurrent}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
            onSortBy={setSortBy}
            onSortDir={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            onPage={(p) => setPage(p)}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          >
            <ChangesTable rows={data as AsmChange[]} />
          </FindingsDataPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FindingsDataPanel({
  active,
  tab,
  loading,
  data,
  total,
  q,
  sortBy,
  sortDir,
  page,
  pageSize,
  sortOptions,
  canExport,
  onExport,
  onSearch,
  onSortBy,
  onSortDir,
  onPage,
  onPageSize,
  children,
}: {
  active: TabKey;
  tab: TabKey;
  loading: boolean;
  data: any[];
  total: number;
  q: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
  sortOptions: Array<{ value: string; label: string }>;
  canExport: boolean;
  onExport: () => void;
  onSearch: (value: string) => void;
  onSortBy: (value: string) => void;
  onSortDir: () => void;
  onPage: (value: number) => void;
  onPageSize: (value: number) => void;
  children: ReactNode;
}) {
  if (active !== tab) return null;

  const titleMap: Record<TabKey, string> = {
    subdomains: "Subdomains",
    ips: "IPs",
    cloud_assets: "Cloud",
    ports: "Ports",
    services: "Services",
    ssl: "SSL/TLS",
    api: "API Endpoints",
    admin: "Admin Endpoints",
    backup: "Backup Files",
    changes: "Changes",
  };

  const descMap: Record<TabKey, string> = {
    subdomains: "",
    ips: "",
    cloud_assets: "",
    ports: "Discovered open ports from ASM scans",
    services: "Service fingerprints from ASM scans",
    ssl: "TLS/SSL analysis results from ASM scans",
    api: "Discovered API surface from ASM scans",
    admin: "Admin endpoint detection results",
    backup: "Backup/config file discovery results",
    changes: "Change detection results across scans",
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5">
            {tab === "ports" && <Server className="w-4 h-4 text-primary" />}
            {tab === "services" && <Cpu className="w-4 h-4 text-primary" />}
            {tab === "ssl" && <ShieldCheck className="w-4 h-4 text-primary" />}
            {tab === "api" && <Code2 className="w-4 h-4 text-primary" />}
            {tab === "admin" && <Shield className="w-4 h-4 text-primary" />}
            {tab === "backup" && <FileArchive className="w-4 h-4 text-primary" />}
            {tab === "changes" && <GitCompare className="w-4 h-4 text-primary" />}
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">{titleMap[tab]}</div>
            <div className="text-xs text-muted-foreground">{descMap[tab]}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          <div className="relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-2.5" />
            <input
              className="h-11 w-56 rounded-xl border border-border bg-card pl-9 pr-3 text-sm"
              placeholder="Search..."
              value={q}
              onChange={(e) => onSearch(e.target.value)}
            />
            {canExport && (
              <button
                type="button"
                onClick={onExport}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                title="Export CSV"
              >
                Export
              </button>
            )}
          </div>
          <select
            className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
            value={sortBy}
            onChange={(e) => onSortBy(e.target.value)}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="icon"
            onClick={onSortDir}
            title="Toggle sort direction"
          >
            <ArrowUpDown className="w-4 h-4" />
          </Button>
          
        </div>
      </div>
      {loading ? (
        <div className="p-8 text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading findings...
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-background/50 p-8 text-center">
          <div className="mx-auto w-10 h-10 rounded-full bg-muted/60 flex items-center justify-center">
            <Search className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="mt-3 text-sm font-medium text-foreground">No findings yet</div>
          <div className="text-xs text-muted-foreground mt-1">
            Run a Deep discovery or enable this detector to populate this view.
          </div>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">{children}</div>
          <div className="flex items-center justify-between p-4 border-t border-border">
            <div className="text-xs text-muted-foreground">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                value={pageSize}
                onChange={(e) => onPageSize(parseInt(e.target.value, 10))}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}/page</option>
                ))}
              </select>
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPage(1)}>
                First
              </Button>
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}>
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * pageSize >= total}
                onClick={() => onPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PortsTable({ rows }: { rows: AsmPort[] }) {
  return (
    <table className="w-full">
      <thead className="bg-muted/30 border-b border-border">
        <tr className="text-left text-sm text-muted-foreground">
          <th className="p-4 font-medium">IP</th>
          <th className="p-4 font-medium">Port</th>
          <th className="p-4 font-medium">Protocol</th>
          <th className="p-4 font-medium">Service</th>
          <th className="p-4 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="p-4 font-mono text-sm">{r.ip_address}</td>
            <td className="p-4">{r.port}</td>
            <td className="p-4">{r.protocol || "tcp"}</td>
            <td className="p-4">{r.service || "—"}</td>
            <td className="p-4">
              <Badge variant="outline">{r.status || "open"}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ServicesTable({ rows }: { rows: AsmService[] }) {
  return (
    <table className="w-full">
      <thead className="bg-muted/30 border-b border-border">
        <tr className="text-left text-sm text-muted-foreground">
          <th className="p-4 font-medium">IP</th>
          <th className="p-4 font-medium">Port</th>
          <th className="p-4 font-medium">Service</th>
          <th className="p-4 font-medium">Version</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="p-4 font-mono text-sm">{r.ip_address}</td>
            <td className="p-4">{r.port}</td>
            <td className="p-4">{r.service_name}</td>
            <td className="p-4">{r.version || r.product || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SSLTable({ rows }: { rows: AsmSSLCert[] }) {
  return (
    <table className="w-full">
      <thead className="bg-muted/30 border-b border-border">
        <tr className="text-left text-sm text-muted-foreground">
          <th className="p-4 font-medium">Host</th>
          <th className="p-4 font-medium">Port</th>
          <th className="p-4 font-medium">Protocol</th>
          <th className="p-4 font-medium">Issuer</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="p-4">{r.host}</td>
            <td className="p-4">{r.port}</td>
            <td className="p-4">{r.protocol || "—"}</td>
            <td className="p-4">{r.certificate_issuer || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ApiTable({ rows }: { rows: AsmAPIEndpoint[] }) {
  return (
    <table className="w-full">
      <thead className="bg-muted/30 border-b border-border">
        <tr className="text-left text-sm text-muted-foreground">
          <th className="p-4 font-medium">URL</th>
          <th className="p-4 font-medium">Method</th>
          <th className="p-4 font-medium">Status</th>
          <th className="p-4 font-medium">Type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="p-4 font-mono text-sm">{r.url}</td>
            <td className="p-4">{r.method || "—"}</td>
            <td className="p-4">{r.status_code ?? "—"}</td>
            <td className="p-4">{r.endpoint_type || "api"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CloudTable({ rows }: { rows: AsmCloudResource[] }) {
  return (
    <table className="w-full">
      <thead className="bg-muted/30 border-b border-border">
        <tr className="text-left text-sm text-muted-foreground">
          <th className="p-4 font-medium">Service</th>
          <th className="p-4 font-medium">Type</th>
          <th className="p-4 font-medium">Resource</th>
          <th className="p-4 font-medium">Access</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="p-4">{r.service}</td>
            <td className="p-4">{r.resource_type}</td>
            <td className="p-4 font-mono text-sm">{r.resource_name}</td>
            <td className="p-4">{r.access_status || "unknown"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AdminTable({ rows }: { rows: AsmAdminEndpoint[] }) {
  return (
    <table className="w-full">
      <thead className="bg-muted/30 border-b border-border">
        <tr className="text-left text-sm text-muted-foreground">
          <th className="p-4 font-medium">URL</th>
          <th className="p-4 font-medium">Status</th>
          <th className="p-4 font-medium">Type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="p-4 font-mono text-sm">{r.url}</td>
            <td className="p-4">{r.status_code ?? "—"}</td>
            <td className="p-4">{r.endpoint_type || "admin"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BackupTable({ rows }: { rows: AsmBackupFile[] }) {
  return (
    <table className="w-full">
      <thead className="bg-muted/30 border-b border-border">
        <tr className="text-left text-sm text-muted-foreground">
          <th className="p-4 font-medium">URL</th>
          <th className="p-4 font-medium">Extension</th>
          <th className="p-4 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="p-4 font-mono text-sm">{r.file_url}</td>
            <td className="p-4">{r.file_extension || "—"}</td>
            <td className="p-4">{r.status || "checked"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangesTable({ rows }: { rows: AsmChange[] }) {
  return (
    <table className="w-full">
      <thead className="bg-muted/30 border-b border-border">
        <tr className="text-left text-sm text-muted-foreground">
          <th className="p-4 font-medium">Message</th>
          <th className="p-4 font-medium">Changes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="p-4">{r.message || "—"}</td>
            <td className="p-4">
              <Badge variant="outline">
                {r.changes ? r.changes.length : 0}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
