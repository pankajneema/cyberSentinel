package asm

import (
	"fmt"
)

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
