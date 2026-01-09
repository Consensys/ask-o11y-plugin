import {
  extractPromQLQueries,
  hasPromQLQueries,
  removePromQLCodeBlocks,
  splitContentByPromQL,
} from '../promqlParser';

describe('promqlParser', () => {
  describe('extractPromQLQueries', () => {
    it('should extract a simple PromQL query', () => {
      const content = '```promql\nrate(http_requests_total[5m])\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].query).toBe('rate(http_requests_total[5m])');
      expect(queries[0].language).toBe('promql');
      expect(queries[0].type).toBe('metrics');
    });

    it('should extract a prometheus query', () => {
      const content = '```prometheus\nup{job="prometheus"}\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].language).toBe('prometheus');
      expect(queries[0].type).toBe('metrics');
    });

    it('should extract a LogQL query', () => {
      const content = '```logql\n{job="varlogs"} |= "error"\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].query).toBe('{job="varlogs"} |= "error"');
      expect(queries[0].language).toBe('logql');
      expect(queries[0].type).toBe('logs');
    });

    it('should extract a loki query', () => {
      const content = '```loki\n{app="nginx"}\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].language).toBe('loki');
      expect(queries[0].type).toBe('logs');
    });

    it('should extract a TraceQL query', () => {
      const content = '```traceql\n{span.http.status_code >= 400}\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].language).toBe('traceql');
      expect(queries[0].type).toBe('traces');
    });

    it('should extract a tempo query', () => {
      const content = '```tempo\n{resource.service.name="frontend"}\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].language).toBe('tempo');
      expect(queries[0].type).toBe('traces');
    });

    it('should extract query with title attribute', () => {
      const content = '```promql title="CPU Usage"\nprocess_cpu_seconds_total\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].title).toBe('CPU Usage');
    });

    it('should extract query with from attribute', () => {
      const content = '```promql from="now-7d"\nhttp_requests_total\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].from).toBe('now-7d');
    });

    it('should extract query with to attribute', () => {
      const content = '```promql to="now"\nhttp_requests_total\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].to).toBe('now');
    });

    it('should extract query with viz attribute', () => {
      const content = '```promql viz="gauge"\nmemory_usage\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].visualization).toBe('gauge');
    });

    it('should extract query with multiple attributes', () => {
      const content = '```promql title="CPU" from="now-1h" to="now" viz="timeseries"\nprocess_cpu\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].title).toBe('CPU');
      expect(queries[0].from).toBe('now-1h');
      expect(queries[0].to).toBe('now');
      expect(queries[0].visualization).toBe('timeseries');
    });

    it('should extract multiple queries from content', () => {
      const content = `
Some text here

\`\`\`promql
rate(http_requests_total[5m])
\`\`\`

More text

\`\`\`logql
{job="varlogs"} |= "error"
\`\`\`
      `;
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(2);
      expect(queries[0].language).toBe('promql');
      expect(queries[1].language).toBe('logql');
    });

    it('should return empty array for content without queries', () => {
      const content = 'Just some plain text without any code blocks';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(0);
    });

    it('should ignore non-query code blocks', () => {
      const content = '```javascript\nconsole.log("hello");\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(0);
    });

    it('should handle multiline queries', () => {
      const content = '```promql\nsum by (job) (\n  rate(http_requests_total[5m])\n)\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].query).toContain('sum by (job)');
    });

    it('should ignore invalid visualization types', () => {
      const content = '```promql viz="invalid"\nmetric\n```';
      const queries = extractPromQLQueries(content);
      expect(queries).toHaveLength(1);
      expect(queries[0].visualization).toBeUndefined();
    });

    it('should accept all valid visualization types', () => {
      const vizTypes = ['timeseries', 'stat', 'gauge', 'table', 'piechart', 'barchart', 'heatmap', 'histogram'];
      for (const vizType of vizTypes) {
        const content = `\`\`\`promql viz="${vizType}"\nmetric\n\`\`\``;
        const queries = extractPromQLQueries(content);
        expect(queries[0].visualization).toBe(vizType);
      }
    });
  });

  describe('hasPromQLQueries', () => {
    it('should return true when content has PromQL queries', () => {
      const content = '```promql\nup\n```';
      expect(hasPromQLQueries(content)).toBe(true);
    });

    it('should return true when content has LogQL queries', () => {
      const content = '```logql\n{app="test"}\n```';
      expect(hasPromQLQueries(content)).toBe(true);
    });

    it('should return false when content has no queries', () => {
      const content = 'Just plain text';
      expect(hasPromQLQueries(content)).toBe(false);
    });

    it('should return false for non-query code blocks', () => {
      const content = '```python\nprint("hello")\n```';
      expect(hasPromQLQueries(content)).toBe(false);
    });
  });

  describe('removePromQLCodeBlocks', () => {
    it('should remove PromQL code blocks', () => {
      const content = 'Before ```promql\nrate(http_requests_total[5m])\n``` After';
      const result = removePromQLCodeBlocks(content);
      expect(result).toBe('Before  After');
    });

    it('should remove LogQL code blocks', () => {
      const content = 'Text ```logql\n{job="test"}\n``` more text';
      const result = removePromQLCodeBlocks(content);
      expect(result).toBe('Text  more text');
    });

    it('should remove TraceQL code blocks', () => {
      const content = 'Start ```traceql\n{span.id="abc"}\n``` End';
      const result = removePromQLCodeBlocks(content);
      expect(result).toBe('Start  End');
    });

    it('should remove all query code blocks', () => {
      const content = '```promql\nquery1\n``` text ```logql\nquery2\n```';
      const result = removePromQLCodeBlocks(content);
      expect(result).toBe(' text ');
    });

    it('should preserve non-query code blocks', () => {
      const content = '```javascript\ncode\n```';
      const result = removePromQLCodeBlocks(content);
      expect(result).toBe('```javascript\ncode\n```');
    });
  });

  describe('splitContentByPromQL', () => {
    it('should split content with promql sections', () => {
      const content = 'Text before ```promql\nrate(http_requests_total[5m])\n``` text after';
      const sections = splitContentByPromQL(content);

      expect(sections).toHaveLength(3);
      expect(sections[0].type).toBe('text');
      expect(sections[0].content).toBe('Text before');
      expect(sections[1].type).toBe('promql');
      expect(sections[1].query?.query).toBe('rate(http_requests_total[5m])');
      expect(sections[2].type).toBe('text');
      expect(sections[2].content).toBe('text after');
    });

    it('should split content with logql sections', () => {
      const content = 'Check logs: ```logql\n{job="varlogs"}\n```';
      const sections = splitContentByPromQL(content);

      expect(sections).toHaveLength(2);
      expect(sections[0].type).toBe('text');
      expect(sections[1].type).toBe('logql');
      expect(sections[1].query?.type).toBe('logs');
    });

    it('should split content with traceql sections', () => {
      const content = 'Trace query: ```traceql\n{duration > 1s}\n```';
      const sections = splitContentByPromQL(content);

      expect(sections).toHaveLength(2);
      expect(sections[0].type).toBe('text');
      expect(sections[1].type).toBe('traceql');
      expect(sections[1].query?.type).toBe('traces');
    });

    it('should return text content when no queries present', () => {
      const content = 'Just plain text content';
      const sections = splitContentByPromQL(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].type).toBe('text');
      expect(sections[0].content).toBe('Just plain text content');
    });

    it('should return empty array for empty content', () => {
      const sections = splitContentByPromQL('');
      expect(sections).toHaveLength(0);
    });

    it('should handle multiple query sections', () => {
      const content = `
Text 1
\`\`\`promql
query1
\`\`\`
Text 2
\`\`\`logql
query2
\`\`\`
Text 3
      `;
      const sections = splitContentByPromQL(content);

      expect(sections.filter((s) => s.type === 'text')).toHaveLength(3);
      expect(sections.filter((s) => s.type === 'promql')).toHaveLength(1);
      expect(sections.filter((s) => s.type === 'logql')).toHaveLength(1);
    });

    it('should include query attributes in sections', () => {
      const content = '```promql title="Test" from="now-1h" viz="gauge"\nmetric\n```';
      const sections = splitContentByPromQL(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].query?.title).toBe('Test');
      expect(sections[0].query?.from).toBe('now-1h');
      expect(sections[0].query?.visualization).toBe('gauge');
    });

    it('should skip empty text sections', () => {
      const content = '```promql\nquery\n```';
      const sections = splitContentByPromQL(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].type).toBe('promql');
    });

    it('should handle whitespace-only content', () => {
      const content = '   ';
      const sections = splitContentByPromQL(content);
      expect(sections).toHaveLength(0);
    });
  });
});

