/**
 * Query Analyzer - Auto-detects query patterns and suggests visualizations
 *
 * Analyzes LogQL and TraceQL queries to detect aggregation patterns
 * and recommend appropriate visualization types.
 */

export type QueryType = 'promql' | 'logql' | 'traceql';
export type AggregationType = 'sum' | 'rate' | 'count' | 'avg' | 'min' | 'max' | 'none';
export type VisualizationSuggestion =
  | 'timeseries'
  | 'barchart'
  | 'stat'
  | 'table'
  | 'logs'
  | 'traces'
  | 'drilldown';

export interface QueryAnalysis {
  type: QueryType;
  hasAggregation: boolean;
  aggregationType: AggregationType;
  suggestedVisualization: VisualizationSuggestion;
  extractedLabels: string[];
  queryPatterns: string[];
}

/**
 * Analyze a query to detect its type, aggregation patterns, and suggest visualizations
 */
export function analyzeQuery(query: string): QueryAnalysis {
  const trimmedQuery = query.trim();

  // Detect query type
  const queryType = detectQueryType(trimmedQuery);

  // Detect aggregation patterns
  const aggregation = detectAggregation(trimmedQuery, queryType);

  // Extract labels for potential drilldown
  const labels = extractLabels(trimmedQuery, queryType);

  // Suggest visualization based on analysis
  const visualization = suggestVisualization(queryType, aggregation);

  return {
    type: queryType,
    hasAggregation: aggregation.type !== 'none',
    aggregationType: aggregation.type,
    suggestedVisualization: visualization,
    extractedLabels: labels,
    queryPatterns: aggregation.patterns,
  };
}

/**
 * Detect the type of query (LogQL, TraceQL, or default to PromQL)
 */
function detectQueryType(query: string): QueryType {
  // TraceQL patterns
  const traceqlPatterns = [
    /traceID\s*=|span:|duration:|error:|status:|service:|name:/i,
    /\{[^}]*span:/,
    /\{[^}]*traceID:/,
  ];

  for (const pattern of traceqlPatterns) {
    if (pattern.test(query)) {
      return 'traceql';
    }
  }

  // LogQL patterns
  const logqlPatterns = [
    /count_over_time|rate_over_time|avg_over_time|sum_over_time/i,
    /\{\s*.*\s*=\s*.*\s*\}\s*(!=|~|!~|!=)/,
    /\|\s*(|log|line|json|patterns|labels|parser)/i,
    /\{\s*job\s*=|{\s*instance\s*=|{\s*exported_*\w+\s*=}/i,
  ];

  for (const pattern of logqlPatterns) {
    if (pattern.test(query)) {
      return 'logql';
    }
  }

  return 'promql';
}

/**
 * Detect aggregation patterns in the query
 */
function detectAggregation(query: string, queryType: QueryType): {
  type: AggregationType;
  patterns: string[];
} {
  const patterns: string[] = [];
  let aggregation: AggregationType = 'none';

  if (queryType === 'logql') {
    // LogQL aggregation patterns
    if (/\bsum\s*\(\s*count_over_time/i.test(query)) {
      patterns.push('sum_count_over_time');
      aggregation = 'sum';
    } else if (/\brate\s*\(\s*\{/i.test(query)) {
      patterns.push('rate');
      aggregation = 'rate';
    } else if (/\bcount_over_time\s*\(/i.test(query)) {
      patterns.push('count_over_time');
      aggregation = 'count';
    } else if (/\bavg_over_time\s*\(/i.test(query)) {
      patterns.push('avg_over_time');
      aggregation = 'avg';
    } else if (/\bmin_over_time\s*\(/i.test(query)) {
      patterns.push('min_over_time');
      aggregation = 'min';
    } else if (/\bmax_over_time\s*\(/i.test(query)) {
      patterns.push('max_over_time');
      aggregation = 'max';
    }
  } else if (queryType === 'traceql') {
    // TraceQL aggregation patterns
    if (/span:error|span:error\s*=|status:error/i.test(query)) {
      patterns.push('error_count');
      aggregation = 'count';
    } else if (/span:duration|duration:>|duration:</i.test(query)) {
      patterns.push('duration');
      aggregation = 'avg';
    } else if (/span:childCount|span:parentCount/i.test(query)) {
      patterns.push('fanout');
      aggregation = 'count';
    } else if (/service:|name:|handler:/i.test(query)) {
      patterns.push('service_name');
      aggregation = 'count';
    }
  }

  return { type: aggregation, patterns };
}

/**
 * Extract labels from a query for potential drilldown
 */
function extractLabels(query: string, queryType: QueryType): string[] {
  const labels: string[] = [];

  if (queryType === 'logql') {
    // Extract LogQL labels: job, instance, exporter, container, etc.
    const labelPatterns = [
      /\{\s*(job|instance|exporter|container|pod|namespace)\s*=/gi,
      /\|\s*labels=\{([^}]+)\}/gi,
      /\|\s*parser\s*=\s*"([^"]+)"/gi,
    ];

    for (const pattern of labelPatterns) {
      const matches = query.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          const labelMatch = match.match(/(job|instance|exporter|container|pod|namespace)/i);
          if (labelMatch && !labels.includes(labelMatch[1])) {
            labels.push(labelMatch[1]);
          }
        });
      }
    }
  } else if (queryType === 'traceql') {
    // Extract TraceQL attributes: service.name, span.name, status, etc.
    const attrPatterns = [
      /service\.name\s*=|service:/gi,
      /span\.name\s*=|name:/gi,
      /status\s*=|status:/gi,
      /span:status|span:duration/i,
    ];

    for (const pattern of attrPatterns) {
      const matches = query.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          if (match.includes('service') && !labels.includes('service')) {
            labels.push('service');
          } else if (match.includes('name') && !labels.includes('name')) {
            labels.push('name');
          } else if (match.includes('status') && !labels.includes('status')) {
            labels.push('status');
          }
        });
      }
    }
  }

  return labels;
}

/**
 * Suggest visualization based on query analysis
 */
function suggestVisualization(
  queryType: QueryType,
  aggregation: { type: AggregationType; patterns: string[] }
): VisualizationSuggestion {
  // TraceQL always suggests traces or drilldown
  if (queryType === 'traceql') {
    if (aggregation.type !== 'none') {
      return 'drilldown'; // Aggregated traces benefit from drilldown
    }
    return 'traces';
  }

  // LogQL suggestions
  if (queryType === 'logql') {
    if (aggregation.type !== 'none') {
      switch (aggregation.type) {
        case 'sum':
        case 'count':
          return 'barchart'; // Aggregations work well as bar charts
        case 'rate':
          return 'timeseries'; // Rate is time-based
        case 'avg':
        case 'min':
        case 'max':
          return 'stat'; // Single value aggregations
        default:
          return 'logs';
      }
    }
    return 'logs'; // Raw logs visualization
  }

  // PromQL (default)
  if (aggregation.type !== 'none') {
    switch (aggregation.type) {
      case 'sum':
      case 'count':
        return 'barchart';
      case 'rate':
        return 'timeseries';
      case 'avg':
      case 'min':
      case 'max':
        return 'stat';
      default:
        return 'timeseries';
    }
  }

  return 'timeseries';
}

/**
 * Build an aggregation query from a base query
 */
export function buildAggregationQuery(query: string, aggregationType: AggregationType): string {
  switch (aggregationType) {
    case 'sum':
      return `sum(${query})`;
    case 'rate':
      // Wrap with rate() if not already present
      if (/rate\s*\(/i.test(query)) {
        return query;
      }
      return `rate(${query})`;
    case 'count':
      return `count(${query})`;
    case 'avg':
      return `avg(${query})`;
    case 'min':
      return `min(${query})`;
    case 'max':
      return `max(${query})`;
    default:
      return query;
  }
}

/**
 * Check if a query has aggregation patterns
 */
export function hasAggregation(query: string): boolean {
  return analyzeQuery(query).hasAggregation;
}

/**
 * Get the suggested visualization for a query
 */
export function getSuggestedVisualization(query: string): VisualizationSuggestion {
  return analyzeQuery(query).suggestedVisualization;
}

/**
 * Get the aggregation type for a query
 */
export function getAggregationType(query: string): AggregationType {
  return analyzeQuery(query).aggregationType;
}
