// Exposure Signals — real, defensible exposure scoring (CVSS/EPSS/KEV-aware on
// the backend). Shows scored IPs, a severity summary, and the "why" breakdown.

import { Fragment, useEffect, useMemo, useState } from "react";
import { getExposure, type ExposureItem } from "@/lib/services/asm";
import { ChevronDown, ChevronUp, ShieldAlert, Globe } from "lucide-react";

const SEV_COLOR: Record<string, string> = {
  critical: "bg-red-500/15 text-red-600 border-red-500/30",
  high: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  medium: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  low: "bg-sky-500/15 text-sky-700 border-sky-500/30",
  info: "bg-muted text-muted-foreground border-border",
};

function scoreBar(score: number) {
  const color =
    score >= 80 ? "bg-red-500" : score >= 60 ? "bg-orange-500" : score >= 40 ? "bg-amber-500" : score >= 20 ? "bg-sky-500" : "bg-muted-foreground/40";
  return (
    <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
    </div>
  );
}

export function ExposureSignals() {
  const [items, setItems] = useState<ExposureItem[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    getExposure(100)
      .then((res) => {
        setItems(res.items);
        setSummary(res.summary || {});
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const order = ["critical", "high", "medium", "low", "info"];
  const counts = useMemo(() => order.map((s) => ({ s, n: summary[s] || 0 })), [summary]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Scoring exposure…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-primary" /> Exposure Signals
        </h2>
        <p className="text-sm text-muted-foreground">
          Defensible per-asset exposure scoring — open ports & sensitive services, TLS posture,
          and known vulnerabilities (CVSS · EPSS · KEV). Every point is explained.
        </p>
      </div>

      {/* Severity summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {counts.map(({ s, n }) => (
          <div key={s} className={`rounded-lg border p-3 ${SEV_COLOR[s]}`}>
            <div className="text-2xl font-bold">{n}</div>
            <div className="text-xs capitalize">{s}</div>
          </div>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          <Globe className="w-6 h-6 mx-auto mb-2 opacity-50" />
          No scored assets yet. Run a discovery to populate exposure signals.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">IP address</th>
                <th className="px-4 py-2">Location / ASN</th>
                <th className="px-4 py-2">Open ports</th>
                <th className="px-4 py-2">Exposure</th>
                <th className="px-4 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <Fragment key={it.ip_address}>
                  <tr
                    className="border-t cursor-pointer hover:bg-muted/30"
                    onClick={() => setOpen(open === it.ip_address ? null : it.ip_address)}
                  >
                    <td className="px-4 py-2 font-mono">{it.ip_address}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {it.country || "—"}{it.asn ? ` · ${it.asn}` : ""}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {it.open_ports.length ? it.open_ports.slice(0, 6).join(", ") + (it.open_ports.length > 6 ? "…" : "") : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {scoreBar(it.score)}
                        <span className="font-semibold tabular-nums">{it.score}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border capitalize ${SEV_COLOR[it.severity]}`}>
                          {it.severity}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {open === it.ip_address ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </td>
                  </tr>
                  {open === it.ip_address && (
                    <tr className="border-t bg-muted/20">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="text-xs font-medium text-muted-foreground mb-2">Why this score</div>
                        <div className="space-y-1">
                          {it.factors.map((f, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-foreground">{f.detail}</span>
                              <span className="tabular-nums text-muted-foreground">
                                {f.points > 0 ? `+${f.points}` : f.points === 0 ? "—" : f.points}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
