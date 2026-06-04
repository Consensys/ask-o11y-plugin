import {
  getPluginSessionStorageKeys,
  getPluginStorageKey,
  getPluginStorageNamespace,
  isLegacyPluginStorageKey,
  isPluginStorageKey,
} from '../storageKeys';

describe('storageKeys', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('derives the namespace from the plugin id', () => {
    expect(getPluginStorageNamespace()).toBe('consensys-asko11y-app');
    expect(getPluginStorageKey('mcp-tool-settings')).toBe('consensys-asko11y-app:mcp-tool-settings');
  });

  it('matches current plugin storage keys', () => {
    expect(isPluginStorageKey('consensys-asko11y-app:mcp-tool-settings')).toBe(true);
    expect(isPluginStorageKey('other-plugin:mcp-tool-settings')).toBe(false);
  });

  it('matches legacy storage keys for cleanup', () => {
    expect(isLegacyPluginStorageKey('asko11y-settings')).toBe(true);
    expect(isLegacyPluginStorageKey('consensys-asko11y-app:old')).toBe(true);
    expect(isLegacyPluginStorageKey('grafana:other')).toBe(false);
  });

  it('returns current and legacy session storage keys', () => {
    sessionStorage.setItem('consensys-asko11y-app:active-run', '1');
    sessionStorage.setItem('asko11y-settings', '1');
    sessionStorage.setItem('grafana:other', '1');

    expect(getPluginSessionStorageKeys(sessionStorage).sort()).toEqual([
      'asko11y-settings',
      'consensys-asko11y-app:active-run',
    ]);
  });
});
