/**
 * McpConnectionsButton
 *
 * Chat toolbar button that lets the current user connect or disconnect
 * their own account on OAuth-gated MCP servers. Renders nothing when no
 * configured server requires per-user OAuth.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Modal, useStyles2, useTheme2 } from '@grafana/ui';
import { cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { getHoverButtonStyle } from '../../../../theme';
import { testIds } from '../../../testIds';
import { mcpServerStatusService, MCPOAuthStatus, MCPServerStatus } from '../../../../services/mcpServerStatus';
import { disconnectOAuth, onOAuthCallback, openOAuthPopup, startOAuthUrl } from '../../../../services/oauthClient';

interface OAuthServerRow {
  serverId: string;
  name: string;
  status: MCPOAuthStatus;
}

export function McpConnectionsButton(): React.ReactElement | null {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const [rows, setRows] = useState<OAuthServerRow[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [busyWith, setBusyWith] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await mcpServerStatusService.fetchServerStatuses();
    const oauth = response.oauth ?? {};
    const byId = new Map(response.servers.map((s: MCPServerStatus) => [s.serverId, s]));
    setRows(
      Object.entries(oauth)
        .filter(([, status]) => status.configured)
        .map(([serverId, status]) => ({
          serverId,
          name: byId.get(serverId)?.name || serverId,
          status,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = onOAuthCallback(() => {
      refresh();
    });
    return unsubscribe;
  }, [refresh]);

  if (rows.length === 0) {
    return null;
  }

  const disconnectedCount = rows.filter((r) => !r.status.connected).length;

  const handleConnect = (serverId: string) => {
    const popup = openOAuthPopup(serverId);
    if (!popup) {
      // Popup blocked: fall back to same-tab navigation.
      window.location.href = startOAuthUrl(serverId);
    }
  };

  const handleDisconnect = async (serverId: string) => {
    setBusyWith(serverId);
    try {
      await disconnectOAuth(serverId);
      await refresh();
    } finally {
      setBusyWith(null);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={cx(
          'flex items-center gap-2 px-2 py-1 text-xs font-medium rounded-md transition-colors',
          styles.hoverButton
        )}
        aria-label="MCP connections"
        title="Connect your accounts for external MCP servers"
        style={{ color: theme.colors.text.secondary }}
        data-testid={testIds.chat.mcpConnectionsButton}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Connections{disconnectedCount > 0 ? ` (${disconnectedCount})` : ''}</span>
      </button>

      <Modal
        title="MCP connections"
        isOpen={isOpen}
        onDismiss={() => setIsOpen(false)}
        data-testid={testIds.chat.mcpConnectionsModal}
      >
        <p className="text-sm text-secondary mb-3">
          These MCP servers authenticate each user individually. Connect with your own account to let the assistant
          use their tools on your behalf.
        </p>
        {rows.map((row) => (
          <div
            key={row.serverId}
            className="flex items-center justify-between py-2 border-b border-weak"
            data-testid={testIds.chat.mcpConnectionRow(row.serverId)}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{row.name}</span>
              <Badge
                text={row.status.connected ? 'Connected' : 'Not connected'}
                color={row.status.connected ? 'green' : 'orange'}
              />
            </div>
            {row.status.connected ? (
              <Button
                size="sm"
                variant="secondary"
                icon="unlock"
                disabled={busyWith === row.serverId}
                onClick={() => handleDisconnect(row.serverId)}
                data-testid={testIds.chat.mcpConnectionDisconnect(row.serverId)}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon="external-link-alt"
                onClick={() => handleConnect(row.serverId)}
                data-testid={testIds.chat.mcpConnectionConnect(row.serverId)}
              >
                Connect
              </Button>
            )}
          </div>
        ))}
      </Modal>
    </>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  hoverButton: getHoverButtonStyle(theme),
});
