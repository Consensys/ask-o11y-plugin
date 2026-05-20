import { formatModelLabel, listLLMModelOptions } from '../llmModels';

describe('llmModels', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('formats labels with provider model IDs', () => {
    expect(formatModelLabel('base', 'claude-haiku-4-5')).toBe('Base · claude-haiku-4-5');
    expect(formatModelLabel('large', 'claude-sonnet-4-6')).toBe('Large · claude-sonnet-4-6');
    expect(formatModelLabel('base')).toBe('Base');
  });

  it('lists supported model abstractions and maps configured provider IDs', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [{ id: 'base' }, { id: 'large' }, { id: 'custom' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          jsonData: {
            models: {
              default: 'large',
              mapping: {
                base: 'claude-haiku-4-5',
                large: 'claude-sonnet-4-6',
              },
            },
          },
        }),
      });

    await expect(listLLMModelOptions()).resolves.toEqual([
      {
        value: 'base',
        providerModel: 'claude-haiku-4-5',
        label: 'Base · claude-haiku-4-5',
        isDefault: false,
      },
      {
        value: 'large',
        providerModel: 'claude-sonnet-4-6',
        label: 'Large · claude-sonnet-4-6',
        isDefault: true,
      },
    ]);
  });

  it('falls back to base and large when the models endpoint is empty', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ jsonData: { models: { default: 'base', mapping: {} } } }),
      });

    const options = await listLLMModelOptions();

    expect(options.map((option) => option.value)).toEqual(['base', 'large']);
    expect(options[0].isDefault).toBe(true);
  });

  it('lists available models without provider labels when settings are unavailable', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [{ id: 'base' }, { id: 'large' }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

    await expect(listLLMModelOptions()).resolves.toEqual([
      { value: 'base', providerModel: undefined, label: 'Base', isDefault: false },
      { value: 'large', providerModel: undefined, label: 'Large', isDefault: false },
    ]);
  });
});
