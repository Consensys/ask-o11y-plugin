package mcp

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestGeneratePKCE(t *testing.T) {
	pkce, err := GeneratePKCE()
	if err != nil {
		t.Fatalf("GeneratePKCE failed: %v", err)
	}

	// Verify method is S256
	if pkce.Method != "S256" {
		t.Errorf("Expected method S256, got %s", pkce.Method)
	}

	// Verify code verifier is not empty
	if pkce.CodeVerifier == "" {
		t.Error("Code verifier is empty")
	}

	// Verify code verifier length (43-128 characters in base64url)
	if len(pkce.CodeVerifier) < 43 || len(pkce.CodeVerifier) > 128 {
		t.Errorf("Code verifier length %d is outside valid range (43-128)", len(pkce.CodeVerifier))
	}

	// Verify code challenge is not empty
	if pkce.CodeChallenge == "" {
		t.Error("Code challenge is empty")
	}

	// Verify code challenge is correctly computed
	hash := sha256.Sum256([]byte(pkce.CodeVerifier))
	expectedChallenge := base64.RawURLEncoding.EncodeToString(hash[:])
	if pkce.CodeChallenge != expectedChallenge {
		t.Errorf("Code challenge mismatch: expected %s, got %s", expectedChallenge, pkce.CodeChallenge)
	}
}

func TestGeneratePKCEUniqueness(t *testing.T) {
	// Generate multiple PKCE params and verify they're all unique
	seen := make(map[string]bool)
	iterations := 100

	for i := 0; i < iterations; i++ {
		pkce, err := GeneratePKCE()
		if err != nil {
			t.Fatalf("GeneratePKCE failed on iteration %d: %v", i, err)
		}

		if seen[pkce.CodeVerifier] {
			t.Errorf("Duplicate code verifier generated: %s", pkce.CodeVerifier)
		}
		seen[pkce.CodeVerifier] = true
	}

	if len(seen) != iterations {
		t.Errorf("Expected %d unique code verifiers, got %d", iterations, len(seen))
	}
}

func TestGenerateState(t *testing.T) {
	state, err := GenerateState()
	if err != nil {
		t.Fatalf("GenerateState failed: %v", err)
	}

	// Verify state is not empty
	if state == "" {
		t.Error("State is empty")
	}

	// Verify state has reasonable length (at least 32 characters)
	if len(state) < 32 {
		t.Errorf("State length %d is too short", len(state))
	}
}

func TestGenerateStateUniqueness(t *testing.T) {
	// Generate multiple states and verify they're all unique
	seen := make(map[string]bool)
	iterations := 100

	for i := 0; i < iterations; i++ {
		state, err := GenerateState()
		if err != nil {
			t.Fatalf("GenerateState failed on iteration %d: %v", i, err)
		}

		if seen[state] {
			t.Errorf("Duplicate state generated: %s", state)
		}
		seen[state] = true
	}

	if len(seen) != iterations {
		t.Errorf("Expected %d unique states, got %d", iterations, len(seen))
	}
}
