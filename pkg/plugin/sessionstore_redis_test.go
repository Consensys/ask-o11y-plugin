package plugin

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

func newTestRedisSessionStore(t *testing.T) (*RedisSessionStore, *redis.Client, *miniredis.Miniredis) {
	t.Helper()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = client.Close()
		mr.Close()
	})

	return NewRedisSessionStore(client, log.DefaultLogger), client, mr
}

func TestRedisSessionStore_GetSessionExpiredClearsCurrentSession(t *testing.T) {
	store, client, _ := newTestRedisSessionStore(t)

	session, err := store.CreateSession(1, 1, "", []SessionMessage{{Role: "user", Content: "hello"}}, 90*24*time.Hour)
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	if err := store.SetCurrentSessionID(1, 1, session.ID); err != nil {
		t.Fatalf("SetCurrentSessionID failed: %v", err)
	}

	rs, err := store.getSessionRaw(session.ID)
	if err != nil {
		t.Fatalf("getSessionRaw failed: %v", err)
	}

	expiredAt := time.Now().Add(-1 * time.Minute)
	rs.ExpiresAt = &expiredAt
	data, err := json.Marshal(rs)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	if err := client.Set(context.Background(), sessionKey(session.ID), data, 90*24*time.Hour).Err(); err != nil {
		t.Fatalf("failed to overwrite session: %v", err)
	}

	_, err = store.GetSession(session.ID, 1, 1)
	if err == nil || err.Error() != "session expired" {
		t.Fatalf("expected session expired error, got %v", err)
	}

	currentID, err := store.GetCurrentSessionID(1, 1)
	if err != nil {
		t.Fatalf("GetCurrentSessionID failed: %v", err)
	}
	if currentID != "" {
		t.Fatalf("expected current session to be cleared, got %q", currentID)
	}
}
