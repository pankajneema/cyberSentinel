package runner

import "fmt"

func collectSubdomainsFromPipeline(pipeline []ToolResult, upto int) []string {
	var subdomains []string
	seen := make(map[string]bool)
	relevantSteps := map[string]bool{
		"subdomain_discovery": true,
		"cert_intel":          true,
		"deep_discovery":      true,
		"recursive_discovery": true,
		"recursive_osint":     true,
		"subdomain_expansion": true,
	}
	for j := 0; j < upto; j++ {
		if !relevantSteps[pipeline[j].Step] || pipeline[j].Status != "COMPLETED" {
			continue
		}
		result := pipeline[j].Result
		if subdomainsData, ok := result["subdomains"].([]interface{}); ok {
			for _, sd := range subdomainsData {
				if sdStr, ok := sd.(string); ok {
					if sdStr != "" && !seen[sdStr] {
						subdomains = append(subdomains, sdStr)
						seen[sdStr] = true
					}
				}
			}
		} else if data, ok := result["data"].([]interface{}); ok {
			for _, item := range data {
				if sdStr, ok := item.(string); ok {
					if sdStr != "" && !seen[sdStr] {
						subdomains = append(subdomains, sdStr)
						seen[sdStr] = true
					}
				}
			}
		} else if candidates, ok := result["candidates"].([]interface{}); ok {
			for _, item := range candidates {
				if sdStr, ok := item.(string); ok {
					if sdStr != "" && !seen[sdStr] {
						subdomains = append(subdomains, sdStr)
						seen[sdStr] = true
					}
				}
			}
		} else if data, ok := result["data"].([]string); ok {
			for _, sdStr := range data {
				if sdStr != "" && !seen[sdStr] {
					subdomains = append(subdomains, sdStr)
					seen[sdStr] = true
				}
			}
		}
	}
	return subdomains
}

// collectCloudResourcesFromPipeline gathers cloud-resource maps emitted by the
// cloud asset-type stages (and the domain cloud stage) in prior steps. Handles
// both []map[string]interface{} (in-process) and []interface{} (post-JSON).
func collectCloudResourcesFromPipeline(pipeline []ToolResult, upto int) []map[string]interface{} {
	var out []map[string]interface{}
	cloudSteps := map[string]bool{
		"public_endpoint_detect": true,
		"config_review_readonly": true,
		"full_osint_correlation": true,
		"cloud_exposure_detect":  true,
	}
	for j := 0; j < upto && j < len(pipeline); j++ {
		if !cloudSteps[pipeline[j].Step] || pipeline[j].Status != "COMPLETED" {
			continue
		}
		res, ok := pipeline[j].Result["resources"]
		if !ok {
			continue
		}
		switch v := res.(type) {
		case []map[string]interface{}:
			out = append(out, v...)
		case []interface{}:
			for _, item := range v {
				if m, ok := item.(map[string]interface{}); ok {
					out = append(out, m)
				}
			}
		}
	}
	return out
}

func collectIPsFromResolutionSteps(pipeline []ToolResult, upto int) []string {
	var ips []string
	ipSet := make(map[string]bool)
	for j := 0; j < upto; j++ {
		if (pipeline[j].Step == "dns_resolution" || pipeline[j].Step == "ip_mapping") &&
			pipeline[j].Status == "COMPLETED" {
			result := pipeline[j].Result
			if resolved, ok := result["resolved"].([]interface{}); ok {
				for _, item := range resolved {
					if itemMap, ok := item.(map[string]interface{}); ok {
						if ipList, ok := itemMap["ips"].([]interface{}); ok {
							for _, ip := range ipList {
								if ipStr, ok := ip.(string); ok {
									if !ipSet[ipStr] {
										ips = append(ips, ipStr)
										ipSet[ipStr] = true
									}
								}
							}
						}
					}
				}
			} else if resolved, ok := result["resolved"].([]map[string]interface{}); ok {
				for _, itemMap := range resolved {
					if ipList, ok := itemMap["ips"].([]string); ok {
						for _, ipStr := range ipList {
							if ipStr != "" && !ipSet[ipStr] {
								ips = append(ips, ipStr)
								ipSet[ipStr] = true
							}
						}
					} else if ipList, ok := itemMap["ips"].([]interface{}); ok {
						for _, ip := range ipList {
							if ipStr, ok := ip.(string); ok && ipStr != "" && !ipSet[ipStr] {
								ips = append(ips, ipStr)
								ipSet[ipStr] = true
							}
						}
					}
				}
			}
		}
	}
	return ips
}

func collectPortsFromCommonScan(pipeline []ToolResult, upto int) []int {
	var ports []int
	for j := 0; j < upto; j++ {
		if pipeline[j].Step == "common_port_scan" &&
			pipeline[j].Status == "COMPLETED" {
			result := pipeline[j].Result
			if portList, ok := result["ports"].([]interface{}); ok {
				for _, p := range portList {
					if portMap, ok := p.(map[string]interface{}); ok {
						if port, ok := portMap["port"].(float64); ok {
							ports = append(ports, int(port))
						}
					}
				}
			} else if portList, ok := result["ports"].([]map[string]interface{}); ok {
				for _, portMap := range portList {
					if port, ok := portMap["port"].(int); ok {
						ports = append(ports, port)
					} else if port, ok := portMap["port"].(float64); ok {
						ports = append(ports, int(port))
					}
				}
			}
		}
	}
	return ports
}

func toInterfaceMapSlice(items []map[string]interface{}) []interface{} {
	out := make([]interface{}, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}

func summaryChangeMessage(entity string, count int) string {
	return fmt.Sprintf("%s diff completed; %d changes detected", entity, count)
}
