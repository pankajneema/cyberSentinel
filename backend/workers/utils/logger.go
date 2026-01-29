package utils

import (
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var Logger *zap.SugaredLogger

// InitLogger initializes a global logger based on log level
func InitLogger(level string) {
	var cfg zap.Config

	switch strings.ToLower(level) {
	case "debug":
		cfg = zap.NewDevelopmentConfig()
	default:
		cfg = zap.NewProductionConfig()
	}

	cfg.EncoderConfig.TimeKey = "timestamp"
	cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder

	logger, err := cfg.Build()
	if err != nil {
		panic(err)
	}

	Logger = logger.Sugar()
}

// Sync flushes buffered logs (call on shutdown)
func Sync() {
	if Logger != nil {
		_ = Logger.Sync()
	}
}

