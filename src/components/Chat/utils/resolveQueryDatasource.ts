import { DataSourceInstanceSettings } from '@grafana/data';
import { getDataSourceSrv, type GetDataSourceListFilters } from '@grafana/runtime';

export type QueryDatasourceKind = 'prometheus' | 'loki' | 'tempo';

export type ResolveQueryDatasourceResult =
  | { ok: true; settings: DataSourceInstanceSettings }
  | { ok: false; reason: string };

const KIND_CONFIG: Record<
  QueryDatasourceKind,
  { label: string; nameHint: string; listFilters: GetDataSourceListFilters }
> = {
  prometheus: {
    label: 'Prometheus',
    nameHint: 'Prometheus',
    listFilters: { type: 'prometheus', metrics: true },
  },
  loki: {
    label: 'Loki',
    nameHint: 'Loki',
    listFilters: { type: 'loki', logs: true },
  },
  tempo: {
    label: 'Tempo',
    nameHint: 'Tempo',
    listFilters: { type: 'tempo', tracing: true },
  },
};

/**
 * Pick a queryable datasource from a pre-fetched list (exported for unit tests).
 */
export function resolveQueryDatasourceFromList(
  list: DataSourceInstanceSettings[],
  kind: QueryDatasourceKind
): ResolveQueryDatasourceResult {
  const cfg = KIND_CONFIG[kind];

  if (list.length === 0) {
    return {
      ok: false,
      reason: `No ${cfg.label} data source is available. Add a ${cfg.label} data source under Connections → Data sources in Grafana.`,
    };
  }

  const byDefault = list.find((d) => d.isDefault);
  const byName = list.find((d) => d.name.toLowerCase() === cfg.nameHint.toLowerCase());
  const selected = byDefault ?? byName ?? list[0];

  // `url` is optional on DataSourceInstanceSettings; undefined must be treated like a missing backend URL.
  const url = selected.url;
  if (typeof url !== 'string' || url.trim() === '') {
    return {
      ok: false,
      reason: `The ${cfg.label} data source "${selected.name}" has no URL configured. Set the URL in the data source settings (or ensure provisioning env vars such as PROM_URL are set).`,
    };
  }

  return { ok: true, settings: selected };
}

/**
 * Resolve the datasource to use for in-chat metrics, logs, or traces queries.
 */
export function resolveQueryDatasource(kind: QueryDatasourceKind): ResolveQueryDatasourceResult {
  const cfg = KIND_CONFIG[kind];
  const list = getDataSourceSrv().getList(cfg.listFilters);
  return resolveQueryDatasourceFromList(list, kind);
}
