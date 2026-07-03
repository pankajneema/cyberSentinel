package asm

import (
	"errors"
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
		// Idempotent redelivery: the discovery is already COMPLETED or actively
		// RUNNING on another worker. Respond 200 so the consumer ACKs the message
		// (it is not a failure and must not be dead-lettered / retried).
		if errors.Is(err, orchestration.ErrAlreadyProcessed) {
			utils.Logger.Infof(
				"[ASM][ALREADY_PROCESSED] request_id=%s job_id=%s — acking without re-run",
				requestID, job.ID,
			)
			c.JSON(http.StatusOK, gin.H{
				"status": "skipped",
				"job_id": job.ID,
				"reason": "already processed",
			})
			return
		}

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

	// 5️⃣ Execute SYNCHRONOUSLY (ACK-after-success).
	// The gin router already runs each request in its own goroutine, so concurrent
	// scans are still parallel across requests. Running the pipeline here (instead
	// of a detached `go executeJob`) means this HTTP request — and therefore the
	// RabbitMQ ACK in the consumer — only completes once the scan reaches a
	// terminal state. A worker crash mid-scan leaves the queue message un-ACKed,
	// so it is dead-lettered (requeue=false, no automatic retry) rather than
	// silently dropped; recovery is via the reaper or a DLQ replay.
	if err := orchestration.ExecuteJob(job.ID); err != nil {
		utils.Logger.Errorf(
			"[ASM][EXECUTE_FAILED] request_id=%s job_id=%s error=%v",
			requestID, job.ID, err,
		)
		_ = orchestration.RemoveJob(job.ID)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  err.Error(),
			"job_id": job.ID,
		})
		return
	}

	// Drop the completed job from the in-memory registry (no leak).
	_ = orchestration.RemoveJob(job.ID)

	// 6️⃣ Log success
	utils.Logger.Infof(
		"[ASM][JOB_COMPLETED] request_id=%s job_id=%s user_id=%s",
		requestID,
		job.ID,
		job.UserID,
	)

	// 7️⃣ Response
	c.JSON(http.StatusOK, gin.H{
		"status": "completed",
		"job_id": job.ID,
		"type":   job.Type,
	})
}