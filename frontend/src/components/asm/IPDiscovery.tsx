import { useState, useEffect } from "react";
import { exportRowsToCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Download,
  MapPin,
  Network,
  Shield,
  Server,
  Globe,
  AlertCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { SeverityBadge } from "./SeverityBadge";
import { Badge } from "@/components/ui/badge";
import { fetchAsmOverview } from "@/lib/api";
import { fetchAllIPs, type AsmIP } from "@/lib/services/asm";

export function IPDiscovery() {
  const [searchQuery, setSearchQuery] = useState("");
  const [ips, setIps] = useState<AsmIP[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalIPs, setTotalIPs] = useState(0);
  const [totalActive, setTotalActive] = useState(0);
  const [totalReachable, setTotalReachable] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    fetchIPs();
    fetchStats();
  }, [page]);

  const fetchIPs = async () => {
    setLoading(true);
    try {
      const data = await fetchAllIPs(page, pageSize);
      setIps(data.items || []);
      setTotalIPs(data.total || 0);
    } catch (error) {
      console.error("Failed to fetch IPs:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const overview = await fetchAsmOverview();
      setTotalIPs(overview.asset_counts?.ips || 0);
      // Count active and reachable from current page (can be enhanced with separate endpoint)
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  };

  const filteredIPs = ips.filter(ip => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      ip.ip_address.toLowerCase().includes(query) ||
      (ip.subdomain || "").toLowerCase().includes(query)
    );
  });

  const activeCount = ips.filter(ip => ip.status === "active").length;
  const reachableCount = ips.filter(ip => ip.reachable === true).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            IP Address Discovery
          </h2>
          <p className="text-sm text-muted-foreground">
            View all discovered IP addresses with their exposure details and open ports
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            disabled={ips.length === 0}
            onClick={() => exportRowsToCsv(ips as unknown as Record<string, unknown>[], "asm-ips-export")}
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Total IPs", value: String(totalIPs), icon: Network, color: "bg-primary/10 text-primary" },
          { label: "Active", value: String(activeCount), icon: Shield, color: "bg-success/10 text-success" },
          { label: "Reachable", value: String(reachableCount), icon: Globe, color: "bg-blue-500/10 text-blue-600" },
          { label: "High Exposure", value: String(ips.filter(ip => ip.exposure_level === "high").length), icon: AlertCircle, color: "bg-destructive/10 text-destructive" },
        ].map((stat, i) => (
          <motion.div 
            key={stat.label} 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: i * 0.1 }} 
            className="bg-card rounded-2xl border border-border p-5 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Search IP addresses or subdomains..." 
          className="pl-11 h-12 rounded-xl" 
          value={searchQuery} 
          onChange={(e) => setSearchQuery(e.target.value)} 
        />
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground">IP Addresses</h3>
          </div>
        </div>
        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="text-muted-foreground">Loading IPs...</div>
          </div>
        ) : filteredIPs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {searchQuery ? "No IPs found matching your search" : "No IPs discovered yet. Start a discovery to find IP addresses."}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/30 border-b border-border">
                  <tr className="text-left text-sm text-muted-foreground">
                    <th className="p-4 font-medium">IP Address</th>
                    <th className="p-4 font-medium">Subdomain</th>
                    <th className="p-4 font-medium">Status</th>
                    <th className="p-4 font-medium">Reachable</th>
                    <th className="p-4 font-medium">Exposure</th>
                    <th className="p-4 font-medium">Open Ports</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIPs.map((ip, index) => (
                    <motion.tr
                      key={ip.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.05 }}
                      className="border-t border-border hover:bg-muted/20 transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Server className="w-4 h-4 text-muted-foreground" />
                          <span className="font-mono font-medium text-foreground">{ip.ip_address}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        {ip.subdomain ? (
                          <span className="text-sm text-foreground">{ip.subdomain}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        <Badge variant={ip.status === "active" ? "default" : "secondary"}>
                          {ip.status}
                        </Badge>
                      </td>
                      <td className="p-4">
                        {ip.reachable !== null ? (
                          <Badge variant={ip.reachable ? "default" : "secondary"} className={ip.reachable ? "bg-green-500/20 text-green-600" : "bg-red-500/20 text-red-600"}>
                            {ip.reachable ? "Yes" : "No"}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        <SeverityBadge severity={ip.exposure_level || "not_calculated"} showDot={false} />
                      </td>
                      <td className="p-4">
                        <Badge variant="outline" className="bg-blue-500/20 text-blue-600">
                          {ip.open_ports != null ? `${ip.open_ports} ports` : "N/A"}
                        </Badge>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Pagination */}
            {totalIPs > 0 && (
              <div className="flex items-center justify-between p-4 border-t border-border">
                <div className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalIPs)} of {totalIPs} IPs
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                  >
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <div className="flex items-center gap-1 px-2">
                    <span className="text-sm text-muted-foreground">Page</span>
                    <span className="text-sm font-medium text-foreground">{page}</span>
                    <span className="text-sm text-muted-foreground">of</span>
                    <span className="text-sm font-medium text-foreground">{Math.ceil(totalIPs / pageSize)}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * pageSize >= totalIPs}
                  >
                    Next
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.ceil(totalIPs / pageSize))}
                    disabled={page * pageSize >= totalIPs}
                  >
                    Last
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
