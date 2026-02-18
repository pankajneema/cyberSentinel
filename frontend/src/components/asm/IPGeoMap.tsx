import { useEffect, useMemo, useState } from "react";
import { MapPinned, Globe2, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchIPGeoMap, type AsmIPGeoPoint } from "@/lib/services/asm";

export function IPGeoMap() {
  const [points, setPoints] = useState<AsmIPGeoPoint[]>([]);
  const [countries, setCountries] = useState<Array<{ country: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredCluster, setHoveredCluster] = useState<{
    x: number;
    y: number;
    count: number;
    sample: AsmIPGeoPoint;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchIPGeoMap(undefined, 3000);
        setPoints(data.items || []);
        setCountries(data.countries || []);
      } catch (err) {
        console.error("Failed to load geo map data:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const maxCountryCount = useMemo(
    () => Math.max(1, ...countries.map((c) => c.count)),
    [countries]
  );

  const clusters = useMemo(() => {
    const byLocation = new Map<string, { lat: number; lon: number; items: AsmIPGeoPoint[] }>();
    for (const p of points) {
      if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
      // Cluster nearby markers while keeping geo position stable.
      const lat = Number(p.latitude.toFixed(1));
      const lon = Number(p.longitude.toFixed(1));
      const key = `${lat}:${lon}`;
      const existing = byLocation.get(key);
      if (existing) {
        existing.items.push(p);
      } else {
        byLocation.set(key, { lat, lon, items: [p] });
      }
    }
    return Array.from(byLocation.values());
  }, [points]);

  const countryCenters = useMemo(() => {
    const map = new Map<string, { country: string; count: number; latSum: number; lonSum: number }>();
    for (const c of clusters) {
      const sample = c.items[0];
      const country = sample.country || "Unknown";
      const existing = map.get(country);
      if (existing) {
        existing.count += c.items.length;
        existing.latSum += c.lat * c.items.length;
        existing.lonSum += c.lon * c.items.length;
      } else {
        map.set(country, {
          country,
          count: c.items.length,
          latSum: c.lat * c.items.length,
          lonSum: c.lon * c.items.length,
        });
      }
    }
    return Array.from(map.values())
      .map((x) => ({
        country: x.country,
        count: x.count,
        lat: x.latSum / x.count,
        lon: x.lonSum / x.count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [clusters]);

  const networkLinks = useMemo(() => {
    const nodes = clusters.map((cluster) => {
      const x = ((cluster.lon + 180) / 360) * 1000;
      const y = ((90 - cluster.lat) / 180) * 500;
      return { x, y, weight: cluster.items.length };
    });

    const links: Array<{ x1: number; y1: number; x2: number; y2: number; w: number }> = [];
    for (let i = 0; i < nodes.length; i++) {
      const src = nodes[i];
      const nearest = nodes
        .map((dst, j) => ({ j, d: Math.hypot(src.x - dst.x, src.y - dst.y) }))
        .filter((v) => v.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);

      for (const n of nearest) {
        if (n.d > 320) continue;
        const dst = nodes[n.j];
        const x1 = Math.min(src.x, dst.x);
        const x2 = Math.max(src.x, dst.x);
        const y1 = src.x <= dst.x ? src.y : dst.y;
        const y2 = src.x <= dst.x ? dst.y : src.y;
        links.push({ x1, y1, x2, y2, w: Math.min(src.weight, dst.weight) });
      }
    }
    return links.slice(0, 140);
  }, [clusters]);

  const stars = useMemo(
    () =>
      Array.from({ length: 130 }).map((_, i) => {
        const x = (i * 73) % 1000;
        const y = (i * 41 + (i % 7) * 13) % 500;
        const r = ((i * 37) % 100) < 12 ? 1.6 : ((i * 37) % 100) < 45 ? 1.1 : 0.8;
        return { x, y, r };
      }),
    []
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <MapPinned className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">IP Geolocation Map</h3>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading geolocation map...</div>
        ) : points.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No geolocation data found. Run `NORMAL` or `DEEP` discovery to enrich IPs.
          </div>
        ) : (
          <div className="relative w-full overflow-hidden rounded-xl border border-[#1e3f78] bg-[#06102b]" style={{ aspectRatio: "2 / 1" }}>
            <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
              <defs>
                <filter id="pointGlow" x="-300%" y="-300%" width="700%" height="700%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3.2" floodColor="#7cc5ff" floodOpacity="0.95" />
                </filter>
                <linearGradient id="mapBg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0b1b49" />
                  <stop offset="100%" stopColor="#050d22" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width="1000" height="500" fill="url(#mapBg)" />
              <image
                href="https://upload.wikimedia.org/wikipedia/commons/8/80/World_map_-_low_resolution.svg"
                x="0"
                y="0"
                width="1000"
                height="500"
                preserveAspectRatio="none"
                opacity="0.45"
              />
              {stars.map((s, i) => (
                <circle key={`star-${i}`} cx={s.x} cy={s.y} r={s.r} fill="#b9d7ff" opacity="0.55" />
              ))}

              {[...Array(18)].map((_, i) => (
                <line
                  key={`lon-${i}`}
                  x1={(i * 1000) / 17}
                  y1="0"
                  x2={(i * 1000) / 17}
                  y2="500"
                  stroke="#1a4a93"
                  strokeWidth="1"
                  opacity="0.42"
                />
              ))}
              {[...Array(10)].map((_, i) => (
                <line
                  key={`lat-${i}`}
                  x1="0"
                  y1={(i * 500) / 9}
                  x2="1000"
                  y2={(i * 500) / 9}
                  stroke="#1a4a93"
                  strokeWidth="1"
                  opacity="0.42"
                />
              ))}

              {networkLinks.map((link, i) => (
                <line
                  key={`net-${i}`}
                  x1={link.x1}
                  y1={link.y1}
                  x2={link.x2}
                  y2={link.y2}
                  stroke="#62afff"
                  strokeOpacity={Math.min(0.42, 0.18 + link.w * 0.025)}
                  strokeWidth={0.9}
                />
              ))}

              {countryCenters.length > 1 &&
                countryCenters.slice(1, 10).map((center, idx) => {
                  const from = countryCenters[0];
                  const x1 = ((from.lon + 180) / 360) * 1000;
                  const y1 = ((90 - from.lat) / 180) * 500;
                  const x2 = ((center.lon + 180) / 360) * 1000;
                  const y2 = ((90 - center.lat) / 180) * 500;
                  const ctrlX = (x1 + x2) / 2;
                  const ctrlY = Math.min(y1, y2) - Math.max(30, Math.abs(x2 - x1) * 0.12);
                  return (
                    <path
                      key={`arc-${center.country}-${idx}`}
                      d={`M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`}
                      fill="none"
                      stroke="#8bd0ff"
                      strokeWidth="1.6"
                      strokeOpacity="0.8"
                      strokeDasharray="7 7"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        values="0;28"
                        dur={`${2.2 + idx * 0.25}s`}
                        repeatCount="indefinite"
                      />
                    </path>
                  );
                })}

              {clusters.map((cluster, idx) => {
                const x = ((cluster.lon + 180) / 360) * 1000;
                const y = ((90 - cluster.lat) / 180) * 500;
                const count = cluster.items.length;
                const radius = Math.min(14, 4 + Math.log2(count + 1) * 2.2);
                const sample = cluster.items[0];

                return (
                  <g
                    key={`${cluster.lat}-${cluster.lon}-${idx}`}
                    onMouseEnter={() =>
                      setHoveredCluster({
                        x,
                        y,
                        count,
                        sample,
                      })
                    }
                    onMouseLeave={() => setHoveredCluster(null)}
                  >
                    <circle cx={x} cy={y} r={radius + 8} fill="#6fc2ff" opacity="0.13" />
                    <circle cx={x} cy={y} r={radius + 3.4} fill="none" stroke="#9ddaff" strokeWidth="1.7" opacity="0.8" />
                    <circle cx={x} cy={y} r={radius} fill="#b8ecff" filter="url(#pointGlow)">
                      <animate attributeName="r" values={`${radius};${radius + 2};${radius}`} dur="1.8s" repeatCount="indefinite" />
                    </circle>
                    {count > 1 && (
                      <text
                        x={x}
                        y={y + 1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize="10"
                        fill="#08335e"
                        fontWeight="700"
                      >
                        {count}
                      </text>
                    )}
                    <title>
                      {count} IP(s) • {sample.city || "Unknown city"}, {sample.country || "Unknown country"}
                    </title>
                  </g>
                );
              })}
            </svg>
            {hoveredCluster && (
              <div
                className="pointer-events-none absolute z-20 w-64 rounded-lg border border-[#245aa4] bg-[#091b3d]/95 p-2 text-xs text-[#d8edff] shadow-lg"
                style={{
                  left: `${(hoveredCluster.x / 1000) * 100}%`,
                  top: `${(hoveredCluster.y / 500) * 100}%`,
                  transform: "translate(10px, -110%)",
                }}
              >
                <div className="font-mono text-[#93d7ff]">{hoveredCluster.sample.ip_address}</div>
                <div className="mt-1 text-[#d8edff]">
                  {hoveredCluster.sample.city || "Unknown city"}, {hoveredCluster.sample.country || "Unknown country"}
                </div>
                <div className="mt-1 text-[#9eb9dc]">
                  {hoveredCluster.sample.asn || "ASN N/A"} {hoveredCluster.sample.asn_org || ""}
                </div>
                <div className="mt-1 text-[#d8edff]">IPs at this location: {hoveredCluster.count}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Country Distribution</h3>
          </div>
          {countries.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">No distribution data available.</div>
          ) : (
            <div className="space-y-2">
              {countries.slice(0, 10).map((item) => (
                <div key={item.country} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{item.country}</span>
                    <span className="text-muted-foreground">{item.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(item.count / maxCountryCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Sample Geocoded IPs</h3>
          </div>
          <div className="space-y-2">
            {points.slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-xs">
                <div>
                  <div className="font-mono text-foreground">{p.ip_address}</div>
                  <div className="text-muted-foreground">{p.city || "Unknown city"}, {p.country || "Unknown country"}</div>
                </div>
                <Badge variant="outline">{p.asn || "ASN N/A"}</Badge>
              </div>
            ))}
            {points.length === 0 && (
              <div className="py-6 text-sm text-muted-foreground">No geocoded IP rows found.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
