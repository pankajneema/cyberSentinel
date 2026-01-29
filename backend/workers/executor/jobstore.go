package executor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"workers/database"
	"workers/utils"
)

// Pipeline represents job execution state
type Pipeline struct {
	JobID     string         `json:"job_id"`
	AssetType string         `json:"asset_type"`
	Intensity string         `json:"intensity"`
	Status    string         `json:"status"`
	Pipeline  []PipelineStep `json:"pipeline"`
}

type PipelineStep struct {
	Order  int    `json:"order"`
	Tool   string `json:"tool"`
	Status string `json:"status"`
}

const pipelineTTL = 24 * time.Hour

var (
	dbInitOnce sync.Once
	dbInitErr  error
)

// ensureDBConnection initializes database connection only once
func ensureDBConnection() error {
	dbInitOnce.Do(func() {
		if database.RedisClient == nil {
			dbInitErr = database.InitRedis()
			if dbInitErr != nil {
				utils.Logger.Errorf("redis init failed: %v", dbInitErr)
			} else {
				utils.Logger.Info("Redis connection initialized successfully")
			}
		}
	})
	return dbInitErr
}

func pipelineKey(jobID string) string {
	return "asm:pipeline:" + jobID
}

// GetPipeline loads pipeline state for a job
func GetPipeline(ctx context.Context, jobID string) (*Pipeline, error) {
	if err := ensureDBConnection(); err != nil {
		return nil, fmt.Errorf("database connection failed: %w", err)
	}

	redisCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	val, err := database.Get(redisCtx, pipelineKey(jobID))
	if err != nil {
		utils.Logger.Errorf("failed to get pipeline from redis id=%s error=%v", jobID, err)
		return nil, errors.New("pipeline not found")
	}

	var p Pipeline
	if err := json.Unmarshal([]byte(val), &p); err != nil {
		utils.Logger.Errorf("failed to unmarshal pipeline id=%s error=%v", jobID, err)
		return nil, err
	}

	return &p, nil
}

// SavePipeline persists full pipeline state
func SavePipeline(ctx context.Context, jobID string, p *Pipeline) error {
	if err := ensureDBConnection(); err != nil {
		utils.Logger.Warnf("database connection failed, continuing without cache: %v", err)
		return nil // Don't fail the job, just skip caching
	}

	data, err := json.Marshal(p)
	if err != nil {
		utils.Logger.Errorf("failed to marshal pipeline id=%s error=%v", jobID, err)
		return err
	}

	redisCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	if err := database.Set(redisCtx, pipelineKey(jobID), string(data), pipelineTTL); err != nil {
		utils.Logger.Errorf("failed to store pipeline in redis id=%s error=%v", jobID, err)
		utils.Logger.Warnf("continuing without redis cache for job=%s", jobID)
		return nil // Don't fail the job
	}

	utils.Logger.Infof("pipeline stored in redis key=%s", pipelineKey(jobID))
	return nil
}


// UpdateStepStatus updates a single pipeline step safely
func UpdateStepStatus(
	ctx context.Context,
	jobID string,
	stepIndex int,
	status string,
) error {
	p, err := GetPipeline(ctx, jobID)
	if err != nil {
		return err
	}

	if stepIndex < 0 || stepIndex >= len(p.Pipeline) {
		return errors.New("invalid pipeline step index")
	}

	p.Pipeline[stepIndex].Status = status
	return SavePipeline(ctx, jobID, p)
}

// RetryableGet attempts to get pipeline with retry logic
func RetryableGet(ctx context.Context, jobID string, maxRetries int) (*Pipeline, error) {
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		p, err := GetPipeline(ctx, jobID)
		if err == nil {
			return p, nil
		}

		lastErr = err
		if attempt < maxRetries-1 {
			waitTime := time.Duration(attempt+1) * time.Second
			utils.Logger.Warnf("get pipeline retry %d/%d after %v, job=%s",
				attempt+1, maxRetries, waitTime, jobID)
			time.Sleep(waitTime)
		}
	}

	return nil, fmt.Errorf("failed after %d retries: %w", maxRetries, lastErr)
}

// RetryableSave attempts to save pipeline with retry logic
func RetryableSave(ctx context.Context, jobID string, p *Pipeline, maxRetries int) error {
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		err := SavePipeline(ctx, jobID, p)
		if err == nil {
			return nil
		}

		lastErr = err
		if attempt < maxRetries-1 {
			waitTime := time.Duration(attempt+1) * time.Second
			utils.Logger.Warnf("save pipeline retry %d/%d after %v, job=%s",
				attempt+1, maxRetries, waitTime, jobID)
			time.Sleep(waitTime)
		}
	}

	return fmt.Errorf("failed after %d retries: %w", maxRetries, lastErr)
}
