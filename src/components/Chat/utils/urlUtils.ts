import { GrafanaPageRef } from '../types';

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

/**
 * Convert an absolute URL to a relative URL suitable for iframe embedding
 * Optionally adds kiosk mode parameter
 */
export function toRelativeUrl(url: string, kioskModeEnabled = true): string {
  let relativeUrl = url;

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const match = url.match(/https?:\/\/[^/]+(\/.*)/);
    relativeUrl = match ? match[1] : url;
  }

  if (relativeUrl.includes('kiosk') || relativeUrl.includes('viewPanel')) {
    return relativeUrl;
  }

  if (!kioskModeEnabled) {
    return relativeUrl;
  }

  const separator = relativeUrl.includes('?') ? '&' : '?';
  return `${relativeUrl}${separator}kiosk`;
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
