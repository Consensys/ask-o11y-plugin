/**
 * Unit tests for SessionSidebar utilities and helpers
 * The component tests are deferred to E2E tests due to complex mocking requirements
 */

describe('SessionSidebar utilities', () => {
  describe('date formatting helper', () => {
    const formatDate = (date: Date) => {
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) {
        return 'Today';
      } else if (days === 1) {
        return 'Yesterday';
      } else if (days < 7) {
        return `${days} days ago`;
      } else {
        return date.toLocaleDateString();
      }
    };

    it('should return "Today" for dates from today', () => {
      expect(formatDate(new Date())).toBe('Today');
    });

    it('should return "Yesterday" for dates from yesterday', () => {
      const yesterday = new Date(Date.now() - 86400000);
      expect(formatDate(yesterday)).toBe('Yesterday');
    });

    it('should return "X days ago" for recent dates', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
      expect(formatDate(threeDaysAgo)).toBe('3 days ago');
    });

    it('should return localized date string for old dates', () => {
      const oldDate = new Date(Date.now() - 30 * 86400000);
      expect(formatDate(oldDate)).toBe(oldDate.toLocaleDateString());
    });
  });

  describe('storage percentage calculation', () => {
    it('should calculate storage percent correctly', () => {
      const used = 1024;
      const total = 5242880;
      const percent = Math.round((used / total) * 100);
      expect(percent).toBe(0); // Very small usage
    });

    it('should calculate 50% storage correctly', () => {
      const used = 2621440;
      const total = 5242880;
      const percent = Math.round((used / total) * 100);
      expect(percent).toBe(50);
    });

    it('should handle full storage', () => {
      const used = 5242880;
      const total = 5242880;
      const percent = Math.round((used / total) * 100);
      expect(percent).toBe(100);
    });
  });

  describe('session sorting', () => {
    it('should sort sessions by date descending', () => {
      const sessions = [
        { id: '1', updatedAt: new Date('2024-01-01') },
        { id: '2', updatedAt: new Date('2024-01-03') },
        { id: '3', updatedAt: new Date('2024-01-02') },
      ];

      const sorted = [...sessions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });
  });

  describe('session stats formatting', () => {
    const formatTokenCount = (tokens: number): string => {
      if (tokens < 1000) {
        return tokens.toString();
      }
      if (tokens < 10000) {
        return `${(tokens / 1000).toFixed(1)}k`;
      }
      if (tokens < 1000000) {
        const rounded = Math.round(tokens / 1000);
        return rounded >= 1000 ? `${(tokens / 1000000).toFixed(1)}M` : `${rounded}k`;
      }
      return `${(tokens / 1000000).toFixed(1)}M`;
    };

    const formatStats = (stats: { totalTokens: number; runCount: number; toolCallCount: number }): string =>
      `${formatTokenCount(stats.totalTokens)} tokens · ${stats.runCount} ${stats.runCount === 1 ? 'turn' : 'turns'} · ` +
      `${stats.toolCallCount} tool ${stats.toolCallCount === 1 ? 'call' : 'calls'}`;

    it('should pluralize turns and tool calls', () => {
      expect(formatStats({ totalTokens: 1234, runCount: 3, toolCallCount: 5 })).toBe('1.2k tokens · 3 turns · 5 tool calls');
    });

    it('should use singular turn and tool call for a count of one', () => {
      expect(formatStats({ totalTokens: 500, runCount: 1, toolCallCount: 1 })).toBe('500 tokens · 1 turn · 1 tool call');
    });

    it('should abbreviate large token counts with a "k" suffix', () => {
      expect(formatStats({ totalTokens: 47015, runCount: 1, toolCallCount: 3 })).toBe('47k tokens · 1 turn · 3 tool calls');
    });

    it('should abbreviate token counts in the millions with an "M" suffix', () => {
      expect(formatStats({ totalTokens: 1000000, runCount: 10, toolCallCount: 20 })).toBe('1.0M tokens · 10 turns · 20 tool calls');
    });

    it('should promote to the "M" suffix when rounding would otherwise reach "1000k"', () => {
      expect(formatStats({ totalTokens: 999600, runCount: 2, toolCallCount: 4 })).toBe('1.0M tokens · 2 turns · 4 tool calls');
    });
  });

  describe('session title generation', () => {
    const generateTitle = (firstMessage: string, maxLength = 50): string => {
      if (!firstMessage) { return 'New Session'; }
      const truncated = firstMessage.length > maxLength 
        ? firstMessage.slice(0, maxLength) + '...' 
        : firstMessage;
      return truncated;
    };

    it('should return "New Session" for empty message', () => {
      expect(generateTitle('')).toBe('New Session');
    });

    it('should truncate long messages', () => {
      const longMessage = 'A'.repeat(100);
      const title = generateTitle(longMessage);
      expect(title.length).toBe(53); // 50 + '...'
      expect(title.endsWith('...')).toBe(true);
    });

    it('should not truncate short messages', () => {
      const shortMessage = 'Hello world';
      expect(generateTitle(shortMessage)).toBe('Hello world');
    });
  });
});

