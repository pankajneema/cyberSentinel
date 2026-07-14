package config

import (
	"log"
	"strconv"

	"github.com/joho/godotenv"
)

// Config holds all application configuration
type Config struct {
	// Application
	AppName string
	AppEnv  string

	// Logging
	LogLevel string

	// RabbitMQ
	RabbitURL         string
	ASMRabbitJobQueue string
	VSRabbitJobQueue  string

	//database
	PostgreSql string

	//redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// Orchestration
	JobMaxConcurrency int // local consumer worker-pool bound (goroutines)
	TaskTimeoutSec    int

	// Per-service global concurrency, enforced via Redis slots:{service}.
	ASMMaxConcurrency int
	VSMaxConcurrency  int
	CAMaxConcurrency  int

	// Task lease / heartbeat (seconds). The reaper requeues a RUNNING task whose
	// lease TTL expired; the engine renews the lease every HeartbeatSec.
	LeaseTTLSec  int
	HeartbeatSec int

	// Executor
	ExecutorWorkDir string
	ExecutorBinPath string

	// WebSocket
	WSBufferSize int

	// Shared secret sent as X-Internal-Token when the VS worker fetches
	// authenticated-scan credentials from the core API's internal endpoint.
	ControlPlaneToken string

	// Base URL of the core (Python) API service. Used by the VS worker to fetch
	// authenticated-scan credentials just-in-time from the INTERNAL endpoint
	// POST {CoreAPIURL}/api/v1/internal/vs/credential. Defaults to the in-cluster
	// service name; override via CORE_API_URL for local/other deployments.
	CoreAPIURL string
}

// Load loads environment variables and returns Config
func Load() *Config {
	// Load .env file if present (ignored in prod)
	_ = godotenv.Load()

	cfg := &Config{
		// Application
		AppName: Env("APP_NAME", "cybersential-workers"),
		AppEnv:  Env("APP_ENV", "dev"),

		// Logging
		LogLevel: Env("LOG_LEVEL", "info"),

		// RabbitMQ (required)
		RabbitURL: MustEnv("RABBITMQ_URL"),

		ASMRabbitJobQueue: Env("ASM_RABBITMQ_JOB_QUEUE", "jobs.asm"),
		VSRabbitJobQueue:  Env("VS_RABBITMQ_JOB_QUEUE", "jobs.vs"),

		// Orchestration
		JobMaxConcurrency: mustInt("JOB_MAX_CONCURRENCY", 8),
		TaskTimeoutSec:    mustInt("TASK_TIMEOUT_SECONDS", 900),

		// Per-service global concurrency (heavy external tools for ASM/VS; CA lighter).
		ASMMaxConcurrency: mustInt("ASM_MAX_CONCURRENCY", 2),
		VSMaxConcurrency:  mustInt("VS_MAX_CONCURRENCY", 2),
		CAMaxConcurrency:  mustInt("CA_MAX_CONCURRENCY", 3),

		LeaseTTLSec:  mustInt("TASK_LEASE_TTL_SECONDS", 120),
		HeartbeatSec: mustInt("TASK_HEARTBEAT_SECONDS", 30),

		// Executor
		ExecutorWorkDir: Env("EXECUTOR_WORKDIR", "/tmp/cybersential"),
		ExecutorBinPath: Env("EXECUTOR_BIN_PATH", "/usr/bin"),

		// WebSocket
		WSBufferSize: mustInt("WS_BUFFER_SIZE", 1024),

		ControlPlaneToken: Env("CONTROL_PLANE_TOKEN", ""),

		// Core API base URL for internal credential fetch (JIT authenticated scan).
		CoreAPIURL: Env("CORE_API_URL", "http://api_service:8000"),

		//database
		PostgreSql: MustEnv("POSTGRESQL_URL"),

		//Redis
		RedisAddr:     Env("REDISADDR", "localhost:6379"),
		RedisPassword: Env("REDISPASS", ""),
		RedisDB:       mustInt("REDISDB", 0),
	}

	log.Printf("config loaded (env=%s)", cfg.AppEnv)
	return cfg
}

// MaxConcurrencyFor returns the configured global slot cap for a service.
func (c *Config) MaxConcurrencyFor(service string) int {
	switch service {
	case "asm":
		return c.ASMMaxConcurrency
	case "vs":
		return c.VSMaxConcurrency
	case "ca":
		return c.CAMaxConcurrency
	default:
		return c.JobMaxConcurrency
	}
}

// mustInt reads an env var as int or exits on error
func mustInt(key string, fallback int) int {
	val := Env(key, "")
	if val == "" {
		return fallback
	}

	i, err := strconv.Atoi(val)
	if err != nil {
		log.Fatalf("invalid integer value for %s: %v", key, err)
	}
	return i
}
