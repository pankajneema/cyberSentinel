package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"workers/utils"
	"workers/config"

)

var Pool *pgxpool.Pool

// InitPostgres initializes PostgreSQL connection pool
func InitPostgres() error {
	cfg := config.Load()
	databaseURL := cfg.PostgreSql
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db_config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return err
	}

	// Pool tuning (adjust as per load)
	db_config.MaxConns = 20
	db_config.MinConns = 5
	db_config.MaxConnLifetime = time.Hour
	db_config.MaxConnIdleTime = 30 * time.Minute
	db_config.HealthCheckPeriod = 1 * time.Minute

	Pool, err = pgxpool.NewWithConfig(ctx, db_config)
	if err != nil {
		return err
	}

	return Pool.Ping(ctx)
}

// ClosePostgres closes DB pool with timeout
func ClosePostgres() {
	if Pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		
		// Pool.Close() doesn't use context but we ensure cleanup completes
		done := make(chan struct{})
		go func() {
			Pool.Close()
			close(done)
		}()
		
		select {
		case <-done:
			// Closed successfully
		case <-ctx.Done():
			utils.Logger.Warn("database pool close timed out")
		}
	}
}

// Exec runs INSERT / UPDATE / DELETE
func Exec(
	ctx context.Context,
	query string,
	args ...any,
) error {
	_, err := Pool.Exec(ctx, query, args...)
	return err
}

// Query runs SELECT returning multiple rows
func Query(
	ctx context.Context,
	query string,
	args ...any,
) (pgx.Rows, error) {
	return Pool.Query(ctx, query, args...)
}

// QueryRow runs SELECT returning single row
func QueryRow(
	ctx context.Context,
	query string,
	args ...any,
) pgx.Row {
	return Pool.QueryRow(ctx, query, args...)
}

// WithTransaction helper for transactions
func WithTransaction(
	ctx context.Context,
	fn func(tx pgx.Tx) error,
) error {
	tx, err := Pool.Begin(ctx)
	if err != nil {
		return err
	}

	defer func() {
		if err != nil {
			// Use background context for rollback to ensure it completes
			// even if the original context is cancelled
			rbCtx, rbCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer rbCancel()
			
			if rbErr := tx.Rollback(rbCtx); rbErr != nil {
				utils.Logger.Errorf("error rolling back transaction: %v (original error: %v)", rbErr, err)
			}
		}
	}()

	err = fn(tx)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// GetPoolStats returns connection pool statistics for monitoring
func GetPoolStats() *pgxpool.Stat {
	if Pool == nil {
		return nil
	}
	return Pool.Stat()
}