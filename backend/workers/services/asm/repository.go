package asm

import (
	"context"
	"encoding/json"

	"workers/config"
)

// repository.go holds ALL SQL for the ASM service. Executor/orchestration code
// must go through these typed helpers rather than issuing raw queries, so the
// data-access surface lives in one place.

// AssetName returns the display name for an asset. A not-found row surfaces as a
// non-nil error; callers decide whether an empty/missing name is fatal.
func AssetName(ctx context.Context, assetID string) (string, error) {
	var name string
	err := config.QueryRow(ctx, `SELECT name FROM assets WHERE id = $1 LIMIT 1`, assetID).Scan(&name)
	return name, err
}

// DiscoveryTargets returns the raw target_source and manual_targets JSON text
// for a discovery row.
func DiscoveryTargets(ctx context.Context, discoveryID string) (targetSource string, manualTargetsRaw []byte, err error) {
	err = config.QueryRow(
		ctx,
		`SELECT target_source::text, manual_targets::text FROM asm_discoveries WHERE id = $1 LIMIT 1`,
		discoveryID,
	).Scan(&targetSource, &manualTargetsRaw)
	return targetSource, manualTargetsRaw, err
}

// DiscoveryJSON returns the full discovery row serialized with row_to_json.
func DiscoveryJSON(ctx context.Context, discoveryID string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := config.QueryRow(ctx, `SELECT row_to_json(ad) FROM asm_discoveries ad WHERE ad.id = $1;`, discoveryID).Scan(&raw)
	return raw, err
}

// SetDiscoveryRunning marks a discovery RUNNING.
func SetDiscoveryRunning(ctx context.Context, discoveryID string) error {
	return config.Exec(ctx, `UPDATE asm_discoveries SET status = 'RUNNING', updated_at = NOW() WHERE id = $1;`, discoveryID)
}

// SetDiscoveryFailed marks a discovery FAILED.
func SetDiscoveryFailed(ctx context.Context, discoveryID string) error {
	return config.Exec(ctx, `UPDATE asm_discoveries SET status = 'FAILED', updated_at = NOW() WHERE id = $1;`, discoveryID)
}

// SetDiscoveryCompleted marks a discovery COMPLETED.
func SetDiscoveryCompleted(ctx context.Context, discoveryID string) error {
	return config.Exec(ctx, `UPDATE asm_discoveries SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1;`, discoveryID)
}
