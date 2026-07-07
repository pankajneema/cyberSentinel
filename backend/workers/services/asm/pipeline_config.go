package asm

// StageConfig represents a single pipeline stage with its tool mapping.
type StageConfig struct {
	Stage string `json:"stage"` // Stage name (e.g., "subdomain_discovery")
	Tool  string `json:"tool"`  // Tool name (e.g., "subfinder")
}

// PipelineConfig holds all asset type and intensity mappings with stage-based
// configuration. ASM Intensity Levels: LIGHT (visibility), NORMAL (exposure),
// DEEP (risk signals). Each asset type has a defined set of stages, and each
// stage maps to a specific tool/capability resolved by name at execution time.
var PipelineConfig = map[string]map[string][]StageConfig{
	"domain": {
		"LIGHT": {
			{Stage: "subdomain_discovery", Tool: "subfinder"},
			{Stage: "cert_intel", Tool: "crtsh"},
			{Stage: "ai_subdomain_probe", Tool: "ai_subdomain_probe"},
			{Stage: "dns_resolution", Tool: "dnsx"},
			{Stage: "reachability_check", Tool: "http_probe"},
			{Stage: "http_status", Tool: "httpx"},
		},
		"NORMAL": {
			{Stage: "subdomain_discovery", Tool: "subfinder"},
			{Stage: "deep_discovery", Tool: "amass"},
			{Stage: "cert_intel", Tool: "crtsh"},
			{Stage: "ai_subdomain_probe", Tool: "ai_subdomain_probe"},
			{Stage: "dns_resolution", Tool: "dnsx"},
			{Stage: "reachability_check", Tool: "http_probe"},
			{Stage: "http_status", Tool: "httpx"},
			{Stage: "ip_mapping", Tool: "ip_mapping"},
			{Stage: "ip_info", Tool: "ipinfo"},
			{Stage: "asn_map", Tool: "asnmap"},
			{Stage: "common_port_scan", Tool: "top_ports_scanner"},
			{Stage: "service_fingerprint", Tool: "service_detector"},
			{Stage: "tls_metadata", Tool: "ssl_analyzer"},
			{Stage: "api_surface_hint", Tool: "api_detector"},
		},
		"DEEP": {
			{Stage: "subdomain_discovery", Tool: "subfinder"},
			{Stage: "recursive_discovery", Tool: "amass"},
			{Stage: "recursive_osint", Tool: "bbot"},
			{Stage: "subdomain_expansion", Tool: "dnsgen"},
			{Stage: "cert_intel", Tool: "crtsh"},
			{Stage: "ai_subdomain_probe", Tool: "ai_subdomain_probe"},
			{Stage: "dns_resolution", Tool: "dnsx"},
			{Stage: "reachability_check", Tool: "http_probe"},
			{Stage: "http_status", Tool: "httpx"},
			{Stage: "ip_mapping", Tool: "ip_mapping"},
			{Stage: "ip_info", Tool: "ipinfo"},
			{Stage: "asn_map", Tool: "asnmap"},
			{Stage: "common_port_scan", Tool: "top_ports_scanner"},
			{Stage: "service_fingerprint", Tool: "service_detector"},
			{Stage: "tls_metadata", Tool: "ssl_analyzer"},
			{Stage: "api_surface_hint", Tool: "api_detector"},
			{Stage: "vulnerability_scan", Tool: "nuclei"},
			{Stage: "cloud_exposure_detect", Tool: "cloud_osint"},
			{Stage: "admin_endpoint_check", Tool: "admin_finder"},
			{Stage: "backup_file_check", Tool: "backup_detector"},
			{Stage: "change_detection", Tool: "asset_diff_engine"},
		},
	},
	"ip": {
		"LIGHT": {
			{Stage: "ip_target_seed", Tool: "ip_target_seed"},
			{Stage: "alive_check", Tool: "ip_alive_check"},
			{Stage: "common_port_scan", Tool: "ip_port_scan_light"},
			{Stage: "service_fingerprint", Tool: "ip_service_fingerprint_light"},
			{Stage: "http_status", Tool: "ip_http_probe_light"},
			{Stage: "asn_geo_mapping", Tool: "ip_enrichment_cached"},
			{Stage: "change_detection", Tool: "ip_diff"},
			{Stage: "exposure_scoring", Tool: "ip_exposure_score"},
		},
		"NORMAL": {
			{Stage: "ip_target_seed", Tool: "ip_target_seed"},
			{Stage: "alive_check", Tool: "ip_alive_check"},
			{Stage: "common_port_scan", Tool: "ip_port_scan_normal"},
			{Stage: "udp_port_scan", Tool: "ip_udp_scan_normal"},
			{Stage: "service_fingerprint", Tool: "ip_service_fingerprint_normal"},
			{Stage: "banner_grab", Tool: "ip_banner_grab"},
			{Stage: "http_status", Tool: "ip_http_probe_normal"},
			{Stage: "asn_geo_mapping", Tool: "ip_enrichment_fresh"},
			{Stage: "whois_rdap", Tool: "ip_whois_rdap"},
			{Stage: "change_detection", Tool: "ip_diff"},
			{Stage: "exposure_scoring", Tool: "ip_exposure_score"},
		},
		"DEEP": {
			{Stage: "ip_target_seed", Tool: "ip_target_seed"},
			{Stage: "alive_check", Tool: "ip_alive_check_deep"},
			{Stage: "common_port_scan", Tool: "ip_port_scan_deep"},
			{Stage: "udp_port_scan", Tool: "ip_udp_scan_deep"},
			{Stage: "service_fingerprint", Tool: "ip_service_fingerprint_deep"},
			{Stage: "banner_grab", Tool: "ip_banner_grab"},
			{Stage: "tls_metadata", Tool: "ip_tls_deep"},
			{Stage: "http_status", Tool: "ip_http_probe_deep"},
			{Stage: "asn_geo_mapping", Tool: "ip_enrichment_fresh"},
			{Stage: "whois_rdap", Tool: "ip_whois_rdap_fresh"},
			{Stage: "relationship_mapping", Tool: "ip_relationship_map"},
			{Stage: "change_detection", Tool: "ip_diff"},
			{Stage: "exposure_scoring", Tool: "ip_exposure_score"},
			{Stage: "findings_summary", Tool: "ip_findings_summary"},
		},
	},
	"service": {
		"LIGHT": {
			{Stage: "http_banner_check", Tool: "http_banner_check"},
		},
		"NORMAL": {
			{Stage: "http_banner_check", Tool: "http_banner_check"},
			{Stage: "top_ports_services", Tool: "top_ports_services"},
		},
		"DEEP": {
			{Stage: "http_banner_check", Tool: "http_banner_check"},
			{Stage: "top_ports_services", Tool: "top_ports_services"},
			{Stage: "deep_misconfig_analysis", Tool: "deep_misconfig_analysis"},
		},
	},
	"cloud": {
		"LIGHT": {
			{Stage: "public_endpoint_detect", Tool: "public_endpoint_detect"},
		},
		"NORMAL": {
			{Stage: "public_endpoint_detect", Tool: "public_endpoint_detect"},
			{Stage: "config_review_readonly", Tool: "config_review_readonly"},
		},
		"DEEP": {
			{Stage: "public_endpoint_detect", Tool: "public_endpoint_detect"},
			{Stage: "config_review_readonly", Tool: "config_review_readonly"},
			{Stage: "full_osint_correlation", Tool: "full_osint_correlation"},
		},
	},
	"human": {
		"LIGHT": {
			{Stage: "email_leak_check", Tool: "email_leak_check"},
		},
		"NORMAL": {
			{Stage: "email_leak_check", Tool: "email_leak_check"},
			{Stage: "repo_secret_scan", Tool: "repo_secret_scan"},
		},
		"DEEP": {
			{Stage: "email_leak_check", Tool: "email_leak_check"},
			{Stage: "repo_secret_scan", Tool: "repo_secret_scan"},
			{Stage: "full_osint_correlation", Tool: "full_osint_correlation"},
		},
	},
	"repo": {
		"LIGHT": {
			{Stage: "repo_secret_scan", Tool: "repo_secret_scan"},
		},
		"NORMAL": {
			{Stage: "repo_secret_scan", Tool: "repo_secret_scan"},
		},
		"DEEP": {
			{Stage: "repo_secret_scan", Tool: "repo_secret_scan"},
			{Stage: "full_osint_correlation", Tool: "full_osint_correlation"},
		},
	},
	"saas": {
		"LIGHT": {
			{Stage: "saas_detect", Tool: "saas_detect"},
		},
		"NORMAL": {
			{Stage: "saas_detect", Tool: "saas_detect"},
		},
		"DEEP": {
			{Stage: "saas_detect", Tool: "saas_detect"},
		},
	},
	"user": {
		"LIGHT": {
			{Stage: "email_leak_check", Tool: "email_leak_check"},
		},
		"NORMAL": {
			{Stage: "email_leak_check", Tool: "email_leak_check"},
		},
		"DEEP": {
			{Stage: "email_leak_check", Tool: "email_leak_check"},
			{Stage: "full_osint_correlation", Tool: "full_osint_correlation"},
		},
	},
}
