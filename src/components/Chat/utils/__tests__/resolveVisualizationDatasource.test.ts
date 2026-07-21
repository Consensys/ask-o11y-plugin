import { getDataSourceSrv } from '@grafana/runtime';
import { resolveVisualizationDatasource } from '../resolveVisualizationDatasource';

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: jest.fn(),
}));

const getDataSourceSrvMock = getDataSourceSrv as jest.MockedFunction<typeof getDataSourceSrv>;

describe('resolveVisualizationDatasource', () => {
  const getInstanceSettings = jest.fn();
  const getList = jest.fn();

  beforeEach(() => {
    getInstanceSettings.mockReset();
    getList.mockReset();
    getDataSourceSrvMock.mockReturnValue({
      getInstanceSettings,
      getList,
      get: jest.fn(),
      reload: jest.fn(),
      registerRuntimeDataSource: jest.fn(),
    });
  });

  it('returns settings when UID is valid and type matches', () => {
    getInstanceSettings.mockReturnValue({ uid: 'my-prom', type: 'prometheus', name: 'P' });
    const r = resolveVisualizationDatasource('prometheus', 'my-prom');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.uid).toBe('my-prom');
    }
    expect(getList).not.toHaveBeenCalled();
  });

  it('returns error when UID is unknown', () => {
    getInstanceSettings.mockReturnValue(undefined);
    const r = resolveVisualizationDatasource('prometheus', 'missing');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('not found');
    }
  });

  it('returns error when UID type mismatches', () => {
    getInstanceSettings.mockReturnValue({ uid: 'x', type: 'loki', name: 'L' });
    const r = resolveVisualizationDatasource('prometheus', 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('loki');
    }
  });

  it('picks default datasource when UID omitted', () => {
    getList.mockReturnValue([
      { uid: 'a', type: 'prometheus', name: 'A', isDefault: false },
      { uid: 'b', type: 'prometheus', name: 'B', isDefault: true },
    ]);
    const r = resolveVisualizationDatasource('prometheus', undefined);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.uid).toBe('b');
    }
    expect(getList).toHaveBeenCalledWith({ pluginId: 'prometheus' });
  });

  it('falls back to first instance when none marked default', () => {
    getList.mockReturnValue([
      { uid: 'first', type: 'prometheus', name: 'First', isDefault: false },
      { uid: 'second', type: 'prometheus', name: 'Second' },
    ]);
    const r = resolveVisualizationDatasource('prometheus', undefined);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.uid).toBe('first');
    }
  });

  it('returns error when no datasource of type exists', () => {
    getList.mockReturnValue([]);
    const r = resolveVisualizationDatasource('loki', undefined);
    expect(r.ok).toBe(false);
  });
});
