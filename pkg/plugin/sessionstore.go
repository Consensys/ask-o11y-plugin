package plugin

import (
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type SessionMessage struct {
	Role      string          `json:"role"`
	Content   string          `json:"content"`
	ToolCalls json.RawMessage `json:"toolCalls,omitempty"`
	PageRefs  json.RawMessage `json:"pageRefs,omitempty"`
}

type ChatSession struct {
	ID           string           `json:"id"`
	Title        string           `json:"title"`
	Messages     []SessionMessage `json:"messages"`
	Summary      string           `json:"summary,omitempty"`
	CreatedAt    time.Time        `json:"createdAt"`
	UpdatedAt    time.Time        `json:"updatedAt"`
	MessageCount int              `json:"messageCount"`
	ActiveRunID  string           `json:"activeRunId,omitempty"`
	UserID       int64            `json:"-"`
	OrgID        int64            `json:"-"`
}

type SessionMetadata struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	MessageCount int       `json:"messageCount"`
	ActiveRunID  string    `json:"activeRunId,omitempty"`
}

type SessionUpdate struct {
	Messages []SessionMessage `json:"messages,omitempty"`
	Title    *string          `json:"title,omitempty"`
	Summary  *string          `json:"summary,omitempty"`
}

type SessionStoreInterface interface {
	CreateSession(userID, orgID int64, title string, messages []SessionMessage) (*ChatSession, error)
	GetSession(sessionID string, userID, orgID int64) (*ChatSession, error)
	ListSessions(userID, orgID int64) ([]SessionMetadata, error)
	UpdateSession(sessionID string, userID, orgID int64, update SessionUpdate) error
	AppendMessages(sessionID string, userID, orgID int64, messages []SessionMessage) error
	DeleteSession(sessionID string, userID, orgID int64) error
	DeleteAllSessions(userID, orgID int64) error
	GetCurrentSessionID(userID, orgID int64) (string, error)
	SetCurrentSessionID(userID, orgID int64, sessionID string) error
	ClearCurrentSessionID(userID, orgID int64) error
	SetActiveRunID(sessionID string, userID, orgID int64, runID string) error
	ClearActiveRunID(sessionID string, userID, orgID int64) error
}

func sessionOwnerKey(userID, orgID int64) string {
	return fmt.Sprintf("%d:%d", userID, orgID)
}

func generateSessionTitle(messages []SessionMessage) string {
	for _, m := range messages {
		if m.Role == "user" && m.Content != "" {
			content := m.Content
			if len(content) > 60 {
				return content[:60] + "..."
			}
			return content
		}
	}
	return "New Conversation"
}

type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*ChatSession         // sessionID -> session
	userIdx  map[string]map[string]struct{}   // ownerKey -> set of sessionIDs
	current  map[string]string                // ownerKey -> current sessionID
	logger   log.Logger
}

func NewSessionStore(logger log.Logger) *SessionStore {
	return &SessionStore{
		sessions: make(map[string]*ChatSession),
		userIdx:  make(map[string]map[string]struct{}),
		current:  make(map[string]string),
		logger:   logger,
	}
}

func (s *SessionStore) CreateSession(userID, orgID int64, title string, messages []SessionMessage) (*ChatSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ownerKey := sessionOwnerKey(userID, orgID)

	if idx, ok := s.userIdx[ownerKey]; ok && len(idx) >= SessionMaxPerUserOrg {
		s.evictOldest(ownerKey)
	}

	id, err := generateShareID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate session ID: %w", err)
	}

	if title == "" {
		title = generateSessionTitle(messages)
	}

	now := time.Now()
	session := &ChatSession{
		ID:           id,
		Title:        title,
		Messages:     messages,
		Summary:      "",
		CreatedAt:    now,
		UpdatedAt:    now,
		MessageCount: len(messages),
		UserID:       userID,
		OrgID:        orgID,
	}

	s.sessions[id] = session
	if s.userIdx[ownerKey] == nil {
		s.userIdx[ownerKey] = make(map[string]struct{})
	}
	s.userIdx[ownerKey][id] = struct{}{}

	return session, nil
}

func (s *SessionStore) evictOldest(ownerKey string) {
	idx := s.userIdx[ownerKey]
	if len(idx) == 0 {
		return
	}

	var oldest *ChatSession
	for id := range idx {
		sess := s.sessions[id]
		if sess == nil {
			continue
		}
		if oldest == nil || sess.UpdatedAt.Before(oldest.UpdatedAt) {
			oldest = sess
		}
	}

	if oldest != nil {
		delete(s.sessions, oldest.ID)
		delete(idx, oldest.ID)
		if s.current[ownerKey] == oldest.ID {
			delete(s.current, ownerKey)
		}
	}
}

func (s *SessionStore) GetSession(sessionID string, userID, orgID int64) (*ChatSession, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found")
	}
	if session.UserID != userID || session.OrgID != orgID {
		return nil, fmt.Errorf("session not found")
	}

	copied := *session
	copied.Messages = make([]SessionMessage, len(session.Messages))
	copy(copied.Messages, session.Messages)
	return &copied, nil
}

func (s *SessionStore) ListSessions(userID, orgID int64) ([]SessionMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ownerKey := sessionOwnerKey(userID, orgID)
	idx := s.userIdx[ownerKey]

	result := make([]SessionMetadata, 0, len(idx))
	for id := range idx {
		sess := s.sessions[id]
		if sess == nil {
			continue
		}
		result = append(result, SessionMetadata{
			ID:           sess.ID,
			Title:        sess.Title,
			CreatedAt:    sess.CreatedAt,
			UpdatedAt:    sess.UpdatedAt,
			MessageCount: sess.MessageCount,
			ActiveRunID:  sess.ActiveRunID,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt.After(result[j].UpdatedAt)
	})

	return result, nil
}

func (s *SessionStore) UpdateSession(sessionID string, userID, orgID int64, update SessionUpdate) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found")
	}
	if session.UserID != userID || session.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	if update.Messages != nil {
		session.Messages = update.Messages
		session.MessageCount = len(update.Messages)
	}
	if update.Title != nil {
		session.Title = *update.Title
	}
	if update.Summary != nil {
		session.Summary = *update.Summary
	}
	session.UpdatedAt = time.Now()

	return nil
}

func (s *SessionStore) AppendMessages(sessionID string, userID, orgID int64, messages []SessionMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found")
	}
	if session.UserID != userID || session.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	session.Messages = append(session.Messages, messages...)
	session.MessageCount = len(session.Messages)
	session.UpdatedAt = time.Now()

	return nil
}

func (s *SessionStore) DeleteSession(sessionID string, userID, orgID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found")
	}
	if session.UserID != userID || session.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	ownerKey := sessionOwnerKey(userID, orgID)
	delete(s.sessions, sessionID)
	if idx, ok := s.userIdx[ownerKey]; ok {
		delete(idx, sessionID)
	}
	if s.current[ownerKey] == sessionID {
		delete(s.current, ownerKey)
	}

	return nil
}

func (s *SessionStore) DeleteAllSessions(userID, orgID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	ownerKey := sessionOwnerKey(userID, orgID)
	idx := s.userIdx[ownerKey]
	for id := range idx {
		delete(s.sessions, id)
	}
	delete(s.userIdx, ownerKey)
	delete(s.current, ownerKey)

	return nil
}

func (s *SessionStore) GetCurrentSessionID(userID, orgID int64) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ownerKey := sessionOwnerKey(userID, orgID)
	id, ok := s.current[ownerKey]
	if !ok {
		return "", nil
	}
	return id, nil
}

func (s *SessionStore) SetCurrentSessionID(userID, orgID int64, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists || session.UserID != userID || session.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	ownerKey := sessionOwnerKey(userID, orgID)
	s.current[ownerKey] = sessionID
	return nil
}

func (s *SessionStore) ClearCurrentSessionID(userID, orgID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	ownerKey := sessionOwnerKey(userID, orgID)
	delete(s.current, ownerKey)
	return nil
}

func (s *SessionStore) SetActiveRunID(sessionID string, userID, orgID int64, runID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found")
	}
	if session.UserID != userID || session.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	session.ActiveRunID = runID
	session.UpdatedAt = time.Now()
	return nil
}

func (s *SessionStore) ClearActiveRunID(sessionID string, userID, orgID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found")
	}
	if session.UserID != userID || session.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	session.ActiveRunID = ""
	return nil
}

func (s *SessionStore) CleanupOld() {
	// In-memory store doesn't need periodic cleanup — sessions are persistent.
}
