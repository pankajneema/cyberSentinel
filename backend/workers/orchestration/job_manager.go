package orchestration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"workers/database"
	"workers/utils"

	"workers/executor"
	"workers/executor/runner"

)

var (
	jobs   = make(map[string]*Job)
	jobMux sync.RWMutex
)

// initDBConnection ensures database connections are established
func initDBConnection() error {
	// PostgreSQL
	if database.Pool == nil {
		if err := database.InitPostgres(); err != nil {
			return fmt.Errorf("postgres init failed: %w", err)
		}
		utils.Logger.Info("PostgreSQL connection initialized in orchestration")
	}

	// Redis
	if database.RedisClient == nil {
		if err := database.InitRedis(); err != nil {
			return fmt.Errorf("redis init failed: %w", err)
		}
		utils.Logger.Info("Redis connection initialized in orchestration")
	}

	return nil
}

// RegisterJob registers ANY type of job (asm / vs / etc)
func RegisterJob(job *Job) error {
	if job.ID == "" {
		return errors.New("job id is empty")
	}

	// ✅ DB initialization
	if err := initDBConnection(); err != nil {
		utils.Logger.Errorf("database init failed: %v", err)
		return err
	}

	jobMux.Lock()
	defer jobMux.Unlock()

	if _, exists := jobs[job.ID]; exists {
		return fmt.Errorf("job already exists: %s", job.ID)
	}

	job.State = JobPending
	jobs[job.ID] = job

	// Fetch job data from DB
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `SELECT row_to_json(ad) FROM asm_discoveries ad WHERE ad.id = $1;`

	var raw json.RawMessage
	err := database.QueryRow(ctx, query, job.ID).Scan(&raw)
	if err != nil {
		utils.Logger.Errorf("failed to fetch job data id=%s error=%v", job.ID, err)
		delete(jobs, job.ID)
		return fmt.Errorf("fetch job data failed: %w", err)
	}

	var jobData map[string]interface{}
	if err := json.Unmarshal(raw, &jobData); err != nil {
		utils.Logger.Errorf("failed to parse job data id=%s error=%v", job.ID, err)
		delete(jobs, job.ID)
		return fmt.Errorf("parse job data failed: %w", err)
	}

	utils.Logger.Infof("job data fetched id=%s data=%+v", job.ID, jobData)

	// Generate Pipeline from job data
	assetType, ok := jobData["asset_type"].(string)
	if !ok || assetType == "" {
		delete(jobs, job.ID)
		return errors.New("invalid or missing asset_type")
	}

	intensity, ok := jobData["intensity"].(string)
	if !ok || intensity == "" {
		delete(jobs, job.ID)
		return errors.New("invalid or missing intensity")
	}

	status, _ := jobData["status"].(string)

	discoveryJob := DiscoveryJob{
		ID:        job.ID,
		AssetType: assetType,
		Intensity: intensity,
		Status:    status,
	}

	pipeline, err := GeneratePipeline(discoveryJob)
	if err != nil {
		utils.Logger.Errorf("failed to generate pipeline id=%s error=%v", job.ID, err)
		delete(jobs, job.ID)
		return fmt.Errorf("generate pipeline failed: %w", err)
	}

	pipelineJSON, err := json.Marshal(pipeline)
	if err != nil {
		utils.Logger.Errorf("failed to marshal pipeline id=%s error=%v", job.ID, err)
		delete(jobs, job.ID)
		return fmt.Errorf("marshal pipeline failed: %w", err)
	}

	// Pretty print pipeline
	utils.Logger.Infof("pipeline generated id=%s\n%s", job.ID, string(pipelineJSON))

	// Store pipeline in Redis
	redisCtx, redisCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer redisCancel()

	if err := database.Set(redisCtx, "asm:pipeline:"+job.ID, pipelineJSON, 24*time.Hour); err != nil {
		utils.Logger.Errorf("failed to store pipeline in redis id=%s error=%v", job.ID, err)
		// ⚠️ Don't fail the job, just log warning
		utils.Logger.Warnf("continuing without redis cache for job=%s", job.ID)
	} else {
		utils.Logger.Infof("pipeline stored in redis key=asm:pipeline:%s", job.ID)
	}
   
    //TODO FOR FUTURES HERE MAKE A LOAD BALANCE AND SHARDING LOGIC=========================
	go executeJob(job.ID)

	// Update job status to RUNNING in DB
	job.State = JobRunning
	updateQuery := `UPDATE asm_discoveries SET status = 'RUNNING', updated_at = NOW() WHERE id = $1;`
	if err := database.Exec(ctx, updateQuery, job.ID); err != nil {
		utils.Logger.Errorf("failed to update job status id=%s error=%v", job.ID, err)
		delete(jobs, job.ID)
		return fmt.Errorf("update job status failed: %w", err)
	}
	utils.Logger.Infof("job status updated to RUNNING id=%s", job.ID)
    

	

	utils.Logger.Infof("job registered successfully id=%s type=%s asset_type=%s intensity=%s tools=%d",
		job.ID, job.Type, assetType, intensity, len(pipeline.Pipeline))

	return nil
}



func executeJob(jobID string) error {
	ctx, cancel := runner.NewContext()
	defer cancel()

	task := executor.Task{
		JobID: jobID, // 🔑 ONLY JOB ID PASSED
	}

	utils.Logger.Infof("job_manager starting executor job=%s", jobID)
	result := runner.Run(ctx, task)

	if !result.Success {
		JobFailed := `UPDATE asm_discoveries SET status = 'FAILED', updated_at = NOW() WHERE id = $1;`
		if err := database.Exec(ctx, JobFailed,jobID); err != nil {
		// Update status to FAILED  DB
			utils.Logger.Errorf("failed to update job status: %v", err)
		}

		utils.Logger.Errorf(
			"job_manager job failed job=%s err=%s",
			jobID,
			result.Error,
		)
		return fmt.Errorf("job execution failed: %s", result.Error)
	}

	utils.Logger.Infof("job_manager job completed job=%s", jobID)
	return nil
}



func UpdateJobState(jobID string, state JobState) error {
	jobMux.Lock()
	defer jobMux.Unlock()

	job, ok := jobs[jobID]
	if !ok {
		return fmt.Errorf("job not found: %s", jobID)
	}

	oldState := job.State
	job.State = state

	utils.Logger.Infof("job state updated id=%s old_state=%s new_state=%s", jobID, oldState, state)

	return nil
}

func GetJob(jobID string) (*Job, error) {
	jobMux.RLock()
	defer jobMux.RUnlock()

	job, ok := jobs[jobID]
	if !ok {
		return nil, fmt.Errorf("job not found: %s", jobID)
	}

	return job, nil
}

// Get pipeline from Redis if needed
func GetPipelineFromRedis(jobID string) (*PipelineResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	key := "asm:pipeline:" + jobID
	data, err := database.Get(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("pipeline not found in redis: %w", err)
	}

	var pipeline PipelineResponse
	if err := json.Unmarshal([]byte(data), &pipeline); err != nil {
		return nil, fmt.Errorf("failed to unmarshal pipeline: %w", err)
	}

	return &pipeline, nil
}

// List all active jobs
func ListJobs() []*Job {
	jobMux.RLock()
	defer jobMux.RUnlock()

	jobList := make([]*Job, 0, len(jobs))
	for _, job := range jobs {
		jobList = append(jobList, job)
	}

	return jobList
}

// Remove completed/failed job from memory
func RemoveJob(jobID string) error {
	jobMux.Lock()
	defer jobMux.Unlock()

	if _, exists := jobs[jobID]; !exists {
		return fmt.Errorf("job not found: %s", jobID)
	}

	delete(jobs, jobID)
	utils.Logger.Infof("job removed from memory id=%s", jobID)

	return nil
}
