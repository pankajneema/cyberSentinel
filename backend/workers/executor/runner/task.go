package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"workers/database"
	"workers/executor"
	"workers/executor/tools/subfinder"
	"workers/utils"
)

// ToolResult represents the result of a tool execution within pipeline
type ToolResult struct {
	Order         int                    `json:"order"`
	AssetID       string                 `json:"asset_id,omitempty"`
	Tool          string                 `json:"tool"`
	Status        string                 `json:"status"` // PENDING, RUNNING, COMPLETED, FAILED
	StartedAt     *time.Time             `json:"started_at,omitempty"`
	EndedAt       *time.Time             `json:"ended_at,omitempty"`
	ExecutionTime int64                  `json:"execution_time_ms,omitempty"`
	Result        map[string]interface{} `json:"result,omitempty"`
	Error         string                 `json:"error,omitempty"`
}

// EnhancedPipeline represents the complete pipeline with results
type EnhancedPipeline struct {
	JobID     string       `json:"job_id"`
	AssetType string       `json:"asset_type"`
	AssetName string       `json:"asset_name,omitempty"` // Domain name for domain assets
	Intensity string       `json:"intensity"`
	Status    string       `json:"status"`
	Process   string       `json:"process"`
	Error     string       `json:"error,omitempty"`
	Pipeline  []ToolResult `json:"pipeline"`
}

// reportQueue holds RabbitMQ connection for reporting
var reportQueue *utils.Queue

// InitReportQueue initializes RabbitMQ connection for ASM reports
func InitReportQueue(rabbitURL string) error {
	var err error
	reportQueue, err = utils.Connect(rabbitURL, "report.asm")
	if err != nil {
		return fmt.Errorf("failed to connect to report.asm queue: %w", err)
	}
	utils.Logger.Info("report.asm queue initialized successfully")
	return nil
}

// CloseReportQueue closes the report queue connection
func CloseReportQueue() {
	if reportQueue != nil {
		reportQueue.Close()
		utils.Logger.Info("report.asm queue closed")
	}
}

// pushToReportQueue sends pipeline data to RabbitMQ report.asm queue
func pushToReportQueue(ctx context.Context, pipeline *EnhancedPipeline) error {
	if reportQueue == nil {
		return errors.New("report queue not initialized")
	}

	data, err := json.Marshal(pipeline)
	if err != nil {
		return fmt.Errorf("failed to marshal pipeline for report: %w", err)
	}

	publishCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	err = reportQueue.Publish(publishCtx, data)
	if err != nil {
		return fmt.Errorf("failed to publish to report.asm: %w", err)
	}

	utils.Logger.Debugf("pushed to report.asm queue job=%s status=%s", pipeline.JobID, pipeline.Status)
	return nil
}

// getAssetName fetches asset name from database by asset_id
func getAssetName(ctx context.Context, assetID string) (string, error) {
	if assetID == "" {
		return "", errors.New("asset_id is empty")
	}

	// Initialize database connection if needed
	if database.Pool == nil {
		if err := database.InitPostgres(); err != nil {
			return "", fmt.Errorf("failed to initialize database: %w", err)
		}
	}

	queryCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	query := `SELECT name FROM assets WHERE id = $1 LIMIT 1;`
	var assetName string
	err := database.QueryRow(queryCtx, query, assetID).Scan(&assetName)
	if err != nil {
		utils.Logger.Warnf("failed to fetch asset name for asset_id=%s error=%v", assetID, err)
		return "", fmt.Errorf("asset not found: %w", err)
	}

	return assetName, nil
}

func Run(ctx context.Context, task executor.Task) executor.Result {
	utils.Logger.Infof("executor started job=%s", task.JobID)

	// 🔹 Load pipeline from Redis
	basePipeline, err := executor.GetPipeline(ctx, task.JobID)
	if err != nil {
		utils.Logger.Errorf("failed to load pipeline job=%s error=%v", task.JobID, err)
		return fail(task.JobID, err)
	}

	utils.Logger.Infof("pipeline loaded job=%s asset_type=%s intensity=%s steps=%d",
		task.JobID, basePipeline.AssetType, basePipeline.Intensity, len(basePipeline.Pipeline))

	// 🔹 Get asset name from first step's asset_id (for domain assets)
	var assetName string
	if len(basePipeline.Pipeline) > 0 && basePipeline.Pipeline[0].AssetID != "" {
		if basePipeline.AssetType == "domain" {
			name, err := getAssetName(ctx, basePipeline.Pipeline[0].AssetID)
			if err != nil {
				utils.Logger.Warnf("failed to get asset name for job=%s asset_id=%s error=%v, continuing without asset name",
					task.JobID, basePipeline.Pipeline[0].AssetID, err)
			} else {
				assetName = name
				utils.Logger.Infof("fetched asset name for job=%s asset_id=%s asset_name=%s",
					task.JobID, basePipeline.Pipeline[0].AssetID, assetName)
			}
		}
	}

	// 🔹 Create enhanced pipeline structure
	enhancedPipeline := &EnhancedPipeline{
		JobID:     task.JobID,
		AssetType: basePipeline.AssetType,
		AssetName: assetName,
		Intensity: basePipeline.Intensity,
		Status:    "RUNNING",
		Process:   fmt.Sprintf("0/%d", len(basePipeline.Pipeline)),
		Pipeline:  make([]ToolResult, len(basePipeline.Pipeline)),
	}

	// Initialize all steps as PENDING and preserve asset_id
	for i, step := range basePipeline.Pipeline {
		enhancedPipeline.Pipeline[i] = ToolResult{
			Order:   step.Order,
			AssetID: step.AssetID,
			Tool:    step.Tool,
			Status:  "PENDING",
		}
	}

	// Save initial state
	if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
		utils.Logger.Warnf("failed to save initial pipeline state job=%s: %v", task.JobID, err)
	}

	// 🔹 Execute pipeline steps sequentially
	completedSteps := 0
	for i := range enhancedPipeline.Pipeline {
		stepStartTime := time.Now()

		utils.Logger.Infof(
			"job=%s running step=%d/%d tool=%s",
			task.JobID, i+1, len(enhancedPipeline.Pipeline), enhancedPipeline.Pipeline[i].Tool,
		)

		// Update step status to RUNNING
		enhancedPipeline.Pipeline[i].Status = "RUNNING"
		enhancedPipeline.Pipeline[i].StartedAt = &stepStartTime
		enhancedPipeline.Process = fmt.Sprintf("%d/%d", completedSteps, len(enhancedPipeline.Pipeline))

		if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
			utils.Logger.Warnf("failed to update step to RUNNING job=%s step=%d: %v", task.JobID, i, err)
		}

		// Push RUNNING state to report queue
		// if err := pushToReportQueue(ctx, enhancedPipeline); err != nil {
		// 	utils.Logger.Warnf("failed to push RUNNING state to report queue job=%s step=%d: %v", task.JobID, i, err)
		// }

		// Execute the tool
		var toolErr error
		var output interface{}

		switch enhancedPipeline.Pipeline[i].Tool {

		case "subfinder":
			// Use AssetName (domain name) instead of AssetType
			domainName := enhancedPipeline.AssetName
			if domainName == "" {
				// Fallback: try to get asset name from current step's asset_id
				if enhancedPipeline.Pipeline[i].AssetID != "" {
					name, err := getAssetName(ctx, enhancedPipeline.Pipeline[i].AssetID)
					if err == nil {
						domainName = name
						enhancedPipeline.AssetName = name // Update for future steps
					}
				}
				// If still empty, fallback to AssetType (for backward compatibility)
				if domainName == "" {
					domainName = enhancedPipeline.AssetType
					utils.Logger.Warnf("using AssetType as fallback for subfinder job=%s step=%d", task.JobID, i)
				}
			}
			output, toolErr = subfinder.Run(ctx, domainName)
			if toolErr != nil {
				utils.Logger.Errorf("subfinder failed job=%s step=%d domain=%s error=%v", task.JobID, i, domainName, toolErr)
			} else {
				utils.Logger.Infof("subfinder completed job=%s step=%d domain=%s", task.JobID, i, domainName)
			}

		default:
			toolErr = errors.New("unknown tool: " + enhancedPipeline.Pipeline[i].Tool)
			utils.Logger.Errorf("unknown tool job=%s step=%d tool=%s", task.JobID, i, enhancedPipeline.Pipeline[i].Tool)
		}

		stepEndTime := time.Now()
		executionTime := stepEndTime.Sub(stepStartTime).Milliseconds()

		// Update step with result
		enhancedPipeline.Pipeline[i].EndedAt = &stepEndTime
		enhancedPipeline.Pipeline[i].ExecutionTime = executionTime

		// Handle tool execution result
		if toolErr != nil {
			// Mark current step as FAILED
			enhancedPipeline.Pipeline[i].Status = "FAILED"
			enhancedPipeline.Pipeline[i].Error = toolErr.Error()
			enhancedPipeline.Pipeline[i].Result = make(map[string]interface{})

			// Mark overall pipeline as FAILED
			enhancedPipeline.Status = "FAILED"
			enhancedPipeline.Error = toolErr.Error()
			enhancedPipeline.Process = fmt.Sprintf("%d/%d", completedSteps, len(enhancedPipeline.Pipeline))

			if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
				utils.Logger.Errorf("failed to save FAILED state job=%s: %v", task.JobID, err)
			}

			// Push FAILED state to report queue
			if err := pushToReportQueue(ctx, enhancedPipeline); err != nil {
				utils.Logger.Errorf("failed to push FAILED state to report queue job=%s: %v", task.JobID, err)
			}

			return fail(task.JobID, toolErr)
		}

		// Mark step as COMPLETED with result data
		resultData := make(map[string]interface{})

		// Parse tool output into result data
		if output != nil {
			switch v := output.(type) {
			case map[string]interface{}:
				resultData = v
			case []interface{}:
				resultData["data"] = v
				resultData["count"] = len(v)
			case []string:
				resultData["data"] = v
				resultData["count"] = len(v)
			case string:
				resultData["output"] = v
			default:
				// Try to marshal and unmarshal to get map
				if jsonBytes, err := json.Marshal(output); err == nil {
					resultData["raw_output"] = string(jsonBytes)

					// Try to parse as array of strings
					var strArray []string
					if err := json.Unmarshal(jsonBytes, &strArray); err == nil {
						resultData["subdomains"] = strArray
					}
				}
			}
		}

		enhancedPipeline.Pipeline[i].Status = "COMPLETED"
		enhancedPipeline.Pipeline[i].Result = resultData
		completedSteps++
		enhancedPipeline.Process = fmt.Sprintf("%d/%d", completedSteps, len(enhancedPipeline.Pipeline))

		if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
			utils.Logger.Warnf("failed to save COMPLETED state job=%s step=%d: %v", task.JobID, i, err)
		}
		utils.Logger.Infof("job=%s completed step=%d/%d tool=%s status=COMPLETED duration=%dms",
			task.JobID, i+1, len(enhancedPipeline.Pipeline), enhancedPipeline.Pipeline[i].Tool, executionTime)
	}

	// ✅ All steps completed successfully
	enhancedPipeline.Status = "COMPLETED"
	enhancedPipeline.Process = fmt.Sprintf("%d/%d", completedSteps, len(enhancedPipeline.Pipeline))

	if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
		utils.Logger.Errorf("failed to save final COMPLETED state job=%s: %v", task.JobID, err)
	}

	// Push final COMPLETED state to report queue
	if err := pushToReportQueue(ctx, enhancedPipeline); err != nil {
		utils.Logger.Errorf("failed to push final COMPLETED state to report queue job=%s: %v", task.JobID, err)
	}

	// Pretty print final pipeline
	summaryJSON, err := json.MarshalIndent(enhancedPipeline, "", "  ")
	if err != nil {
		utils.Logger.Errorf("failed to marshal pipeline summary job=%s: %v", task.JobID, err)
	} else {
		utils.Logger.Infof("executor finished successfully job=%s status=COMPLETED\n=== PIPELINE SUMMARY ===\n%s\n========================",
			task.JobID, string(summaryJSON))
	}

	return executor.Result{
		JobID:   task.JobID,
		Success: true,
		Status:  "COMPLETED",
		EndAt:   time.Now(),
	}
}

// saveEnhancedPipeline saves the complete pipeline state to Redis (single key)
func saveEnhancedPipeline(ctx context.Context, pipeline *EnhancedPipeline) error {
	data, err := json.Marshal(pipeline)
	if err != nil {
		return fmt.Errorf("failed to marshal pipeline: %w", err)
	}

	pipelineKey := fmt.Sprintf("asm:pipeline:%s", pipeline.JobID)

	redisCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	if err := executor.SavePipelineRaw(redisCtx, pipelineKey, string(data)); err != nil {
		return fmt.Errorf("failed to save to redis: %w", err)
	}

	utils.Logger.Debugf("pipeline updated in redis key=%s", pipelineKey)
	return nil
}

func fail(jobID string, err error) executor.Result {
	utils.Logger.Errorf("executor failed job=%s err=%v", jobID, err)

	return executor.Result{
		JobID:   jobID,
		Success: false,
		Status:  "FAILED",
		Error:   err.Error(),
		EndAt:   time.Now(),
	}
}
