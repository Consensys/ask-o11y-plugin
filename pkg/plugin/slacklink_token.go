package plugin

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const slackBridgeTokenLifetime = 2 * time.Minute

type slackBridgeTokenPayload struct {
	TID string `json:"tid"`
	SID string `json:"sid"`
	OID int64  `json:"oid"`
	Exp int64  `json:"exp"`
}

// Token format: base64url(JSON payload) + "." + HMAC-SHA256-base64url(body).
// Keep in sync with signBridgeToken() in slack-bridge/src/index.ts.
func signSlackBridgeToken(secret, teamID, slackUserID string, orgID int64) (string, error) {
	if secret == "" || teamID == "" || slackUserID == "" || orgID <= 0 {
		return "", errors.New("invalid token inputs")
	}
	p := slackBridgeTokenPayload{
		TID: teamID,
		SID: slackUserID,
		OID: orgID,
		Exp: time.Now().Add(slackBridgeTokenLifetime).Unix(),
	}
	body, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	b64 := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(b64))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return b64 + "." + sig, nil
}

func verifySlackBridgeToken(secret, token string) (teamID, slackUserID string, orgID int64, ok bool) {
	if secret == "" || token == "" {
		return "", "", 0, false
	}
	b64, sigB64, found := strings.Cut(token, ".")
	if !found || b64 == "" || sigB64 == "" {
		return "", "", 0, false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(b64))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	sigBytes, err1 := base64.RawURLEncoding.DecodeString(sigB64)
	expBytes, err2 := base64.RawURLEncoding.DecodeString(expected)
	if err1 != nil || err2 != nil || !hmac.Equal(sigBytes, expBytes) {
		return "", "", 0, false
	}
	body, err := base64.RawURLEncoding.DecodeString(b64)
	if err != nil {
		return "", "", 0, false
	}
	var p slackBridgeTokenPayload
	if err := json.Unmarshal(body, &p); err != nil || p.TID == "" || p.SID == "" || p.OID <= 0 {
		return "", "", 0, false
	}
	if time.Now().Unix() > p.Exp {
		return "", "", 0, false
	}
	return p.TID, p.SID, p.OID, true
}
