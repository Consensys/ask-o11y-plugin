package plugin

import "sync"

// OrgIdentityStore holds the lazily captured org binding of this plugin
// instance: every Grafana org gets its own app instance, so the first
// inbound request to this instance names the org it serves, its Grafana URL,
// and its service-account token. Workflow schedulers read the same binding;
// until it is seeded they skip with a warning, exactly like Scout.
type OrgIdentityStore struct {
	mu      sync.RWMutex
	orgID   int64
	url     string
	saToken string
}

func NewOrgIdentityStore() *OrgIdentityStore {
	return &OrgIdentityStore{}
}

// Seed records the org (write-once), the Grafana URL (write-once), and
// refreshes the service-account token (every call), so token rotation is
// picked up by the next workflow tick.
func (s *OrgIdentityStore) Seed(orgID int64, grafanaURL, saToken string) {
	if orgID <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.orgID == 0 {
		s.orgID = orgID
	}
	if s.url == "" && grafanaURL != "" {
		s.url = grafanaURL
	}
	if saToken != "" {
		s.saToken = saToken
	}
}

// Get returns the instance binding and whether it is usable: a workflow tick
// skips (and says so) until org, URL, and token are all present.
func (s *OrgIdentityStore) Get() (orgID int64, grafanaURL, saToken string, ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.orgID == 0 || s.url == "" || s.saToken == "" {
		return 0, "", "", false
	}
	return s.orgID, s.url, s.saToken, true
}
