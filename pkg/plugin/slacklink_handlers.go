package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const (
	slackBridgeSecretHeader        = "X-Slack-Bridge-Secret"
	slackBridgeTokenHeader         = "X-Slack-Bridge-Token"
	slackBridgeAgentRunsPathPrefix = "/api/slack-bridge/agent/runs/"

	slackLogPendingSecretInvalid = "Slack bridge pending: invalid secret"
	slackLogLookupSecretInvalid  = "Slack bridge lookup: invalid secret"

	slackBridgeRunsPerHour = 20
)

// ─── Rate limiter ─────────────────────────────────────────────────────────────

type slackBridgeRL struct {
	mu       sync.Mutex
	limiters map[int64]*rate.Limiter
}

func newSlackBridgeRL() *slackBridgeRL {
	return &slackBridgeRL{limiters: make(map[int64]*rate.Limiter)}
}

func (r *slackBridgeRL) allow(userID int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	rl, ok := r.limiters[userID]
	if !ok {
		rl = rate.NewLimiter(rate.Every(time.Hour/slackBridgeRunsPerHour), slackBridgeRunsPerHour)
		r.limiters[userID] = rl
	}
	return rl.Allow()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func isValidSlackNonce(s string) bool {
	if len(s) < 16 || len(s) > 128 {
		return false
	}
	for _, c := range s {
		switch {
		case c >= 'a' && c <= 'z':
		case c >= 'A' && c <= 'Z':
		case c >= '0' && c <= '9':
		case c == '-' || c == '_':
		default:
			return false
		}
	}
	return true
}

func slackBridgeSecretsEqual(expected, fromHeader string) bool {
	eh := sha256.Sum256([]byte(expected))
	ah := sha256.Sum256([]byte(fromHeader))
	return subtle.ConstantTimeCompare(eh[:], ah[:]) == 1
}

func (p *Plugin) slackBridgeConfigured() bool {
	return p.slackBridgeSecret != "" && p.slackLinkStore != nil
}

func (p *Plugin) requireSlackBridge(w http.ResponseWriter, r *http.Request) bool {
	if !p.slackBridgeConfigured() {
		http.NotFound(w, r)
		return false
	}
	return true
}

func requireHTTPMethod(w http.ResponseWriter, r *http.Request, want string) bool {
	if r.Method != want {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	return true
}

func (p *Plugin) requireSlackBridgeSharedSecret(w http.ResponseWriter, r *http.Request, invalidSecretLog string) bool {
	if !slackBridgeSecretsEqual(p.slackBridgeSecret, r.Header.Get(slackBridgeSecretHeader)) {
		p.logger.Warn(invalidSecretLog)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

// slackBridgeLinkedUser validates the bridge token and resolves the linked Grafana user.
// On failure it writes the HTTP response and returns ok=false.
// It also logs a warning when the stored role may be stale (> 24 h since linking).
func (p *Plugin) slackBridgeLinkedUser(w http.ResponseWriter, r *http.Request) (userID, orgID int64, role string, ok bool) {
	tok := r.Header.Get(slackBridgeTokenHeader)
	tid, sid, tokOrgID, tokOK := verifySlackBridgeToken(p.slackBridgeSecret, tok)
	if !tokOK {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return 0, 0, "", false
	}
	userID, orgID, role, linkedAt, linked := p.slackLinkStore.getLink(r.Context(), tid, sid)
	if !linked || orgID != tokOrgID {
		http.Error(w, "Slack user not linked", http.StatusForbidden)
		return 0, 0, "", false
	}
	if linkedAt.IsZero() || time.Since(linkedAt) > slackRoleStaleDuration {
		p.logger.Warn("Slack link role may be stale; user should re-run 'setup' in Slack to refresh",
			"teamId", tid, "linkedAt", linkedAt)
	}
	return userID, orgID, role, true
}

// ─── Bridge management endpoints (called by the bridge service) ───────────────

func (p *Plugin) handleSlackBridgePending(w http.ResponseWriter, r *http.Request) {
	if !p.requireSlackBridge(w, r) {
		return
	}
	if !requireHTTPMethod(w, r, http.MethodPost) {
		return
	}
	if !p.requireSlackBridgeSharedSecret(w, r, slackLogPendingSecretInvalid) {
		return
	}
	var req struct {
		Nonce       string `json:"nonce"`
		TeamID      string `json:"teamId"`
		SlackUserID string `json:"slackUserId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.logger.Warn("Slack bridge pending: invalid body")
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if !isValidSlackNonce(req.Nonce) || req.TeamID == "" || req.SlackUserID == "" {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if err := p.slackLinkStore.setPending(r.Context(), req.Nonce, req.TeamID, req.SlackUserID); err != nil {
		p.logger.Warn("Slack bridge pending: store failed", "error", err)
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (p *Plugin) handleSlackBridgeLookup(w http.ResponseWriter, r *http.Request) {
	if !p.requireSlackBridge(w, r) {
		return
	}
	if !requireHTTPMethod(w, r, http.MethodPost) {
		return
	}
	if !p.requireSlackBridgeSharedSecret(w, r, slackLogLookupSecretInvalid) {
		return
	}
	var req struct {
		TeamID      string `json:"teamId"`
		SlackUserID string `json:"slackUserId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.logger.Warn("Slack bridge lookup: invalid body")
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.TeamID == "" || req.SlackUserID == "" {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	_, orgID, _, _, ok := p.slackLinkStore.getLink(r.Context(), req.TeamID, req.SlackUserID)
	if !ok {
		http.Error(w, "Not linked", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int64{"orgId": orgID})
}

// ─── User-facing link management (called via Grafana session) ────────────────

func (p *Plugin) handleSlackLinkConfirm(w http.ResponseWriter, r *http.Request) {
	if !p.requireSlackBridge(w, r) {
		return
	}
	if !requireHTTPMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Nonce string `json:"nonce"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.logger.Warn("Slack link confirm: invalid body")
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if !isValidSlackNonce(req.Nonce) {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	// Consume the nonce before checking auth so it is always single-use,
	// even when the Grafana session is missing.
	teamID, slackUserID, ok := p.slackLinkStore.consumePending(r.Context(), req.Nonce)
	if !ok {
		http.Error(w, "Invalid or expired link", http.StatusGone)
		return
	}
	userID := getUserID(r)
	orgID := getOrgID(r)
	if userID == 0 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	role := getUserRole(r)
	if err := p.slackLinkStore.setLink(r.Context(), teamID, slackUserID, userID, orgID, role); err != nil {
		p.logger.Warn("Slack link confirm: set link failed", "error", err)
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}
	p.logger.Info("Slack account linked", "teamId", teamID, "slackUserId", slackUserID, "orgId", orgID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "linked"})
}

// handleSlackLinkDelete unlinks the current Grafana user's Slack account.
func (p *Plugin) handleSlackLinkDelete(w http.ResponseWriter, r *http.Request) {
	if !p.requireSlackBridge(w, r) {
		return
	}
	if !requireHTTPMethod(w, r, http.MethodDelete) {
		return
	}
	userID := getUserID(r)
	orgID := getOrgID(r)
	if userID == 0 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	teamID, slackUserID, ok := p.slackLinkStore.getLinkByGrafanaUser(r.Context(), userID, orgID)
	if !ok {
		http.Error(w, "Not linked", http.StatusNotFound)
		return
	}
	if err := p.slackLinkStore.deleteLink(r.Context(), teamID, slackUserID); err != nil {
		p.logger.Warn("Slack link delete failed", "error", err)
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}
	p.logger.Info("Slack account unlinked", "orgId", orgID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "unlinked"})
}

// handleSlackLinkStatus returns whether the current Grafana user has a linked Slack account.
func (p *Plugin) handleSlackLinkStatus(w http.ResponseWriter, r *http.Request) {
	if !p.requireSlackBridge(w, r) {
		return
	}
	if !requireHTTPMethod(w, r, http.MethodGet) {
		return
	}
	userID := getUserID(r)
	orgID := getOrgID(r)
	if userID == 0 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	_, _, linked := p.slackLinkStore.getLinkByGrafanaUser(r.Context(), userID, orgID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"linked": linked, "orgId": orgID})
}

// handleSlackLinkRouter dispatches GET/DELETE on /api/slack-link
func (p *Plugin) handleSlackLinkRouter(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		p.handleSlackLinkStatus(w, r)
	case http.MethodDelete:
		p.handleSlackLinkDelete(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ─── Bridge agent run endpoints ───────────────────────────────────────────────

func (p *Plugin) handleSlackBridgeAgentRun(w http.ResponseWriter, r *http.Request) {
	if !p.requireSlackBridge(w, r) {
		return
	}
	if !requireHTTPMethod(w, r, http.MethodPost) {
		return
	}
	userID, orgID, role, ok := p.slackBridgeLinkedUser(w, r)
	if !ok {
		return
	}
	if !p.slackBridgeRL.allow(userID) {
		http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	var req agent.RunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.logger.Warn("Slack bridge agent run: invalid body")
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.OrgName == "" {
		req.OrgName = "Org" + strconv.FormatInt(orgID, 10)
	}
	if req.Message == "" {
		http.Error(w, "'message' is required", http.StatusBadRequest)
		return
	}

	orgIDStr := strconv.FormatInt(orgID, 10)
	ident := agentRunIdentity{
		userID:   userID,
		orgID:    orgID,
		userRole: role,
	}
	p.executeDetachedAgentRun(w, r, orgIDStr, ident, req, "agent_run_slack_bridge")
}

func (p *Plugin) handleSlackBridgeAgentRuns(w http.ResponseWriter, r *http.Request) {
	if !p.requireSlackBridge(w, r) {
		return
	}
	path := r.URL.Path
	if !strings.HasPrefix(path, slackBridgeAgentRunsPathPrefix) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	remainder := strings.TrimPrefix(path, slackBridgeAgentRunsPathPrefix)
	if remainder == "" {
		http.Error(w, "Run ID required", http.StatusBadRequest)
		return
	}

	userID, orgID, _, ok := p.slackBridgeLinkedUser(w, r)
	if !ok {
		return
	}

	runID, isEvents := strings.CutSuffix(remainder, "/events")
	if !isValidSecureID(runID) {
		http.Error(w, "Invalid run ID format", http.StatusBadRequest)
		return
	}

	if isEvents {
		if !requireHTTPMethod(w, r, http.MethodGet) {
			return
		}
		if _, ok := p.getAuthorizedSlackRun(w, runID, userID, orgID); !ok {
			return
		}
		p.streamAgentRunSSE(w, r, runID)
		return
	}

	// Path matched /api/slack-bridge/agent/runs/{runId} without a recognised suffix.
	http.NotFound(w, r)
}

func (p *Plugin) getAuthorizedSlackRun(w http.ResponseWriter, runID string, userID, orgID int64) (*AgentRun, bool) {
	run, err := p.runStore.GetRun(runID)
	if err != nil {
		http.Error(w, "Run not found", http.StatusNotFound)
		return nil, false
	}
	if run.OrgID != orgID || run.UserID != userID {
		http.Error(w, "Access denied", http.StatusForbidden)
		return nil, false
	}
	return run, true
}
