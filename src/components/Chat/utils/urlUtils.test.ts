import { toRelativeUrl, extractPathFromUrl, getTabLabel } from './urlUtils';

describe('toRelativeUrl', () => {
  it('keeps relative dashboard URLs and appends kiosk mode', () => {
    expect(toRelativeUrl('/d/abc123/my-dashboard')).toBe('/d/abc123/my-dashboard?kiosk');
  });

  it('keeps relative explore URLs', () => {
    expect(toRelativeUrl('/explore?left={"datasource":"loki"}')).toBe('/explore?left={"datasource":"loki"}&kiosk');
  });

  it('accepts subpath-prefixed dashboard and explore URLs', () => {
    expect(toRelativeUrl('/grafana/d/abc/x', true, '/grafana')).toBe('/grafana/d/abc/x?kiosk');
    expect(toRelativeUrl('/grafana/explore', true, '/grafana')).toBe('/grafana/explore?kiosk');
    expect(toRelativeUrl('/grafana/explore?left={}', true, '/grafana')).toBe('/grafana/explore?left={}&kiosk');
    expect(toRelativeUrl('/grafana/d/abc/x', true, '/grafana/')).toBe('/grafana/d/abc/x?kiosk');
  });

  it('upgrades root-relative refs to the subpath-prefixed form', () => {
    // parseGrafanaLinks emits root-relative URLs even on subpath deployments.
    expect(toRelativeUrl('/d/abc/x', true, '/grafana')).toBe('/grafana/d/abc/x?kiosk');
    expect(toRelativeUrl('/explore', true, '/grafana')).toBe('/grafana/explore?kiosk');
    expect(toRelativeUrl('/explore?left={}', true, '/grafana')).toBe('/grafana/explore?left={}&kiosk');
  });

  it('emits the resolved path so the iframe cannot escape the subpath', () => {
    // "/grafana/x/../../d/abc/x" passes validation (resolves to a valid
    // route) but must not be returned raw: the browser would resolve it
    // outside the Grafana mount.
    expect(toRelativeUrl('/grafana/x/../../d/abc/x', true, '/grafana')).toBe('/grafana/d/abc/x?kiosk');
    expect(toRelativeUrl('/d/abc/x?left=1', true, '/grafana')).toBe('/grafana/d/abc/x?left=1&kiosk');
  });

  it('rejects routes outside the configured subpath', () => {
    expect(toRelativeUrl('/grafana/admin/users', true, '/grafana')).toBe('');
    expect(toRelativeUrl('/grafana/d/abc/../../admin', true, '/grafana')).toBe('');
    expect(toRelativeUrl('/admin/users', true, '/grafana')).toBe('');
    expect(toRelativeUrl('/grafanad/abc', true, '/grafana')).toBe('');
  });

  it('does not duplicate kiosk parameter', () => {
    expect(toRelativeUrl('/d/abc/x?kiosk')).toBe('/d/abc/x?kiosk');
  });

  it('respects kioskModeEnabled = false', () => {
    expect(toRelativeUrl('/d/abc/x', false)).toBe('/d/abc/x');
  });

  it('strips the host from absolute same-site dashboard URLs', () => {
    expect(toRelativeUrl('https://grafana.example.com/d/abc/x')).toBe('/d/abc/x?kiosk');
  });

  it('rejects absolute URLs without a path', () => {
    // https://evil.com previously passed through unchanged and became an
    // external iframe inside the Grafana panel.
    expect(toRelativeUrl('https://evil.com')).toBe('');
    expect(toRelativeUrl('http://169.254.169.254')).toBe('');
  });

  it('rejects absolute URLs pointing at non-Grafana paths', () => {
    expect(toRelativeUrl('https://grafana.example.com/admin/users')).toBe('');
    expect(toRelativeUrl('https://evil.com/d/abc/x')).toBe('/d/abc/x?kiosk'); // path kept, host dropped
  });

  it('rejects non-http schemes and javascript: URLs', () => {
    expect(toRelativeUrl('javascript:alert(1)')).toBe('');
    expect(toRelativeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(toRelativeUrl('file:///etc/passwd')).toBe('');
  });

  it('rejects protocol-relative and relative non-Grafana paths', () => {
    expect(toRelativeUrl('//evil.com/d/x')).toBe('');
    expect(toRelativeUrl('/api/admin/settings')).toBe('');
    expect(toRelativeUrl('/dashboard/new')).toBe('');
  });

  it('rejects path traversal escaping into other same-origin routes', () => {
    expect(toRelativeUrl('/d/../admin')).toBe('');
    expect(toRelativeUrl('/explore/../logout')).toBe('');
    expect(toRelativeUrl('/d/abc/../../admin/users')).toBe('');
    expect(toRelativeUrl('/d/%2e%2e/admin')).toBe('');
    expect(toRelativeUrl('https://grafana.example.com/d/../admin')).toBe('');
  });

  it('rejects double-encoded traversal and separators', () => {
    // "%252e%252e" decodes once to literal "%2e%2e", which servers then read
    // as ".." — the emitted path must be fully decoded before validation.
    expect(toRelativeUrl('/d/%252e%252e/admin')).toBe('');
    expect(toRelativeUrl('/d/%252e%252e/x')).toBe('');
    expect(toRelativeUrl('/grafana/d/%252e%252e/admin', true, '/grafana')).toBe('');
    expect(toRelativeUrl('/d/%255c..%255cadmin')).toBe('');
  });

  it('rejects any path that still contains a percent sign after decoding', () => {
    // The decode loop is bounded, so deeper encodings (or any leftover
    // percent-sequence a server might decode further) must be rejected
    // outright rather than emitted.
    expect(toRelativeUrl('/d/%25252e%25252e/admin')).toBe('');
    // A 9x-encoded space still contains "%" after the 8 decode rounds.
    expect(toRelativeUrl(`/d/abc/${'%25'.repeat(8)}20x`)).toBe('');
    expect(toRelativeUrl('/d/abc%zz/x')).toBe('');
    expect(toRelativeUrl('/d/100%25')).toBe('');
    // Fully decodable sequences are fine: "%2520" is just a double-encoded
    // space.
    expect(toRelativeUrl('/d/abc%2520x')).toBe('/d/abc x?kiosk');
    // Query and fragment are inert for routing and may keep percent-escapes.
    expect(toRelativeUrl('/d/abc/x?query=%7B1%7D')).toBe('/d/abc/x?query=%7B1%7D&kiosk');
  });

  it('still accepts legitimately percent-encoded paths', () => {
    expect(toRelativeUrl('/d/abc123/my%20dashboard')).toBe('/d/abc123/my dashboard?kiosk');
    expect(toRelativeUrl('/d/abc123/%D0%BF%D0%B0%D0%BD%D0%B5%D0%BB%D1%8C')).toBe('/d/abc123/панель?kiosk');
  });

  it('rejects backslash traversal (browsers treat \\ as / in HTTP URLs)', () => {
    expect(toRelativeUrl('/d/\\..\\..\\admin')).toBe('');
    expect(toRelativeUrl('/d/%5c..%5cadmin')).toBe('');
    expect(toRelativeUrl('/d/..%5Cadmin')).toBe('');
    expect(toRelativeUrl('/explore/\\../logout')).toBe('');
  });

  it('rejects control-character traversal and fragment escapes', () => {
    // URL parsers strip tab/LF/CR, so "/d/.\t./logout" resolves to "/logout".
    expect(toRelativeUrl('/d/.\t./logout')).toBe('');
    expect(toRelativeUrl('/d/..\n/logout')).toBe('');
    // "/d/..#fragment" resolves to "/".
    expect(toRelativeUrl('/d/..#fragment')).toBe('');
    expect(toRelativeUrl('/explore/..#')).toBe('');
  });

  it('rejects lookalike prefixes without a segment boundary', () => {
    expect(toRelativeUrl('/explorer')).toBe('');
    expect(toRelativeUrl('/d')).toBe('');
    expect(toRelativeUrl('/d/')).toBe('');
    expect(toRelativeUrl('/explore-help')).toBe('');
  });

  it('rejects malformed percent-encoding', () => {
    expect(toRelativeUrl('/d/abc%zz/x')).toBe('');
  });

  it('rejects empty input', () => {
    expect(toRelativeUrl('')).toBe('');
  });
});

describe('extractPathFromUrl', () => {
  it('extracts path from absolute URL', () => {
    expect(extractPathFromUrl('https://grafana.example.com/d/abc/x')).toBe('/d/abc/x');
  });

  it('returns relative URL unchanged', () => {
    expect(extractPathFromUrl('/explore?left={}')).toBe('/explore?left={}');
  });
});

describe('getTabLabel', () => {
  it('truncates long titles', () => {
    expect(getTabLabel({ url: '/d/x', type: 'dashboard', title: 'a'.repeat(30) }, 0)).toBe('a'.repeat(20) + '...');
  });

  it('falls back to type labels', () => {
    expect(getTabLabel({ url: '/explore', type: 'explore' }, 0)).toBe('Explore');
    expect(getTabLabel({ url: '/d/abcdef123456/x', type: 'dashboard', uid: 'abcdef123456' }, 0)).toBe(
      'Dashboard abcdef12'
    );
    expect(getTabLabel({ url: '/d/x', type: 'dashboard' }, 3)).toBe('Page 4');
  });
});
