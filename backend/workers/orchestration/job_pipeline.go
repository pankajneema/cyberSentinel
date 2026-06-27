package orchestration

import (
	"fmt"
)

// StageConfig represents a single pipeline stage with its tool mapping
type StageConfig struct {
	Stage string `json:"stage"` // Stage name (e.g., "subdomain_discovery")
	Tool  string `json:"tool"`  // Tool name (e.g., "subfinder")
}

// PipelineConfig holds all asset type and intensity mappings with stage-based configuration
// ASM Intensity Levels: LIGHT (visibility), NORMAL (exposure), DEEP (risk signals)
var PipelineConfig = map[string]map[string][]StageConfig{
	// ASM Principle: Each asset type has a defined set of stages, and each stage maps to a specific tool	
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
}

// ToolExecution represents a single tool execution in the pipeline
// Each execution corresponds to a stage in the ASM pipeline
type ToolExecution struct {
	Order      int                      `json:"order"`
	Step       string                   `json:"step"` // Stage name (e.g., "subdomain_discovery")
	AssetID    string                   `json:"asset_id,omitempty"`
	Tool       string                   `json:"tool"`   // Tool name (e.g., "subfinder")
	Status     string                   `json:"status"` // PENDING, RUNNING, COMPLETED, FAILED
	DurationMs *int64                   `json:"duration_ms,omitempty"`
	Summary    map[string]interface{}   `json:"summary,omitempty"`
	Result     []map[string]interface{} `json:"result,omitempty"`
	DataRef    string                   `json:"data_ref,omitempty"`
	Error      string                   `json:"error,omitempty"`
}

// PipelineResponse represents the complete pipeline structure
type PipelineResponse struct {
	JobID     string          `json:"job_id"`
	AssetType string          `json:"asset_type"`
	Intensity string          `json:"intensity"`
	Status    string          `json:"status"`
	Pipeline  []ToolExecution `json:"pipeline"`
}

// DiscoveryJob represents the job data from database
type DiscoveryJob struct {
	ID        string
	AssetType string
	Intensity string
	Status    string
	AssetIDs  []string
}

// GeneratePipeline creates pipeline structure from job data
// ASM Principle: One job supports ONLY ONE asset_type at a time
// Pipeline executes sequentially, step-by-step, emitting events after each step
func GeneratePipeline(job DiscoveryJob) (*PipelineResponse, error) {
	// Get stage configurations for this asset type and intensity
	stages, exists := PipelineConfig[job.AssetType][job.Intensity]
	if !exists {
		return nil, fmt.Errorf("invalid asset_type: %s or intensity: %s", job.AssetType, job.Intensity)
	}

	// Determine assets; if none provided create pipeline per-stage without an asset_id
	assets := job.AssetIDs
	if len(assets) == 0 {
		assets = []string{""}
	}

	// Preallocate pipeline entries (assets x stages)
	// Note: ASM design supports one asset_type per job, but allows multiple assets
	// Each asset gets its own sequential pipeline execution
	total := len(assets) * len(stages)
	pipeline := &PipelineResponse{
		JobID:     job.ID,
		AssetType: job.AssetType,
		Intensity: job.Intensity,
		Status:    job.Status,
		Pipeline:  make([]ToolExecution, 0, total),
	}

	// Create entries: iterate assets outer, stages inner to keep order sequential across assets
	// Each stage represents a step in the ASM pipeline
	order := 1
	for _, asset := range assets {
		for _, stageConfig := range stages {
			entry := ToolExecution{
				Order:   order,
				Step:    stageConfig.Stage, // Stage name (e.g., "subdomain_discovery")
				AssetID: asset,
				Tool:    stageConfig.Tool, // Tool name (e.g., "subfinder")
				Status:  "PENDING",
			}
			pipeline.Pipeline = append(pipeline.Pipeline, entry)
			order++
		}
	}

	return pipeline, nil
}

// UpdateToolStatus updates a specific tool's execution status
func (p *PipelineResponse) UpdateToolStatus(order int, status string, durationMs int64, summary map[string]interface{}, result []map[string]interface{}, dataRef string, errorMsg string) {
	if order < 1 || order > len(p.Pipeline) {
		return
	}

	tool := &p.Pipeline[order-1]
	tool.Status = status

	if durationMs > 0 {
		tool.DurationMs = &durationMs
	}
	if summary != nil {
		tool.Summary = summary
	}
	if result != nil {
		tool.Result = result
	}
	if dataRef != "" {
		tool.DataRef = dataRef
	}
	if errorMsg != "" {
		tool.Error = errorMsg
	}
}

// GetNextPendingTool returns the next tool that needs to be executed
func (p *PipelineResponse) GetNextPendingTool() *ToolExecution {
	for i := range p.Pipeline {
		if p.Pipeline[i].Status == "PENDING" {
			return &p.Pipeline[i]
		}
	}
	return nil
}

// IsCompleted checks if all tools are completed
func (p *PipelineResponse) IsCompleted() bool {
	for _, tool := range p.Pipeline {
		if tool.Status != "COMPLETED" && tool.Status != "FAILED" && tool.Status != "SKIPPED" {
			return false
		}
	}
	return true
}

// HasFailures checks if any tool has failed
func (p *PipelineResponse) HasFailures() bool {
	for _, tool := range p.Pipeline {
		if tool.Status == "FAILED" {
			return true
		}
	}
	return false
}
