package orchestration

// JobState represents the lifecycle state of a job
type JobState string

const (
	JobPending JobState = "PENDING"
	JobRunning JobState = "RUNNING"
	JobDone    JobState = "DONE"
	JobFailed  JobState = "FAILED"
)
