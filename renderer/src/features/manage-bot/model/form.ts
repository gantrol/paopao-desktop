import type { BotRecord } from '@/entities/bot';
import type { AiProviderRecord } from '@/entities/provider';

export const NEW_BOT_ID = '__new_bot__';

export type BotFormState = {
  id?: string;
  name: string;
  slug?: string;
  introduction: string;
  avatarUrl: string;
  avatarPreset: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  enabled: boolean;
};

export function createEmptyBotForm(defaultProviderId = ''): BotFormState {
  return {
    name: '',
    introduction: '',
    avatarUrl: '',
    avatarPreset: 'machine',
    providerId: defaultProviderId,
    model: '',
    systemPrompt: '',
    enabled: true,
  };
}

export function toBotForm(bot: BotRecord, providers: AiProviderRecord[]): BotFormState {
  return {
    id: bot.id,
    name: bot.name || '',
    slug: bot.slug || '',
    introduction: bot.introduction || '',
    avatarUrl: bot.avatarUrl || '',
    avatarPreset: bot.avatarPreset || '',
    providerId: bot.providerId || providers[0]?.id || '',
    model: bot.model || bot.providerDefaultModel || '',
    systemPrompt: bot.systemPrompt || '',
    enabled: bot.enabled,
  };
}
