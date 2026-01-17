package main

import (
	"workers/config"
	"workers/utils"

	"workers/control-plane/api"
)

func main() {
	cfg := config.Load()

	utils.InitLogger(cfg.LogLevel)
	defer utils.Sync()

	utils.Logger.Info("starting control-plane (gin server)")

	if err := api.StartServer(cfg); err != nil {
		utils.Logger.Fatalf("gin server failed: %v", err)
	}
}

