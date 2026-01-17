package api

import (
	"github.com/gin-gonic/gin"

	"workers/control-plane/api/handlers"
)

func registerRoutes(r *gin.Engine) {
	// Health
	r.GET("/health", healthHandler)

	// Internal routes
	internal := r.Group("/internal")
	{
		internal.POST("/jobs/start", handlers.StartJob)
	}
}

func healthHandler(c *gin.Context) {
	c.JSON(200, gin.H{
		"status": "ok",
	})
}

