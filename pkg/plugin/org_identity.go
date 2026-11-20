package plugin

import "sync"

// OrgIdentityStore holds the lazily captured org binding a workflow runs in:
// the Grafana URL and the service-account token of the first inbound request
// observed for that org. The backend startup context carries no org
// identity, so scheduled runs must wait for a real request to seed it — the
// same constraint Scout solves for its single org, generalized per org.
type OrgIdentityStore struct {
	mu   sync.RWMutex
	orgs map[int64]orgIdentity
}

type orgIdentity struct {
	grafanaURL string
	saToken    string
}

func NewOrgIdentityStore() *OrgIdentityStore {
	return &OrgIdentityStore{orgs: make(map[int64]orgIdentity)}
}

// Seed records the Grafana URL (write-once per org) and refreshes the
// service-account token (every call), so token rotation is picked up by the
// next workflow tick.
func (s *OrgIdentityStore) Seed(orgID int64, grafanaURL, saToken string) {
	if orgID <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := s.orgs[orgID]
	if id.grafanaURL == "" && grafanaURL != "" {
		id.grafanaURL = grafanaURL
	}
	if saToken != "" {
		id.saToken = saToken
	}
	s.orgs[orgID] = id
}

// Get returns the identity for an org and whether it is usable: a workflow
// tick skips (and says so) until both URL and token are present.
func (s *OrgIdentityStore) Get(orgID int64) (grafanaURL, saToken string, ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, exists := s.orgs[orgID]
	if !exists || id.grafanaURL == "" || id.saToken == "" {
		return "", "", false
	}
	return id.grafanaURL, id.saToken, true
}
