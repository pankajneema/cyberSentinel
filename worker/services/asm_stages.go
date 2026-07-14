package services

import "worker/core"

// asmPipeline is the ASM stage→tool map, ported verbatim from the existing
// backend/workers/services/asm/pipeline_config.go. Keyed by asset type then
// intensity (LIGHT=visibility, NORMAL=exposure, DEEP=risk). The engine resolves
// each Stage.Tool via the tool registry; tools not yet ported to a registered
// adapter are SKIPPED at runtime (visible in task state), so partial pipelines
// degrade gracefully instead of failing.
var asmPipeline = map[string]map[string][]core.Stage{
	"domain": {
		"LIGHT": {
			{Name: "subdomain_discovery", Tool: "subfinder"},
			{Name: "cert_intel", Tool: "crtsh"},
			{Name: "ai_subdomain_probe", Tool: "ai_subdomain_probe"},
			{Name: "dns_resolution", Tool: "dnsx"},
			{Name: "reachability_check", Tool: "http_probe"},
			{Name: "http_status", Tool: "httpx"},
		},
		"NORMAL": {
			{Name: "subdomain_discovery", Tool: "subfinder"},
			{Name: "deep_discovery", Tool: "amass"},
			{Name: "cert_intel", Tool: "crtsh"},
			{Name: "ai_subdomain_probe", Tool: "ai_subdomain_probe"},
			{Name: "dns_resolution", Tool: "dnsx"},
			{Name: "reachability_check", Tool: "http_probe"},
			{Name: "http_status", Tool: "httpx"},
			{Name: "ip_mapping", Tool: "ip_mapping"},
			{Name: "ip_info", Tool: "ipinfo"},
			{Name: "asn_map", Tool: "asnmap"},
			{Name: "common_port_scan", Tool: "top_ports_scanner"},
			{Name: "service_fingerprint", Tool: "service_detector"},
			{Name: "tls_metadata", Tool: "ssl_analyzer"},
			{Name: "api_surface_hint", Tool: "api_detector"},
		},
		"DEEP": {
			{Name: "subdomain_discovery", Tool: "subfinder"},
			{Name: "recursive_discovery", Tool: "amass"},
			{Name: "recursive_osint", Tool: "bbot"},
			{Name: "subdomain_expansion", Tool: "dnsgen"},
			{Name: "cert_intel", Tool: "crtsh"},
			{Name: "ai_subdomain_probe", Tool: "ai_subdomain_probe"},
			{Name: "dns_resolution", Tool: "dnsx"},
			{Name: "reachability_check", Tool: "http_probe"},
			{Name: "http_status", Tool: "httpx"},
			{Name: "ip_mapping", Tool: "ip_mapping"},
			{Name: "ip_info", Tool: "ipinfo"},
			{Name: "asn_map", Tool: "asnmap"},
			{Name: "common_port_scan", Tool: "top_ports_scanner"},
			{Name: "service_fingerprint", Tool: "service_detector"},
			{Name: "tls_metadata", Tool: "ssl_analyzer"},
			{Name: "api_surface_hint", Tool: "api_detector"},
			{Name: "vulnerability_scan", Tool: "nuclei"},
			{Name: "cloud_exposure_detect", Tool: "cloud_osint"},
			{Name: "admin_endpoint_check", Tool: "admin_finder"},
			{Name: "backup_file_check", Tool: "backup_detector"},
			{Name: "change_detection", Tool: "asset_diff_engine"},
		},
	},
	"ip": {
		"LIGHT": {
			{Name: "ip_target_seed", Tool: "ip_target_seed"},
			{Name: "alive_check", Tool: "ip_alive_check"},
			{Name: "common_port_scan", Tool: "ip_port_scan_light"},
			{Name: "service_fingerprint", Tool: "ip_service_fingerprint_light"},
			{Name: "http_status", Tool: "ip_http_probe_light"},
			{Name: "asn_geo_mapping", Tool: "ip_enrichment_cached"},
			{Name: "change_detection", Tool: "ip_diff"},
			{Name: "exposure_scoring", Tool: "ip_exposure_score"},
		},
		"NORMAL": {
			{Name: "ip_target_seed", Tool: "ip_target_seed"},
			{Name: "alive_check", Tool: "ip_alive_check"},
			{Name: "common_port_scan", Tool: "ip_port_scan_normal"},
			{Name: "udp_port_scan", Tool: "ip_udp_scan_normal"},
			{Name: "service_fingerprint", Tool: "ip_service_fingerprint_normal"},
			{Name: "banner_grab", Tool: "ip_banner_grab"},
			{Name: "http_status", Tool: "ip_http_probe_normal"},
			{Name: "asn_geo_mapping", Tool: "ip_enrichment_fresh"},
			{Name: "whois_rdap", Tool: "ip_whois_rdap"},
			{Name: "change_detection", Tool: "ip_diff"},
			{Name: "exposure_scoring", Tool: "ip_exposure_score"},
		},
		"DEEP": {
			{Name: "ip_target_seed", Tool: "ip_target_seed"},
			{Name: "alive_check", Tool: "ip_alive_check_deep"},
			{Name: "common_port_scan", Tool: "ip_port_scan_deep"},
			{Name: "udp_port_scan", Tool: "ip_udp_scan_deep"},
			{Name: "service_fingerprint", Tool: "ip_service_fingerprint_deep"},
			{Name: "banner_grab", Tool: "ip_banner_grab"},
			{Name: "tls_metadata", Tool: "ip_tls_deep"},
			{Name: "http_status", Tool: "ip_http_probe_deep"},
			{Name: "asn_geo_mapping", Tool: "ip_enrichment_fresh"},
			{Name: "whois_rdap", Tool: "ip_whois_rdap_fresh"},
			{Name: "relationship_mapping", Tool: "ip_relationship_map"},
			{Name: "change_detection", Tool: "ip_diff"},
			{Name: "exposure_scoring", Tool: "ip_exposure_score"},
			{Name: "findings_summary", Tool: "ip_findings_summary"},
		},
	},
	"service": {
		"LIGHT":  {{Name: "http_banner_check", Tool: "http_banner_check"}},
		"NORMAL": {{Name: "http_banner_check", Tool: "http_banner_check"}, {Name: "top_ports_services", Tool: "top_ports_services"}},
		"DEEP":   {{Name: "http_banner_check", Tool: "http_banner_check"}, {Name: "top_ports_services", Tool: "top_ports_services"}, {Name: "deep_misconfig_analysis", Tool: "deep_misconfig_analysis"}},
	},
	"cloud": {
		"LIGHT":  {{Name: "public_endpoint_detect", Tool: "public_endpoint_detect"}},
		"NORMAL": {{Name: "public_endpoint_detect", Tool: "public_endpoint_detect"}, {Name: "config_review_readonly", Tool: "config_review_readonly"}},
		"DEEP":   {{Name: "public_endpoint_detect", Tool: "public_endpoint_detect"}, {Name: "config_review_readonly", Tool: "config_review_readonly"}, {Name: "full_osint_correlation", Tool: "full_osint_correlation"}},
	},
	"human": {
		"LIGHT":  {{Name: "email_leak_check", Tool: "email_leak_check"}},
		"NORMAL": {{Name: "email_leak_check", Tool: "email_leak_check"}, {Name: "repo_secret_scan", Tool: "repo_secret_scan"}},
		"DEEP":   {{Name: "email_leak_check", Tool: "email_leak_check"}, {Name: "repo_secret_scan", Tool: "repo_secret_scan"}, {Name: "full_osint_correlation", Tool: "full_osint_correlation"}},
	},
	"repo": {
		"LIGHT":  {{Name: "repo_secret_scan", Tool: "repo_secret_scan"}},
		"NORMAL": {{Name: "repo_secret_scan", Tool: "repo_secret_scan"}},
		"DEEP":   {{Name: "repo_secret_scan", Tool: "repo_secret_scan"}, {Name: "full_osint_correlation", Tool: "full_osint_correlation"}},
	},
	"saas": {
		"LIGHT":  {{Name: "saas_detect", Tool: "saas_detect"}},
		"NORMAL": {{Name: "saas_detect", Tool: "saas_detect"}},
		"DEEP":   {{Name: "saas_detect", Tool: "saas_detect"}},
	},
	"user": {
		"LIGHT":  {{Name: "email_leak_check", Tool: "email_leak_check"}},
		"NORMAL": {{Name: "email_leak_check", Tool: "email_leak_check"}},
		"DEEP":   {{Name: "email_leak_check", Tool: "email_leak_check"}, {Name: "full_osint_correlation", Tool: "full_osint_correlation"}},
	},
}
