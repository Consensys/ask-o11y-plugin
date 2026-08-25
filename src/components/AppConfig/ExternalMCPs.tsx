/**
 * ExternalMCPs
 *
 * AppConfig section that lets Admin users attach external OAuth-gated MCP
 * servers at runtime — presets (GitHub read-only, GitHub read/write,
 * Atlassian) plus a generic form. After provisioning, each end user runs
 * their own Connect flow from the chat toolbar.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Combobox, Field, Input, Switch } from '@grafana/ui';
import { testIds } from '../testIds';
import {
  addGeneric,
  addPreset,
  AddGenericInput,
  DynamicMCPServer,
  listDynamicServers,
  listPresets,
  MCPPreset,
  removeDynamicServer,
} from '../../services/mcpProvisionerClient';

interface PresetCredentials {
  clientId: string;
  clientSecret: string;
}

function PresetCard({
  preset,
  isProvisioned,
  onProvision,
  onRemove,
  busyWith,
}: {
  preset: MCPPreset;
  isProvisioned: boolean;
  onProvision: (preset: MCPPreset, credentials: PresetCredentials) => Promise<void>;
  onRemove: (serverId: string) => Promise<void>;
  busyWith: string | null;
}) {
  const needsClientId = !preset.dcrCapable;
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const busy = busyWith === preset.id;

  const handleAdd = async () => {
    await onProvision(preset, { clientId, clientSecret });
    setClientId('');
    setClientSecret('');
  };

  return (
    <div
      className="p-3 rounded border border-weak flex flex-col gap-2 mb-3"
      data-testid={testIds.appConfig.externalMcpPresetCard(preset.id)}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{preset.displayName}</div>
          <div className="text-xs text-secondary">
            {preset.mcpUrl} · {preset.transport} ·{' '}
            {preset.dcrCapable ? 'auto-registers with provider' : 'bring your own OAuth app'}
          </div>
          {preset.scopes.length > 0 && <div className="text-xs text-secondary">scopes: {preset.scopes.join(', ')}</div>}
        </div>
        {isProvisioned ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => onRemove(preset.serverId)}
            data-testid={testIds.appConfig.externalMcpPresetRemoveButton(preset.id)}
          >
            Remove
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={busy || (needsClientId && !clientId)}
            onClick={handleAdd}
            data-testid={testIds.appConfig.externalMcpPresetAddButton(preset.id)}
          >
            {busy ? 'Adding…' : 'Add'}
          </Button>
        )}
      </div>
      {needsClientId && !isProvisioned && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Client ID"
            description="Create an OAuth App at the provider (e.g. github.com/settings/developers) using the plugin callback URL, then paste its client ID here."
          >
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.currentTarget.value)}
              placeholder="Iv1.abcd…"
              data-testid={testIds.appConfig.externalMcpPresetClientIdInput(preset.id)}
            />
          </Field>
          <Field label="Client Secret" description="Optional — leave blank for PKCE-only.">
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.currentTarget.value)}
              placeholder="leave blank for PKCE-only"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

const EMPTY_GENERIC_FORM: AddGenericInput = {
  serverId: '',
  displayName: '',
  mcpUrl: '',
  transport: 'streamable-http',
  pkce: true,
  discover: true,
};

function GenericForm({ onSubmit, busy }: { onSubmit: (input: AddGenericInput) => Promise<void>; busy: boolean }) {
  const [form, setForm] = useState<AddGenericInput>(EMPTY_GENERIC_FORM);
  const [scopesText, setScopesText] = useState('');

  const set = <K extends keyof AddGenericInput>(k: K, v: AddGenericInput[K]) => setForm((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    const scopes = scopesText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await onSubmit({ ...form, scopes });
  };

  return (
    <div className="p-3 rounded border border-weak" data-testid={testIds.appConfig.externalMcpGenericForm}>
      <div className="font-medium mb-2">Generic OAuth MCP</div>
      <div className="text-xs text-secondary mb-3">
        Keep <strong>Discover</strong> on when the server publishes OAuth metadata
        (/.well-known/oauth-authorization-server); turn it off to supply the URLs manually.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Server ID" description="Lowercase letters, digits and dashes.">
          <Input value={form.serverId} onChange={(e) => set('serverId', e.currentTarget.value)} placeholder="my-mcp" />
        </Field>
        <Field label="Display name">
          <Input value={form.displayName ?? ''} onChange={(e) => set('displayName', e.currentTarget.value)} />
        </Field>
        <Field label="MCP URL" className="col-span-2">
          <Input
            value={form.mcpUrl}
            onChange={(e) => set('mcpUrl', e.currentTarget.value)}
            placeholder="https://mcp.example.com/v1/mcp"
          />
        </Field>
        <Field label="Transport">
          <Combobox
            value={form.transport}
            onChange={(v) => set('transport', (v?.value as 'streamable-http' | 'sse') || 'streamable-http')}
            options={[
              { value: 'streamable-http', label: 'streamable-http' },
              { value: 'sse', label: 'sse' },
            ]}
          />
        </Field>
        <Field label="Discover + auto-register" description="RFC 8414 discovery, RFC 7591 registration.">
          <Switch value={form.discover ?? true} onChange={(e) => set('discover', e.currentTarget.checked)} />
        </Field>
        <Field label="Authorization URL" description="Leave blank when Discover is on.">
          <Input value={form.authorizationUrl ?? ''} onChange={(e) => set('authorizationUrl', e.currentTarget.value)} />
        </Field>
        <Field label="Token URL" description="Leave blank when Discover is on.">
          <Input value={form.tokenUrl ?? ''} onChange={(e) => set('tokenUrl', e.currentTarget.value)} />
        </Field>
        <Field label="Client ID" description="Required unless Discover registers one automatically.">
          <Input value={form.clientId ?? ''} onChange={(e) => set('clientId', e.currentTarget.value)} />
        </Field>
        <Field label="Client Secret" description="Optional — PKCE preferred.">
          <Input
            type="password"
            value={form.clientSecret ?? ''}
            onChange={(e) => set('clientSecret', e.currentTarget.value)}
          />
        </Field>
        <Field label="Scopes" description="Space or comma separated." className="col-span-2">
          <Input
            value={scopesText}
            onChange={(e) => setScopesText(e.currentTarget.value)}
            placeholder="offline_access read:content"
          />
        </Field>
      </div>
      <div className="mt-2">
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={busy || !form.serverId || !form.mcpUrl}
          data-testid={testIds.appConfig.externalMcpGenericAddButton}
        >
          {busy ? 'Adding…' : 'Add generic MCP'}
        </Button>
      </div>
    </div>
  );
}

export function ExternalMCPs() {
  const [presets, setPresets] = useState<MCPPreset[]>([]);
  const [servers, setServers] = useState<DynamicMCPServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyWith, setBusyWith] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([listPresets(), listDynamicServers()]);
      setPresets(p);
      setServers(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load external MCP servers');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const provisionedByPreset = new Set(servers.map((s) => s.presetId).filter(Boolean));

  const runAction = async (busyKey: string, action: () => Promise<unknown>) => {
    setBusyWith(busyKey);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyWith(null);
    }
  };

  const handleProvision = (preset: MCPPreset, credentials: PresetCredentials) =>
    runAction(preset.id, () =>
      addPreset({
        preset: preset.id,
        clientId: credentials.clientId || undefined,
        clientSecret: credentials.clientSecret || undefined,
      })
    );

  const handleRemove = (serverId: string) => runAction(serverId, () => removeDynamicServer(serverId));

  const handleGeneric = (input: AddGenericInput) => runAction('generic', () => addGeneric(input));

  return (
    <div className="mt-6" data-testid={testIds.appConfig.externalMcpSection}>
      <h3 className="text-xl font-semibold mb-2">External MCP servers (OAuth)</h3>
      <p className="text-sm text-secondary mb-4">
        Attach one-click presets or any MCP server that speaks OAuth 2.0 authorization-code. Each Grafana user then
        connects with their own account from the MCP connections button in the chat toolbar.
      </p>
      {error && (
        <Alert severity="error" title="Action failed" onRemove={() => setError(null)}>
          {error}
        </Alert>
      )}
      {presets.map((p) => (
        <PresetCard
          key={p.id}
          preset={p}
          isProvisioned={provisionedByPreset.has(p.id)}
          onProvision={handleProvision}
          onRemove={handleRemove}
          busyWith={busyWith}
        />
      ))}

      {servers
        .filter((s) => !s.presetId)
        .map((s) => (
          <div key={s.serverId} className="p-3 rounded border border-weak flex items-center justify-between mb-3">
            <div>
              <div className="font-medium">{s.displayName}</div>
              <div className="text-xs text-secondary">
                {s.mcpUrl} · {s.transport}
              </div>
            </div>
            <Button
              size="sm"
              variant="destructive"
              disabled={busyWith === s.serverId}
              onClick={() => handleRemove(s.serverId)}
            >
              Remove
            </Button>
          </div>
        ))}

      <GenericForm onSubmit={handleGeneric} busy={busyWith === 'generic'} />
    </div>
  );
}
