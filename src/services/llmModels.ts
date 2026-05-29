export type LLMModel = 'base' | 'large';
export type LLMModelSelection = 'auto' | LLMModel;

export interface LLMModelOption {
  value: LLMModelSelection;
  label: string;
  providerModel?: string;
  isDefault: boolean;
}

interface LLMModelDescriptor {
  id?: string;
  name?: string;
  model?: string;
}

type LLMModelsResponse = LLMModelDescriptor[] | {
  data?: LLMModelDescriptor[];
  models?: LLMModelDescriptor[];
};

interface LLMPluginSettingsResponse {
  jsonData?: {
    models?: {
      default?: string;
      mapping?: Record<string, string>;
    };
  };
}

const LLM_MODELS_URL = '/api/plugins/grafana-llm-app/resources/llm/v1/models';
const LLM_SETTINGS_URL = '/api/plugins/grafana-llm-app/settings';
const SUPPORTED_MODELS: LLMModel[] = ['base', 'large'];

function isLLMModel(value: string | undefined): value is LLMModel {
  return value === 'base' || value === 'large';
}

function modelTitle(model: LLMModel): string {
  return model === 'base' ? 'Base' : 'Large';
}

export function formatModelLabel(model: LLMModel, providerModel?: string): string {
  return providerModel ? `${modelTitle(model)} · ${providerModel}` : modelTitle(model);
}

export function formatModelSelectionLabel(model: LLMModelSelection, providerModel?: string): string {
  return model === 'auto' ? 'Auto' : formatModelLabel(model, providerModel);
}

function extractModelIDs(response: LLMModelsResponse): Array<string | undefined> {
  if (Array.isArray(response)) {
    return response.map((model) => model.id ?? model.name ?? model.model);
  }

  const models = response.data ?? response.models ?? [];
  return models.map((model) => model.id ?? model.name ?? model.model);
}

export async function listLLMModelOptions(): Promise<LLMModelOption[]> {
  const [modelsResp, settingsResp] = await Promise.all([
    fetch(LLM_MODELS_URL),
    fetch(LLM_SETTINGS_URL).catch(() => undefined),
  ]);

  if (!modelsResp.ok) {
    throw new Error(`Failed to list LLM models (${modelsResp.status})`);
  }

  const modelsData = (await modelsResp.json()) as LLMModelsResponse;
  const settingsData = settingsResp?.ok ? ((await settingsResp.json()) as LLMPluginSettingsResponse) : {};
  const mapping = settingsData.jsonData?.models?.mapping ?? {};

  const available = extractModelIDs(modelsData).filter(isLLMModel);
  const uniqueModels = Array.from(new Set(available.length > 0 ? available : SUPPORTED_MODELS));

  const explicitOptions = uniqueModels.map((model) => {
    const providerModel = mapping[model];
    return {
      value: model,
      providerModel,
      label: formatModelLabel(model, providerModel),
      isDefault: false,
    };
  });

  return [
    {
      value: 'auto',
      label: 'Auto',
      isDefault: true,
    },
    ...explicitOptions,
  ];
}
