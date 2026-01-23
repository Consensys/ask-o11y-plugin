import React, { useCallback, useEffect, useState } from 'react';
import { Button, Field, Input, Switch, TagsInput, Alert } from '@grafana/ui';
import { OAuth2Config } from '../../types/plugin';
import { oauthService } from '../../services/oauthService';
import { OAuthStatusBadge } from './OAuthStatusBadge';

export interface OAuthConfigPanelProps {
  serverId: string;
  serverUrl: string;
  config?: OAuth2Config;
  onChange: (config: OAuth2Config) => void;
}

export const OAuthConfigPanel: React.FC<OAuthConfigPanelProps> = ({ serverId, serverUrl, config = {}, onChange }) => {
  const [discovering, setDiscovering] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState(config.tokenStatus || 'not_configured');

  const loadOAuthStatus = useCallback(async () => {
    try {
      const status = await oauthService.getOAuthStatus(serverId);
      setTokenStatus(status.tokenStatus);
      onChange({
        ...config,
        tokenStatus: status.tokenStatus,
        tokenExpiresAt: status.expiresAt,
        lastError: status.lastError,
      });
    } catch (err) {
      console.error('Failed to load OAuth status:', err);
    }
  }, [serverId, config, onChange]);

  // Load OAuth status on mount
  useEffect(() => {
    if (serverId) {
      loadOAuthStatus();
    }
  }, [serverId, loadOAuthStatus]);

  const handleDiscover = async () => {
    setDiscovering(true);
    setError(null);

    try {
      const metadata = await oauthService.discoverMetadata(serverUrl);
      onChange({
        ...config,
        discoveryUrl: metadata.issuer,
        authorizationEndpoint: metadata.authorization_endpoint,
        tokenEndpoint: metadata.token_endpoint,
        registrationEndpoint: metadata.registration_endpoint,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover OAuth metadata');
    } finally {
      setDiscovering(false);
    }
  };

  const handleRegisterClient = async () => {
    if (!config.registrationEndpoint) {
      setError('Registration endpoint not configured');
      return;
    }

    setRegistering(true);
    setError(null);

    try {
      // Build redirect URI (callback URL for this plugin)
      const redirectUri = `${window.location.origin}/api/plugins/consensys-asko11y-app/resources/api/mcp/oauth/callback`;

      const registration = await oauthService.registerClient({
        registrationEndpoint: config.registrationEndpoint,
        clientName: `Grafana Ask O11y - ${serverUrl}`,
        redirectUri,
        scopes: config.scopes || [],
      });

      onChange({
        ...config,
        clientId: registration.client_id,
        clientSecret: registration.client_secret,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register client');
    } finally {
      setRegistering(false);
    }
  };

  const handleAuthorize = async () => {
    if (!config.clientId || !config.authorizationEndpoint || !config.tokenEndpoint) {
      setError('OAuth configuration is incomplete');
      return;
    }

    setAuthorizing(true);
    setError(null);

    try {
      await oauthService.startAuthorization(serverId, config);
      // Refresh status after authorization
      await loadOAuthStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed');
    } finally {
      setAuthorizing(false);
    }
  };

  const handleRevoke = async () => {
    setError(null);

    try {
      await oauthService.revokeToken(serverId);
      setTokenStatus('not_configured');
      onChange({
        ...config,
        tokenStatus: 'not_configured',
        tokenExpiresAt: undefined,
        lastError: undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token');
    }
  };

  const isConfigured = Boolean(config.clientId && config.authorizationEndpoint && config.tokenEndpoint);

  return (
    <div
      className="mt-2 p-3 rounded"
      style={{
        backgroundColor: 'var(--grafana-background-canvas)',
        border: '1px solid var(--grafana-border-weak)',
      }}
    >
      <h6 className="text-sm font-medium mb-3">OAuth 2.1 Configuration</h6>

      {error && (
        <Alert severity="error" title="OAuth Error" className="mb-3">
          {error}
        </Alert>
      )}

      {/* Discovery URL & Discover Button */}
      <Field label="Server URL" description="The MCP server URL to discover OAuth metadata from">
        <div className="flex gap-2">
          <Input width={60} value={serverUrl} disabled />
          <Button variant="secondary" onClick={handleDiscover} disabled={discovering || !serverUrl}>
            {discovering ? 'Discovering...' : 'Discover'}
          </Button>
        </div>
      </Field>

      {/* Authorization Endpoint */}
      {config.authorizationEndpoint && (
        <Field label="Authorization Endpoint" className="mt-2">
          <Input width={60} value={config.authorizationEndpoint} disabled />
        </Field>
      )}

      {/* Token Endpoint */}
      {config.tokenEndpoint && (
        <Field label="Token Endpoint" className="mt-2">
          <Input width={60} value={config.tokenEndpoint} disabled />
        </Field>
      )}

      {/* Dynamic Client Registration */}
      <Field
        label="Use Dynamic Client Registration"
        description="Automatically register OAuth client with the authorization server"
        className="mt-3"
      >
        <div className="flex items-center gap-2">
          <Switch
            value={config.useDynamicRegistration || false}
            onChange={(e) =>
              onChange({
                ...config,
                useDynamicRegistration: e.currentTarget.checked,
              })
            }
          />
          {config.useDynamicRegistration && config.registrationEndpoint && (
            <Button variant="secondary" size="sm" onClick={handleRegisterClient} disabled={registering}>
              {registering ? 'Registering...' : 'Register Client'}
            </Button>
          )}
        </div>
      </Field>

      {/* Manual Client Credentials (when not using DCR) */}
      {!config.useDynamicRegistration && (
        <>
          <Field label="Client ID" description="OAuth client ID from the authorization server" className="mt-2">
            <Input
              width={60}
              value={config.clientId || ''}
              placeholder="client-id-from-oauth-server"
              onChange={(e) =>
                onChange({
                  ...config,
                  clientId: e.currentTarget.value,
                })
              }
            />
          </Field>

          <Field label="Client Secret" description="OAuth client secret (optional for public clients)" className="mt-2">
            <Input
              width={60}
              type="password"
              value={config.clientSecret || ''}
              placeholder="client-secret-from-oauth-server"
              onChange={(e) =>
                onChange({
                  ...config,
                  clientSecret: e.currentTarget.value,
                })
              }
            />
          </Field>
        </>
      )}

      {/* Scopes */}
      <Field
        label="Scopes"
        description="OAuth scopes to request (space-separated, e.g., mcp:tools mcp:resources)"
        className="mt-2"
      >
        <TagsInput
          tags={config.scopes || []}
          onChange={(scopes) =>
            onChange({
              ...config,
              scopes,
            })
          }
          placeholder="Add scope..."
        />
      </Field>

      {/* Resource (RFC 8707) */}
      <Field
        label="Resource (optional)"
        description="OAuth resource indicator (RFC 8707) - defaults to server URL"
        className="mt-2"
      >
        <Input
          width={60}
          value={config.resource || ''}
          placeholder={serverUrl}
          onChange={(e) =>
            onChange({
              ...config,
              resource: e.currentTarget.value,
            })
          }
        />
      </Field>

      {/* OAuth Status */}
      <div className="mt-4">
        <Field label="Authorization Status">
          <OAuthStatusBadge
            status={tokenStatus}
            expiresAt={config.tokenExpiresAt}
            lastError={config.lastError}
          />
        </Field>
      </div>

      {/* Authorization Actions */}
      <div className="mt-3 flex gap-2">
        {tokenStatus !== 'authorized' ? (
          <Button variant="primary" onClick={handleAuthorize} disabled={!isConfigured || authorizing}>
            {authorizing ? 'Authorizing...' : 'Authorize Now'}
          </Button>
        ) : (
          <Button variant="secondary" onClick={handleRevoke}>
            Revoke Authorization
          </Button>
        )}
      </div>

      {/* Helper Text */}
      <p className="text-xs mt-3" style={{ color: 'var(--grafana-text-secondary)' }}>
        OAuth tokens are user-scoped and stored securely. Authorization will open a popup window for consent.
      </p>
    </div>
  );
};
