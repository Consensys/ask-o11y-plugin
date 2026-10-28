import { GrafanaPageRef } from '../types';
import { getSubpath } from '../../../utils/subpath';

/**
 * Generate a display label for a tab
 */
export function getTabLabel(ref: GrafanaPageRef, index: number): string {
  if (ref.title) {
    return ref.title.length > 20 ? ref.title.substring(0, 20) + '...' : ref.title;
  }
  if (ref.type === 'dashboard' && ref.uid) {
    return `Dashboard ${ref.uid.substring(0, 8)}`;
  }
  return ref.type === 'explore' ? 'Explore' : `Page ${index + 1}`;
}

/** Removes RFC 3986 dot segments; returns null if the path escapes the root. */
function resolveDotSegments(path: string): string | null {
  if (!path.startsWith('/')) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of path.slice(1).split('/')) {
    if (segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

/**
 * Convert an absolute URL to a relative URL suitable for iframe embedding.
 * Optionally adds kiosk mode parameter.
 *
 * Returns an empty string for anything that is not a Grafana dashboard or
 * Explore URL: persisted/imported/shared session data is untrusted, and
 * without this guard an attacker-controlled value (external origin, other
 * schemes, path traversal escaping into other same-origin routes) would
 * end up as the iframe src. The route is validated after dot-segment
 * resolution and percent-decoding, relative to the configured subpath
 * (e.g. "/grafana" behind a reverse proxy).
 */
export function toRelativeUrl(url: string, kioskModeEnabled = true, subpath: string = getSubpath()): string {
  let relativeUrl = url;

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const match = url.match(/https?:\/\/[^/]+(\/.*)/);
    if (!match) {
      return '';
    }
    relativeUrl = match[1];
  }

  // Tab, LF and CR are stripped by URL parsers, so "/d/.\t./logout" reaches
  // the server as "/d/../logout". Reject control characters outright.
  if (/[\u0000-\u001f]/.test(relativeUrl)) {
    return '';
  }

  // Validate the path only: query and fragment never affect routing.
  const pathOnly = relativeUrl.split(/[?#]/)[0];

  // Percent-decode before validation so encoded traversal cannot smuggle past
  // the dot-segment resolver: "%2e%2e" (and any deeper encoding like
  // "%252e%252e") has to be seen as the segments it really is. The loop is
  // bounded, so afterwards ANY remaining "%" is rejected — that makes the
  // bound irrelevant, because a path with leftover percent-sequences could
  // still be decoded further by browsers or servers. Literal "%" never
  // legitimately appears in a Grafana dashboard/Explore path.
  let decodedPath = pathOnly;
  for (let i = 0; i < 8 && /%[0-9a-f]/i.test(decodedPath); i++) {
    let next: string;
    try {
      next = decodeURIComponent(decodedPath);
    } catch {
      return '';
    }
    if (next === decodedPath) {
      break;
    }
    decodedPath = next;
  }
  // Raw and percent-encoded backslashes decode into separators just the same
  // (browsers treat "\" as "/" in HTTP(S) URLs).
  if (decodedPath.includes('%') || decodedPath.includes('\\') || /[\u0000-\u001f]/.test(decodedPath)) {
    return '';
  }

  // Resolve dot segments ("/d/abc/../../admin" -> "/admin") so the prefix and
  // route checks below see the path the browser will actually request.
  const normalizedPrefix = subpath.replace(/\/+$/, '');
  const resolved = resolveDotSegments(decodedPath);
  if (resolved === null) {
    return '';
  }
  // parseGrafanaLinks and persisted refs emit root-relative "/d/" and
  // "/explore" URLs even when Grafana is served under a subpath. Accept those
  // and upgrade them to the prefixed form so the iframe resolves; URLs that
  // already carry the prefix are validated as-is.
  let route = resolved;
  let needsPrefix = false;
  if (normalizedPrefix) {
    if (resolved.startsWith(`${normalizedPrefix}/`)) {
      route = resolved.slice(normalizedPrefix.length);
    } else {
      needsPrefix = true;
    }
  }
  // Segment boundaries matter: "/explorer" is not Explore.
  if (!/^\/(d\/[^/]+|explore)(\/|$)/.test(route)) {
    return '';
  }

  // Emit the resolved path, not the raw one: a ref like
  // "/grafana/x/../../d/abc/x" passes validation but the browser would
  // resolve it outside the Grafana mount. Query and fragment are inert and
  // carried over verbatim.
  const suffix = relativeUrl.slice(pathOnly.length);
  let output = (needsPrefix ? normalizedPrefix : '') + resolved + suffix;

  if (output.includes('kiosk') || output.includes('viewPanel')) {
    return output;
  }

  if (!kioskModeEnabled) {
    return output;
  }

  const separator = output.includes('?') ? '&' : '?';
  return `${output}${separator}kiosk`;
}

/**
 * Extract the path from an absolute URL
 */
export function extractPathFromUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const match = url.match(/https?:\/\/[^/]+(\/.*)/);
    return match ? match[1] : url;
  }
  return url;
}
