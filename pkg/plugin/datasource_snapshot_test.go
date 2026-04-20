package plugin

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestRenderDatasourceSnapshot_Array(t *testing.T) {
	raw := `[
	  {"uid":"abc123","name":"mimir","type":"prometheus"},
	  {"uid":"def456","name":"loki-prod","type":"loki"}
	]`
	got := renderDatasourceSnapshot(raw)
	if !strings.Contains(got, "uid=abc123") || !strings.Contains(got, "uid=def456") {
		t.Fatalf("expected both UIDs rendered, got:\n%s", got)
	}
	if !strings.Contains(got, "prometheus") || !strings.Contains(got, "loki") {
		t.Fatalf("expected type labels, got:\n%s", got)
	}
}

func TestRenderDatasourceSnapshot_ObjectWrapper(t *testing.T) {
	raw := `{"datasources":[{"uid":"u1","name":"p","type":"prometheus"}]}`
	got := renderDatasourceSnapshot(raw)
	if !strings.Contains(got, "uid=u1") {
		t.Fatalf("expected u1 in output, got:\n%s", got)
	}
}

func TestRenderDatasourceSnapshot_FailOpenCases(t *testing.T) {
	cases := map[string]string{
		"empty":         ``,
		"garbage":       `<html>`,
		"no datasources":`{}`,
		"missing uid":   `[{"name":"p","type":"prometheus"}]`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			got := renderDatasourceSnapshot(raw)
			if !strings.Contains(got, "MUST call `list_datasources`") {
				t.Fatalf("expected fail-open warning for %q, got:\n%s", name, got)
			}
		})
	}
}

func TestRenderDatasourceSnapshot_CapsAtMax(t *testing.T) {
	var b strings.Builder
	b.WriteString("[")
	for i := 0; i < 100; i++ {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(`{"uid":"uid`)
		b.WriteString(itoa(i))
		b.WriteString(`","name":"ds","type":"prometheus"}`)
	}
	b.WriteString("]")
	got := renderDatasourceSnapshot(b.String())
	lines := strings.Count(got, "\n") + 1
	if lines > dsSnapshotMaxEntries {
		t.Fatalf("expected cap at %d, got %d lines", dsSnapshotMaxEntries, lines)
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b strings.Builder
	neg := false
	if i < 0 {
		neg = true
		i = -i
	}
	digits := ""
	for i > 0 {
		digits = string(rune('0'+i%10)) + digits
		i /= 10
	}
	if neg {
		b.WriteRune('-')
	}
	b.WriteString(digits)
	return b.String()
}

func TestDatasourceCache_TTL(t *testing.T) {
	p := &Plugin{
		logger:    log.DefaultLogger,
		dsCache:   map[string]dsCacheEntry{},
		dsCacheMu: sync.Mutex{},
	}
	p.storeDatasourceCache("org1", "- prometheus: uid=abc")
	if snap, ok := p.lookupDatasourceCache("org1"); !ok || snap == "" {
		t.Fatal("expected fresh cache hit")
	}

	// Age the entry past the TTL.
	p.dsCacheMu.Lock()
	entry := p.dsCache["org1"]
	entry.fetchedAt = time.Now().Add(-(dsCacheTTL + time.Second))
	p.dsCache["org1"] = entry
	p.dsCacheMu.Unlock()

	if _, ok := p.lookupDatasourceCache("org1"); ok {
		t.Fatal("expected stale cache miss")
	}
}

func TestDatasourceCache_EvictsOldestOverMax(t *testing.T) {
	p := &Plugin{logger: log.DefaultLogger, dsCache: map[string]dsCacheEntry{}}

	// Seed cache right at the cap with older timestamps, then add one more.
	base := time.Now().Add(-time.Hour)
	for i := 0; i < dsCacheMaxOrgs; i++ {
		p.dsCache["k"+itoa(i)] = dsCacheEntry{
			snapshot:  "snap",
			fetchedAt: base.Add(time.Duration(i) * time.Second),
		}
	}
	p.storeDatasourceCache("new", "snap-new")

	if len(p.dsCache) > dsCacheMaxOrgs {
		t.Fatalf("expected cache size <= %d, got %d", dsCacheMaxOrgs, len(p.dsCache))
	}
	// Newest entry should still be present.
	if _, ok := p.dsCache["new"]; !ok {
		t.Fatal("newest entry was evicted")
	}
	// The oldest seeded entry ("k0") should be gone.
	if _, ok := p.dsCache["k0"]; ok {
		t.Fatal("expected oldest entry to be evicted")
	}
}
