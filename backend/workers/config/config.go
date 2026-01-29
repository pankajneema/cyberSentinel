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

	// Gin Control Plane
	GinHost string
	GinPort string

	// RabbitMQ
	RabbitURL         string
	ASMRabbitJobQueue string

	//database
	PostgreSql string

	//redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// Orchestration
	JobMaxConcurrency int
	TaskTimeoutSec    int

	// Executor
	ExecutorWorkDir string
	ExecutorBinPath string

	// WebSocket
	WSBufferSize int

	// Mircoservice
	AsmEndpoint string
}

// Load loads environment variables and returns Config
func Load() *Config {
	// Load .env file if present (ignored in prod)
	_ = godotenv.Load()

	cfg := &Config{
		// Application
		AppName: Get("APP_NAME", "cybersential-workers"),
		AppEnv:  Get("APP_ENV", "dev"),

		// Logging
		LogLevel: Get("LOG_LEVEL", "info"),

		// Gin Control Plane
		GinHost: Get("GIN_HOST", "0.0.0.0"),
		GinPort: Get("GIN_PORT", "8090"),

		// RabbitMQ (required)
		RabbitURL: MustGet("RABBITMQ_URL"),

		ASMRabbitJobQueue: Get("ASM_RABBITMQ_JOB_QUEUE", "jobs.asm"),

		// Orchestration
		JobMaxConcurrency: mustInt("JOB_MAX_CONCURRENCY", 3),
		TaskTimeoutSec:    mustInt("TASK_TIMEOUT_SECONDS", 900),

		// Executor
		ExecutorWorkDir: Get("EXECUTOR_WORKDIR", "/tmp/cybersential"),
		ExecutorBinPath: Get("EXECUTOR_BIN_PATH", "/usr/bin"),

		// WebSocket
		WSBufferSize: mustInt("WS_BUFFER_SIZE", 1024),

		// Microservices
		AsmEndpoint: Get("ASM_SERVICE_ENDPOINTS", "http://localhost:9003/asm/"),

		//database
		PostgreSql: MustGet("POSTGRESQL_URL"),

		//Redis
		RedisAddr:     Get("REDISADDR", "localhost:6379"),
		RedisPassword: Get("REDISPASS", ""),
		RedisDB:       mustInt("REDISDB", 0),
	}

	log.Printf("config loaded (env=%s)", cfg.AppEnv)
	return cfg
}

// mustInt reads an env var as int or exits on error
func mustInt(key string, fallback int) int {
	val := Get(key, "")
	if val == "" {
		return fallback
	}

	i, err := strconv.Atoi(val)
	if err != nil {
		log.Fatalf("invalid integer value for %s: %v", key, err)
	}
	return i
}
