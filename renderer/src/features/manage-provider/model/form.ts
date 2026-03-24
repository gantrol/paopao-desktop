import type { AiProviderRecord } from '@/entities/provider';

export const NEW_PROVIDER_ID = '__new_provider__';

export type ProviderFormState = Omit<AiProviderRecord, 'id'> & { id?: string };

export function createEmptyProviderForm(): ProviderFormState {
  return {
    name: '',
    kind: 'openai-compatible',
    baseUrl: '',
    defaultModel: '',
    apiKeyRef: '',
    enabled: true,
  };
}

export function toProviderForm(provider: AiProviderRecord): ProviderFormState {
  return {
    id: provider.id,
    name: provider.name || '',
    kind: provider.kind || 'openai-compatible',
    baseUrl: provider.baseUrl || '',
    defaultModel: provider.defaultModel || '',
    apiKeyRef: '',
    enabled: provider.enabled,
  };
}

export function getProviderModelLabel(provider: AiProviderRecord | null, modelName: string) {
  const providerName = provider?.name?.trim().toLowerCase() || '';
  if (providerName.includes('kimi')) {
    if (modelName === 'kimi-k2.5') return 'KIMI 2.5';
    if (modelName === 'kimi-thinking-preview') return 'KIMI Thinking';
    if (modelName === 'kimi-k2-0905-preview') return 'KIMI K2';
    if (modelName === 'kimi-k2-turbo-preview') return 'KIMI K2 Turbo';
  }

  if (providerName.includes('deepseek')) {
    if (modelName === 'deepseek-chat') return 'DeepSeek 3.2';
    if (modelName === 'deepseek-reasoner') return 'DeepSeek 3.2 Reasoner';
  }

  return modelName;
}
