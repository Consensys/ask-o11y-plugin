export interface TopologyNode {
  id: string;
  label: string;
  type: string;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface AgentTopologyResponse {
  enabled: boolean;
  source: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  rawFactCount?: number;
  warnings?: string[];
}

export interface AgentTopologyOptions {
  maxNodes?: number;
  maxEdges?: number;
}

const AGENT_TOPOLOGY_URL = '/api/plugins/consensys-asko11y-app/resources/api/agent/topology';

function orgIdHeaders(orgId?: string): Record<string, string> {
  if (orgId) {
    return { 'X-Grafana-Org-Id': orgId };
  }
  return {};
}

export async function getAgentTopology(
  query?: string,
  orgId?: string,
  options: AgentTopologyOptions = {}
): Promise<AgentTopologyResponse> {
  const url = new URL(AGENT_TOPOLOGY_URL, window.location.origin);
  const trimmedQuery = query?.trim();
  if (trimmedQuery) {
    url.searchParams.set('query', trimmedQuery);
  }
  if (options.maxNodes && options.maxNodes > 0) {
    url.searchParams.set('maxNodes', String(options.maxNodes));
  }
  if (options.maxEdges && options.maxEdges > 0) {
    url.searchParams.set('maxEdges', String(options.maxEdges));
  }

  const resp = await fetch(url.pathname + url.search, {
    headers: orgIdHeaders(orgId),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to load service graph (${resp.status}): ${text}`);
  }

  return resp.json();
}
