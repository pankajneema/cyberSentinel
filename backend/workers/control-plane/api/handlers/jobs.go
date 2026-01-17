package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"workers/orchestration"
	"workers/utils"
)

// StartJobRequest represents incoming job start payload
type StartJobRequest struct {
	JobID   string `json:"job_id" binding:"required"`
	JobKind string `json:"job_kind" binding:"required"`
}

// StartJob handles /internal/jobs/start
func StartJob(c *gin.Context) {
	var req StartJobRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Logger.Warnf("invalid start job request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid request payload",
		})
		return
	}

	job, err := orchestration.StartJob(req.JobID, req.JobKind)
	if err != nil {
		utils.Logger.Errorf("failed to start job: %v", err)
		c.JSON(http.StatusConflict, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"job_id": job.ID,
		"state":  job.State,
	})
}

