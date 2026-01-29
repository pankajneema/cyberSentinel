package orchestration

import (
	"fmt"
)

// PipelineConfig holds all asset type and intensity mappings
var PipelineConfig = map[string]map[string][]string{
	"domain": {
		"LIGHT":  {"subfinder", "basic_dns"},
		"NORMAL": {"amass_passive"},
		"DEEP":   {"amass_active", "reverse_dns", "exposure_scan"},
	},
	"ip": {
		"LIGHT":  {"ip_resolve"},
		"NORMAL": {"asn_geo_mapping"},
		"DEEP":   {"full_port_service_scan"},
	},
	"service": {
		"LIGHT":  {"http_banner_check"},
		"NORMAL": {"top_ports_services"},
		"DEEP":   {"deep_misconfig_analysis"},
	},
	"cloud": {
		"LIGHT":  {"public_endpoint_detect"},
		"NORMAL": {"config_review_readonly"},
		"DEEP":   {"full_osint_correlation"},
	},
	"human": {
		"LIGHT":  {"email_leak_check"},
		"NORMAL": {"repo_secret_scan"},
		"DEEP":   {"full_osint_correlation"},
	},
}

// ToolExecution represents a single tool in the pipeline
type ToolExecution struct {
	Order      int                      `json:"order"`
	Tool       string                   `json:"tool"`
	Status     string                   `json:"status"`
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
}

// GeneratePipeline creates pipeline structure from job data
func GeneratePipeline(job DiscoveryJob) (*PipelineResponse, error) {
	// Get tools for this asset type and intensity
	tools, exists := PipelineConfig[job.AssetType][job.Intensity]
	if !exists {
		return nil, fmt.Errorf("invalid asset_type: %s or intensity: %s", job.AssetType, job.Intensity)
	}

	// Create pipeline structure
	pipeline := &PipelineResponse{
		JobID:     job.ID,
		AssetType: job.AssetType,
		Intensity: job.Intensity,
		Status:    job.Status,
		Pipeline:  make([]ToolExecution, len(tools)),
	}

	// Initialize each tool with PENDING status
	for i, tool := range tools {
		pipeline.Pipeline[i] = ToolExecution{
			Order:  i + 1,
			Tool:   tool,
			Status: "PENDING",
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
