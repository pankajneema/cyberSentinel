package orchestration

type Job struct {
	ID     string
	Type   string
	UserID string
	State  JobState
}
