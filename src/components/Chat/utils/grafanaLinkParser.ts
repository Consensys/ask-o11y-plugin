import { GrafanaPageRef } from '../types';

/**
 * Regex pattern to match dashboard URLs: /d/{uid} with optional slug and query params
 * Supports both relative paths and full URLs (http/https)
 *
 * Examples:
 * - /d/abc123
 * - /d/abc123/my-dashboard
 * - /d/abc123?orgId=1&from=now-1h
 * - http://localhost:3000/d/abc123
 * - https://grafana.example.com/d/abc123/slug?from=now-6h
 */
const DASHBOARD_PATTERN = /(?:https?:\/\/[^\s/]+)?\/d\/([a-zA-Z0-9_-]+)(?:\/[^\s?#)"\]`]*)?(?:\?[^\s)"\]`]*)?/g;

/**
 * Regex pattern to match explore URLs: /explore with optional query params
 * Supports both relative paths and full URLs (http/https)
 * Uses lookahead to ensure /explore is a complete path segment (not /explorer, /explore-beta, etc.)
 *
 * Examples:
 * - /explore
 * - /explore?orgId=1
 * - /explore?orgId=1&left=["now-1h","now"]
 * - /explore?panes={"abc":{"datasource":"..."}}
 * - https://grafana.example.com/explore?orgId=1
 */
const EXPLORE_PATTERN = /(?:https?:\/\/[^\s/]+)?\/explore(?=\?|[)\]`"\s.,;:!?]|$)(?:\?[^\s)"\]`]*)?/g;

/**
 * Regex pattern to match markdown links with Grafana dashboard or explore URLs
 * Captures: [link text](url)
 * For explore links, requires /explore to be a complete path segment (not /explorer, etc.)
 *
 * Examples:
 * - [My Dashboard](/d/abc123)
 * - [Explore Metrics](/explore?orgId=1)
 * - [Dashboard](https://grafana.com/d/abc123)
 */
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(((?:https?:\/\/[^\s/]+)?\/(?:d\/[^)]+|explore(?:\?[^)]*)?))\)/g;

/**
 * Extract the dashboard UID from a dashboard URL
 */
function extractDashboardUid(url: string): string | undefined {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : undefined;
}

/**
 * Pattern to check if URL contains /explore as a complete path segment
 * Matches /explore followed by end-of-string, query params (?), or path separator (/)
 */
const EXPLORE_PATH_CHECK = /\/explore(?:\?|\/|$)/;

/**
 * Determine if a URL is a dashboard or explore link
 */
function getPageType(url: string): 'dashboard' | 'explore' | null {
  if (url.includes('/d/')) {
    return 'dashboard';
  }
  if (EXPLORE_PATH_CHECK.test(url)) {
    return 'explore';
  }
  return null;
}

/**
 * Normalize a URL by trimming trailing punctuation that might have been captured
 */
function normalizeUrl(url: string): string {
  return url.replace(/[.,;:!?`]+$/, '').trim();
}

/**
 * Extract a deduplication key from a URL (path portion starting from /d/ or /explore)
 * This ensures relative and absolute URLs pointing to the same resource are treated as duplicates
 * For /explore, ensures it's a complete path segment (not /explorer, /explore-beta, etc.)
 */
function getDedupeKey(url: string): string {
  const dashboardMatch = url.match(/\/d\/[^\s]*/);
  if (dashboardMatch) {
    return dashboardMatch[0];
  }
  // Match /explore only when followed by ?, /, or end of string (complete path segment)
  const exploreMatch = url.match(/\/explore(?:\?[^\s]*|\/[^\s]*)?$/);
  if (exploreMatch) {
    return exploreMatch[0];
  }
  return url;
}

interface ParsedLink {
  url: string;
  title?: string;
  type: 'dashboard' | 'explore';
  uid?: string;
}

/**
 * Parse content for Grafana page references (dashboards and explore pages)
 *
 * This function extracts:
 * 1. Markdown links: [Link Text](/d/abc123)
 * 2. Raw dashboard URLs: /d/abc123 or https://grafana.com/d/abc123
 * 3. Raw explore URLs: /explore or https://grafana.com/explore?orgId=1
 *
 * Returns an array of deduplicated GrafanaPageRef objects with metadata.
 */
export function parseGrafanaLinks(content: string): GrafanaPageRef[] {
  if (!content) {
    return [];
  }

  const links: ParsedLink[] = [];
  const seenUrls = new Set<string>();

  // First, extract markdown links (these include titles)
  const markdownMatches = Array.from(content.matchAll(MARKDOWN_LINK_PATTERN));
  for (const match of markdownMatches) {
    const title = match[1];
    const rawUrl = normalizeUrl(match[2]);
    const type = getPageType(rawUrl);
    const dedupeKey = getDedupeKey(rawUrl);

    if (type && !seenUrls.has(dedupeKey)) {
      seenUrls.add(dedupeKey);
      links.push({
        url: rawUrl,
        title,
        type,
        uid: type === 'dashboard' ? extractDashboardUid(rawUrl) : undefined,
      });
    }
  }

  // Then extract raw dashboard URLs
  const dashboardMatches = Array.from(content.matchAll(DASHBOARD_PATTERN));
  for (const match of dashboardMatches) {
    const rawUrl = normalizeUrl(match[0]);
    const dedupeKey = getDedupeKey(rawUrl);
    if (!seenUrls.has(dedupeKey)) {
      seenUrls.add(dedupeKey);
      links.push({
        url: rawUrl,
        type: 'dashboard',
        uid: extractDashboardUid(rawUrl),
      });
    }
  }

  // Finally extract raw explore URLs
  const exploreMatches = Array.from(content.matchAll(EXPLORE_PATTERN));
  for (const match of exploreMatches) {
    const rawUrl = normalizeUrl(match[0]);
    const dedupeKey = getDedupeKey(rawUrl);
    if (!seenUrls.has(dedupeKey)) {
      seenUrls.add(dedupeKey);
      links.push({
        url: rawUrl,
        type: 'explore',
      });
    }
  }

  return links;
}

/**
 * Quick check if content contains any Grafana links (dashboard or explore)
 */
export function hasGrafanaLinks(content: string): boolean {
  if (!content) {
    return false;
  }

  // Reset lastIndex since these are global regexes
  DASHBOARD_PATTERN.lastIndex = 0;
  EXPLORE_PATTERN.lastIndex = 0;

  return DASHBOARD_PATTERN.test(content) || EXPLORE_PATTERN.test(content);
}
