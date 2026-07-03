import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  RefreshCw,
  Globe,
  Server,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Network,
  MapPin,
  Layers,
  HelpCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { fetchAssets, fetchSubdomains, type ApiAsset, type AsmSubdomain } from "@/lib/api";
import { fetchSubdomainIPs, fetchAllIPs, type AsmIP } from "@/lib/services/asm";
import { exportRowsToCsv } from "@/lib/csv";

interface GraphNode {
  id: string;
  label: string;
  type: "domain" | "subdomain" | "ip" | "port" | "service";
  severity?: "critical" | "high" | "medium" | "low";
  x: number;
  y: number;
  connections: string[];
  // Status indicators
  resolved?: boolean | null;
  reachable?: boolean | null;
  status?: string;
  // Metadata
  metadata?: {
    ip_address?: string;
    port?: number;
    service_name?: string;
    subdomain?: string;
  };
}

const getNodeStroke = (type: string) => {
  switch (type) {
    case "domain": return "stroke-primary/70";
    case "subdomain": return "stroke-blue-500/70";
    case "ip": return "stroke-purple-500/70";
    case "port": return "stroke-orange-500/70";
    case "service": return "stroke-yellow-500/70";
    default: return "stroke-muted-foreground/60";
  }
};

const getNodeFill = (resolved?: boolean | null, reachable?: boolean | null) => {
  if (resolved === false || reachable === false) return "fill-red-500/10";
  if (resolved === true || reachable === true) return "fill-green-500/10";
  return "fill-card";
};

const getNodeSize = (type: string) => {
  switch (type) {
    case "domain": return 35;
    case "subdomain": return 28;
    case "ip": return 22;
    case "port": return 18;
    case "service": return 16;
    default: return 16;
  }
};

const getNodeIcon = (type: string) => {
  switch (type) {
    case "domain": return Globe;
    case "subdomain": return Network;
    case "ip": return Server;
    case "port": return MapPin;
    case "service": return Layers;
    default: return Globe;
  }
};

// Hierarchical layout: Domain -> Subdomain -> IP -> Port -> Service
const calculateHierarchicalLayout = (nodes: GraphNode[]) => {
  const domainNodes = nodes.filter(n => n.type === "domain");
  const subdomainNodes = nodes.filter(n => n.type === "subdomain");
  const ipNodes = nodes.filter(n => n.type === "ip");
  const portNodes = nodes.filter(n => n.type === "port");
  const serviceNodes = nodes.filter(n => n.type === "service");

  const levelSpacing = 180;
  const nodeSpacing = 140;
  const levels = [domainNodes, subdomainNodes, ipNodes, portNodes, serviceNodes];
  const maxCount = Math.max(1, ...levels.map(l => l.length));
  const canvasWidth = Math.max(1200, maxCount * nodeSpacing);
  const startY = 80;

  levels.forEach((levelNodes, levelIndex) => {
    const y = startY + levelIndex * levelSpacing;
    const count = levelNodes.length;
    levelNodes.forEach((node, index) => {
      const x = ((index + 1) / (count + 1)) * canvasWidth;
      node.x = x;
      node.y = y;
    });
  });

  return nodes;
};

const computeBounds = (nodes: GraphNode[]) => {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
  let minX = nodes[0].x;
  let maxX = nodes[0].x;
  let minY = nodes[0].y;
  let maxY = nodes[0].y;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  });
  return { minX, minY, maxX, maxY };
};

export function AttackSurfaceGraph() {
  const [zoom, setZoom] = useState(1);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("all");
  const [selectedAssetType, setSelectedAssetType] = useState<"domain" | "ip" | "all">("all");
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [subdomains, setSubdomains] = useState<AsmSubdomain[]>([]);
  const [ips, setIps] = useState<AsmIP[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const graphRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [assetsRes, subdomainsRes, ipsRes] = await Promise.all([
          fetchAssets({ type: "domain", page: 1, page_size: 1000 }),
          fetchSubdomains(undefined, 1, 1000),
          fetchAllIPs(1, 1000),
        ]);
        setAssets(assetsRes.items || []);
        setSubdomains(subdomainsRes.items || []);
        setIps(ipsRes.items || []);
      } catch (error) {
        console.error("Failed to load graph data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Build complete hierarchy graph nodes
  const nodes = useMemo(() => {
    const graphNodes: GraphNode[] = [];
    const nodeIdMap = new Map<string, string>();

    // Filter by selected asset if specified
    const filteredAssets = selectedAssetId === "all" 
      ? assets.filter(a => selectedAssetType === "all" || a.type === selectedAssetType)
      : assets.filter(a => a.id === selectedAssetId);
    
    const filteredSubdomains = selectedAssetId === "all"
      ? subdomains
      : subdomains.filter(sd => filteredAssets.some(a => a.id === sd.asset_id));
    
    const filteredIPs = selectedAssetId === "all"
      ? ips
      : ips.filter(ip => filteredSubdomains.some(sd => sd.id === ip.subdomain_id));

    // Level 1: Create domain nodes
    filteredAssets.forEach((asset) => {
      if (asset.type === "domain") {
        const nodeId = `domain-${asset.id}`;
        nodeIdMap.set(asset.id, nodeId);
        graphNodes.push({
          id: nodeId,
          label: asset.name,
          type: "domain",
          x: 0,
          y: 0,
          connections: [],
          status: asset.status || "active",
        });
      }
    });

    // Level 2: Create subdomain nodes and connect to domains
    filteredSubdomains.forEach((subdomain) => {
      const parentNodeId = nodeIdMap.get(subdomain.asset_id);
      if (parentNodeId) {
        const subdomainNodeId = `subdomain-${subdomain.id}`;
        graphNodes.push({
          id: subdomainNodeId,
          label: subdomain.subdomain,
          type: "subdomain",
          x: 0,
          y: 0,
          connections: [parentNodeId],
          resolved: subdomain.resolved ?? null,
          status: subdomain.status || "active",
          metadata: { subdomain: subdomain.subdomain },
        });
        
        const domainNode = graphNodes.find(n => n.id === parentNodeId);
        if (domainNode) {
          domainNode.connections.push(subdomainNodeId);
        }
        nodeIdMap.set(subdomain.id, subdomainNodeId);
      }
    });

    // Level 3: Create IP nodes and connect to subdomains
    filteredIPs.forEach((ip) => {
      if (ip.subdomain_id) {
        const parentNodeId = nodeIdMap.get(ip.subdomain_id);
        if (parentNodeId) {
          const ipNodeId = `ip-${ip.id}`;
          graphNodes.push({
            id: ipNodeId,
            label: ip.ip_address,
            type: "ip",
            x: 0,
            y: 0,
            connections: [parentNodeId],
            reachable: ip.reachable ?? null,
            status: ip.status || "active",
            metadata: { ip_address: ip.ip_address },
          });
          
          const subdomainNode = graphNodes.find(n => n.id === parentNodeId);
          if (subdomainNode) {
            subdomainNode.connections.push(ipNodeId);
          }
          nodeIdMap.set(ip.id, ipNodeId);
        }
      }
    });

    // Calculate hierarchical layout
    const laidOut = calculateHierarchicalLayout(graphNodes);
    // Apply manual overrides (dragging)
    for (const node of laidOut) {
      const override = nodePositions[node.id];
      if (override) {
        node.x = override.x;
        node.y = override.y;
      }
    }
    return laidOut;
  }, [assets, subdomains, ips, selectedAssetId, selectedAssetType, nodePositions]);

  const filteredNodes = useMemo(() => {
    if (!focusNodeId) return nodes;
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const focus = nodeMap.get(focusNodeId);
    if (!focus) return nodes;

    const parents = nodes.filter(n => n.connections.includes(focusNodeId)).map(n => n.id);
    const children = focus.connections;

    const include = new Set<string>();
    include.add(focusNodeId);
    parents.forEach(p => include.add(p));
    children.forEach(c => include.add(c));

    // If focus is a domain, include subdomains + their IPs
    if (focus.type === "domain") {
      children.forEach((subId) => {
        const subNode = nodeMap.get(subId);
        if (subNode) {
          subNode.connections.forEach((ipId) => include.add(ipId));
        }
      });
    }

    return nodes.filter(n => include.has(n.id));
  }, [nodes, focusNodeId]);

  const bounds = useMemo(() => computeBounds(filteredNodes), [filteredNodes]);

  const toggleFilter = (type: string) => {
    // For now, we show all nodes
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

  const domainAssets = assets.filter(a => a.type === "domain");

  const getSvgPoint = (clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const vb = svgRef.current.viewBox.baseVal;
    const x = ((clientX - rect.left) / rect.width) * vb.width + vb.x;
    const y = ((clientY - rect.top) / rect.height) * vb.height + vb.y;
    return { x, y };
  };

  const onNodePointerDown = (e: React.PointerEvent, node: GraphNode) => {
    e.stopPropagation();
    const p = getSvgPoint(e.clientX, e.clientY);
    setDraggingNodeId(node.id);
    setDragOffset({ x: p.x - node.x, y: p.y - node.y });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingNodeId || !dragOffset) return;
    const p = getSvgPoint(e.clientX, e.clientY);
    setNodePositions((prev) => ({
      ...prev,
      [draggingNodeId]: { x: p.x - dragOffset.x, y: p.y - dragOffset.y },
    }));
  };

  const onPointerUp = () => {
    setDraggingNodeId(null);
    setDragOffset(null);
  };

  return (
    <div className="space-y-6">

      {/* Asset Selection */}
      <div className="bg-card rounded-2xl border border-border p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

        {/* LEFT: Asset Type */}
        <div className="w-full sm:w-[200px]">
          <Select
            value={selectedAssetType}
            onValueChange={(v) => {
              setSelectedAssetType(v as "domain" | "ip" | "all");
              setSelectedAssetId("all");
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Asset Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assets</SelectItem>
              <SelectItem value="domain">Domains Only</SelectItem>
              <SelectItem value="ip">IPs Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* CENTER: Domain Selector */}
        {selectedAssetType === "domain" && (
          <div className="w-full sm:w-[260px]">
            <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select Domain" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Domains</SelectItem>
                {domainAssets.map((asset) => (
                  <SelectItem key={asset.id} value={asset.id}>
                    {asset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* RIGHT: Actions */}
        <div className="flex items-center gap-2 sm:ml-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={filteredNodes.length === 0}
            onClick={() =>
              exportRowsToCsv(
                filteredNodes.map((n) => ({ id: n.id, type: n.type, label: n.label })) as unknown as Record<string, unknown>[],
                "asm-attack-surface-graph",
              )
            }
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

      </div>
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
            {focusNodeId && (
              <Button variant="outline" size="sm" onClick={() => setFocusNodeId(null)}>
                Reset Focus
              </Button>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {filteredNodes.length} nodes • Zoom: {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Graph SVG */}
        {filteredNodes.length > 0 ? (
          <div ref={graphRef} className="relative h-[700px] overflow-hidden bg-muted/20">
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={`${(bounds.minX - 120) + (bounds.maxX - bounds.minX + 240) * (1 - 1 / zoom) / 2}
                ${(bounds.minY - 120) + (bounds.maxY - bounds.minY + 240) * (1 - 1 / zoom) / 2}
                ${(bounds.maxX - bounds.minX + 240) / zoom}
                ${(bounds.maxY - bounds.minY + 240) / zoom}`}
              className="transition-all duration-300"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {/* Connections */}
              {filteredNodes.map((node) =>
                node.connections.map((connId) => {
                  const target = filteredNodes.find((n) => n.id === connId);
                  if (!target) return null;
                  return (
                    <motion.line
                      key={`${node.id}-${connId}`}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 0.4 }}
                      transition={{ duration: 0.5 }}
                      x1={node.x}
                      y1={node.y}
                      x2={target.x}
                      y2={target.y}
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-muted-foreground"
                      markerEnd="url(#arrowhead)"
                    />
                  );
                })
              )}

              {/* Arrow marker */}
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3, 0 6" fill="currentColor" className="text-muted-foreground" />
                </marker>
              </defs>

              {/* Nodes */}
              {filteredNodes.map((node, index) => {
                const size = getNodeSize(node.type);
                const Icon = getNodeIcon(node.type);
                const nodeStroke = getNodeStroke(node.type);
                const nodeFill = getNodeFill(node.resolved, node.reachable);
                
                return (
                  <motion.g
                    key={node.id}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: index * 0.03 }}
                    onClick={() => {
                      setSelectedNode(node);
                      setFocusNodeId(node.id);
                    }}
                    onPointerDown={(e) => onNodePointerDown(e, node)}
                    onMouseEnter={(e) => {
                      setHoverNode(node);
                      if (graphRef.current) {
                        const rect = graphRef.current.getBoundingClientRect();
                        setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                      }
                    }}
                    onMouseLeave={() => {
                      setHoverNode(null);
                      setHoverPos(null);
                    }}
                    className="cursor-pointer"
                  >
                    {/* Node symbol */}
                    {node.type === "domain" && (
                      <polygon
                        points={`${node.x - size},${node.y} ${node.x - size / 2},${node.y - size} ${node.x + size / 2},${node.y - size} ${node.x + size},${node.y} ${node.x + size / 2},${node.y + size} ${node.x - size / 2},${node.y + size}`}
                        className={`${nodeFill} ${nodeStroke} stroke-2`}
                      />
                    )}
                    {node.type === "subdomain" && (
                      <rect
                        x={node.x - size}
                        y={node.y - size}
                        width={size * 2}
                        height={size * 2}
                        rx={6}
                        className={`${nodeFill} ${nodeStroke} stroke-2`}
                      />
                    )}
                    {node.type === "ip" && (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={size}
                        className={`${nodeFill} ${nodeStroke} stroke-2`}
                      />
                    )}
                    {node.type === "port" && (
                      <polygon
                        points={`${node.x},${node.y - size} ${node.x + size},${node.y} ${node.x},${node.y + size} ${node.x - size},${node.y}`}
                        className={`${nodeFill} ${nodeStroke} stroke-2`}
                      />
                    )}
                    {node.type === "service" && (
                      <polygon
                        points={`${node.x},${node.y - size} ${node.x + size},${node.y + size} ${node.x - size},${node.y + size}`}
                        className={`${nodeFill} ${nodeStroke} stroke-2`}
                      />
                    )}
                    
                    {/* Status indicator (small circle on top-right) */}
                    {node.resolved !== null && node.resolved !== undefined && (
                      <circle
                        cx={node.x + size * 0.7}
                        cy={node.y - size * 0.7}
                        r={size * 0.3}
                        className={node.resolved ? "fill-green-500" : "fill-red-500"}
                      />
                    )}
                    {node.reachable !== null && node.reachable !== undefined && (
                      <circle
                        cx={node.x + size * 0.7}
                        cy={node.y - size * 0.7}
                        r={size * 0.3}
                        className={node.reachable ? "fill-green-500" : "fill-red-500"}
                      />
                    )}
                    
                    {/* Node label */}
                    <text
                      x={node.x}
                      y={node.y + size + 16}
                      textAnchor="middle"
                      className="fill-foreground text-xs font-medium"
                      style={{ fontSize: "11px" }}
                    >
                      {node.label.length > 25 ? node.label.substring(0, 25) + "..." : node.label}
                    </text>
                    
                    {/* Type badge */}
                    <text
                      x={node.x}
                      y={node.y + size + 30}
                      textAnchor="middle"
                      className="fill-muted-foreground text-xs"
                      style={{ fontSize: "9px" }}
                    >
                      {node.type}
                    </text>
                  </motion.g>
                );
              })}
            </svg>

            {/* Legend */}
            <div className="absolute bottom-4 left-4 p-4 bg-card/95 backdrop-blur-sm rounded-lg border border-border shadow-lg">
              <button
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowLegend((v) => !v)}
              >
                <HelpCircle className="w-4 h-4" />
                Legend
              </button>
              {showLegend && (
                <div className="mt-3 space-y-2">
                  {[
                    { type: "Domain", shape: "Hex" },
                    { type: "Subdomain", shape: "Square" },
                    { type: "IP Address", shape: "Circle" },
                  ].map((item) => (
                    <div key={item.type} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{item.type}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
                        {item.shape}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-border mt-2">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                      <span className="text-xs text-muted-foreground">Resolved/Reachable</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <XCircle className="w-3 h-3 text-red-500" />
                      <span className="text-xs text-muted-foreground">Unresolved/Not Reachable</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {hoverNode && hoverPos && (
              <div
                className="absolute z-10 pointer-events-none bg-card/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs text-foreground shadow-lg"
                style={{ left: hoverPos.x + 12, top: hoverPos.y + 12 }}
              >
                <div className="font-medium">{hoverNode.label}</div>
                <div className="text-muted-foreground capitalize">{hoverNode.type}</div>
                {hoverNode.resolved !== null && hoverNode.resolved !== undefined && (
                  <div className={hoverNode.resolved ? "text-green-600" : "text-red-600"}>
                    {hoverNode.resolved ? "Resolved" : "Unresolved"}
                  </div>
                )}
                {hoverNode.reachable !== null && hoverNode.reachable !== undefined && (
                  <div className={hoverNode.reachable ? "text-green-600" : "text-red-600"}>
                    {hoverNode.reachable ? "Reachable" : "Not Reachable"}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="h-[700px] flex items-center justify-center">
            <EmptyState
              icon={Globe}
              title="No graph data"
              description={selectedAssetId !== "all" 
                ? "No data found for selected asset. Try selecting a different asset."
                : "No domains or subdomains found. Start a discovery to populate the graph."}
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
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`p-2 rounded-lg ${getNodeFill(selectedNode.resolved, selectedNode.reachable)} ${getNodeStroke(selectedNode.type)} border`}>
                    {(() => {
                      const Icon = getNodeIcon(selectedNode.type);
                      return <Icon className="w-4 h-4 text-white" />;
                    })()}
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{selectedNode.label}</div>
                    <div className="text-sm text-muted-foreground capitalize">{selectedNode.type}</div>
                  </div>
                </div>
                
                {/* Status badges */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedNode.resolved !== null && selectedNode.resolved !== undefined && (
                    <Badge variant={selectedNode.resolved ? "default" : "destructive"}>
                      {selectedNode.resolved ? "Resolved" : "Unresolved"}
                    </Badge>
                  )}
                  {selectedNode.reachable !== null && selectedNode.reachable !== undefined && (
                    <Badge variant={selectedNode.reachable ? "default" : "destructive"}>
                      {selectedNode.reachable ? "Reachable" : "Not Reachable"}
                    </Badge>
                  )}
                  {selectedNode.status && (
                    <Badge variant="outline">
                      Status: {selectedNode.status}
                    </Badge>
                  )}
                </div>
                
                {/* Metadata */}
                {selectedNode.metadata && (
                  <div className="mt-3 text-xs text-muted-foreground space-y-1">
                    {selectedNode.metadata.ip_address && (
                      <div>IP: {selectedNode.metadata.ip_address}</div>
                    )}
                    {selectedNode.metadata.port && (
                      <div>Port: {selectedNode.metadata.port}</div>
                    )}
                    {selectedNode.metadata.service_name && (
                      <div>Service: {selectedNode.metadata.service_name}</div>
                    )}
                  </div>
                )}
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
