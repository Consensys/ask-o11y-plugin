import { config } from '@grafana/runtime';

const PLUGIN_BASE = '/api/plugins/consensys-asko11y-app/resources';

/** Grafana's sub-path prefix when served behind a reverse proxy (e.g. `/grafana`), or '' at root. */
export function getSubpath(): string {
  return config.appSubUrl || '';
}

/** Prefixes an absolute path with Grafana's sub-path. Use for non-plugin (Grafana core, other plugins) URLs. */
export function withSubpath(path: string): string {
  return `${getSubpath()}${path}`;
}

/** Builds a URL under this plugin's resources route, honoring Grafana's sub-path. */
export function pluginUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return withSubpath(`${PLUGIN_BASE}${normalized}`);
}
