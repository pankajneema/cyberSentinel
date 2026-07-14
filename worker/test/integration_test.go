package test

import (
	"context"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"worker/config"
	"worker/core"
	"worker/tools"
	"worker/utils"

	_ "worker/services"
)

// seq gives every subtest globally-unique service names / task ids so parallel
// or repeated runs never collide on shared Redis keys.
var seq int64

func uniq(prefix string) string {
	n := atomic.AddInt64(&seq, 1)
	return prefix + "-" + time.Now().Format("150405.000") + "-" + itoa(n)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// setup brings up the live-Redis-backed engine or skips if Redis is unavailable.
func setup(t *testing.T) {
	t.Helper()
	// config.Load()/InitRedis() call MustEnv for these; the .env lives at the
	// module root, not this test dir, so satisfy them if the process env is bare.
	if os.Getenv("RABBITMQ_URL") == "" {
		os.Setenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
	}
	if os.Getenv("POSTGRESQL_URL") == "" {
		os.Setenv("POSTGRESQL_URL", "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable")
	}
	utils.InitLogger("error")
	if err := config.InitRedis(); err != nil {
		t.Skip("redis unavailable: " + err.Error())
	}
	cfg := config.Load()
	core.Configure(cfg)
}

// ---- (1) slot cap: acquire up to max, then fail, release frees one ----

func TestAcquireReleaseSlotCap(t *testing.T) {
	setup(t)
	ctx := context.Background()
	svc := uniq("slotsvc")
	defer config.Del(ctx, core.SlotsKey(svc))

	const max = 3
	for i := 0; i < max; i++ {
		ok, err := core.AcquireSlot(ctx, svc, max)
		if err != nil {
			t.Fatalf("AcquireSlot #%d error: %v", i, err)
		}
		if !ok {
			t.Fatalf("AcquireSlot #%d: expected true below cap", i)
		}
	}

	ok, err := core.AcquireSlot(ctx, svc, max)
	if err != nil {
		t.Fatalf("AcquireSlot at cap error: %v", err)
	}
	if ok {
		t.Fatal("AcquireSlot at cap: expected false")
	}

	if err := core.ReleaseSlot(ctx, svc); err != nil {
		t.Fatalf("ReleaseSlot error: %v", err)
	}

	ok, err = core.AcquireSlot(ctx, svc, max)
	if err != nil {
		t.Fatalf("AcquireSlot after release error: %v", err)
	}
	if !ok {
		t.Fatal("AcquireSlot after release: expected true (one slot freed)")
	}
}

// ---- (2) lease set/exists/clear ----

func TestLeaseLifecycle(t *testing.T) {
	setup(t)
	ctx := context.Background()
	id := uniq("leasetask")
	defer config.Del(ctx, core.LeaseKey(id))

	if err := core.SetLease(ctx, id, time.Minute); err != nil {
		t.Fatalf("SetLease error: %v", err)
	}
	n, err := config.Exists(ctx, core.LeaseKey(id))
	if err != nil {
		t.Fatalf("Exists error: %v", err)
	}
	if n == 0 {
		t.Fatal("expected lease key to exist after SetLease")
	}

	if err := core.ClearLease(ctx, id); err != nil {
		t.Fatalf("ClearLease error: %v", err)
	}
	n, err = config.Exists(ctx, core.LeaseKey(id))
	if err != nil {
		t.Fatalf("Exists after clear error: %v", err)
	}
	if n != 0 {
		t.Fatal("expected lease key gone after ClearLease")
	}
}

// ---- (3) cancel request / detect / clear ----

func TestCancelLifecycle(t *testing.T) {
	setup(t)
	ctx := context.Background()
	id := uniq("canceltask")
	defer config.Del(ctx, core.CancelKey(id))

	if core.IsCancelled(ctx, id) {
		t.Fatal("fresh task should not be cancelled")
	}
	if err := core.RequestCancel(ctx, id); err != nil {
		t.Fatalf("RequestCancel error: %v", err)
	}
	if !core.IsCancelled(ctx, id) {
		t.Fatal("expected IsCancelled true after RequestCancel")
	}
	if err := core.ClearCancel(ctx, id); err != nil {
		t.Fatalf("ClearCancel error: %v", err)
	}
	if core.IsCancelled(ctx, id) {
		t.Fatal("expected IsCancelled false after ClearCancel")
	}
}

// ---- (4) full engine end-to-end ----

// fakeTool is a tools.Capability that always returns exactly one finding.
type fakeTool struct{ name string }

func (f fakeTool) Name() string { return f.name }
func (f fakeTool) Run(ctx context.Context, in tools.Input) (tools.Output, error) {
	return tools.Output{
		Findings: []tools.Finding{{
			Type:   "test.finding",
			Target: in.AssetID,
			Name:   "ok",
		}},
		Raw: map[string]any{"ran": true},
	}, nil
}

// fakeService is a core.Service with a single stage bound to a fakeTool.
type fakeService struct {
	name     string
	toolName string
	saved    int
}

func (s *fakeService) Name() string     { return s.name }
func (s *fakeService) Queues() []string { return core.QueuesFor(s.name) }
func (s *fakeService) Stages(job core.Job) []core.Stage {
	return []core.Stage{{Name: "only-stage", Tool: s.toolName}}
}
func (s *fakeService) SaveFindings(ctx context.Context, task *core.Task, stage core.Stage, out tools.Output) error {
	s.saved += len(out.Findings)
	return nil
}

func TestEngineRunEndToEnd(t *testing.T) {
	setup(t)
	ctx := context.Background()

	svcName := uniq("engsvc")
	toolName := uniq("engtool")
	taskID := uniq("engtask")

	tools.Register(fakeTool{name: toolName})
	svc := &fakeService{name: svcName, toolName: toolName}
	core.RegisterService(svc)

	// Ensure a clean slot counter for this unique service.
	_ = config.Del(ctx, core.SlotsKey(svcName))
	defer func() {
		_ = config.Del(ctx, core.TaskKey(taskID))
		_ = config.Del(ctx, core.SlotsKey(svcName))
		_ = config.Del(ctx, core.LeaseKey(taskID))
		_ = config.Del(ctx, core.CancelKey(taskID))
	}()

	job := core.Job{
		Type:   svcName,
		TaskID: taskID,
		OrgID:  uniq("org"),
		Mode:   core.ModeLight,
	}
	if err := core.Run(ctx, svc, job); err != nil {
		t.Fatalf("core.Run error: %v", err)
	}

	task, err := core.LoadTask(ctx, taskID)
	if err != nil {
		t.Fatalf("LoadTask error: %v", err)
	}
	if task.Status != core.StateCompleted {
		t.Fatalf("task status = %q, want %q", task.Status, core.StateCompleted)
	}
	if len(task.Stages) != 1 {
		t.Fatalf("stages = %d, want 1", len(task.Stages))
	}
	if task.Stages[0].Status != core.StageCompleted {
		t.Fatalf("stage status = %q, want %q", task.Stages[0].Status, core.StageCompleted)
	}
	if svc.saved != 1 {
		t.Fatalf("SaveFindings saw %d findings, want 1", svc.saved)
	}

	// Slot was released: counter is back at 0, so a fresh acquire at cap=1 succeeds.
	ok, err := core.AcquireSlot(ctx, svcName, 1)
	if err != nil {
		t.Fatalf("post-run AcquireSlot error: %v", err)
	}
	if !ok {
		t.Fatal("expected slot free after Run (counter should be 0)")
	}
	_ = core.ReleaseSlot(ctx, svcName)
}
