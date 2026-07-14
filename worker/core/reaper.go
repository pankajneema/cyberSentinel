package core

import (
	"context"
	"strings"
	"time"

	"worker/config"
	"worker/utils"
)

// The reaper is the crash-recovery backstop. A task's lease (task:{id}:lease) is
// renewed by a heartbeat while it runs; if the worker holding it dies, the lease
// TTL expires. This loop finds tasks still marked RUNNING whose lease is gone and
// marks them FAILED (emitting the terminal event so Python finalizes the run),
// so a crashed scan never hangs in RUNNING forever.

// StartReaper launches the background reaper on the given interval.
func StartReaper(interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for range t.C {
			reapOnce(context.Background())
		}
	}()
	utils.Logger.Infof("stale-task reaper started (interval=%s)", interval)
}

func reapOnce(ctx context.Context) {
	var cursor uint64
	for {
		keys, next, err := config.RedisClient.Scan(ctx, cursor, "task:*", 200).Result()
		if err != nil {
			utils.Logger.Warnf("reaper scan failed: %v", err)
			return
		}
		cursor = next
		for _, key := range keys {
			// task:{id} only — skip the :cancel / :lease sub-keys.
			if strings.HasSuffix(key, ":cancel") || strings.HasSuffix(key, ":lease") {
				continue
			}
			taskID := strings.TrimPrefix(key, "task:")
			task, err := LoadTask(ctx, taskID)
			if err != nil || task.Status != StateRunning {
				continue
			}
			// Still leased → its worker is alive; leave it.
			if n, _ := config.Exists(ctx, LeaseKey(taskID)); n > 0 {
				continue
			}
			// Claim exclusively so multiple workers don't double-finalize.
			claimed, err := config.RedisClient.SetNX(ctx, "reaper:"+taskID, "1", time.Minute).Result()
			if err != nil || !claimed {
				continue
			}
			task.Status = StateFailed
			_ = task.persist(ctx)
			emitTask(ctx, task, 100)
			publishTerminal(ctx, task)
			utils.Logger.Warnf("reaper: task=%s marked FAILED (lease expired while RUNNING)", taskID)
		}
		if cursor == 0 {
			return
		}
	}
}
