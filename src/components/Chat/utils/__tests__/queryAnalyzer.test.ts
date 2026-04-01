import { analyzeQuery } from '../queryAnalyzer';

describe('queryAnalyzer', () => {
  describe('traceql aggregation detection', () => {
    it('does not classify span duration filters as aggregations', () => {
      const analysis = analyzeQuery('{span:duration > 500ms}', 'traceql');

      expect(analysis).toEqual({
        hasAggregation: false,
        aggregationType: 'none',
      });
    });

    it('does not classify span status filters as aggregations', () => {
      const analysis = analyzeQuery('{span:status = error}', 'traceql');

      expect(analysis).toEqual({
        hasAggregation: false,
        aggregationType: 'none',
      });
    });

    it('detects count aggregation in TraceQL pipelines', () => {
      const analysis = analyzeQuery('{} | count() > 2', 'traceql');

      expect(analysis).toEqual({
        hasAggregation: true,
        aggregationType: 'count',
      });
    });

    it('detects avg aggregation in TraceQL pipelines', () => {
      const analysis = analyzeQuery('{resource.service.name="api"} | avg(duration)', 'traceql');

      expect(analysis).toEqual({
        hasAggregation: true,
        aggregationType: 'avg',
      });
    });
  });

  describe('logql aggregation detection', () => {
    it('still detects LogQL rate aggregations', () => {
      const analysis = analyzeQuery('rate({app="api"}[5m])', 'logql');

      expect(analysis).toEqual({
        hasAggregation: true,
        aggregationType: 'rate',
      });
    });
  });
});
