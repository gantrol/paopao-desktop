import type { MessageData } from '@/entities/message';
import { AI_AVATAR, DEFAULT_STREAM_AVATAR_PRESET, STREAM_AVATAR_PRESETS, USER_AVATAR } from '@/shared/config/avatar';

export function normalizeAvatarPreset(value?: string) {
  if (!value) return DEFAULT_STREAM_AVATAR_PRESET;
  if (value === 'assistant') return 'bubble';
  if (value === 'claude') return 'sun';
  if (value === 'gemini') return 'machine';
  return STREAM_AVATAR_PRESETS.some((preset) => preset.id === value) ? value : DEFAULT_STREAM_AVATAR_PRESET;
}

export function getMessageAvatarSrc(
  message: MessageData,
  options?: {
    userAvatarUrl?: string;
    conversationAvatarUrl?: string;
    fallbackAvatar?: string;
    forceConversationAvatar?: boolean;
  },
) {
  const userAvatarUrl = typeof options?.userAvatarUrl === 'string' && options.userAvatarUrl.trim()
    ? options.userAvatarUrl.trim()
    : USER_AVATAR;
  const conversationAvatarUrl = typeof options?.conversationAvatarUrl === 'string' && options.conversationAvatarUrl.trim()
    ? options.conversationAvatarUrl.trim()
    : '';
  const fallbackAvatar = typeof options?.fallbackAvatar === 'string' && options.fallbackAvatar.trim()
    ? options.fallbackAvatar.trim()
    : AI_AVATAR;
  const forceConversationAvatar = Boolean(options?.forceConversationAvatar);

  if (message.role === 'me') return userAvatarUrl;
  if (forceConversationAvatar && conversationAvatarUrl) return conversationAvatarUrl;
  if (typeof message.senderAvatarUrl === 'string' && message.senderAvatarUrl.trim()) {
    return message.senderAvatarUrl.trim();
  }
  if (conversationAvatarUrl) return conversationAvatarUrl;
  return fallbackAvatar;
}

export function getUserAvatarSrc(profile?: { avatarUrl?: string | null } | null) {
  return typeof profile?.avatarUrl === 'string' && profile.avatarUrl.trim()
    ? profile.avatarUrl.trim()
    : USER_AVATAR;
}
