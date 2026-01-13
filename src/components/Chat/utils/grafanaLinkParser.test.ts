import { parseGrafanaLinks, hasGrafanaLinks } from './grafanaLinkParser';

describe('grafanaLinkParser', () => {
  describe('parseGrafanaLinks', () => {
    describe('Dashboard Detection', () => {
      it('should detect basic dashboard path', () => {
        const content = 'Check out /d/abc123 for more details';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'dashboard',
          url: '/d/abc123',
          uid: 'abc123',
          title: undefined,
        });
      });

      it('should detect dashboard with slug', () => {
        const content = 'View the dashboard at /d/abc123/my-dashboard-name';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'dashboard',
          url: '/d/abc123/my-dashboard-name',
          uid: 'abc123',
          title: undefined,
        });
      });

      it('should detect dashboard with query params', () => {
        const content = 'Open /d/abc123?orgId=1&from=now-1h&to=now';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'dashboard',
          url: '/d/abc123?orgId=1&from=now-1h&to=now',
          uid: 'abc123',
          title: undefined,
        });
      });

      it('should detect dashboard with panel view', () => {
        const content = 'See panel at /d/abc123?viewPanel=2';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'dashboard',
          url: '/d/abc123?viewPanel=2',
          uid: 'abc123',
          title: undefined,
        });
      });

      it('should detect full HTTP URL', () => {
        const content = 'Go to http://localhost:3000/d/abc123';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'dashboard',
          url: 'http://localhost:3000/d/abc123',
          uid: 'abc123',
          title: undefined,
        });
      });

      it('should detect full HTTPS URL with slug and query params', () => {
        const content = 'Visit https://grafana.example.com/d/abc123/slug?from=now-6h';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'dashboard',
          url: 'https://grafana.example.com/d/abc123/slug?from=now-6h',
          uid: 'abc123',
          title: undefined,
        });
      });

      it('should detect markdown link with title', () => {
        const content = 'Check out [My Dashboard](/d/abc123) for more info';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'dashboard',
          url: '/d/abc123',
          uid: 'abc123',
          title: 'My Dashboard',
        });
      });

      it('should detect markdown link with full URL', () => {
        const content = 'See [Dashboard](https://grafana.com/d/abc123) here';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'dashboard',
          url: 'https://grafana.com/d/abc123',
          uid: 'abc123',
          title: 'Dashboard',
        });
      });

      it('should handle dashboard UID with underscores and hyphens', () => {
        const content = 'Check /d/my_dashboard-123_test';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0].uid).toBe('my_dashboard-123_test');
      });
    });

    describe('Explore Detection', () => {
      it('should detect basic explore path', () => {
        const content = 'Go to /explore to investigate';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'explore',
          url: '/explore',
          uid: undefined,
          title: undefined,
        });
      });

      it('should detect explore with org', () => {
        const content = 'Visit /explore?orgId=1';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'explore',
          url: '/explore?orgId=1',
          uid: undefined,
          title: undefined,
        });
      });

      it('should detect explore with left pane (legacy format)', () => {
        const content = 'Open /explore?orgId=1&left=["now-1h","now","Prometheus"]';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('explore');
        expect(result[0].url).toContain('/explore?orgId=1&left=');
      });

      it('should detect explore with panes (new format)', () => {
        const content = 'Check /explore?panes={"abc":{"datasource":"uid"}}&schemaVersion=1';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('explore');
        expect(result[0].url).toContain('/explore?panes=');
      });

      it('should detect full explore URL', () => {
        const content = 'Go to https://grafana.example.com/explore?orgId=1';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'explore',
          url: 'https://grafana.example.com/explore?orgId=1',
          uid: undefined,
          title: undefined,
        });
      });

      it('should detect explore markdown link', () => {
        const content = 'Use [Explore Metrics](/explore?orgId=1) to investigate';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'explore',
          url: '/explore?orgId=1',
          uid: undefined,
          title: 'Explore Metrics',
        });
      });
    });

    describe('Mixed Content', () => {
      it('should detect multiple links in one message', () => {
        const content = 'Check /d/dash1 and /d/dash2 for comparison';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(2);
        expect(result[0].uid).toBe('dash1');
        expect(result[1].uid).toBe('dash2');
      });

      it('should detect dashboard and explore links together', () => {
        const content = 'See the [Dashboard](/d/abc123) or use [Explore](/explore?orgId=1)';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(2);
        expect(result.find((r) => r.type === 'dashboard')).toBeDefined();
        expect(result.find((r) => r.type === 'explore')).toBeDefined();
      });

      it('should detect links inside code blocks', () => {
        const content = 'The URL is `http://localhost:3000/d/abc123`';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0].uid).toBe('abc123');
      });

      it('should detect links with surrounding text', () => {
        const content =
          'For more details, please check the production dashboard at /d/prod-metrics?from=now-1h which shows the current state.';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0].uid).toBe('prod-metrics');
      });

      it('should deduplicate identical URLs', () => {
        const content = 'Go to /d/abc123 and also check /d/abc123 again';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0].uid).toBe('abc123');
      });

      it('should not duplicate markdown links found as raw URLs', () => {
        const content = '[Dashboard](/d/abc123)';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Dashboard');
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array for no links', () => {
        const content = 'This is just regular text without any Grafana links';
        const result = parseGrafanaLinks(content);

        expect(result).toEqual([]);
      });

      it('should return empty array for empty content', () => {
        expect(parseGrafanaLinks('')).toEqual([]);
      });

      it('should return empty array for null/undefined content', () => {
        expect(parseGrafanaLinks(null as unknown as string)).toEqual([]);
        expect(parseGrafanaLinks(undefined as unknown as string)).toEqual([]);
      });

      it('should not crash on malformed URLs', () => {
        const content = 'Some text /d/ without uid';
        const result = parseGrafanaLinks(content);

        // Should not match invalid /d/ without UID
        expect(result).toEqual([]);
      });

      it('should not match URL-like text that is not a Grafana link', () => {
        const content = 'Check the /data/file.txt path';
        const result = parseGrafanaLinks(content);

        expect(result).toEqual([]);
      });

      it('should handle very long query parameters', () => {
        const longQuery = 'a'.repeat(500);
        const content = `/d/abc123?query=${longQuery}`;
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0].uid).toBe('abc123');
      });

      it('should trim trailing punctuation from URLs', () => {
        const content = 'Check out /d/abc123.';
        const result = parseGrafanaLinks(content);

        expect(result).toHaveLength(1);
        expect(result[0].url).toBe('/d/abc123');
      });
    });
  });

  describe('hasGrafanaLinks', () => {
    it('should return true for dashboard links', () => {
      expect(hasGrafanaLinks('/d/abc123')).toBe(true);
      expect(hasGrafanaLinks('Check [Dashboard](/d/abc123)')).toBe(true);
    });

    it('should return true for explore links', () => {
      expect(hasGrafanaLinks('/explore')).toBe(true);
      expect(hasGrafanaLinks('/explore?orgId=1')).toBe(true);
    });

    it('should return false for no links', () => {
      expect(hasGrafanaLinks('Regular text')).toBe(false);
      expect(hasGrafanaLinks('')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(hasGrafanaLinks(null as unknown as string)).toBe(false);
      expect(hasGrafanaLinks(undefined as unknown as string)).toBe(false);
    });
  });
});
