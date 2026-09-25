package plugin

import (
	"strings"
	"testing"
	"time"
)

func TestExtractAlertNameForSnapshot(t *testing.T) {
	cases := []struct {
		name, message, want string
	}{
		{"deep-link form", "alertName:CubistTokenRefreshPerpsLam", "CubistTokenRefreshPerpsLam"},
		{"deep-link form with spaces", "alertName:High Error Rate on Checkout", "High Error Rate on Checkout"},
		{"alert prefix", "Alert: SomeRuleName", "SomeRuleName"},
		{"firing identifier title", "Alert: [FIRING:1] HighNoQuotesRateForT2Chains\nAlert: something at 2026-09-11", "HighNoQuotesRateForT2Chains"},
		{"firing multi-word title skipped", "Alert: [FIRING:1] Some Display Name With Spaces fired", ""},
		{"explicit alertname quoted", `Firing: alertname="High Error Rate" severity=critical`, "High Error Rate"},
		{"explicit alertname unquoted", "alertname=foo_bar, job=x", "foo_bar"},
		{"explicit alertname colon", "label alertname: foo-bar", "foo-bar"},
		{"explicit wins over firing header", "[FIRING:1] SomeDisplay\nalertname=real_rule", "real_rule"},
		{"empty message", "", ""},
		{"no match", "hello world, what is up", ""},
		{"firing without identifier", "Alert: [FIRING:1] Something Is Broken", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := extractAlertNameForSnapshot(tc.message); got != tc.want {
				t.Errorf("extractAlertNameForSnapshot(%q) = %q, want %q", tc.message, got, tc.want)
			}
		})
	}
}

func TestExtractMetricNames(t *testing.T) {
	cases := []struct {
		name, expr string
		want       []string
	}{
		{
			"simple selector with labels",
			`rate(http_requests_total{job="api"}[5m]) > 0.1`,
			[]string{"http_requests_total"},
		},
		{
			"aggregation with grouping clause",
			`sum by (namespace) (rate(nginx_ingress_controller_requests{status=~"5.."}[5m]))`,
			[]string{"nginx_ingress_controller_requests"},
		},
		{
			"dedupes repeated metrics",
			`sum(rate(x_total[5m])) / scalar(sum(rate(x_total[5m])))`,
			[]string{"x_total"},
		},
		{
			"bare comparison",
			`up == 0`,
			[]string{"up"},
		},
		{
			"logical operator paren is not grouping",
			`errors_total > 10 and (latency_seconds > 1)`,
			[]string{"errors_total", "latency_seconds"},
		},
		{
			"histogram quantile with le grouping",
			`histogram_quantile(0.9, sum by (le) (rate(latency_bucket[5m])))`,
			[]string{"latency_bucket"},
		},
		{
			"logql stream selector yields no metrics",
			`{job="xyz"} |= "err"`,
			nil,
		},
		{
			"label names inside braces are not metrics",
			`metric_here{job="x", namespace="ns"}`,
			[]string{"metric_here"},
		},
		{
			"without clause",
			`avg without (instance, pod) (cpu_usage)`,
			[]string{"cpu_usage"},
		},
		{
			"keyword chaining",
			`a_total > 1 unless on (instance) b_total < 5`,
			[]string{"a_total", "b_total"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := extractMetricNames(tc.expr)
			if len(got) != len(tc.want) {
				t.Fatalf("extractMetricNames(%q) = %v, want %v", tc.expr, got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Fatalf("extractMetricNames(%q) = %v, want %v", tc.expr, got, tc.want)
				}
			}
		})
	}
}

func TestExtractMetricNamesCapped(t *testing.T) {
	expr := ""
	for i := 0; i < 30; i++ {
		expr += "metric_number_" + string(rune('a'+i)) + "_zz > 0 or "
	}
	expr += "final_metric > 0"
	got := extractMetricNames(expr)
	if len(got) != arMaxMetrics {
		t.Errorf("expected cap of %d metrics, got %d", arMaxMetrics, len(got))
	}
}

func TestExtractLabelMatchers(t *testing.T) {
	cases := []struct {
		name, expr string
		want       []string
	}{
		{
			"prometheus selector",
			`rate(http_requests_total{job="api",status=~"5.."}[5m])`,
			[]string{`job="api"`, `status=~"5.."`},
		},
		{
			"logql stream selector",
			`{job="xyz"} |= "err"`,
			[]string{`job="xyz"`},
		},
		{
			"negative matchers",
			`x{env!~"dev|stage",team!="a"} > 0`,
			[]string{`env!~"dev|stage"`, `team!="a"`},
		},
		{"no braces", `up > 0`, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := extractLabelMatchers(tc.expr)
			if len(got) != len(tc.want) {
				t.Fatalf("extractLabelMatchers(%q) = %v, want %v", tc.expr, got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Fatalf("extractLabelMatchers(%q) = %v, want %v", tc.expr, got, tc.want)
				}
			}
		})
	}
}

func TestAlertRuleTitleMatches(t *testing.T) {
	if !alertRuleTitleMatches("HighNoQuotesRateForT2Chains", "highnoquotesratefort2chains") {
		t.Error("exact case-insensitive match should hit")
	}
	if !alertRuleTitleMatches("checkout: High Error Rate", "high error rate") {
		t.Error("containment of a specific (>=8 char) alert name should hit")
	}
	if alertRuleTitleMatches("Some Long Title", "short") {
		t.Error("short alert-name containment should not match")
	}
	if alertRuleTitleMatches("", "x") || alertRuleTitleMatches("x", "") {
		t.Error("empty sides should never match")
	}
}

func TestRenderAlertRuleSnapshot_SingleRule(t *testing.T) {
	d := alertRuleData{
		title: "HighNoQuotesRateForT2Chains", uid: "rule-1", ruleType: "alerting",
		group: "t2", folder: "prod", state: "firing", forDur: "5m",
		dsUID:  "prom-uid-1",
		labels: map[string]string{"severity": "critical", "team": "t2"},
		annotations: map[string]string{
			"runbook_url": "https://runbooks.example/t2",
			"summary":     "Too many chains without quotes",
		},
		queries: []alertRuleQuery{
			{datasourceUID: "prom-uid-1", expr: `rate(no_quotes_total{chain="t2"}[5m]) > 3`, metrics: []string{"no_quotes_total"}, matchers: []string{`chain="t2"`}},
		},
	}
	out := renderAlertRuleSnapshot("HighNoQuotesRateForT2Chains", []alertRuleData{d})

	for _, want := range []string{
		"1 exact match",
		"HighNoQuotesRateForT2Chains",
		"prom-uid-1",
		`runbook_url="https://runbooks.example/t2"`,
		"metrics: no_quotes_total",
		`label matchers: chain="t2"`,
		"rate(no_quotes_total{chain=\"t2\"}[5m]) > 3",
		"authoritative",
		"alerting_manage_rules",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("rendered snapshot missing %q\n---\n%s", want, out)
		}
	}
}

func TestRenderAlertRuleSnapshot_MultiRule(t *testing.T) {
	r := alertRuleData{title: "Dup", ruleType: "alerting", dsUID: "ds1"}
	out := renderAlertRuleSnapshot("Dup", []alertRuleData{r, r})
	if !strings.Contains(out, "2 matching rules") {
		t.Errorf("expected multi-rule header, got:\n%s", out)
	}
}

func TestRenderAlertRuleSnapshot_TruncatesAndCaps(t *testing.T) {
	longExpr := strings.Repeat("x", 500)
	labels := map[string]string{}
	for i := 0; i < 20; i++ {
		labels[string(rune('a'+i))+"_label"] = "v"
	}
	d := alertRuleData{
		title: "R", ruleType: "alerting", dsUID: "ds1",
		labels: labels,
		queries: []alertRuleQuery{
			{datasourceUID: "ds1", expr: longExpr, metrics: []string{"m1"}, matchers: []string{`j="v"`}},
		},
	}
	out := renderAlertRuleSnapshot("R", []alertRuleData{d})
	if !strings.Contains(out, truncateChars(longExpr, arMaxExprChars)) || strings.Contains(out, longExpr) {
		t.Error("long expr should be truncated")
	}
	if strings.Contains(out, "t_label") {
		t.Error("label cap exceeded — should render at most arMaxLabels labels")
	}
}

func TestAlertRuleSnapshotCache(t *testing.T) {
	p := &Plugin{}

	if _, ok := p.lookupAlertRuleCache("o\x00a"); ok {
		t.Fatal("empty cache should miss")
	}

	p.storeAlertRuleCache("o\x00a", "snapshot", arCacheTTL)
	if snap, ok := p.lookupAlertRuleCache("o\x00a"); !ok || snap != "snapshot" {
		t.Fatalf("cache hit expected, got ok=%v snap=%q", ok, snap)
	}

	// Expired entry must miss.
	p.arCache["o\x00b"] = dsCacheEntry{snapshot: "old", fetchedAt: time.Now().Add(-2 * arCacheTTL), ttl: arCacheTTL}
	if _, ok := p.lookupAlertRuleCache("o\x00b"); ok {
		t.Error("expired entry should miss")
	}

	// Negative (empty) entries cache under the miss TTL.
	p.storeAlertRuleCache("o\x00c", "", arMissTTL)
	if snap, ok := p.lookupAlertRuleCache("o\x00c"); !ok || snap != "" {
		t.Fatalf("negative cache hit expected, got ok=%v snap=%q", ok, snap)
	}
}

func TestAlertRuleSnapshot_FailOpenWithoutProxy(t *testing.T) {
	p := &Plugin{}
	if got := p.alertRuleSnapshot("whatever", "1", "org", ""); got != "" {
		t.Errorf("nil mcpProxy must fail open to empty snapshot, got %q", got)
	}
}

func TestParseDatasourceRef(t *testing.T) {
	if got := parseDatasourceRef([]byte(`"prom-uid"`)); got != "prom-uid" {
		t.Errorf("string ref: got %q", got)
	}
	if got := parseDatasourceRef([]byte(`{"type":"prometheus","uid":"obj-uid"}`)); got != "obj-uid" {
		t.Errorf("object ref: got %q", got)
	}
	if got := parseDatasourceRef([]byte("null")); got != "" {
		t.Errorf("null ref: got %q", got)
	}
}
