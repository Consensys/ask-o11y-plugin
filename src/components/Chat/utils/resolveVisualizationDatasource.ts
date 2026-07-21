import { DataSourceInstanceSettings } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';

export type VisualizationDataSourcePluginId = 'prometheus' | 'loki' | 'tempo';

export type ResolveVisualizationDatasourceResult =
  | { ok: true; settings: DataSourceInstanceSettings }
  | { ok: false; error: string };

export function resolveVisualizationDatasource(
  pluginId: VisualizationDataSourcePluginId,
  datasourceUid?: string
): ResolveVisualizationDatasourceResult {
  const srv = getDataSourceSrv();
  const uid = datasourceUid?.trim();

  if (uid) {
    const settings = srv.getInstanceSettings(uid);
    if (!settings) {
      return { ok: false, error: `Datasource UID "${uid}" was not found.` };
    }
    if (settings.type !== pluginId) {
      return {
        ok: false,
        error: `Datasource "${uid}" has type "${settings.type}"; expected "${pluginId}".`,
      };
    }
    return { ok: true, settings };
  }

  const list = srv.getList({ pluginId });
  const chosen = list.find((ds) => ds.isDefault) ?? list[0];
  if (!chosen) {
    return {
      ok: false,
      error: `No ${pluginId} datasource found. Add one under Connections, or set a default.`,
    };
  }
  return { ok: true, settings: chosen };
}
