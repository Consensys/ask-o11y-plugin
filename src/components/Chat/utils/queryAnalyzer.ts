export type AggregationType = 'sum' | 'rate' | 'count' | 'avg' | 'min' | 'max' | 'none';

export interface QueryAnalysis {
  hasAggregation: boolean;
  aggregationType: AggregationType;
}

export function analyzeQuery(query: string, queryType: 'logql' | 'traceql'): QueryAnalysis {
  const aggregationType = detectAggregation(query.trim(), queryType);
  return {
    hasAggregation: aggregationType !== 'none',
    aggregationType,
  };
}

function detectAggregation(query: string, queryType: 'logql' | 'traceql'): AggregationType {
  if (queryType === 'logql') {
    if (/\bsum\s*\(\s*count_over_time/i.test(query)) {
      return 'sum';
    }
    if (/\brate\s*\(\s*\{/i.test(query)) {
      return 'rate';
    }
    if (/\bcount_over_time\s*\(/i.test(query)) {
      return 'count';
    }
    if (/\bavg_over_time\s*\(/i.test(query)) {
      return 'avg';
    }
    if (/\bmin_over_time\s*\(/i.test(query)) {
      return 'min';
    }
    if (/\bmax_over_time\s*\(/i.test(query)) {
      return 'max';
    }
  } else {
    // TraceQL aggregations are introduced in the pipeline (e.g. {} | count()).
    // Intrinsics inside span filters (e.g. span:duration, span:status) are not aggregations.
    const traceqlAggregationMatch = query.match(/\|\s*(count|avg|min|max|sum)\s*\(/i);
    if (traceqlAggregationMatch) {
      return traceqlAggregationMatch[1].toLowerCase() as AggregationType;
    }
  }
  return 'none';
}
