package core

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"

	"worker/config"
)

// Admission control + lease/cancel plumbing, all on Redis. Slot acquire/release
// is an atomic Lua op so N workers share one global cap per service without any
// HTTP hop or control-plane.

// acquireScript increments slots:{service} only if it is below the cap. Returns
// 1 on success, 0 if the service is at capacity. Atomic (single round trip).
var acquireScript = redis.NewScript(`
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local max = tonumber(ARGV[1])
if cur < max then
  redis.call('INCR', KEYS[1])
  return 1
end
return 0
`)

// releaseScript decrements slots:{service}, clamped at zero so a double-release
// or a crash-recovered counter can never go negative.
var releaseScript = redis.NewScript(`
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur > 0 then
  redis.call('DECR', KEYS[1])
end
return 1
`)

// AcquireSlot tries once to take a global slot for service (max cap). Returns
// true if admitted. A nil Redis client is a hard error here — slot accounting
// must never be fail-open or the global cap is meaningless.
func AcquireSlot(ctx context.Context, service string, max int) (bool, error) {
	res, err := acquireScript.Run(ctx, config.RedisClient, []string{SlotsKey(service)}, max).Int()
	if err != nil {
		return false, err
	}
	return res == 1, nil
}

// ReleaseSlot returns a slot to the pool. Safe to call more than once.
func ReleaseSlot(ctx context.Context, service string) error {
	return releaseScript.Run(ctx, config.RedisClient, []string{SlotsKey(service)}).Err()
}

// ---- lease / heartbeat ----

// SetLease (re)writes the task lease with a fresh TTL. Renewed every heartbeat
// while RUNNING; its expiry is what the reaper watches.
func SetLease(ctx context.Context, taskID string, ttl time.Duration) error {
	return config.Set(ctx, LeaseKey(taskID), "1", ttl)
}

// ClearLease removes the lease on clean completion.
func ClearLease(ctx context.Context, taskID string) error {
	return config.Del(ctx, LeaseKey(taskID))
}

// ---- cancellation ----

// IsCancelled reports whether FastAPI asked this task to stop (task:{id}:cancel set).
func IsCancelled(ctx context.Context, taskID string) bool {
	n, err := config.Exists(ctx, CancelKey(taskID))
	return err == nil && n > 0
}

// RequestCancel sets the cancel flag (used by tests / the reaper; the primary
// setter is FastAPI on the command API).
func RequestCancel(ctx context.Context, taskID string) error {
	return config.Set(ctx, CancelKey(taskID), "1", taskTTL)
}

// ClearCancel removes the cancel flag after a task has acted on it.
func ClearCancel(ctx context.Context, taskID string) error {
	return config.Del(ctx, CancelKey(taskID))
}
