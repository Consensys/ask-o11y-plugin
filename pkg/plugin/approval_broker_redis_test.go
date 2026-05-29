package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestRedisApprovalBrokerCrossInstanceResolvesPendingApproval(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	ctx := context.Background()
	brokerA := NewRedisApprovalBroker(ctx, client, log.DefaultLogger)
	brokerB := NewRedisApprovalBroker(ctx, client, log.DefaultLogger)

	wait, err := brokerA.Register(ctx, "run-redis-1", agent.ApprovalRequestEvent{ApprovalID: "tc_1"})
	if err != nil {
		t.Fatalf("register approval failed: %v", err)
	}

	resolved, err := brokerB.Resolve(ctx, "run-redis-1", agent.ApprovalResolvedEvent{
		ApprovalID: "tc_1",
		Decision:   "approved",
		ResolvedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("resolve approval failed: %v", err)
	}
	if resolved.Decision != "approved" {
		t.Fatalf("decision = %q, want approved", resolved.Decision)
	}

	waitCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	delivered, err := wait(waitCtx)
	if err != nil {
		t.Fatalf("wait failed: %v", err)
	}
	if delivered.Decision != "approved" {
		t.Fatalf("delivered decision = %q, want approved", delivered.Decision)
	}
}

func TestRedisApprovalBrokerDuplicateDecisionIsIdempotent(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	ctx := context.Background()
	broker := NewRedisApprovalBroker(ctx, client, log.DefaultLogger)

	if _, err := broker.Register(ctx, "run-redis-2", agent.ApprovalRequestEvent{ApprovalID: "tc_1"}); err != nil {
		t.Fatalf("register approval failed: %v", err)
	}

	first, err := broker.Resolve(ctx, "run-redis-2", agent.ApprovalResolvedEvent{
		ApprovalID: "tc_1",
		Decision:   "approved",
		ResolvedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("first resolve failed: %v", err)
	}

	second, err := broker.Resolve(ctx, "run-redis-2", agent.ApprovalResolvedEvent{
		ApprovalID: "tc_1",
		Decision:   "approved",
		Comment:    "duplicate click",
		ResolvedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("second resolve failed: %v", err)
	}
	if second.Decision != first.Decision || second.Comment != first.Comment {
		t.Fatalf("duplicate returned %+v, want existing %+v", second, first)
	}
}

func TestRedisApprovalBrokerConflictingDuplicateDecisionConflicts(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	ctx := context.Background()
	broker := NewRedisApprovalBroker(ctx, client, log.DefaultLogger)

	if _, err := broker.Register(ctx, "run-redis-3", agent.ApprovalRequestEvent{ApprovalID: "tc_1"}); err != nil {
		t.Fatalf("register approval failed: %v", err)
	}
	if _, err := broker.Resolve(ctx, "run-redis-3", agent.ApprovalResolvedEvent{ApprovalID: "tc_1", Decision: "approved"}); err != nil {
		t.Fatalf("first resolve failed: %v", err)
	}

	_, err := broker.Resolve(ctx, "run-redis-3", agent.ApprovalResolvedEvent{ApprovalID: "tc_1", Decision: "rejected"})
	var conflict *approvalConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected approval conflict, got %v", err)
	}
	if conflict.decision != "approved" {
		t.Fatalf("conflict decision = %q, want approved", conflict.decision)
	}
}

func TestRedisApprovalBrokerUnknownApprovalIsNotPending(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	ctx := context.Background()
	broker := NewRedisApprovalBroker(ctx, client, log.DefaultLogger)

	_, err := broker.Resolve(ctx, "run-redis-4", agent.ApprovalResolvedEvent{ApprovalID: "tc_1", Decision: "approved"})
	if !errors.Is(err, errApprovalNotPending) {
		t.Fatalf("expected not pending error, got %v", err)
	}
}
