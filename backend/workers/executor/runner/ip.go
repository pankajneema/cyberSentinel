package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"workers/database"
	"workers/executor/tools/httpx"
	"workers/executor/tools/nmap"
	"workers/utils"
)

type ipSeed struct {
	AssetID    string `json:"asset_id"`
	Target     string `json:"target"`
	Source     string `json:"source"`
	Confidence int    `json:"confidence"`
}

func buildIPSeedTargets(ctx context.Context, jobID, assetID string) ([]ipSeed, []string, error) {
	seeds := make([]ipSeed, 0)
	ipSet := map[string]bool{}
	ips := make([]string, 0)

	appendTarget := func(raw, source string, confidence int) {
		for _, ip := range expandIPTargets(raw) {
			if ipSet[ip] {
				continue
			}
			ipSet[ip] = true
			ips = append(ips, ip)
			seeds = append(seeds, ipSeed{
				AssetID:    assetID,
				Target:     ip,
				Source:     source,
				Confidence: confidence,
			})
		}
	}

	if assetID != "" {
		var assetName string
		err := database.QueryRow(ctx, `SELECT name FROM assets WHERE id = $1 LIMIT 1`, assetID).Scan(&assetName)
		if err == nil && strings.TrimSpace(assetName) != "" {
			appendTarget(assetName, "asset_declared", 95)
		}
	}

	var targetSource string
	var manualTargetsRaw []byte
	err := database.QueryRow(
		ctx,
		`SELECT target_source::text, manual_targets::text FROM asm_discoveries WHERE id = $1 LIMIT 1`,
		jobID,
	).Scan(&targetSource, &manualTargetsRaw)
	if err == nil && strings.EqualFold(targetSource, "MANUAL_ENTRY") && len(manualTargetsRaw) > 0 {
		var manualTargets []string
		if parseErr := json.Unmarshal(manualTargetsRaw, &manualTargets); parseErr == nil {
			for _, target := range manualTargets {
				appendTarget(target, "manual_entry", 100)
			}
		}
	}

	if len(ips) == 0 {
		return seeds, ips, errors.New("no IP targets resolved from assets/manual input")
	}
	return seeds, ips, nil
}

func expandIPTargets(raw string) []string {
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
			for _, ip := range expandCIDR(part, 4096) {
				if !seen[ip] {
					seen[ip] = true
					results = append(results, ip)
				}
			}
			continue
		}
		if ip, err := netip.ParseAddr(part); err == nil {
			ipStr := ip.String()
			if !seen[ipStr] {
				seen[ipStr] = true
				results = append(results, ipStr)
			}
		}
	}
	return results
}

func expandCIDR(cidr string, limit int) []string {
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

func ipsFromResult(result map[string]interface{}, key string) []string {
	raw, ok := result[key]
	if !ok {
		return nil
	}
	var ips []string
	switch v := raw.(type) {
	case []string:
		ips = append(ips, v...)
	case []interface{}:
		for _, item := range v {
			switch iv := item.(type) {
			case string:
				ips = append(ips, strings.TrimSpace(iv))
			case map[string]interface{}:
				if ip, ok := iv["ip"].(string); ok && ip != "" {
					ips = append(ips, strings.TrimSpace(ip))
				}
			}
		}
	}
	return dedupeIPs(ips)
}

func collectIPTargets(pipeline []ToolResult, upto int, assetID string) []string {
	var seedIPs []string
	var aliveIPs []string
	for i := 0; i < upto; i++ {
		step := pipeline[i]
		if step.Status != "COMPLETED" {
			continue
		}
		if assetID != "" && step.AssetID != "" && step.AssetID != assetID {
			continue
		}
		if step.Step == "ip_target_seed" {
			seedIPs = append(seedIPs, ipsFromResult(step.Result, "ips")...)
		}
		if step.Step == "alive_check" {
			aliveIPs = append(aliveIPs, ipsFromResult(step.Result, "alive")...)
		}
	}
	if len(aliveIPs) > 0 {
		return dedupeIPs(aliveIPs)
	}
	return dedupeIPs(seedIPs)
}

func dedupeIPs(ips []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		ip = strings.TrimSpace(ip)
		if ip == "" || seen[ip] {
			continue
		}
		seen[ip] = true
		out = append(out, ip)
	}
	return out
}

func runAliveCheck(ctx context.Context, ips []string) ([]string, []string) {
	alive := make([]string, 0)
	dead := make([]string, 0)
	if len(ips) == 0 {
		return alive, dead
	}

	nmapPath, err := exec.LookPath("nmap")
	if err == nil {
		targetSpec := strings.Join(ips, " ")
		cmd := exec.CommandContext(ctx, "bash", "-lc", fmt.Sprintf("%s -sn -n -T3 %s", nmapPath, targetSpec))
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

func runNmapPortScan(ctx context.Context, ips []string, topPorts int, full bool, udp bool) []map[string]interface{} {
	results := make([]map[string]interface{}, 0)
	if len(ips) == 0 {
		return results
	}

	nmapPath, err := exec.LookPath("nmap")
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

func portsByIP(ports []map[string]interface{}) map[string][]int {
	out := map[string][]int{}
	for _, item := range ports {
		ip, _ := item["ip"].(string)
		portRaw, ok := item["port"]
		if ip == "" || !ok {
			continue
		}
		var port int
		switch v := portRaw.(type) {
		case int:
			port = v
		case float64:
			port = int(v)
		}
		if port <= 0 {
			continue
		}
		out[ip] = append(out[ip], port)
	}
	return out
}

func runServiceFingerprint(ctx context.Context, ports []map[string]interface{}, intensity string) []map[string]interface{} {
	grouped := portsByIP(ports)
	if len(grouped) == 0 {
		return nil
	}
	services := make([]map[string]interface{}, 0)
	for ip, ipPorts := range grouped {
		svc, err := nmap.RunServiceDetection(ctx, []string{ip}, ipPorts)
		if err != nil {
			utils.Logger.Warnf("service detection failed for %s intensity=%s err=%v", ip, intensity, err)
			continue
		}
		for _, s := range svc {
			services = append(services, map[string]interface{}{
				"ip":       s.IP,
				"port":     s.Port,
				"service":  s.Service,
				"version":  s.Version,
				"product":  s.Product,
				"protocol": "tcp",
			})
		}
	}
	return services
}

func runHTTPProbeForIPs(ctx context.Context, ips []string) []map[string]interface{} {
	if len(ips) == 0 {
		return nil
	}
	responses, err := httpx.RunHTTPStatus(ctx, ips)
	if err != nil {
		utils.Logger.Warnf("ip http probe failed: %v", err)
		return nil
	}
	out := make([]map[string]interface{}, 0, len(responses))
	for _, r := range responses {
		out = append(out, map[string]interface{}{
			"ip":          r.URL,
			"status_code": r.StatusCode,
			"https":       r.HTTPS,
			"title":       r.Title,
			"server":      r.Server,
		})
	}
	return out
}

func runIPGeoEnrichment(ctx context.Context, ips []string) []map[string]interface{} {
	client := http.Client{Timeout: 3 * time.Second}
	out := make([]map[string]interface{}, 0)
	for _, ip := range ips {
		req, _ := http.NewRequestWithContext(
			ctx,
			http.MethodGet,
			fmt.Sprintf("http://ip-api.com/json/%s?fields=status,country,countryCode,regionName,city,lat,lon,as,isp", ip),
			nil,
		)
		resp, err := client.Do(req)
		if err != nil || resp == nil {
			continue
		}
		var payload map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&payload)
		_ = resp.Body.Close()
		if payload["status"] != "success" {
			continue
		}
		asnRaw, _ := payload["as"].(string)
		asn := ""
		asnOrg := ""
		if asnRaw != "" {
			parts := strings.SplitN(asnRaw, " ", 2)
			asn = parts[0]
			if len(parts) > 1 {
				asnOrg = parts[1]
			}
		}
		out = append(out, map[string]interface{}{
			"ip":           ip,
			"country":      payload["country"],
			"country_code": payload["countryCode"],
			"region":       payload["regionName"],
			"city":         payload["city"],
			"latitude":     payload["lat"],
			"longitude":    payload["lon"],
			"asn":          asn,
			"asn_org":      asnOrg,
			"isp":          payload["isp"],
		})
	}
	return out
}

func runRDAPLookup(ctx context.Context, ips []string) []map[string]interface{} {
	client := http.Client{Timeout: 4 * time.Second}
	out := make([]map[string]interface{}, 0)
	for _, ip := range ips {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://rdap.org/ip/"+ip, nil)
		resp, err := client.Do(req)
		if err != nil || resp == nil {
			continue
		}
		var payload map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&payload)
		_ = resp.Body.Close()
		out = append(out, map[string]interface{}{
			"ip":           ip,
			"name":         payload["name"],
			"country":      payload["country"],
			"startAddress": payload["startAddress"],
			"endAddress":   payload["endAddress"],
			"handle":       payload["handle"],
		})
	}
	return out
}

func scoreExposure(ports []map[string]interface{}) map[string]map[string]interface{} {
	perIP := map[string][]int{}
	for _, p := range ports {
		ip, _ := p["ip"].(string)
		portRaw, ok := p["port"]
		if ip == "" || !ok {
			continue
		}
		port := 0
		switch v := portRaw.(type) {
		case int:
			port = v
		case float64:
			port = int(v)
		}
		if port > 0 {
			perIP[ip] = append(perIP[ip], port)
		}
	}

	sensitive := map[int]string{
		22:    "Remote Access Exposed",
		23:    "Unencrypted Remote Access",
		3389:  "Remote Desktop Exposed",
		5900:  "Remote Desktop Exposed",
		3306:  "Database Publicly Accessible",
		5432:  "Database Publicly Accessible",
		27017: "Database Publicly Accessible",
		6379:  "Cache Publicly Accessible",
		9200:  "Search Engine Exposed",
		2375:  "Container Runtime Exposed",
		6443:  "K8s API Exposed",
		445:   "File Sharing Exposed",
	}

	results := map[string]map[string]interface{}{}
	for ip, ipPorts := range perIP {
		score := len(ipPorts) * 3
		reasons := make([]string, 0)
		for _, port := range ipPorts {
			if reason, ok := sensitive[port]; ok {
				score += 12
				reasons = append(reasons, reason)
			}
		}
		level := "Low Exposure"
		if score >= 70 {
			level = "Highly Exposed"
		} else if score >= 40 {
			level = "Moderately Exposed"
		}
		results[ip] = map[string]interface{}{
			"score":   minInt(score, 100),
			"level":   level,
			"reasons": reasons,
		}
	}
	return results
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
