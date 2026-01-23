package mcp

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// PKCEParams contains the PKCE code verifier and challenge
// PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks
// RFC 7636: https://datatracker.ietf.org/doc/html/rfc7636
type PKCEParams struct {
	CodeVerifier  string // 43-128 character random string
	CodeChallenge string // BASE64URL(SHA256(CodeVerifier))
	Method        string // Always "S256" for SHA-256
}

// GeneratePKCE creates a new PKCE code verifier and challenge
// Following RFC 7636 requirements:
// - code_verifier: 43-128 characters from unreserved charset
// - code_challenge: BASE64URL(SHA256(code_verifier))
// - code_challenge_method: S256
func GeneratePKCE() (*PKCEParams, error) {
	// Generate code_verifier (32 bytes = 43 base64url chars)
	verifierBytes := make([]byte, 32)
	if _, err := rand.Read(verifierBytes); err != nil {
		return nil, fmt.Errorf("failed to generate random bytes: %w", err)
	}
	verifier := base64.RawURLEncoding.EncodeToString(verifierBytes)

	// Generate code_challenge = BASE64URL(SHA256(verifier))
	hash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(hash[:])

	return &PKCEParams{
		CodeVerifier:  verifier,
		CodeChallenge: challenge,
		Method:        "S256", // SHA-256
	}, nil
}

// GenerateState creates a cryptographically random state parameter
// Used for CSRF protection in OAuth flows
func GenerateState() (string, error) {
	stateBytes := make([]byte, 32)
	if _, err := rand.Read(stateBytes); err != nil {
		return "", fmt.Errorf("failed to generate random state: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(stateBytes), nil
}
