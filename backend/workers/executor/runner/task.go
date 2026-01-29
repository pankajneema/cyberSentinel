package runner

import (
	"context"
	"errors"
	"time"

	"workers/executor"
	"workers/executor/tools/subfinder"
	"workers/utils"
)

func Run(ctx context.Context, task executor.Task) executor.Result {
	utils.Logger.Infof("executor started job=%s", task.JobID)

	// 🔹 Load pipeline from Redis
	pipeline, err := executor.GetPipeline(ctx, task.JobID)
	if err != nil {
		return fail(task.JobID, err)
	}

	utils.Logger.Infof("pipeline loaded job=%s asset_type=%s intensity=%s steps=%d",
		task.JobID, pipeline.AssetType, pipeline.Intensity, len(pipeline.Pipeline))

	// 🔹 Execute pipeline steps sequentially
	for i, step := range pipeline.Pipeline {
		utils.Logger.Infof(
			"job=%s running step=%d/%d tool=%s",
			task.JobID, step.Order, len(pipeline.Pipeline), step.Tool,
		)

		// Update step status to RUNNING
		if err := executor.UpdateStepStatus(ctx, task.JobID, i, "RUNNING"); err != nil {
			utils.Logger.Warnf("failed to update step status job=%s step=%d: %v", task.JobID, i, err)
		}

		// Execute the tool
		switch step.Tool {

		case "subfinder":
			_, err := subfinder.Run(ctx, pipeline.AssetType)
			if err != nil {
				// Mark step as FAILED
				_ = executor.UpdateStepStatus(ctx, task.JobID, i, "FAILED")
				return fail(task.JobID, err)
			}

		default:
			_ = executor.UpdateStepStatus(ctx, task.JobID, i, "FAILED")
			return fail(task.JobID, errors.New("unknown tool: "+step.Tool))
		}

		// Mark step as DONE
		if err := executor.UpdateStepStatus(ctx, task.JobID, i, "DONE"); err != nil {
			utils.Logger.Warnf("failed to update step status job=%s step=%d: %v", task.JobID, i, err)
		}

		utils.Logger.Infof("job=%s completed step=%d/%d tool=%s",
			task.JobID, step.Order, len(pipeline.Pipeline), step.Tool)
	}

	// Update overall pipeline status to DONE
	pipeline.Status = "DONE"
	if err := executor.SavePipeline(ctx, task.JobID, pipeline); err != nil {
		utils.Logger.Warnf("failed to save final pipeline status job=%s: %v", task.JobID, err)
	}

	utils.Logger.Infof("executor finished successfully job=%s", task.JobID)

	return executor.Result{
		JobID:   task.JobID,
		Success: true,
		EndAt:   time.Now(),
	}
}

func fail(jobID string, err error) executor.Result {
	utils.Logger.Errorf("executor failed job=%s err=%v", jobID, err)

	return executor.Result{
		JobID:   jobID,
		Success: false,
		Error:   err.Error(),
		EndAt:   time.Now(),
	}
}
