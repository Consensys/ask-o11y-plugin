package plugin

import "testing"

func TestResolveMaxIterations(t *testing.T) {
	tests := []struct {
		name string
		typ  string
		msg  string
		want int
	}{
		{"investigation type", "investigation", "anything", AlertInvestigationMaxIter},
		{"firing bracket", "chat", "[FIRING:1] OOMKilled in linea-prod", AlertInvestigationMaxIter},
		{"firing lowercase", "chat", "[firing:2] SomeAlert", AlertInvestigationMaxIter},
		{"alert investigation prefix", "chat", "Alert Investigation: KubePodNotReady", AlertInvestigationMaxIter},
		{"rca phrase", "chat", "please perform root cause analysis on this pod", AlertInvestigationMaxIter},
		{"plain chat", "chat", "how many pods are running in cs tenant", AgentMaxIterations},
		{"empty message", "", "", AgentMaxIterations},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveMaxIterations(tc.typ, tc.msg)
			if got != tc.want {
				t.Fatalf("got %d want %d (type=%q msg=%q)", got, tc.want, tc.typ, tc.msg)
			}
		})
	}
}
