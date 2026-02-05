package mcp

import "testing"

func TestGetSecureHeaderKey(t *testing.T) {
	tests := []struct {
		name      string
		serverID  string
		headerKey string
		expected  string
	}{
		{
			name:      "basic server ID and header key",
			serverID:  "server-1",
			headerKey: "Authorization",
			expected:  "mcp_server-1_header_Authorization",
		},
		{
			name:      "server ID with hyphens",
			serverID:  "my-mcp-server",
			headerKey: "X-API-Key",
			expected:  "mcp_my-mcp-server_header_X-API-Key",
		},
		{
			name:      "header key with hyphens",
			serverID:  "server",
			headerKey: "Content-Type",
			expected:  "mcp_server_header_Content-Type",
		},
		{
			name:      "simple server ID and header key",
			serverID:  "test",
			headerKey: "key",
			expected:  "mcp_test_header_key",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GetSecureHeaderKey(tt.serverID, tt.headerKey)
			if result != tt.expected {
				t.Errorf("GetSecureHeaderKey(%q, %q) = %q, want %q",
					tt.serverID, tt.headerKey, result, tt.expected)
			}
		})
	}
}

func TestGetSecureHeaderKey_ConsistentWithFrontend(t *testing.T) {
	testCases := []struct {
		serverID  string
		headerKey string
	}{
		{"server-1", "Authorization"},
		{"my-mcp-server", "X-API-Key"},
		{"grafana", "X-Grafana-Org-Id"},
	}

	for _, tc := range testCases {
		key := GetSecureHeaderKey(tc.serverID, tc.headerKey)
		expectedPrefix := "mcp_" + tc.serverID + "_header_"
		if len(key) <= len(expectedPrefix) {
			t.Errorf("Key %q is too short", key)
			continue
		}
		if key[:len(expectedPrefix)] != expectedPrefix {
			t.Errorf("Key %q doesn't have expected prefix %q", key, expectedPrefix)
		}
		if key != expectedPrefix+tc.headerKey {
			t.Errorf("Key %q doesn't match expected format", key)
		}
	}
}
