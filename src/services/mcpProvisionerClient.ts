import { firstValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';

const baseUrl = '/api/plugins/consensys-asko11y-app/resources/api/mcp/provisioner';

export type PresetID = 'github-read' | 'github-write' | 'atlassian';

export interface MCPPreset {
  id: PresetID;
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
    getBackendSrv().fetch<{ presets: MCPPreset[] }>({ url: `${baseUrl}/presets`, method: 'GET' })
  );
  return resp?.data?.presets ?? [];
}

export async function listDynamicServers(): Promise<DynamicMCPServer[]> {
  const resp = await firstValueFrom(
    getBackendSrv().fetch<{ servers: DynamicMCPServer[] }>({ url: baseUrl, method: 'GET' })
  );
  return resp?.data?.servers ?? [];
}

export interface AddPresetInput {
  preset: PresetID;
  clientId?: string;
  clientSecret?: string;
}

export async function addPreset(input: AddPresetInput): Promise<{ serverId: string }> {
  const resp = await firstValueFrom(
    getBackendSrv().fetch<{ serverId: string }>({
      url: `${baseUrl}/preset`,
      method: 'POST',
      data: input,
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
      url: `${baseUrl}/generic`,
      method: 'POST',
      data: input,
    })
  );
  return resp?.data ?? { serverId: '' };
}

export async function removeDynamicServer(serverId: string): Promise<void> {
  await firstValueFrom(
    getBackendSrv().fetch({ url: `${baseUrl}/${encodeURIComponent(serverId)}`, method: 'DELETE' })
  );
}
