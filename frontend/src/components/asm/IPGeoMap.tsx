// IP Geo Map — real interactive world map (react-simple-maps + world-atlas
// topojson) with your discovered IPs plotted as markers. Hover for a quick look,
// click to inspect; a country breakdown sits alongside.
//
// Requires:  npm install react-simple-maps

import { Fragment, useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { Globe2, Building2, Network, X, MapPin } from "lucide-react";
import { fetchIPGeoMap, type AsmIPGeoPoint } from "@/lib/services/asm";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface Cluster {
  lon: number;
  lat: number;
  points: AsmIPGeoPoint[];
}

export function IPGeoMap() {
  const [points, setPoints] = useState<AsmIPGeoPoint[]>([]);
  const [countries, setCountries] = useState<Array<{ country: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AsmIPGeoPoint | null>(null);

  useEffect(() => {
    fetchIPGeoMap(undefined, 3000)
      .then((data: any) => {
        setPoints((data.items ?? data.points ?? []).filter((p: AsmIPGeoPoint) => p.latitude != null && p.longitude != null));
        setCountries(data.countries ?? []);
      })
      .catch(() => setPoints([]))
      .finally(() => setLoading(false));
  }, []);

  // Cluster points that round to the same ~2° lon/lat cell.
  const clusters = useMemo<Cluster[]>(() => {
    const cell = 2;
    const grid = new Map<string, Cluster>();
    for (const p of points) {
      const lon = p.longitude as number;
      const lat = p.latitude as number;
      const key = `${Math.round(lon / cell)}:${Math.round(lat / cell)}`;
      const c = grid.get(key);
      if (c) {
        c.points.push(p);
        c.lon = (c.lon * (c.points.length - 1) + lon) / c.points.length;
        c.lat = (c.lat * (c.points.length - 1) + lat) / c.points.length;
      } else {
        grid.set(key, { lon, lat, points: [p] });
      }
    }
    return Array.from(grid.values());
  }, [points]);

  const maxCountry = countries[0]?.count || 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Globe2 className="w-5 h-5 text-primary" /> IP Geo Map
        </h2>
        <p className="text-sm text-muted-foreground">
          Geolocation of your discovered internet-facing IPs. Scroll to zoom, drag to pan, hover a marker for a quick look, click to inspect.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_280px] gap-6">
        {/* Map */}
        <div className="relative rounded-xl border bg-[#0B1120] overflow-hidden">
          {loading ? (
            <div className="h-[420px] flex items-center justify-center text-sm text-slate-400">Loading map…</div>
          ) : (
            <ComposableMap
              projection="geoEqualEarth"
              projectionConfig={{ scale: 165 }}
              style={{ width: "100%", height: "auto" }}
            >
              <ZoomableGroup zoom={1} center={[10, 25]} maxZoom={8}>
                <Geographies geography={GEO_URL}>
                  {({ geographies }: any) =>
                    geographies.map((geo: any) => (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill="#172033"
                        stroke="#243049"
                        strokeWidth={0.4}
                        style={{
                          default: { outline: "none" },
                          hover: { fill: "#1e293b", outline: "none" },
                          pressed: { outline: "none" },
                        }}
                      />
                    ))
                  }
                </Geographies>

                {clusters.map((c, i) => {
                  const n = c.points.length;
                  const r = Math.min(3 + Math.log2(n + 1) * 1.8, 11);
                  const tip = `${c.points[0].ip_address}${c.points[0].country ? ` · ${c.points[0].country}` : ""}${n > 1 ? ` · +${n - 1} more` : ""}`;
                  return (
                    <Marker key={i} coordinates={[c.lon, c.lat]} onClick={() => setSelected(c.points[0])} style={{ default: { cursor: "pointer" } }}>
                      <title>{tip}</title>
                      <circle r={r + 2.5} fill="#22d3ee" opacity={0.15} />
                      <circle r={r} fill="#22d3ee" stroke="#0B1120" strokeWidth={0.8} />
                      {n > 1 && (
                        <text textAnchor="middle" dy={3} fontSize={Math.min(r, 8)} fontWeight={700} fill="#04222b">
                          {n}
                        </text>
                      )}
                    </Marker>
                  );
                })}
              </ZoomableGroup>
            </ComposableMap>
          )}

          {!loading && points.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400 pointer-events-none">
              <div className="text-center">
                <MapPin className="w-6 h-6 mx-auto mb-2 opacity-50" />
                No geolocated IPs yet. Run a discovery to populate the map.
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {selected ? (
            <div className="rounded-xl border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">IP detail</h3>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="font-mono text-sm">{selected.ip_address}</div>
              <dl className="space-y-1.5 text-xs">
                {selected.subdomain && (
                  <div className="flex justify-between"><dt className="text-muted-foreground">Host</dt><dd className="font-mono">{selected.subdomain}</dd></div>
                )}
                <div className="flex justify-between"><dt className="text-muted-foreground flex items-center gap-1"><Globe2 className="w-3 h-3" />Country</dt><dd>{selected.country || "—"}</dd></div>
                {selected.city && <div className="flex justify-between"><dt className="text-muted-foreground">City</dt><dd>{selected.city}</dd></div>}
                <div className="flex justify-between"><dt className="text-muted-foreground flex items-center gap-1"><Network className="w-3 h-3" />ASN</dt><dd>{selected.asn || "—"}</dd></div>
                {selected.asn_org && <div className="flex justify-between"><dt className="text-muted-foreground flex items-center gap-1"><Building2 className="w-3 h-3" />Org</dt><dd className="text-right">{selected.asn_org}</dd></div>}
              </dl>
            </div>
          ) : (
            <div className="rounded-xl border p-4">
              <h3 className="font-semibold text-sm mb-3">Countries ({countries.length})</h3>
              {countries.length === 0 ? (
                <p className="text-xs text-muted-foreground">No data yet.</p>
              ) : (
                <div className="space-y-2">
                  {countries.slice(0, 12).map((c) => (
                    <Fragment key={c.country}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span>{c.country}</span>
                        <span className="text-muted-foreground tabular-nums">{c.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400" style={{ width: `${(c.count / maxCountry) * 100}%` }} />
                      </div>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border p-4 text-xs text-muted-foreground">
            <div className="flex items-center justify-between"><span>Total IPs</span><span className="font-semibold text-foreground tabular-nums">{points.length}</span></div>
            <div className="flex items-center justify-between mt-1"><span>Marker clusters</span><span className="font-semibold text-foreground tabular-nums">{clusters.length}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
