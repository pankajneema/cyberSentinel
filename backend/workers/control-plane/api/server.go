package api

import (
	"crypto/subtle"
	"fmt"

	"github.com/gin-gonic/gin"

	"workers/config"
	"workers/utils"
)

// internalAuth gates the control-plane behind a shared secret. The job-trigger
// API accepts a user_id/discovery_id and launches active scans, so unauthenticated
// it is an unauthorized-scan + cross-tenant IDOR vector. /health and / stay open.
func internalAuth(token string) gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.FullPath() {
		case "/health", "/":
			c.Next()
			return
		}
		if token == "" { // dev only (startup warns); fail-closed in prod below
			c.Next()
			return
		}
		got := c.GetHeader("X-Internal-Token")
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}

// StartServer initializes and runs Gin server
func StartServer(cfg *config.Config) error {
	// Gin mode
	if cfg.AppEnv == "prod" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Fail closed in production if the internal token isn't configured.
	if cfg.ControlPlaneToken == "" {
		if cfg.AppEnv == "prod" {
			utils.Logger.Fatal("CONTROL_PLANE_TOKEN must be set in production (control-plane would be unauthenticated)")
		}
		utils.Logger.Warn("CONTROL_PLANE_TOKEN not set — control-plane is UNAUTHENTICATED (dev only). Set GIN_HOST=127.0.0.1.")
	}

	router := gin.New()

	// Middlewares
	router.Use(gin.Recovery())
	router.Use(gin.Logger())
	router.Use(internalAuth(cfg.ControlPlaneToken))

	// Register routes
	registerRoutes(router)

	addr := fmt.Sprintf("%s:%s", cfg.GinHost, cfg.GinPort)
	utils.Logger.Infof("gin listening on %s", addr)

	return router.Run(addr)
}

