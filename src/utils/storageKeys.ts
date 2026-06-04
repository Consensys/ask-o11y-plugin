import pluginJson from '../plugin.json';

const LEGACY_PREFIXES = ['asko11y-', 'consensys-asko11y'];

export function getPluginStorageNamespace(pluginId: string = pluginJson.id): string {
  return pluginId;
}

export function getPluginStorageKey(key: string, pluginId?: string): string {
  return `${getPluginStorageNamespace(pluginId)}:${key}`;
}

export function isPluginStorageKey(key: string, pluginId?: string): boolean {
  return key.startsWith(`${getPluginStorageNamespace(pluginId)}:`);
}

export function isLegacyPluginStorageKey(key: string): boolean {
  return LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function getPluginSessionStorageKeys(storage: Storage = window.sessionStorage): string[] {
  const keysToRemove: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (isPluginStorageKey(key) || isLegacyPluginStorageKey(key))) {
      keysToRemove.push(key);
    }
  }
  return keysToRemove;
}
