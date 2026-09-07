package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type stubRunStore struct {
	snapshot *AgentRun
	live     chan agent.SSEEvent
}

func (s *stubRunStore) CreateRun(runID string, userID, orgID int64, sessionID ...string) *AgentRun {
	return s.snapshot
}
func (s *stubRunStore) AppendEvent(string, agent.SSEEvent)              {}
func (s *stubRunStore) FinishRun(string, RunStatus, string)             {}
func (s *stubRunStore) GetRun(string) (*AgentRun, error)                { return s.snapshot, nil }
func (s *stubRunStore) ListRuns(int64, int64, int) ([]*AgentRun, error) { return nil, nil }
func (s *stubRunStore) CleanupOld()                                     {}
func (s *stubRunStore) SubscribeAndSnapshot(string) (*AgentRun, <-chan agent.SSEEvent, func(), error) {
	return s.snapshot, s.live, func() {}, nil
}

func contentEvent(sequence int64, text string) agent.SSEEvent {
	return agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: text}, Sequence: sequence}
}

// A replica's pub/sub subscription is attached before the snapshot is read, so
// the live channel can carry events the snapshot already contains.
func TestHandleAgentRunEvents_SkipsEventsAlreadyReplayed(t *testing.T) {
	live := make(chan agent.SSEEvent, 8)
	store := &stubRunStore{
		snapshot: &AgentRun{
			RunID:  "run-1",
			Status: RunStatusRunning,
			UserID: 7,
			OrgID:  1,
			Events: []agent.SSEEvent{contentEvent(0, "first"), contentEvent(1, "second")},
		},
		live: live,
	}
	live <- contentEvent(0, "first")
	live <- contentEvent(1, "second")
	live <- contentEvent(2, "third")
	close(live)

	body := runEventsHandler(t, store, "run-1")

	for _, want := range []string{"first", "second", "third"} {
		if got := strings.Count(body, `"content":"`+want+`"`); got != 1 {
			t.Errorf("expected %q exactly once in the stream, got %d", want, got)
		}
	}
}

func TestHandleAgentRunEvents_ForwardsNewEvents(t *testing.T) {
	live := make(chan agent.SSEEvent, 4)
	store := &stubRunStore{
		snapshot: &AgentRun{
			RunID:  "run-2",
			Status: RunStatusRunning,
			UserID: 7,
			OrgID:  1,
			Events: []agent.SSEEvent{contentEvent(0, "replayed")},
		},
		live: live,
	}
	live <- contentEvent(1, "streamed")
	close(live)

	body := runEventsHandler(t, store, "run-2")

	if strings.Count(body, `"content":"replayed"`) != 1 {
		t.Error("expected the snapshot event to be replayed once")
	}
	if strings.Count(body, `"content":"streamed"`) != 1 {
		t.Error("expected the live event to be forwarded")
	}
}

func runEventsHandler(t *testing.T, store RunStoreInterface, runID string) string {
	t.Helper()

	p := &Plugin{runStore: store, logger: log.DefaultLogger}
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	req.Header.Set("X-Grafana-User-Id", "7")
	req.Header.Set("X-Grafana-Org-Id", "1")
	recorder := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		defer close(done)
		p.handleAgentRunEvents(recorder, req, runID)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("handler did not return after the live channel closed")
	}

	return recorder.Body.String()
}

// Pub/sub delivery is at-most-once, so a dropped message can leave a hole that a
// later delivered event papers over. The stream has to stop at the gap so the
// client's reconnect replays the durable list instead of rendering a partial run.
func TestHandleAgentRunEvents_StopsAtLiveSequenceGap(t *testing.T) {
	live := make(chan agent.SSEEvent, 8)
	store := &stubRunStore{
		snapshot: &AgentRun{
			RunID:  "run-gap",
			Status: RunStatusRunning,
			UserID: 7,
			OrgID:  1,
			Events: []agent.SSEEvent{contentEvent(0, "first")},
		},
		live: live,
	}
	live <- contentEvent(1, "second")
	live <- contentEvent(3, "fourth")
	live <- contentEvent(4, "fifth")
	close(live)

	body := runEventsHandler(t, store, "run-gap")

	for _, want := range []string{"first", "second"} {
		if got := strings.Count(body, `"content":"`+want+`"`); got != 1 {
			t.Errorf("expected %q exactly once before the gap, got %d", want, got)
		}
	}
	for _, unwanted := range []string{"fourth", "fifth"} {
		if strings.Contains(body, `"content":"`+unwanted+`"`) {
			t.Errorf("expected %q to be withheld: it arrived after a sequence gap", unwanted)
		}
	}
}
