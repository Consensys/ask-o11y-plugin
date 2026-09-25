package agent

import (
	"testing"
)

func TestCanonicalToolSignature_KeyOrderAgnostic(t *testing.T) {
	a := canonicalToolSignature("query_prometheus", `{"b": 1, "a": "x"}`)
	b := canonicalToolSignature("query_prometheus", `{"a": "x", "b": 1}`)
	if a != b {
		t.Errorf("signatures differ for semantically identical args:\n a=%q\n b=%q", a, b)
	}
	if a == canonicalToolSignature("query_prometheus", `{"a": "y", "b": 1}`) {
		t.Errorf("signature collided across different arg values")
	}
}

func TestTokenSimilarity(t *testing.T) {
	cases := []struct {
		name string
		a, b string
		min  float64
		max  float64
	}{
		{"identical", "echo {\"n\":1}", "echo {\"n\":1}", 1, 1},
		{"widened window fires", `echo {"query":"rate(errors[5m])"}`, `echo {"query":"rate(errors[10m])"}`, 0.7, 1},
		{"shifted range fires", `qp {"query":"up","start":"2026-09-25T10:00:00Z"}`, `qp {"query":"up","start":"2026-09-25T10:05:00Z"}`, 0.7, 1},
		{"different metric does not fire", `qp {"query":"up"}`, `qp {"query":"process_cpu_seconds_total"}`, 0, 0.3},
		{"different label value does not fire", `lg {"query":"{job=\"api\"}"}`, `lg {"query":"{job=\"db\"}"}`, 0, 0.7},
		{"disjoint", "echo aaaa", "echo bbbb", 0, 0.3},
		{"empty vs empty", "", "", 1, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tokenSimilarity(tc.a, tc.b)
			if got < tc.min || got > tc.max {
				t.Errorf("tokenSimilarity(%q, %q) = %v, want within [%v, %v]", tc.a, tc.b, got, tc.min, tc.max)
			}
		})
	}
}

func TestStallDetector_ExactDuplicateReplay(t *testing.T) {
	d := newStallDetector()
	sig := canonicalToolSignature("fake_echo", `{"n":1}`)

	if _, exact := d.checkExact(sig); exact {
		t.Fatal("fresh detector must not report a cache hit")
	}

	d.rememberSuccess(sig, 0, "one")
	hit, exact := d.checkExact(sig)
	if !exact || hit.content != "one" || hit.iteration != 0 {
		t.Fatalf("cache hit = %+v, exact=%v, want content one at iteration 0", hit, exact)
	}

	// Formatting differences must not hide the duplicate.
	same, different := canonicalToolSignature("fake_echo", `{ "n" : 1 }`), canonicalToolSignature("fake_echo", `{"n":2}`)
	if _, exact := d.checkExact(same); !exact {
		t.Error("whitespace-formatted duplicate not detected")
	}
	if _, exact := d.checkExact(different); exact {
		t.Error("different args must not be a cache hit")
	}
}

func TestStallDetector_RepetitionNudgeAfterThreeDups(t *testing.T) {
	d := newStallDetector()

	// Three repetition events (one exact dup replay, two near-dup
	// re-queries): the nudge fires once.
	d.observe("fake_echo", canonicalToolSignature("fake_echo", `{"query":"rate(errors[5m])"}`))
	d.noteRepetition() // exact dup replay
	if kind, _, _ := d.pendingNudge(); kind != "" {
		t.Fatalf("nudge fired early: kind=%s", kind)
	}
	if !d.observe("fake_echo", canonicalToolSignature("fake_echo", `{"query":"rate(errors[10m])"}`)) {
		t.Fatal("widened-window re-query must count as a near-duplicate")
	}
	if !d.observe("fake_echo", canonicalToolSignature("fake_echo", `{"query":"rate(errors[5m]) by (job)"}`)) {
		t.Fatal("grouping-added re-query must count as a near-duplicate")
	}
	kind, msg, forced := d.pendingNudge()
	if kind != StallKindRepetition || msg == "" || forced {
		t.Fatalf("expected repetition nudge, got kind=%s forced=%v msg=%q", kind, forced, msg)
	}
	// One-shot: it must not repeat (no other condition is pending).
	if kind, _, _ := d.pendingNudge(); kind != "" {
		t.Errorf("repetition nudge fired twice, second kind=%s", kind)
	}
}

func TestStallDetector_StalledProgressNudgeThenForcedFinal(t *testing.T) {
	d := newStallDetector()

	// Three stalled iterations: below the threshold.
	for i := 0; i < stalledIterationThreshold-1; i++ {
		d.recordBatchProgress(false)
	}
	if kind, _, forced := d.pendingNudge(); kind != "" || forced {
		t.Fatalf("stall nudge fired early: kind=%s forced=%v", kind, forced)
	}

	// Fourth consecutive stalled iteration: one-time nudge, not forced.
	d.recordBatchProgress(false)
	kind, msg, forced := d.pendingNudge()
	if kind != StallKindStalled || msg == "" || forced {
		t.Fatalf("expected stalled nudge, got kind=%s forced=%v", kind, forced)
	}

	// Progress resets the streak, so nothing more fires.
	d.recordBatchProgress(true)
	if kind, _, _ := d.pendingNudge(); kind != "" {
		t.Errorf("progress must reset the stall streak, got kind=%s", kind)
	}

	// A second stalled episode after the nudge forces a final answer.
	for i := 0; i < stalledIterationThreshold; i++ {
		d.recordBatchProgress(false)
	}
	kind, msg, forced = d.pendingNudge()
	if kind != StallKindForcedFinal || msg == "" || !forced {
		t.Fatalf("expected forced-final nudge, got kind=%s forced=%v", kind, forced)
	}
	if kind, _, _ := d.pendingNudge(); kind != "" {
		t.Errorf("forced-final nudge fired twice, second kind=%s", kind)
	}
}

func TestStallDetector_ExactDupCountsTowardRepetitionNudge(t *testing.T) {
	d := newStallDetector()
	sig := canonicalToolSignature("fake_echo", `{"n":1}`)

	d.rememberSuccess(sig, 0, "one")
	for i := 0; i < nearDupNudgeThreshold; i++ {
		if _, exact := d.checkExact(sig); !exact {
			t.Fatalf("dup %d: expected cache hit", i)
		}
		d.noteRepetition()
	}
	kind, _, _ := d.pendingNudge()
	if kind != StallKindRepetition {
		t.Errorf("expected repetition nudge after %d exact dups, got kind=%s", nearDupNudgeThreshold, kind)
	}
}
