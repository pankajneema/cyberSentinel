import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./EmptyState";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  Filter,
  RefreshCw,
  Globe,
  Server,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { motion } from "framer-motion";
import { fetchAssets, fetchSubdomains, type ApiAsset, type AsmSubdomain } from "@/lib/api";

interface GraphNode {
  id: string;
  label: string;
  type: "domain" | "subdomain" | "ip" | "port" | "finding";
  severity?: "critical" | "high" | "medium" | "low";
  x: number;
  y: number;
  connections: string[];
}

const getNodeColor = (type: string, severity?: string) => {
  if (type === "finding") {
    switch (severity) {
      case "critical": return "fill-destructive";
      case "high": return "fill-warning";
      case "medium": return "fill-accent";
      default: return "fill-success";
    }
  }
  switch (type) {
    case "domain": return "fill-primary";
    case "subdomain": return "fill-secondary";
    case "ip": return "fill-muted-foreground";
    case "port": return "fill-accent";
    default: return "fill-muted";
  }
};

const getNodeSize = (type: string) => {
  switch (type) {
    case "domain": return 30;
    case "subdomain": return 24;
    case "ip": return 20;
    case "port": return 16;
    case "finding": return 18;
    default: return 16;
  }
};

const calculateLayout = (nodes: GraphNode[]) => {
  const domainNodes = nodes.filter(n => n.type === "domain");
  const subdomainNodes = nodes.filter(n => n.type === "subdomain");
  const otherNodes = nodes.filter(n => !["domain", "subdomain"].includes(n.type));
  
  const centerX = 400;
  const centerY = 100;
  const radius = 150;
  
  // Position domain nodes in a circle at the top
  domainNodes.forEach((node, index) => {
    const angle = (index / domainNodes.length) * 2 * Math.PI;
    node.x = centerX + radius * Math.cos(angle);
    node.y = centerY + radius * Math.sin(angle);
  });
  
  // Position subdomains below their parent domains
  let subdomainIndex = 0;
  domainNodes.forEach((domainNode) => {
    const connectedSubdomains = subdomainNodes.filter(sub => 
      sub.connections.includes(domainNode.id)
    );
    
    connectedSubdomains.forEach((sub, idx) => {
      const offsetX = (idx - (connectedSubdomains.length - 1) / 2) * 80;
      sub.x = domainNode.x + offsetX;
      sub.y = domainNode.y + 120;
      subdomainIndex++;
    });
  });
  
  // Position other nodes (IPs, ports, findings) below subdomains
  let otherIndex = 0;
  subdomainNodes.forEach((subNode) => {
    const connectedOthers = otherNodes.filter(other => 
      other.connections.includes(subNode.id)
    );
    
    connectedOthers.forEach((other, idx) => {
      const offsetX = (idx - (connectedOthers.length - 1) / 2) * 60;
      other.x = subNode.x + offsetX;
      other.y = subNode.y + 100;
      otherIndex++;
    });
  });
  
  return nodes;
};

export function AttackSurfaceGraph() {
  const [zoom, setZoom] = useState(1);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>(["domain", "subdomain"]);
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [subdomains, setSubdomains] = useState<AsmSubdomain[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [assetsRes, subdomainsRes] = await Promise.all([
          fetchAssets({ type: "domain", page: 1, page_size: 1000 }),
          fetchSubdomains(undefined, 1, 1000),
        ]);
        setAssets(assetsRes.items || []);
        setSubdomains(subdomainsRes.items || []);
      } catch (error) {
        console.error("Failed to load graph data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Build graph nodes from real data
  const nodes = useMemo(() => {
    const graphNodes: GraphNode[] = [];
    const nodeIdMap = new Map<string, string>(); // Map asset_id/subdomain_id to graph node id

    // Create domain nodes from assets
    assets.forEach((asset, index) => {
      if (asset.type === "domain") {
        const nodeId = `domain-${asset.id}`;
        nodeIdMap.set(asset.id, nodeId);
        graphNodes.push({
          id: nodeId,
          label: asset.name,
          type: "domain",
          x: 0, // Will be calculated
          y: 0,
          connections: [],
        });
      }
    });

    // Create subdomain nodes and connect them to parent domains
    subdomains.forEach((subdomain) => {
      const parentNodeId = nodeIdMap.get(subdomain.asset_id);
      if (parentNodeId) {
        const subdomainNodeId = `subdomain-${subdomain.id}`;
        graphNodes.push({
          id: subdomainNodeId,
          label: subdomain.subdomain,
          type: "subdomain",
          x: 0, // Will be calculated
          y: 0,
          connections: [parentNodeId],
        });
        
        // Add reverse connection from domain to subdomain
        const domainNode = graphNodes.find(n => n.id === parentNodeId);
        if (domainNode) {
          domainNode.connections.push(subdomainNodeId);
        }
      }
    });

    // Calculate layout positions
    return calculateLayout(graphNodes);
  }, [assets, subdomains]);

  const filteredNodes = nodes.filter((node) => activeFilters.includes(node.type));

  const toggleFilter = (type: string) => {
    setActiveFilters((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center h-[600px]">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Attack Surface Graph</h2>
          <p className="text-sm text-muted-foreground">
            Visual representation of your asset relationships - {nodes.length} nodes total
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export Image
          </Button>
          <Button variant="gradient" onClick={() => window.location.reload()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { type: "domain", label: "Domains", icon: Globe },
          { type: "subdomain", label: "Subdomains", icon: Globe },
        ].map((filter) => (
          <Button
            key={filter.type}
            variant={activeFilters.includes(filter.type) ? "default" : "outline"}
            size="sm"
            onClick={() => toggleFilter(filter.type)}
            className="gap-2"
          >
            <filter.icon className="w-4 h-4" />
            {filter.label}
          </Button>
        ))}
      </div>

      {/* Graph Container */}
      <div className="card-elevated overflow-hidden">
        {/* Controls */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.min(z + 0.2, 2))}>
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.max(z - 0.2, 0.5))}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => setZoom(1)}>
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
          <div className="text-sm text-muted-foreground">
            {filteredNodes.length} nodes • Zoom: {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Graph SVG */}
        {filteredNodes.length > 0 ? (
          <div className="relative h-[600px] overflow-hidden bg-muted/20">
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 800 600"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
              className="transition-transform duration-300"
            >
              {/* Connections */}
              {filteredNodes.map((node) =>
                node.connections
                  .filter((connId) => filteredNodes.find((n) => n.id === connId))
                  .map((connId) => {
                    const target = filteredNodes.find((n) => n.id === connId);
                    if (!target) return null;
                    return (
                      <motion.line
                        key={`${node.id}-${connId}`}
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 0.3 }}
                        transition={{ duration: 0.5 }}
                        x1={node.x}
                        y1={node.y}
                        x2={target.x}
                        y2={target.y}
                        stroke="currentColor"
                        strokeWidth="1"
                        className="text-muted-foreground"
                      />
                    );
                  })
              )}

              {/* Nodes */}
              {filteredNodes.map((node, index) => {
                const size = getNodeSize(node.type);
                return (
                  <motion.g
                    key={node.id}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setSelectedNode(node)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={size}
                      className={`${getNodeColor(node.type, node.severity)} stroke-background stroke-2 hover:stroke-primary transition-colors`}
                    />
                    <text
                      x={node.x}
                      y={node.y + size + 14}
                      textAnchor="middle"
                      className="fill-foreground text-xs font-medium"
                      style={{ fontSize: "10px" }}
                    >
                      {node.label.length > 20 ? node.label.substring(0, 20) + "..." : node.label}
                    </text>
                  </motion.g>
                );
              })}
            </svg>

            {/* Legend */}
            <div className="absolute bottom-4 left-4 p-3 bg-card/90 backdrop-blur-sm rounded-lg border border-border">
              <div className="text-xs font-medium text-foreground mb-2">Legend</div>
              <div className="space-y-1">
                {[
                  { type: "Domain", color: "bg-primary" },
                  { type: "Subdomain", color: "bg-secondary" },
                ].map((item) => (
                  <div key={item.type} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${item.color}`} />
                    <span className="text-xs text-muted-foreground">{item.type}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-[600px] flex items-center justify-center">
            <EmptyState
              icon={Globe}
              title="No graph data"
              description="No domains or subdomains found. Start a discovery to populate the graph."
            />
          </div>
        )}

        {/* Selected Node Info */}
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 border-t border-border bg-muted/30"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-foreground">{selectedNode.label}</div>
                <div className="text-sm text-muted-foreground capitalize">{selectedNode.type}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">View Details</Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)}>Close</Button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
