export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  type?: 'openapi' | 'standard' | 'sse' | 'streamable-http';
  trusted?: boolean;
  headers?: Record<string, string>;
  toolSelections?: Record<string, boolean>;
  riskOverrides?: Record<string, ToolRiskOverride>;
}

export interface ToolRiskOverride {
  requiresApproval?: boolean;
  readOnly?: boolean;
  destructive?: boolean;
  openWorld?: boolean;
  reason?: string;
}

/**
 * jsonData shape for the skills AppConfig tab. For a bundled skill name, an
 * entry's content overrides the shipped SKILL.md; for a new name it defines a
 * custom skill. An entry with empty content and enabled=false disables the
 * bundled skill. Mirrors pkg/skills.Settings.
 */
export interface SkillsSettings {
  entries?: Record<string, SkillEntry>;
}

export interface SkillEntry {
  content?: string;
  enabled?: boolean;
}

export type AppPluginSettings = {
  mcpServers?: MCPServerConfig[];
  useBuiltInMCP?: boolean;
  builtInMCPToolSelections?: Record<string, boolean>;
  useLocalGrafanaURL?: boolean;
  localGrafanaPort?: number;
  trustedMCPServers?: Record<string, boolean>;
  riskOverrides?: Record<string, ToolRiskOverride>;

  defaultSystemPrompt?: string;
  investigationPrompt?: string;
  performancePrompt?: string;

  /** Admin-managed skills from the AppConfig Skills tab. */
  skills?: SkillsSettings;

  maxTotalTokens?: number;
  recentMessageCount?: number;

  kioskModeEnabled?: boolean;
  chatPanelPosition?: 'left' | 'right';

  graphitiScanInterval?: string;
  serviceGraphMaxNodes?: number;
  serviceGraphMaxEdges?: number;
  graphitiAutoSaveSessionsDisabled?: boolean;
  sessionTTLDays?: number;
  graphitiEpisodeTTLDays?: number;

  approvalPolicy?: string;
  maxParallelToolCalls?: number;
  agentEvalCaptureEnabled?: boolean;
};
