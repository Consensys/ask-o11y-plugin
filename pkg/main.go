package main

import (
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend/app"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"consensys-asko11y-app/pkg/plugin"
)

func main() {
	if err := app.Manage("consensys-asko11y-app", plugin.NewPlugin, app.ManageOpts{}); err != nil {
		log.DefaultLogger.Error("Failed to manage app", "error", err.Error())
		os.Exit(1)
	}
}
