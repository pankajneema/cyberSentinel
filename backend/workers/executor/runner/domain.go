package runner

import "fmt"

func collectSubdomainsFromPipeline(pipeline []ToolResult, upto int) []string {
	var subdomains []string
	for j := 0; j < upto; j++ {
		if pipeline[j].Step != "subdomain_discovery" || pipeline[j].Status != "COMPLETED" {
			continue
		}
		result := pipeline[j].Result
		if subdomainsData, ok := result["subdomains"].([]interface{}); ok {
			for _, sd := range subdomainsData {
				if sdStr, ok := sd.(string); ok {
					subdomains = append(subdomains, sdStr)
				}
			}
		} else if data, ok := result["data"].([]interface{}); ok {
			for _, item := range data {
				if sdStr, ok := item.(string); ok {
					subdomains = append(subdomains, sdStr)
				}
			}
		} else if data, ok := result["data"].([]string); ok {
			subdomains = data
		}
		break
	}
	return subdomains
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
