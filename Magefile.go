// +build mage

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/magefile/mage/mg"
	"github.com/magefile/mage/sh"
)

// Default target to run when none is specified
var Default = BuildAll

// Build builds the backend binary
func Build() error {
	mg.Deps(Clean)
	fmt.Println("Building backend plugin...")

	// Get the target OS and architecture
	goos := getEnv("GOOS", runtime.GOOS)
	goarch := getEnv("GOARCH", runtime.GOARCH)

	// Determine the executable name
	executableName := fmt.Sprintf("gpx_consensys-asko11y-app_%s_%s", goos, goarch)
	if goos == "windows" {
		executableName += ".exe"
	}

	// Build the backend with version info
	version := getEnv("VERSION", "0.1.1")
	ldflags := fmt.Sprintf("-w -s -X main.version=%s", version)

	// Build the backend
	return sh.RunWith(
		map[string]string{
			"CGO_ENABLED": "0",
			"GOOS":        goos,
			"GOARCH":      goarch,
		},
		"go", "build",
		"-o", filepath.Join("dist", executableName),
		"-ldflags", ldflags,
		"./pkg",
	)
}

// BuildAll builds for all supported platforms
func BuildAll() error {
	mg.Deps(Clean)

	platforms := []struct {
		os   string
		arch string
	}{
		{"linux", "amd64"},
		{"linux", "arm64"},
		{"darwin", "amd64"},
		{"darwin", "arm64"},
		{"windows", "amd64"},
	}

	version := getEnv("VERSION", "0.1.1")
	ldflags := fmt.Sprintf("-w -s -X main.version=%s", version)

	for _, p := range platforms {
		fmt.Printf("Building for %s/%s...\n", p.os, p.arch)

		executableName := fmt.Sprintf("gpx_consensys-asko11y-app_%s_%s", p.os, p.arch)
		if p.os == "windows" {
			executableName += ".exe"
		}

		err := sh.RunWith(
			map[string]string{
				"CGO_ENABLED": "0",
				"GOOS":        p.os,
				"GOARCH":      p.arch,
			},
			"go", "build",
			"-o", filepath.Join("dist", executableName),
			"-ldflags", ldflags,
			"./pkg",
		)

		if err != nil {
			return fmt.Errorf("failed to build for %s/%s: %w", p.os, p.arch, err)
		}
	}

	// Copy Go module files and source to dist for plugin validator
	fmt.Println("Copying go.mod, go.sum, and pkg/ to dist...")
	if err := copyFile("go.mod", filepath.Join("dist", "go.mod")); err != nil {
		return fmt.Errorf("failed to copy go.mod: %w", err)
	}
	if err := copyFile("go.sum", filepath.Join("dist", "go.sum")); err != nil {
		return fmt.Errorf("failed to copy go.sum: %w", err)
	}
	// Copy pkg directory to dist for source code validation
	if _, err := os.Stat("pkg"); err == nil {
		if err := copyDir("pkg", filepath.Join("dist", "pkg")); err != nil {
			return fmt.Errorf("failed to copy pkg directory: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to check pkg directory: %w", err)
	}

	return nil
}

// Clean removes build artifacts
func Clean() error {
	fmt.Println("Cleaning build artifacts...")

	// Remove backend binaries
	matches, err := filepath.Glob(filepath.Join("dist", "gpx_*"))
	if err != nil {
		return err
	}

	for _, match := range matches {
		if err := os.Remove(match); err != nil && !os.IsNotExist(err) {
			return err
		}
	}

	// Remove Go module files from dist
	goModFiles := []string{
		filepath.Join("dist", "go.mod"),
		filepath.Join("dist", "go.sum"),
	}
	for _, file := range goModFiles {
		if err := os.Remove(file); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	// Remove pkg directory from dist
	pkgDir := filepath.Join("dist", "pkg")
	if err := os.RemoveAll(pkgDir); err != nil && !os.IsNotExist(err) {
		return err
	}

	return nil
}

// Test runs the backend tests
func Test() error {
	fmt.Println("Running tests...")
	return sh.RunV("go", "test", "./pkg/...")
}

// Coverage generates test coverage report
func Coverage() error {
	fmt.Println("Generating coverage report...")
	return sh.RunV("go", "test", "-coverprofile=coverage.out", "./pkg/...")
}

// Dev builds for the current platform (development)
func Dev() error {
	mg.Deps(Clean)
	fmt.Println("Building for development...")

	executableName := fmt.Sprintf("gpx_consensys-asko11y-app_%s_%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		executableName += ".exe"
	}

	return sh.RunV(
		"go", "build",
		"-o", filepath.Join("dist", executableName),
		"./pkg",
	)
}

// ModTidy runs go mod tidy
func ModTidy() error {
	fmt.Println("Running go mod tidy...")
	return sh.RunV("go", "mod", "tidy")
}

// getEnv gets an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// File permissions for copied files
const defaultFileMode = 0644

// copyFile copies a file from src to dst
func copyFile(src, dst string) error {
	input, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, input, defaultFileMode)
}

// copyDir recursively copies a directory from src to dst
func copyDir(src, dst string) error {
	// Get properties of source dir
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if !srcInfo.IsDir() {
		return fmt.Errorf("source is not a directory: %s", src)
	}

	// Create destination dir with standard permissions
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}

	// Read all entries in source dir
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			// Recursively copy subdirectory
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			// Copy file
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	return nil
}
