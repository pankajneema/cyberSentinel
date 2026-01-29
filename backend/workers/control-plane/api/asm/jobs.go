package asm

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"workers/orchestration"
	"workers/utils"
)

// StartJobRequest represents incoming ASM job start payload
type StartJobRequest struct {
	Type   string `json:"type" binding:"required"`
	UserID string `json:"user_id" binding:"required"`
	ID     string `json:"id" binding:"required"`
}

// StartJob handles /internal/jobs/start
func StartJob(c *gin.Context) {
	var req StartJobRequest

	// 🔹 Request metadata
	requestID := c.GetHeader("X-Request-Id")
	clientIP := c.ClientIP()

	utils.Logger.Infof(
		"[ASM][START] incoming request request_id=%s ip=%s",
		requestID,
		clientIP,
	)

	// 1️⃣ Bind & validate JSON
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Logger.Warnf(
			"[ASM][INVALID_PAYLOAD] request_id=%s ip=%s error=%v",
			requestID,
			clientIP,
			err,
		)

		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid request payload",
			"details": err.Error(),
		})
		return
	}

	// 🔹 Log parsed payload
	utils.Logger.Infof(
		"[ASM][PAYLOAD] request_id=%s job_id=%s user_id=%s type=%s",
		requestID,
		req.ID,
		req.UserID,
		req.Type,
	)

	// 2️⃣ Validate job type
	if req.Type != orchestration.JobTypeASM {
		utils.Logger.Warnf(
			"[ASM][UNSUPPORTED_TYPE] request_id=%s job_id=%s received_type=%s",
			requestID,
			req.ID,
			req.Type,
		)

		c.JSON(http.StatusBadRequest, gin.H{
			"error": "unsupported job type",
		})
		return
	}

	// 3️⃣ Create Job (ONLY required fields)
	job := &orchestration.Job{
		ID:     req.ID,
		Type:   orchestration.JobTypeASM,
		UserID: req.UserID,
	}

	utils.Logger.Debugf(
		"[ASM][JOB_CREATED] request_id=%s job=%+v",
		requestID,
		job,
	)

	// 4️⃣ Register job
	if err := orchestration.RegisterJob(job); err != nil {
		utils.Logger.Errorf(
			"[ASM][REGISTER_FAILED] request_id=%s job_id=%s error=%v",
			requestID,
			job.ID,
			err,
		)

		c.JSON(http.StatusConflict, gin.H{
			"error": err.Error(),
		})
		return
	}

	// 5️⃣ Log success
	utils.Logger.Infof(
		"[ASM][JOB_QUEUED] request_id=%s job_id=%s user_id=%s state=%s",
		requestID,
		job.ID,
		job.UserID,
		job.State,
	)

	// 6️⃣ Response
	c.JSON(http.StatusAccepted, gin.H{
		"status": "accepted",
		"job_id": job.ID,
		"state":  job.State,
		"type":   job.Type,
	})
}
