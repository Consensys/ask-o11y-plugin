/**
 * ExternalMCPs
 *
 * AppConfig section that lets Admin users attach external MCP servers at
 * runtime — three presets (GitHub r/o, GitHub r/w, Atlassian) plus a generic
 * form. After provisioning, each end user gets their own "Connect" flow in
 * the MCP Status panel.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Select } from '@grafana/ui';
import {
  addGeneric,
  addPreset,
  AddGenericInput,
  DynamicMCPServer,
  listDynamicServers,
  listPresets,
  MCPPreset,
  PresetID,
  removeDynamicServer,
} from '../../services/mcpProvisionerClient';

function PresetCard({
  preset,
  isProvisioned,
  onProvision,
  onRemove,
  busyWith,
}: {
  preset: MCPPreset;
  isProvisioned: boolean;
  onProvision: (p: MCPPreset) => Promise<void>;
  onRemove: (serverId: string) => Promise<void>;
  busyWith: string | null;
}) {
  const needsClientId = !preset.dcrCapable;
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const busy = busyWith === preset.id;

  return (
    <div className="p-3 rounded border border-weak flex flex-col gap-2 mb-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{preset.displayName}</div>
          <div className="text-xs text-secondary">
            {preset.mcpUrl} · {preset.transport} · {preset.dcrCapable ? 'auto-registers with provider' : 'bring your own OAuth app'}
          </div>
          {preset.scopes.length > 0 && (
            <div className="text-xs text-secondary">scopes: {preset.scopes.join(', ')}</div>
          )}
        </div>
        <div className="flex gap-2">
          {isProvisioned ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                await onRemove(preset.serverId);
              }}
            >
              Remove
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={busy || (needsClientId && !clientId)}
              onClick={async () => {
                await onProvision({ ...preset });
                setClientId('');
                setClientSecret('');
              }}
            >
              {busy ? 'Adding…' : 'Add'}
            </Button>
          )}
        </div>
      </div>
      {needsClientId && !isProvisioned && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Client ID"
            description={
              preset.serverId.startsWith('github')
                ? 'Create an OAuth App at https://github.com/settings/developers with the plugin callback URL.'
                : 'Client ID from your OAuth provider.'
            }
          >
            <Input value={clientId} onChange={(e) => setClientId(e.currentTarget.value)} placeholder="Iv1.abcd…" />
          </Field>
          <Field label="Client Secret (optional, PKCE preferred)">
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.currentTarget.value)}
              placeholder="leave blank for PKCE-only"
            />
          </Field>
          <div className="col-span-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !clientId}
              onClick={async () => {
                (preset as any).__clientId = clientId;
                (preset as any).__clientSecret = clientSecret;
                await onProvision(preset);
                setClientId('');
                setClientSecret('');
              }}
            >
              {busy ? 'Adding…' : 'Add with Client ID'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GenericForm({
  onSubmit,
  busy,
}: {
  onSubmit: (input: AddGenericInput) => Promise<void>;
  busy: boolean;
}) {
  const [form, setForm] = useState<AddGenericInput>({
    serverId: '',
    displayName: '',
    mcpUrl: '',
    transport: 'streamable-http',
    pkce: true,
    discover: true,
    scopes: [],
  });
  const [scopesText, setScopesText] = useState('');

  const set = <K extends keyof AddGenericInput>(k: K, v: AddGenericInput[K]) => setForm({ ...form, [k]: v });

  const submit = async () => {
    const scopes = scopesText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await onSubmit({ ...form, scopes });
  };

  return (
    <div className="p-3 rounded border border-weak">
      <div className="font-medium mb-2">Generic OAuth MCP</div>
      <div className="text-xs text-secondary mb-3">
        Use <strong>Discover</strong> when the server publishes OAuth metadata ({`/.well-known/oauth-authorization-server`}); leave it off to supply URLs manually.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Server ID">
          <Input value={form.serverId} onChange={(e) => set('serverId', e.currentTarget.value)} placeholder="my-mcp" />
        </Field>
        <Field label="Display name">
          <Input value={form.displayName ?? ''} onChange={(e) => set('displayName', e.currentTarget.value)} />
        </Field>
        <Field label="MCP URL" className="col-span-2">
          <Input value={form.mcpUrl} onChange={(e) => set('mcpUrl', e.currentTarget.value)} placeholder="https://mcp.example.com/v1/mcp" />
        </Field>
        <Field label="Transport">
          <Select
            value={form.transport}
            onChange={(v) => set('transport', (v?.value as 'streamable-http' | 'sse') || 'streamable-http')}
            options={[
              { value: 'streamable-http', label: 'streamable-http' },
              { value: 'sse', label: 'sse' },
            ]}
          />
        </Field>
        <Field label="Discover + DCR">
          <input
            type="checkbox"
            checked={form.discover ?? true}
            onChange={(e) => set('discover', e.currentTarget.checked)}
          />
        </Field>
        <Field label="Authorization URL (skip if Discover)">
          <Input value={form.authorizationUrl ?? ''} onChange={(e) => set('authorizationUrl', e.currentTarget.value)} />
        </Field>
        <Field label="Token URL (skip if Discover)">
          <Input value={form.tokenUrl ?? ''} onChange={(e) => set('tokenUrl', e.currentTarget.value)} />
        </Field>
        <Field label="Client ID (required if not using Discover+DCR)">
          <Input value={form.clientId ?? ''} onChange={(e) => set('clientId', e.currentTarget.value)} />
        </Field>
        <Field label="Client Secret (optional)">
          <Input
            type="password"
            value={form.clientSecret ?? ''}
            onChange={(e) => set('clientSecret', e.currentTarget.value)}
          />
        </Field>
        <Field label="Scopes (space-separated)" className="col-span-2">
          <Input value={scopesText} onChange={(e) => setScopesText(e.currentTarget.value)} placeholder="offline_access read:content" />
        </Field>
      </div>
      <div className="mt-2">
        <Button size="sm" variant="primary" onClick={submit} disabled={busy || !form.serverId || !form.mcpUrl}>
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
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const provisionedByPreset = new Set(servers.map((s) => s.presetId).filter(Boolean));

  const handleProvision = async (preset: MCPPreset) => {
    setBusyWith(preset.id);
    setError(null);
    try {
      const clientId = (preset as any).__clientId as string | undefined;
      const clientSecret = (preset as any).__clientSecret as string | undefined;
      await addPreset({ preset: preset.id as PresetID, clientId, clientSecret });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyWith(null);
    }
  };

  const handleRemove = async (serverId: string) => {
    setBusyWith(serverId);
    setError(null);
    try {
      await removeDynamicServer(serverId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyWith(null);
    }
  };

  const handleGeneric = async (input: AddGenericInput) => {
    setBusyWith('generic');
    setError(null);
    try {
      await addGeneric(input);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyWith(null);
    }
  };

  return (
    <div className="mt-6">
      <h3 className="text-xl font-semibold mb-2">External MCP servers (OAuth)</h3>
      <p className="text-sm text-secondary mb-4">
        Attach one-click presets or wire up any MCP that speaks OAuth 2.0 authorization-code. Each Grafana user then
        connects with their own account from the MCP status panel.
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
          <div
            key={s.serverId}
            className="p-3 rounded border border-weak flex items-center justify-between mb-3"
          >
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
