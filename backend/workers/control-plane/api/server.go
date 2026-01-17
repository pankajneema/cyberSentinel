package api

import (
	"fmt"

	"github.com/gin-gonic/gin"

	"workers/config"
	"workers/utils"
)

// StartServer initializes and runs Gin server
func StartServer(cfg *config.Config) error {
	// Gin mode
	if cfg.AppEnv == "prod" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()

	// Middlewares
	router.Use(gin.Recovery())
	router.Use(gin.Logger())

	// Register routes
	registerRoutes(router)

	addr := fmt.Sprintf("%s:%s", cfg.GinHost, cfg.GinPort)
	utils.Logger.Infof("gin listening on %s", addr)

	return router.Run(addr)
}

