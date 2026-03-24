import { DataSourceInstanceSettings } from '@grafana/data';
import {
  resolveQueryDatasource,
  resolveQueryDatasourceFromList,
} from '../resolveQueryDatasource';

const mockGetList = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getDataSourceSrv: () => ({
    getList: mockGetList,
  }),
}));

function makeSettings(overrides: Partial<DataSourceInstanceSettings>): DataSourceInstanceSettings {
  return {
    id: 1,
    uid: 'ds-1',
    type: 'prometheus',
    name: 'Prometheus',
    url: 'http://localhost:9090',
    jsonData: {},
    readOnly: false,
    access: 'proxy',
    meta: {} as DataSourceInstanceSettings['meta'],
    ...overrides,
  };
}

describe('resolveQueryDatasourceFromList', () => {
  it('returns error when list is empty', () => {
    const result = resolveQueryDatasourceFromList([], 'prometheus');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('No Prometheus data source');
    }
  });

  it('prefers isDefault over other entries', () => {
    const list = [
      makeSettings({ uid: 'a', name: 'Other', isDefault: false }),
      makeSettings({ uid: 'b', name: 'Prometheus', isDefault: true }),
    ];
    const result = resolveQueryDatasourceFromList(list, 'prometheus');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.uid).toBe('b');
    }
  });

  it('falls back to name match when no default', () => {
    const list = [
      makeSettings({ uid: 'x', name: 'Other', isDefault: false }),
      makeSettings({ uid: 'y', name: 'Prometheus', isDefault: false }),
    ];
    const result = resolveQueryDatasourceFromList(list, 'prometheus');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.uid).toBe('y');
    }
  });

  it('uses first entry when no default and no name match', () => {
    const list = [
      makeSettings({ uid: 'first', name: 'Metrics A', isDefault: false }),
      makeSettings({ uid: 'second', name: 'Metrics B', isDefault: false }),
    ];
    const result = resolveQueryDatasourceFromList(list, 'prometheus');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.uid).toBe('first');
    }
  });

  it('returns error when selected datasource url is empty string', () => {
    const list = [makeSettings({ uid: 'bad', name: 'Prometheus', url: '' })];
    const result = resolveQueryDatasourceFromList(list, 'prometheus');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no URL configured');
    }
  });

  it('returns error when selected datasource url is undefined', () => {
    const list = [makeSettings({ uid: 'bad', name: 'Prometheus', url: undefined })];
    const result = resolveQueryDatasourceFromList(list, 'prometheus');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no URL configured');
    }
  });

  it('returns error when selected datasource url is whitespace only', () => {
    const list = [makeSettings({ uid: 'bad', name: 'Prometheus', url: '   ' })];
    const result = resolveQueryDatasourceFromList(list, 'prometheus');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no URL configured');
    }
  });
});

describe('resolveQueryDatasource', () => {
  beforeEach(() => {
    mockGetList.mockReset();
  });

  it('delegates to getList with prometheus filters and returns selection', () => {
    mockGetList.mockReturnValue([
      makeSettings({ uid: 'prom', name: 'Prometheus', type: 'prometheus', isDefault: true }),
    ]);

    const result = resolveQueryDatasource('prometheus');
    expect(mockGetList).toHaveBeenCalledWith({ type: 'prometheus', metrics: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.uid).toBe('prom');
    }
  });

  it('returns error when getList returns empty for loki', () => {
    mockGetList.mockReturnValue([]);

    const result = resolveQueryDatasource('loki');
    expect(mockGetList).toHaveBeenCalledWith({ type: 'loki', logs: true });
    expect(result.ok).toBe(false);
  });

  it('uses tempo tracing filter', () => {
    mockGetList.mockReturnValue([
      makeSettings({ uid: 't1', name: 'Tempo', type: 'tempo', isDefault: true }),
    ]);

    const result = resolveQueryDatasource('tempo');
    expect(mockGetList).toHaveBeenCalledWith({ type: 'tempo', tracing: true });
    expect(result.ok).toBe(true);
  });
});
