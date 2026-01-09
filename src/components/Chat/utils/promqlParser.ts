/**
 * Utility functions for detecting and parsing PromQL, LogQL, and TraceQL queries from text
 */

export type QueryLanguage = 'promql' | 'prometheus' | 'logql' | 'loki' | 'traceql' | 'tempo';
export type QueryType = 'metrics' | 'logs' | 'traces';

export type VisualizationType =
  | 'timeseries'
  | 'stat'
  | 'gauge'
  | 'table'
  | 'piechart'
  | 'barchart'
  | 'heatmap'
  | 'histogram';

export interface Query {
  query: string;
  title?: string;
  language: QueryLanguage;
  type: QueryType;
  from?: string;
  to?: string;
  visualization?: VisualizationType;
}

// For backward compatibility
export type PromQLQuery = Query;

/**
 * Determines the query type from language
 */
function getQueryType(language: QueryLanguage): QueryType {
  if (language === 'logql' || language === 'loki') {
    return 'logs';
  } else if (language === 'traceql' || language === 'tempo') {
    return 'traces';
  }
  return 'metrics';
}

/**
 * Parses attributes (title, from, to, viz) from a string like: title="My Title" from="now-7d" to="now" viz="gauge"
 */
function parseAttributes(attrString: string): { title?: string; from?: string; to?: string; viz?: VisualizationType } {
  const attrs: { title?: string; from?: string; to?: string; viz?: VisualizationType } = {};

  const titleMatch = attrString.match(/title="([^"]*)"/);
  if (titleMatch) {
    attrs.title = titleMatch[1];
  }

  const fromMatch = attrString.match(/from="([^"]*)"/);
  if (fromMatch) {
    attrs.from = fromMatch[1];
  }

  const toMatch = attrString.match(/to="([^"]*)"/);
  if (toMatch) {
    attrs.to = toMatch[1];
  }

  const vizMatch = attrString.match(/viz="([^"]*)"/);
  if (vizMatch) {
    const vizValue = vizMatch[1] as VisualizationType;
    // Only accept valid visualization types
    if (['timeseries', 'stat', 'gauge', 'table', 'piechart', 'barchart', 'heatmap', 'histogram'].includes(vizValue)) {
      attrs.viz = vizValue;
    }
  }

  return attrs;
}

/**
 * Detects PromQL, LogQL, and TraceQL queries in markdown code blocks
 * Supports ```promql, ```prometheus, ```logql, ```loki, ```traceql, and ```tempo formats
 */
export function extractPromQLQueries(content: string): Query[] {
  const queries: Query[] = [];

  // Match code blocks with promql, prometheus, logql, loki, traceql, or tempo language tag
  // Captures all attributes as a single group to support title, from, to in any order
  const codeBlockRegex = /```(promql|prometheus|logql|loki|traceql|tempo)([^\n]*)\n([\s\S]*?)```/gi;

  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const [, language, attrString, query] = match;
    const lang = language.toLowerCase() as QueryLanguage;
    const attrs = parseAttributes(attrString);
    queries.push({
      query: query.trim(),
      title: attrs.title,
      language: lang,
      type: getQueryType(lang),
      from: attrs.from,
      to: attrs.to,
      visualization: attrs.viz,
    });
  }

  return queries;
}

/**
 * Check if content contains PromQL, LogQL, or TraceQL queries
 */
export function hasPromQLQueries(content: string): boolean {
  return extractPromQLQueries(content).length > 0;
}

/**
 * Remove PromQL, LogQL, and TraceQL code blocks from content for text rendering
 */
export function removePromQLCodeBlocks(content: string): string {
  return content.replace(/```(promql|prometheus|logql|loki|traceql|tempo)[^\n]*\n[\s\S]*?```/gi, '');
}

/**
 * Split content into text, PromQL, LogQL, and TraceQL sections
 */
export function splitContentByPromQL(
  content: string
): Array<{ type: 'text' | 'promql' | 'logql' | 'traceql'; content: string; query?: Query }> {
  const sections: Array<{ type: 'text' | 'promql' | 'logql' | 'traceql'; content: string; query?: Query }> = [];

  // Captures all attributes as a single group to support title, from, to in any order
  const codeBlockRegex = /```(promql|prometheus|logql|loki|traceql|tempo)([^\n]*)\n([\s\S]*?)```/gi;

  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before this code block
    if (match.index > lastIndex) {
      const textContent = content.substring(lastIndex, match.index).trim();
      if (textContent) {
        sections.push({ type: 'text', content: textContent });
      }
    }

    // Add the query
    const [, language, attrString, query] = match;
    const lang = language.toLowerCase() as QueryLanguage;
    const queryType = getQueryType(lang);
    const attrs = parseAttributes(attrString);

    let sectionType: 'promql' | 'logql' | 'traceql';
    if (queryType === 'logs') {
      sectionType = 'logql';
    } else if (queryType === 'traces') {
      sectionType = 'traceql';
    } else {
      sectionType = 'promql';
    }

    sections.push({
      type: sectionType,
      content: match[0],
      query: {
        query: query.trim(),
        title: attrs.title,
        language: lang,
        type: queryType,
        from: attrs.from,
        to: attrs.to,
        visualization: attrs.viz,
      },
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    const textContent = content.substring(lastIndex).trim();
    if (textContent) {
      sections.push({ type: 'text', content: textContent });
    }
  }

  // If no sections were added, return the whole content as text
  if (sections.length === 0 && content.trim()) {
    sections.push({ type: 'text', content: content });
  }

  return sections;
}
