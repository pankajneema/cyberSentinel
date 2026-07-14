package tools

import (
	"context"
	"net"
	"net/netip"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"worker/utils"
)

// ASM IP-pipeline tool adapters. Ported from the old worker's
// backend/workers/executor/runner/{ip.go,task.go}. Each self-registers under the
// tool name the PipelineConfig references. IP scanning is gated by the
// authoritative SSRF guard (isForbiddenScanIPv2 / expandCIDRv2, ported verbatim
// from ip.go) so private/link-local/metadata/loopback addresses are never
// scanned — this defeats DNS rebinding since the guard runs AFTER CIDR
// expansion and target normalization.

func init() {
	Register(ipSeedTool{})
	Register(ipAliveTool{"ip_alive_check"})
	Register(ipAliveTool{"ip_alive_check_deep"})
	// light/normal/deep + udp differ only by port breadth (top-ports/full/udp),
	// mirroring the old runNmapPortScan(ctx, ips, topPorts, full, udp) args.
	Register(ipPortScanTool{"ip_port_scan_light", 100, false, false})
	Register(ipPortScanTool{"ip_port_scan_normal", 1000, false, false})
	Register(ipPortScanTool{"ip_port_scan_deep", 0, true, false})
	Register(ipPortScanTool{"ip_udp_scan_normal", 20, false, true})
	Register(ipPortScanTool{"ip_udp_scan_deep", 100, false, true})
}

// ---------------------------------------------------------------------------
// SSRF guard + CIDR expansion — ported verbatim from ip.go (CWE-918). Suffixed
// "v2" to keep names unique within package tools.
// ---------------------------------------------------------------------------

// isForbiddenScanIPv2 reports whether an address must never be scanned:
// loopback, RFC1918/ULA private, link-local (incl. 169.254.169.254 cloud
// metadata), multicast, or the unspecified address. Applied AFTER DNS
// resolution/CIDR expansion so it also defeats DNS rebinding.
func isForbiddenScanIPv2(s string) bool {
	ip, err := netip.ParseAddr(s)
	if err != nil {
		return true // unparseable -> drop
	}
	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified()
}

// expandIPTargetsV2 splits a raw target string on commas/whitespace, expands any
// CIDR, and drops every forbidden/unparseable address via the SSRF guard.
func expandIPTargetsV2(raw string) []string {
	cleaned := strings.TrimSpace(raw)
	if cleaned == "" {
		return nil
	}
	parts := strings.FieldsFunc(cleaned, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\t' || r == ' '
	})
	results := make([]string, 0)
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "/") {
			for _, ip := range expandCIDRv2(part, 4096) {
				if !seen[ip] && !isForbiddenScanIPv2(ip) {
					seen[ip] = true
					results = append(results, ip)
				}
			}
			continue
		}
		if ip, err := netip.ParseAddr(part); err == nil {
			ipStr := ip.String()
			if !seen[ipStr] && !isForbiddenScanIPv2(ipStr) {
				seen[ipStr] = true
				results = append(results, ipStr)
			}
		}
	}
	return results
}

// expandCIDRv2 enumerates the addresses of a CIDR up to limit.
func expandCIDRv2(cidr string, limit int) []string {
	prefix, err := netip.ParsePrefix(cidr)
	if err != nil {
		return nil
	}
	prefix = prefix.Masked()
	addr := prefix.Addr()
	if !addr.IsValid() {
		return nil
	}
	out := make([]string, 0)
	for current := addr; prefix.Contains(current); current = current.Next() {
		out = append(out, current.String())
		if len(out) >= limit {
			break
		}
	}
	return out
}

// dedupeIPsV2 unions IPs, dropping blanks/dupes and (authoritatively) any
// forbidden/reserved address that reached us via resolution or CIDR expansion.
func dedupeIPsV2(ips []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		ip = strings.TrimSpace(ip)
		if ip == "" || seen[ip] {
			continue
		}
		if isForbiddenScanIPv2(ip) {
			continue
		}
		seen[ip] = true
		out = append(out, ip)
	}
	return out
}

// scannableIPs resolves the IP targets for a scan stage: prior Type "ip"
// findings (seeded/alive), falling back to the seed roots, each normalized and
// SSRF-guarded via expandIPTargetsV2.
func scannableIPs(in Input) []string {
	sources := Subjects(in, TypeIP)
	if len(sources) == 0 {
		sources = roots(in)
	}
	var all []string
	for _, s := range sources {
		all = append(all, expandIPTargetsV2(s)...)
	}
	return dedupeIPsV2(all)
}

// ---------------------------------------------------------------------------
// ip_target_seed — seed IP targets from in.Targets, expand CIDRs, SSRF-guard.
// ---------------------------------------------------------------------------

type ipSeedTool struct{}

func (ipSeedTool) Name() string { return "ip_target_seed" }

func (ipSeedTool) Run(ctx context.Context, in Input) (Output, error) {
	var ips []string
	for _, raw := range roots(in) {
		ips = append(ips, expandIPTargetsV2(raw)...)
	}
	ips = dedupeIPsV2(ips)
	out := Output{Raw: map[string]any{"count": len(ips), "ips": ips}}
	for _, ip := range ips {
		out.Findings = append(out.Findings, Finding{
			Type: TypeIP, Target: ip,
			Data: map[string]any{"source": "ip_target_seed", "confidence": 100},
		})
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// ip_alive_check / ip_alive_check_deep — liveness over prior Type "ip" targets.
// ---------------------------------------------------------------------------

type ipAliveTool struct{ name string }

func (t ipAliveTool) Name() string { return t.name }

func (t ipAliveTool) Run(ctx context.Context, in Input) (Output, error) {
	ips := scannableIPs(in)
	alive, dead := runAliveCheckV2(ctx, ips)
	out := Output{Raw: map[string]any{
		"alive":         alive,
		"dead":          dead,
		"is_alive":      len(alive) > 0,
		"response_type": "icmp_or_tcp",
		"checked_at":    time.Now().UTC().Format(time.RFC3339),
	}}
	// Keep "ip": re-emit alive IPs so downstream port scans consume live hosts.
	for _, ip := range alive {
		out.Findings = append(out.Findings, Finding{
			Type: TypeIP, Target: ip, Data: map[string]any{"alive": true},
		})
	}
	return out, nil
}

// runAliveCheckV2 ports ip.go: nmap -sn ping sweep (args passed directly, no
// shell — CWE-78), falling back to a TCP 80/443 dial probe when nmap is absent.
func runAliveCheckV2(ctx context.Context, ips []string) ([]string, []string) {
	alive := make([]string, 0)
	dead := make([]string, 0)
	if len(ips) == 0 {
		return alive, dead
	}

	nmapPath, err := utils.LookPath("nmap")
	if err == nil {
		args := append([]string{"-sn", "-n", "-T3"}, ips...)
		cmd := exec.CommandContext(ctx, nmapPath, args...)
		out, runErr := cmd.CombinedOutput()
		if runErr == nil || len(out) > 0 {
			aliveSet := map[string]bool{}
			var current string
			for _, line := range strings.Split(string(out), "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "Nmap scan report for ") {
					current = strings.TrimSpace(strings.TrimPrefix(line, "Nmap scan report for "))
				}
				if current != "" && strings.Contains(line, "Host is up") {
					aliveSet[current] = true
				}
			}
			for _, ip := range ips {
				if aliveSet[ip] {
					alive = append(alive, ip)
				} else {
					dead = append(dead, ip)
				}
			}
			return alive, dead
		}
	}

	for _, ip := range ips {
		isAlive := false
		for _, port := range []string{"80", "443"} {
			conn, dialErr := net.DialTimeout("tcp", net.JoinHostPort(ip, port), 1200*time.Millisecond)
			if conn != nil {
				_ = conn.Close()
				isAlive = true
				break
			}
			if dialErr != nil && strings.Contains(strings.ToLower(dialErr.Error()), "refused") {
				isAlive = true
				break
			}
		}
		if isAlive {
			alive = append(alive, ip)
		} else {
			dead = append(dead, ip)
		}
	}
	return alive, dead
}

// ---------------------------------------------------------------------------
// ip_port_scan_* / ip_udp_scan_* — nmap port scan over prior Type "ip" targets.
// ---------------------------------------------------------------------------

type ipPortScanTool struct {
	name     string
	topPorts int
	full     bool
	udp      bool
}

func (t ipPortScanTool) Name() string { return t.name }

func (t ipPortScanTool) Run(ctx context.Context, in Input) (Output, error) {
	ips := scannableIPs(in)
	ports := runNmapPortScanV2(ctx, ips, t.topPorts, t.full, t.udp)
	out := Output{Raw: map[string]any{"count": len(ports)}}
	keepIP := map[string]bool{}
	for _, p := range ports {
		ip, _ := p["ip"].(string)
		port, _ := p["port"].(int)
		proto, _ := p["protocol"].(string)
		out.Findings = append(out.Findings, Finding{
			Type: "port", Target: ip,
			Data: map[string]any{"ip": ip, "port": port, "protocol": proto},
		})
		if ip != "" && !keepIP[ip] {
			keepIP[ip] = true
		}
	}
	// Keep "ip": propagate the scanned hosts so later stages still see them.
	for _, ip := range ips {
		out.Findings = append(out.Findings, Finding{Type: TypeIP, Target: ip})
	}
	return out, nil
}

// runNmapPortScanV2 ports ip.go verbatim: nmap grepable scan, args passed
// directly (no shell). full=-p-, else --top-ports N; udp=-sU.
func runNmapPortScanV2(ctx context.Context, ips []string, topPorts int, full bool, udp bool) []map[string]interface{} {
	results := make([]map[string]interface{}, 0)
	if len(ips) == 0 {
		return results
	}

	nmapPath, err := utils.LookPath("nmap")
	if err != nil {
		return results
	}

	for _, ip := range ips {
		args := []string{"-n", "-Pn", "--open", "-oG", "-"}
		if udp {
			args = append(args, "-sU")
		}
		if full {
			args = append(args, "-p-")
		} else {
			args = append(args, "--top-ports", strconv.Itoa(topPorts))
		}
		args = append(args, ip)

		cmd := exec.CommandContext(ctx, nmapPath, args...)
		out, _ := cmd.CombinedOutput()
		for _, line := range strings.Split(string(out), "\n") {
			if !strings.Contains(line, "Ports:") {
				continue
			}
			portChunk := strings.SplitN(line, "Ports:", 2)
			if len(portChunk) != 2 {
				continue
			}
			for _, p := range strings.Split(portChunk[1], ",") {
				p = strings.TrimSpace(p)
				parts := strings.Split(p, "/")
				if len(parts) < 3 {
					continue
				}
				portNo, convErr := strconv.Atoi(parts[0])
				if convErr != nil || !strings.EqualFold(parts[1], "open") {
					continue
				}
				protocol := strings.ToLower(parts[2])
				results = append(results, map[string]interface{}{
					"ip":       ip,
					"port":     portNo,
					"protocol": protocol,
				})
			}
		}
	}
	return results
}
