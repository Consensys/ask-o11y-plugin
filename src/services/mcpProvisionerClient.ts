import { firstValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { pluginUrl } from '../utils/subpath';

const base = () => pluginUrl('/api/mcp/provisioner');

export type PresetId = 'github-read' | 'github-write' | 'atlassian';

export interface MCPPreset {
  id: PresetId;
  displayName: string;
  serverId: string;
  mcpUrl: string;
  transport: 'streamable-http' | 'sse';
  scopes: string[];
  dcrCapable: boolean;
}

export interface DynamicMCPServer {
  serverId: string;
  displayName: string;
  mcpUrl: string;
  transport: string;
  presetId?: string;
  scopes?: string[];
}

export async function listPresets(): Promise<MCPPreset[]> {
  const resp = await firstValueFrom(
    getBackendSrv().fetch<{ presets: MCPPreset[] }>({ url: `${base()}/presets`, method: 'GET' })
  );
  return resp?.data?.presets ?? [];
}

export async function listDynamicServers(): Promise<DynamicMCPServer[]> {
  const resp = await firstValueFrom(
    getBackendSrv().fetch<{ servers: DynamicMCPServer[] }>({ url: base(), method: 'GET' })
  );
  return resp?.data?.servers ?? [];
}

export interface AddPresetInput {
  preset: PresetId;
  clientId?: string;
  clientSecret?: string;
}

export async function addPreset(input: AddPresetInput): Promise<{ serverId: string }> {
  const resp = await firstValueFrom(
    getBackendSrv().fetch<{ serverId: string }>({
      url: `${base()}/preset`,
      method: 'POST',
      data: input,
      showErrorAlert: false,
    })
  );
  return resp?.data ?? { serverId: '' };
}

export interface AddGenericInput {
  serverId: string;
  displayName?: string;
  mcpUrl: string;
  transport: 'streamable-http' | 'sse';
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  pkce?: boolean;
  discover?: boolean;
}

export async function addGeneric(input: AddGenericInput): Promise<{ serverId: string }> {
  const resp = await firstValueFrom(
    getBackendSrv().fetch<{ serverId: string }>({
      url: `${base()}/generic`,
      method: 'POST',
      data: input,
      showErrorAlert: false,
    })
  );
  return resp?.data ?? { serverId: '' };
}

export async function removeDynamicServer(serverId: string): Promise<void> {
  await firstValueFrom(
    getBackendSrv().fetch({ url: `${base()}/${encodeURIComponent(serverId)}`, method: 'DELETE' })
  );
}
