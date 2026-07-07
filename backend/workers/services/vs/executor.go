package vs

import (
	"context"
	"fmt"

	"workers/utils"
)

// runAdapter runs ONE scanner engine against one target with panic recovery, so
// a misbehaving engine degrades to an error instead of crashing the worker. It
// is the VS analogue of the ASM per-stage executor.
func runAdapter(ctx context.Context, s Scanner, target Target, profile Profile, scanRunID string) (findings []RawFinding, err error) {
	defer func() {
		if r := recover(); r != nil {
			utils.Logger.Errorf("[VS][ADAPTER_PANIC] scan_run_id=%s engine=%s asset_id=%s: %v",
				scanRunID, s.Name(), target.AssetID, r)
			findings = nil
			err = fmt.Errorf("panic in engine %s: %v", s.Name(), r)
		}
	}()
	return s.Scan(ctx, target, profile)
}
