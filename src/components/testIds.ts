export const testIds = {
  appLoader: {
    container: 'app-loader',
    inline: 'inline-app-loader',
  },
  appConfig: {
    apiKey: 'data-testid ac-api-key',
    apiUrl: 'data-testid ac-api-url',
    maxTotalTokens: 'data-testid ac-max-total-tokens',
    submit: 'data-testid ac-submit-form',
    // Built-in MCP test IDs
    useBuiltInMCPField: 'data-testid ac-use-builtin-mcp-field',
    useBuiltInMCPToggle: 'data-testid ac-use-builtin-mcp-toggle',
    saveMCPModeButton: 'data-testid ac-save-mcp-mode',
    // MCP Server test IDs
    addMcpServerButton: 'data-testid ac-add-mcp-server',
    saveMcpServersButton: 'data-testid ac-save-mcp-servers',
    mcpServerCard: (id: string) => `data-testid ac-mcp-server-${id}`,
    mcpServerNameInput: (id: string) => `data-testid ac-mcp-server-name-${id}`,
    mcpServerUrlInput: (id: string) => `data-testid ac-mcp-server-url-${id}`,
    mcpServerRemoveButton: (id: string) => `data-testid ac-mcp-server-remove-${id}`,
    mcpServerAdvancedToggle: (id: string) => `data-testid ac-mcp-server-advanced-${id}`,
    mcpServerAddHeaderButton: (id: string) => `data-testid ac-mcp-server-add-header-${id}`,
    mcpServerHeaderKeyInput: (id: string, index: number) => `data-testid ac-mcp-server-header-key-${id}-${index}`,
    mcpServerHeaderValueInput: (id: string, index: number) => `data-testid ac-mcp-server-header-value-${id}-${index}`,
    mcpServerHeaderRemoveButton: (id: string, index: number) =>
      `data-testid ac-mcp-server-header-remove-${id}-${index}`,
    // System Prompt test IDs
    systemPromptModeSelector: 'data-testid ac-system-prompt-mode',
    customSystemPromptTextarea: 'data-testid ac-custom-system-prompt',
    customSystemPromptCharCount: 'data-testid ac-custom-prompt-char-count',
    viewDefaultPromptButton: 'data-testid ac-view-default-prompt',
    saveSystemPromptButton: 'data-testid ac-save-system-prompt',
    defaultPromptModal: 'data-testid ac-default-prompt-modal',
    defaultPromptContent: 'data-testid ac-default-prompt-content',
    copyDefaultPromptButton: 'data-testid ac-copy-default-prompt',
    closeDefaultPromptButton: 'data-testid ac-close-default-prompt',
    // Display Settings test IDs
    displaySettings: 'data-testid ac-display-settings',
    kioskModeField: 'data-testid ac-kiosk-mode-field',
    kioskModeToggle: 'data-testid ac-kiosk-mode-toggle',
    chatPanelPositionField: 'data-testid ac-chat-panel-position-field',
    chatPanelPositionSelector: 'data-testid ac-chat-panel-position-selector',
    saveDisplaySettingsButton: 'data-testid ac-save-display-settings',
  },
  home: {
    container: 'data-testid home-container',
  },
  chat: {
    reasoningIndicator: 'data-testid reasoning-indicator',
  },
  investigation: {
    loading: 'data-testid investigation-loading',
    error: 'data-testid investigation-error',
  },
};
