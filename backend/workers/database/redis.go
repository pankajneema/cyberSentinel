package database

import (
	"context"
	"time"

	"workers/config"
	"workers/utils"

	"github.com/redis/go-redis/v9"
)

var RedisClient *redis.Client

// InitRedis initializes Redis connection
func InitRedis() error {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	RedisClient = redis.NewClient(&redis.Options{
		Addr:         cfg.RedisAddr,     // e.g., "localhost:6379"
		Password:     cfg.RedisPassword, // empty string if no password
		DB:           cfg.RedisDB,       // default DB (usually 0)
		DialTimeout:  10 * time.Second,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
		PoolSize:     20,              // Max number of socket connections
		MinIdleConns: 5,               // Min idle connections
		MaxIdleConns: 10,              // Max idle connections
		PoolTimeout:  4 * time.Second, // Time to wait for connection from pool
	})

	// Test connection
	if err := RedisClient.Ping(ctx).Err(); err != nil {
		return err
	}

	utils.Logger.Info("Redis connection established successfully")
	return nil
}

// CloseRedis closes Redis connection with timeout
func CloseRedis() {
	if RedisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		done := make(chan error, 1)
		go func() {
			done <- RedisClient.Close()
		}()

		select {
		case err := <-done:
			if err != nil {
				utils.Logger.Errorf("error closing Redis connection: %v", err)
			} else {
				utils.Logger.Info("Redis connection closed successfully")
			}
		case <-ctx.Done():
			utils.Logger.Warn("Redis connection close timed out")
		}
	}
}

// Set stores a key-value pair with optional expiration
func Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	return RedisClient.Set(ctx, key, value, expiration).Err()
}

// Get retrieves a value by key
func Get(ctx context.Context, key string) (string, error) {
	return RedisClient.Get(ctx, key).Result()
}

// Del deletes one or more keys
func Del(ctx context.Context, keys ...string) error {
	return RedisClient.Del(ctx, keys...).Err()
}

// Exists checks if key exists
func Exists(ctx context.Context, keys ...string) (int64, error) {
	return RedisClient.Exists(ctx, keys...).Result()
}

// Expire sets expiration on a key
func Expire(ctx context.Context, key string, expiration time.Duration) error {
	return RedisClient.Expire(ctx, key, expiration).Err()
}

// HSet sets field in hash
func HSet(ctx context.Context, key string, values ...interface{}) error {
	return RedisClient.HSet(ctx, key, values...).Err()
}

// HGet gets field from hash
func HGet(ctx context.Context, key, field string) (string, error) {
	return RedisClient.HGet(ctx, key, field).Result()
}

// HGetAll gets all fields from hash
func HGetAll(ctx context.Context, key string) (map[string]string, error) {
	return RedisClient.HGetAll(ctx, key).Result()
}

// HDel deletes fields from hash
func HDel(ctx context.Context, key string, fields ...string) error {
	return RedisClient.HDel(ctx, key, fields...).Err()
}

// LPush pushes values to the head of list
func LPush(ctx context.Context, key string, values ...interface{}) error {
	return RedisClient.LPush(ctx, key, values...).Err()
}

// RPush pushes values to the tail of list
func RPush(ctx context.Context, key string, values ...interface{}) error {
	return RedisClient.RPush(ctx, key, values...).Err()
}

// LPop pops value from the head of list
func LPop(ctx context.Context, key string) (string, error) {
	return RedisClient.LPop(ctx, key).Result()
}

// RPop pops value from the tail of list
func RPop(ctx context.Context, key string) (string, error) {
	return RedisClient.RPop(ctx, key).Result()
}

// LRange gets range of elements from list
func LRange(ctx context.Context, key string, start, stop int64) ([]string, error) {
	return RedisClient.LRange(ctx, key, start, stop).Result()
}

// SAdd adds members to set
func SAdd(ctx context.Context, key string, members ...interface{}) error {
	return RedisClient.SAdd(ctx, key, members...).Err()
}

// SMembers gets all members of set
func SMembers(ctx context.Context, key string) ([]string, error) {
	return RedisClient.SMembers(ctx, key).Result()
}

// SRem removes members from set
func SRem(ctx context.Context, key string, members ...interface{}) error {
	return RedisClient.SRem(ctx, key, members...).Err()
}

// Incr increments the integer value of a key by one
func Incr(ctx context.Context, key string) (int64, error) {
	return RedisClient.Incr(ctx, key).Result()
}

// Decr decrements the integer value of a key by one
func Decr(ctx context.Context, key string) (int64, error) {
	return RedisClient.Decr(ctx, key).Result()
}

// GetRedisStats returns Redis client statistics for monitoring
func GetRedisStats() *redis.PoolStats {
	if RedisClient == nil {
		return nil
	}
	return RedisClient.PoolStats()
}

// Ping checks Redis connection health
func Ping(ctx context.Context) error {
	return RedisClient.Ping(ctx).Err()
}
