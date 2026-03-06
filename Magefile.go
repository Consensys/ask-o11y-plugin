//go:build mage

package main

import (
	"os"
	"path/filepath"
	"strings"

	// mage:import
	build "github.com/grafana/grafana-plugin-sdk-go/build"
)

func Default() error {
	build.BuildAll()
	return CleanManifest()
}

// CleanManifest strips node_modules/ entries from dist/go_plugin_build_manifest.
// Workaround for https://github.com/grafana/grafana-plugin-sdk-go/issues/XXX
func CleanManifest() error {
	p := filepath.Join("dist", "go_plugin_build_manifest")
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	lines := strings.Split(string(data), "\n")
	var filtered []string
	for _, line := range lines {
		if !strings.Contains(line, "node_modules/") {
			filtered = append(filtered, line)
		}
	}
	return os.WriteFile(p, []byte(strings.Join(filtered, "\n")), 0644)
}
