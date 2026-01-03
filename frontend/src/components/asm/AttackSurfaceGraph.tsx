import { useState } from "react";
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

interface GraphNode {
  id: string;
  label: string;
  type: "domain" | "subdomain" | "ip" | "port" | "finding";
  severity?: "critical" | "high" | "medium" | "low";
  x: number;
  y: number;
  connections: string[];
}

const nodes: GraphNode[] = [
  { id: "1", label: "company.com", type: "domain", x: 400, y: 100, connections: ["2", "3", "4"] },
  { id: "2", label: "api.company.com", type: "subdomain", x: 200, y: 200, connections: ["5", "6"] },
  { id: "3", label: "app.company.com", type: "subdomain", x: 400, y: 200, connections: ["7"] },
  { id: "4", label: "mail.company.com", type: "subdomain", x: 600, y: 200, connections: ["8", "9"] },
  { id: "5", label: "192.168.1.10", type: "ip", x: 100, y: 300, connections: ["10"] },
  { id: "6", label: "192.168.1.11", type: "ip", x: 250, y: 300, connections: ["11"] },
  { id: "7", label: "192.168.1.12", type: "ip", x: 400, y: 300, connections: ["12"] },
  { id: "8", label: "192.168.1.13", type: "ip", x: 550, y: 300, connections: [] },
  { id: "9", label: "192.168.1.14", type: "ip", x: 700, y: 300, connections: ["13"] },
  { id: "10", label: ":443", type: "port", x: 50, y: 400, connections: ["14"] },
  { id: "11", label: ":22", type: "port", x: 200, y: 400, connections: ["15"] },
  { id: "12", label: ":80", type: "port", x: 350, y: 400, connections: [] },
  { id: "13", label: ":25", type: "port", x: 650, y: 400, connections: ["16"] },
  { id: "14", label: "SSL Expired", type: "finding", severity: "high", x: 50, y: 500, connections: [] },
  { id: "15", label: "Open SSH", type: "finding", severity: "critical", x: 200, y: 500, connections: [] },
  { id: "16", label: "Open Relay", type: "finding", severity: "critical", x: 650, y: 500, connections: [] },
];

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

export function AttackSurfaceGraph() {
  const [zoom, setZoom] = useState(1);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>(["domain", "subdomain", "ip", "port", "finding"]);

  const filteredNodes = nodes.filter((node) => activeFilters.includes(node.type));

  const toggleFilter = (type: string) => {
    setActiveFilters((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Attack Surface Graph</h2>
          <p className="text-sm text-muted-foreground">Visual representation of your asset relationships</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export Image
          </Button>
          <Button variant="gradient">
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
          { type: "ip", label: "IPs", icon: Server },
          { type: "port", label: "Ports", icon: Shield },
          { type: "finding", label: "Findings", icon: AlertTriangle },
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
                  const target = nodes.find((n) => n.id === connId);
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
                    {node.label}
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
                { type: "IP Address", color: "bg-muted-foreground" },
                { type: "Port", color: "bg-accent" },
                { type: "Finding", color: "bg-destructive" },
              ].map((item) => (
                <div key={item.type} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${item.color}`} />
                  <span className="text-xs text-muted-foreground">{item.type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

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

      {filteredNodes.length === 0 && (
        <EmptyState
          icon={Globe}
          title="No graph data"
          description="Select at least one node type to display the attack surface graph."
        />
      )}
    </div>
  );
}
