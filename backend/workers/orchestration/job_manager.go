package orchestration

import (
	"errors"
	"sync"
	"time"

	"workers/utils"
)

var (
	jobs   = make(map[string]*Job)
	jobMux sync.RWMutex
)

// StartJob registers and starts a job
func StartJob(jobID string, kind string) (*Job, error) {
	if jobID == "" {
		return nil, errors.New("job id is empty")
	}

	jobMux.Lock()
	defer jobMux.Unlock()

	// Prevent duplicate job
	if _, exists := jobs[jobID]; exists {
		return nil, errors.New("job already exists")
	}

	job := &Job{
		ID:        jobID,
		Kind:      kind,
		State:     JobRunning,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	jobs[jobID] = job

	utils.Logger.Infof("job started: id=%s kind=%s", jobID, kind)

	return job, nil
}

// UpdateJobState updates the state of a job
func UpdateJobState(jobID string, state JobState) error {
	jobMux.Lock()
	defer jobMux.Unlock()

	job, ok := jobs[jobID]
	if !ok {
		return errors.New("job not found")
	}

	job.State = state
	job.UpdatedAt = time.Now()

	utils.Logger.Infof("job state updated: id=%s state=%s", jobID, state)

	return nil
}

// GetJob returns a job by ID
func GetJob(jobID string) (*Job, error) {
	jobMux.RLock()
	defer jobMux.RUnlock()

	job, ok := jobs[jobID]
	if !ok {
		return nil, errors.New("job not found")
	}

	return job, nil
}

