package plugin

import (
	"testing"
	"time"
)

func TestParseScanInterval(t *testing.T) {
	tests := []struct {
		input    string
		wantDur  time.Duration
		wantOK   bool
	}{
		{"off", 0, false},
		{"", 0, false},
		{"unknown", 0, false},
		{"5m", 5 * time.Minute, true},
		{"15m", 15 * time.Minute, true},
		{"30m", 30 * time.Minute, true},
		{"1h", 1 * time.Hour, true},
		{"3h", 3 * time.Hour, true},
		{"12h", 12 * time.Hour, true},
		{"24h", 24 * time.Hour, true},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, ok := parseScanInterval(tt.input)
			if ok != tt.wantOK {
				t.Errorf("parseScanInterval(%q) ok=%v, want %v", tt.input, ok, tt.wantOK)
			}
			if got != tt.wantDur {
				t.Errorf("parseScanInterval(%q) dur=%v, want %v", tt.input, got, tt.wantDur)
			}
		})
	}
}

func TestHumanDuration(t *testing.T) {
	tests := []struct {
		d    time.Duration
		want string
	}{
		{30 * time.Second, "30s"},
		{5 * time.Minute, "5m"},
		{90 * time.Minute, "1h"},
		{24 * time.Hour, "24h"},
	}
	for _, tt := range tests {
		got := humanDuration(tt.d)
		if got != tt.want {
			t.Errorf("humanDuration(%v) = %q, want %q", tt.d, got, tt.want)
		}
	}
}
