import { getAgentTopology } from '../agentTopologyClient';

describe('getAgentTopology', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('loads topology and forwards the Grafana org header', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        enabled: true,
        source: 'graphiti',
        nodes: [{ id: 'api', label: 'api', type: 'service' }],
        edges: [],
      }),
    });
    global.fetch = mockFetch;

    const topology = await getAgentTopology(' checkout -> payments ', '42', { maxNodes: 75, maxEdges: 150 });

    expect(topology.nodes).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/plugins/consensys-asko11y-app/resources/api/agent/topology?query=checkout+-%3E+payments&maxNodes=75&maxEdges=150',
      {
        headers: {
          'X-Grafana-Org-Id': '42',
        },
      }
    );
  });

  it('throws a user-facing error on non-OK responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('backend unavailable'),
    });

    await expect(getAgentTopology()).rejects.toThrow('Failed to load service graph (500): backend unavailable');
  });
});
