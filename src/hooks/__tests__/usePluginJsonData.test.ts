import { usePluginJsonData } from '../usePluginJsonData';
import { usePluginContext } from '@grafana/data';

// Mock the @grafana/data module
jest.mock('@grafana/data', () => ({
  usePluginContext: jest.fn(),
}));

describe('usePluginJsonData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return undefined when context is null', () => {
    (usePluginContext as jest.Mock).mockReturnValue(null);

    const result = usePluginJsonData();

    expect(result).toBeUndefined();
  });

  it('should return undefined when meta is missing', () => {
    (usePluginContext as jest.Mock).mockReturnValue({});

    const result = usePluginJsonData();

    expect(result).toBeUndefined();
  });

  it('should return undefined when jsonData is missing', () => {
    (usePluginContext as jest.Mock).mockReturnValue({
      meta: {},
    });

    const result = usePluginJsonData();

    expect(result).toBeUndefined();
  });

  it('should return jsonData when available', () => {
    const mockJsonData = {
      mcpServers: [],
      maxTokens: 5000,
      systemPromptSource: 'default' as const,
    };

    (usePluginContext as jest.Mock).mockReturnValue({
      meta: {
        jsonData: mockJsonData,
      },
    });

    const result = usePluginJsonData();

    expect(result).toEqual(mockJsonData);
  });
});

