import { config } from '@grafana/runtime';

jest.mock('@grafana/runtime', () => ({
  config: { appSubUrl: '' },
}));

import { getSubpath, withSubpath, pluginUrl } from '../subpath';

describe('subpath', () => {
  afterEach(() => {
    (config as { appSubUrl: string }).appSubUrl = '';
  });

  it('returns empty subpath at root', () => {
    expect(getSubpath()).toBe('');
    expect(withSubpath('/api/health')).toBe('/api/health');
    expect(pluginUrl('/api/sessions')).toBe('/api/plugins/consensys-asko11y-app/resources/api/sessions');
  });

  it('prefixes urls with the configured subpath', () => {
    (config as { appSubUrl: string }).appSubUrl = '/grafana';

    expect(getSubpath()).toBe('/grafana');
    expect(withSubpath('/api/health')).toBe('/grafana/api/health');
    expect(pluginUrl('/api/sessions')).toBe('/grafana/api/plugins/consensys-asko11y-app/resources/api/sessions');
  });

  it('normalizes a plugin path without a leading slash', () => {
    expect(pluginUrl('api/sessions')).toBe('/api/plugins/consensys-asko11y-app/resources/api/sessions');
  });
});
