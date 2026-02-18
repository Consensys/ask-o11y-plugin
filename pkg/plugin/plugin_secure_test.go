package plugin

import (
	"context"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSecureHeaderMerging(t *testing.T) {
	ctx := context.Background()

	t.Run("merges headers from DecryptedSecureJSONData into server configs", func(t *testing.T) {
		jsonData := `{
			"mcpServers": [
				{
					"id": "server1",
					"name": "Test Server 1",
					"url": "http://example.com",
					"enabled": true,
					"type": "streamable-http"
				},
				{
					"id": "server2",
					"name": "Test Server 2",
					"url": "http://example2.com",
					"enabled": true,
					"type": "openapi"
				}
			]
		}`

		secureData := map[string]string{
			"server1__headers": `{"Authorization":"Bearer token123","X-API-Key":"key456"}`,
			"server2__headers": `{"X-Custom-Header":"custom-value"}`,
		}

		settings := backend.AppInstanceSettings{
			JSONData:                []byte(jsonData),
			DecryptedSecureJSONData: secureData,
		}

		plugin, err := NewPlugin(ctx, settings)
		require.NoError(t, err)
		require.NotNil(t, plugin)

		p := plugin.(*Plugin)
		require.Len(t, p.settings.MCPServers, 2)

		// Verify server1 headers
		assert.NotNil(t, p.settings.MCPServers[0].Headers)
		assert.Equal(t, "Bearer token123", p.settings.MCPServers[0].Headers["Authorization"])
		assert.Equal(t, "key456", p.settings.MCPServers[0].Headers["X-API-Key"])

		// Verify server2 headers
		assert.NotNil(t, p.settings.MCPServers[1].Headers)
		assert.Equal(t, "custom-value", p.settings.MCPServers[1].Headers["X-Custom-Header"])
	})

	t.Run("handles servers without headers gracefully", func(t *testing.T) {
		jsonData := `{
			"mcpServers": [
				{
					"id": "server1",
					"name": "Test Server 1",
					"url": "http://example.com",
					"enabled": true,
					"type": "streamable-http"
				},
				{
					"id": "server2",
					"name": "Test Server 2",
					"url": "http://example2.com",
					"enabled": true,
					"type": "openapi"
				}
			]
		}`

		// Only server1 has headers
		secureData := map[string]string{
			"server1__headers": `{"Authorization":"Bearer token123"}`,
		}

		settings := backend.AppInstanceSettings{
			JSONData:                []byte(jsonData),
			DecryptedSecureJSONData: secureData,
		}

		plugin, err := NewPlugin(ctx, settings)
		require.NoError(t, err)
		require.NotNil(t, plugin)

		p := plugin.(*Plugin)
		require.Len(t, p.settings.MCPServers, 2)

		// Verify server1 has headers
		assert.NotNil(t, p.settings.MCPServers[0].Headers)
		assert.Equal(t, "Bearer token123", p.settings.MCPServers[0].Headers["Authorization"])

		// Verify server2 has no headers (nil map)
		assert.Nil(t, p.settings.MCPServers[1].Headers)
	})

	t.Run("handles invalid JSON in secure headers gracefully", func(t *testing.T) {
		jsonData := `{
			"mcpServers": [
				{
					"id": "server1",
					"name": "Test Server 1",
					"url": "http://example.com",
					"enabled": true,
					"type": "streamable-http"
				}
			]
		}`

		secureData := map[string]string{
			"server1__headers": `{invalid json}`, // Invalid JSON
		}

		settings := backend.AppInstanceSettings{
			JSONData:                []byte(jsonData),
			DecryptedSecureJSONData: secureData,
		}

		plugin, err := NewPlugin(ctx, settings)
		require.NoError(t, err)
		require.NotNil(t, plugin)

		p := plugin.(*Plugin)
		require.Len(t, p.settings.MCPServers, 1)

		// Verify headers are nil (parsing failed, but plugin still works)
		assert.Nil(t, p.settings.MCPServers[0].Headers)
	})

	t.Run("handles nil DecryptedSecureJSONData gracefully", func(t *testing.T) {
		jsonData := `{
			"mcpServers": [
				{
					"id": "server1",
					"name": "Test Server 1",
					"url": "http://example.com",
					"enabled": true,
					"type": "streamable-http"
				}
			]
		}`

		settings := backend.AppInstanceSettings{
			JSONData:                []byte(jsonData),
			DecryptedSecureJSONData: nil,
		}

		plugin, err := NewPlugin(ctx, settings)
		require.NoError(t, err)
		require.NotNil(t, plugin)

		p := plugin.(*Plugin)
		require.Len(t, p.settings.MCPServers, 1)

		// Verify server has no headers
		assert.Nil(t, p.settings.MCPServers[0].Headers)
	})

	t.Run("handles empty headers JSON object", func(t *testing.T) {
		jsonData := `{
			"mcpServers": [
				{
					"id": "server1",
					"name": "Test Server 1",
					"url": "http://example.com",
					"enabled": true,
					"type": "streamable-http"
				}
			]
		}`

		secureData := map[string]string{
			"server1__headers": `{}`, // Empty headers object
		}

		settings := backend.AppInstanceSettings{
			JSONData:                []byte(jsonData),
			DecryptedSecureJSONData: secureData,
		}

		plugin, err := NewPlugin(ctx, settings)
		require.NoError(t, err)
		require.NotNil(t, plugin)

		p := plugin.(*Plugin)
		require.Len(t, p.settings.MCPServers, 1)

		// Verify headers map is empty but not nil
		assert.NotNil(t, p.settings.MCPServers[0].Headers)
		assert.Empty(t, p.settings.MCPServers[0].Headers)
	})

	t.Run("handles multiple servers with different header configurations", func(t *testing.T) {
		jsonData := `{
			"mcpServers": [
				{
					"id": "server1",
					"name": "Server with headers",
					"url": "http://example1.com",
					"enabled": true,
					"type": "streamable-http"
				},
				{
					"id": "server2",
					"name": "Server without headers",
					"url": "http://example2.com",
					"enabled": true,
					"type": "openapi"
				},
				{
					"id": "server3",
					"name": "Server with empty headers",
					"url": "http://example3.com",
					"enabled": true,
					"type": "sse"
				}
			]
		}`

		secureData := map[string]string{
			"server1__headers": `{"Authorization":"Bearer token","X-Header":"value"}`,
			"server3__headers": `{}`,
		}

		settings := backend.AppInstanceSettings{
			JSONData:                []byte(jsonData),
			DecryptedSecureJSONData: secureData,
		}

		plugin, err := NewPlugin(ctx, settings)
		require.NoError(t, err)
		require.NotNil(t, plugin)

		p := plugin.(*Plugin)
		require.Len(t, p.settings.MCPServers, 3)

		// Verify server1 has headers
		assert.NotNil(t, p.settings.MCPServers[0].Headers)
		assert.Len(t, p.settings.MCPServers[0].Headers, 2)

		// Verify server2 has no headers
		assert.Nil(t, p.settings.MCPServers[1].Headers)

		// Verify server3 has empty headers map
		assert.NotNil(t, p.settings.MCPServers[2].Headers)
		assert.Empty(t, p.settings.MCPServers[2].Headers)
	})
}
