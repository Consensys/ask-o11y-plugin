package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// Workflow entries are stored per org as one JSON array under the org's own
// Redis key. The list is replaced as a whole: a save is one atomic SET, so a
// reader never observes a half-applied list, and a failed save leaves the
// previous list in place.
const (
	// workflowStoreKeyPrefix scopes the entry list of each org. The suffix is
	// the org ID, so the same workflow name in two orgs lives in two records.
	workflowStoreKeyPrefix = "workflows:"

	// maxWorkflowEntriesPerOrg bounds one org's list. It matches the widest
	// run window the status join reads, keeping the config UI usable.
	maxWorkflowEntriesPerOrg = 100

	// maxWorkflowStoreBytes bounds the serialized list. A payload at or above
	// it is refused, so one org cannot store a blob large enough to slow every
	// scheduler tick.
	maxWorkflowStoreBytes = 1 << 20

	// maxWorkflowSaveBodyBytes bounds the PUT request body: enough for the
	// maximum list with every optional field filled, far below the 1 MiB
	// default control-request cap.
	maxWorkflowSaveBodyBytes = 256 << 10
)

// workflowStoreKey returns the Redis key holding one org's workflow entry
// list. The org is part of the key, so entries of one org are never visible to
// another org of the same plugin instance.
func workflowStoreKey(orgID int64) string {
	return workflowStoreKeyPrefix + strconv.FormatInt(orgID, 10)
}

// WorkflowStore persists one workflow entry list per org in Redis. Both
// methods fail closed: any Redis or payload error returns a non-nil error, so
// a caller never mistakes an unavailable store for an org with no workflows.
type WorkflowStore struct {
	client *redis.Client
	ctx    context.Context
	logger log.Logger
}

// NewWorkflowStore builds a store over an existing Redis client. A nil client
// keeps the store unusable, which the handlers surface as an error rather than
// an empty list.
func NewWorkflowStore(client *redis.Client, ctx context.Context, logger log.Logger) *WorkflowStore {
	return &WorkflowStore{client: client, ctx: ctx, logger: logger}
}

// workflowEntryStore returns the store this plugin instance reads and writes
// org-scoped workflow entries through.
func (p *Plugin) workflowEntryStore() *WorkflowStore {
	return NewWorkflowStore(p.redisClient, p.ctx, p.logger)
}

// ListWorkflows returns one org's entry list. A missing record is an empty
// list: that org simply saved nothing yet. Every other outcome — no Redis,
// transport failure, oversized stored payload, corrupt JSON — returns an
// error, never a synthesized empty list.
func (s *WorkflowStore) ListWorkflows(ctx context.Context, orgID int64) ([]WorkflowEntry, error) {
	if s == nil || s.client == nil {
		return nil, fmt.Errorf("workflow store requires Redis")
	}
	if ctx == nil {
		ctx = s.ctx
	}
	if ctx == nil {
		ctx = context.Background()
	}
	opCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()

	raw, err := s.client.Get(opCtx, workflowStoreKey(orgID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return []WorkflowEntry{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read workflows for org %d: %w", orgID, err)
	}
	if len(raw) >= maxWorkflowStoreBytes {
		return nil, fmt.Errorf("stored workflows for org %d exceed %d bytes", orgID, maxWorkflowStoreBytes)
	}
	var entries []WorkflowEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("decode workflows for org %d: %w", orgID, err)
	}
	// The org is server-owned: a record that names another org (a hand-edited
	// or migrated payload) still lists only for the org whose key holds it.
	for i := range entries {
		entries[i].OrgID = orgID
	}
	if entries == nil {
		entries = []WorkflowEntry{}
	}
	return entries, nil
}

// SaveWorkflows atomically replaces one org's entry list. The list is encoded
// and size-checked before the SET, so an oversized list is rejected without
// touching the stored record.
func (s *WorkflowStore) SaveWorkflows(ctx context.Context, orgID int64, entries []WorkflowEntry) error {
	if s == nil || s.client == nil {
		return fmt.Errorf("workflow store requires Redis")
	}
	if entries == nil {
		entries = []WorkflowEntry{}
	}
	payload, err := json.Marshal(entries)
	if err != nil {
		return fmt.Errorf("encode workflows for org %d: %w", orgID, err)
	}
	if len(payload) >= maxWorkflowStoreBytes {
		return fmt.Errorf("workflow list for org %d exceeds %d bytes", orgID, maxWorkflowStoreBytes)
	}
	if ctx == nil {
		ctx = s.ctx
	}
	if ctx == nil {
		ctx = context.Background()
	}
	opCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()

	if err := s.client.Set(opCtx, workflowStoreKey(orgID), payload, 0).Err(); err != nil {
		return fmt.Errorf("save workflows for org %d: %w", orgID, err)
	}
	return nil
}
