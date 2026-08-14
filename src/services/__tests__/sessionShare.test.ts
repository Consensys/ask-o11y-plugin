import { config } from '@grafana/runtime';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: jest.fn() }),
  config: {
    appSubUrl: '',
    bootData: { user: { orgId: 1 } },
  },
}));

import { sessionShareService } from '../sessionShare';

describe('SessionShareService.buildShareUrl', () => {
  const origin = 'https://host.example.com';
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin },
    });
    (config as { appSubUrl: string }).appSubUrl = '';
  });

  afterAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('builds a root-relative URL when Grafana is served at root', () => {
    const url = sessionShareService.buildShareUrl('/a/consensys-asko11y-app/shared/abc123?orgId=1');

    expect(url).toBe(`${origin}/a/consensys-asko11y-app/shared/abc123?orgId=1`);
  });

  it('prefixes the share URL with Grafana appSubUrl under a subpath deployment', () => {
    (config as { appSubUrl: string }).appSubUrl = '/grafana';

    const url = sessionShareService.buildShareUrl('/a/consensys-asko11y-app/shared/abc123?orgId=1');

    expect(url).toBe(`${origin}/grafana/a/consensys-asko11y-app/shared/abc123?orgId=1`);
  });

  it('falls back to building the path from a bare shareId, honoring the subpath', () => {
    (config as { appSubUrl: string }).appSubUrl = '/grafana';

    const url = sessionShareService.buildShareUrl('abc123');

    expect(url).toBe(`${origin}/grafana/a/consensys-asko11y-app/shared/abc123?orgId=1`);
  });

  it('falls back to building the path from a bare shareId at root', () => {
    const url = sessionShareService.buildShareUrl('abc123');

    expect(url).toBe(`${origin}/a/consensys-asko11y-app/shared/abc123?orgId=1`);
  });
});
