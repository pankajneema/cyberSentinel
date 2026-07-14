package core

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"

	amqp "github.com/rabbitmq/amqp091-go"

	"worker/config"
	"worker/utils"
)

// idCounter provides unique task ids so parallel/repeated runs never collide on
// the same Redis keys.
var idCounter int64

func uniqueTaskID(t *testing.T) string {
	t.Helper()
	n := atomic.AddInt64(&idCounter, 1)
	return fmt.Sprintf("test-%d-%d", n, testNonce())
}

// testNonce is a cheap process-scoped salt so ids differ across test binaries.
func testNonce() int64 { return int64(len("core")) * 100000 }

// setEnvIfUnset sets an env var only when absent and restores it after the test.
func setEnvIfUnset(t *testing.T, key, val string) {
	t.Helper()
	if _, ok := os.LookupEnv(key); ok {
		return
	}
	if err := os.Setenv(key, val); err != nil {
		t.Fatalf("setenv %s: %v", key, err)
	}
	t.Cleanup(func() { _ = os.Unsetenv(key) })
}

// ---- (a) retryCount + header contract ----------------------------------------

func TestRetryCountConstants(t *testing.T) {
	if retryHeader != "x-retry-count" {
		t.Fatalf("retryHeader = %q, want %q", retryHeader, "x-retry-count")
	}
	if maxRetries <= 0 {
		t.Fatalf("maxRetries = %d, want > 0", maxRetries)
	}
}

func TestRetryCount(t *testing.T) {
	tests := []struct {
		name    string
		headers amqp.Table
		want    int
	}{
		{"nil headers", nil, 0},
		{"missing key", amqp.Table{"other": int32(9)}, 0},
		{"int32", amqp.Table{retryHeader: int32(2)}, 2},
		{"int64", amqp.Table{retryHeader: int64(5)}, 5},
		{"int", amqp.Table{retryHeader: 7}, 7},
		{"unsupported type falls through to 0", amqp.Table{retryHeader: "3"}, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d := amqp.Delivery{Headers: tc.headers}
			if got := retryCount(d); got != tc.want {
				t.Fatalf("retryCount(%v) = %d, want %d", tc.headers, got, tc.want)
			}
		})
	}
}

// ---- (b) progress ------------------------------------------------------------

func TestProgress(t *testing.T) {
	tests := []struct {
		name        string
		done, total int
		want        int
	}{
		{"zero of ten", 0, 10, 0},
		{"half", 5, 10, 50},
		{"complete", 10, 10, 100},
		{"total zero -> 100", 3, 0, 100},
		{"total negative -> 100", 1, -4, 100},
		{"integer truncation 1/3", 1, 3, 33},
		{"integer truncation 2/3", 2, 3, 66},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := progress(tc.done, tc.total); got != tc.want {
				t.Fatalf("progress(%d,%d) = %d, want %d", tc.done, tc.total, got, tc.want)
			}
		})
	}
}

// ---- Redis-gated helpers -----------------------------------------------------

// setupRedis initializes Redis + logger + engine config, skipping the test when
// no Redis is reachable.
func setupRedis(t *testing.T) {
	t.Helper()
	utils.InitLogger("info")
	// config.Load() (called transitively by InitRedis) requires these env vars;
	// supply harmless placeholders so a missing .env does not panic the test.
	setEnvIfUnset(t, "RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
	setEnvIfUnset(t, "POSTGRESQL_URL", "postgres://localhost:5432/test")
	if err := config.InitRedis(); err != nil {
		t.Skipf("Redis unavailable, skipping: %v", err)
	}
	Configure(config.Load())
}

// ---- (d) persist / LoadTask round-trip ---------------------------------------

func TestPersistLoadTaskRoundTrip(t *testing.T) {
	setupRedis(t)
	ctx := context.Background()

	id := uniqueTaskID(t)
	orig := &Task{
		TaskID:  id,
		OrgID:   "org-round",
		AssetID: "asset-1",
		Service: ServiceASM,
		Status:  StateRunning,
		Stages: []Stage{
			{Name: "discover", Tool: "subfinder", Status: StageCompleted},
			{Name: "scan", Tool: "nmap", Status: StagePending},
		},
		StartedAt: "2026-07-09T00:00:00Z",
	}
	if err := orig.persist(ctx); err != nil {
		t.Fatalf("persist: %v", err)
	}
	t.Cleanup(func() { _ = config.Del(ctx, TaskKey(id)) })

	got, err := LoadTask(ctx, id)
	if err != nil {
		t.Fatalf("LoadTask: %v", err)
	}
	if got.TaskID != orig.TaskID || got.OrgID != orig.OrgID || got.AssetID != orig.AssetID {
		t.Fatalf("identity mismatch: got %+v", got)
	}
	if got.Service != orig.Service || got.Status != orig.Status {
		t.Fatalf("service/status mismatch: got service=%q status=%q", got.Service, got.Status)
	}
	if len(got.Stages) != len(orig.Stages) {
		t.Fatalf("stages len = %d, want %d", len(got.Stages), len(orig.Stages))
	}
	if got.Stages[0].Name != "discover" || got.Stages[0].Status != StageCompleted {
		t.Fatalf("stage[0] mismatch: %+v", got.Stages[0])
	}
}

func TestLoadTaskMissing(t *testing.T) {
	setupRedis(t)
	if _, err := LoadTask(context.Background(), uniqueTaskID(t)); err == nil {
		t.Fatal("LoadTask on missing key: want error, got nil")
	}
}

// ---- (c) reaper --------------------------------------------------------------

func TestReapOnceMarksLeaselessRunningFailed(t *testing.T) {
	setupRedis(t)
	ctx := context.Background()

	id := uniqueTaskID(t)
	// OrgID empty so the best-effort event publish short-circuits and the test
	// does not depend on the SSE pub/sub path.
	task := &Task{
		TaskID:  id,
		OrgID:   "",
		Service: ServiceASM,
		Status:  StateRunning,
		Stages:  []Stage{{Name: "s1", Tool: "t1", Status: StageRunning}},
	}
	if err := task.persist(ctx); err != nil {
		t.Fatalf("persist: %v", err)
	}
	t.Cleanup(func() {
		_ = config.Del(ctx, TaskKey(id))
		_ = config.Del(ctx, LeaseKey(id))
		_ = config.Del(ctx, "reaper:"+id)
	})

	// Ensure no live lease so the reaper treats the worker as dead.
	_ = config.Del(ctx, LeaseKey(id))

	reapOnce(ctx)

	got, err := LoadTask(ctx, id)
	if err != nil {
		t.Fatalf("LoadTask after reap: %v", err)
	}
	if got.Status != StateFailed {
		t.Fatalf("status after reap = %q, want %q", got.Status, StateFailed)
	}
}

func TestReapOnceLeavesLeasedRunning(t *testing.T) {
	setupRedis(t)
	ctx := context.Background()

	id := uniqueTaskID(t)
	task := &Task{
		TaskID:  id,
		OrgID:   "",
		Service: ServiceASM,
		Status:  StateRunning,
		Stages:  []Stage{{Name: "s1", Tool: "t1", Status: StageRunning}},
	}
	if err := task.persist(ctx); err != nil {
		t.Fatalf("persist: %v", err)
	}
	if err := SetLease(ctx, id, taskTTL); err != nil {
		t.Fatalf("SetLease: %v", err)
	}
	t.Cleanup(func() {
		_ = config.Del(ctx, TaskKey(id))
		_ = config.Del(ctx, LeaseKey(id))
		_ = config.Del(ctx, "reaper:"+id)
	})

	reapOnce(ctx)

	got, err := LoadTask(ctx, id)
	if err != nil {
		t.Fatalf("LoadTask after reap: %v", err)
	}
	if got.Status != StateRunning {
		t.Fatalf("leased running task status = %q, want %q (should be left alone)", got.Status, StateRunning)
	}
}
