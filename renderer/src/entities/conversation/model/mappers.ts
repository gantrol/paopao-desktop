import { buildMessagePreviewText, type MessageData } from '@/entities/message';
import { formatTime } from '@/shared/lib/time';
import { normalizeAvatarPreset } from '@/shared/lib/avatar';
import type { ChatChannel, ChatLifecycleStatus, ChatRecord } from './types';

export function deriveChannelFromRecord(record: {
  chatId: string;
  title: string;
  avatar: string;
  avatarPreset?: string;
  avatarUrl?: string;
  lastMsg: string;
  lastTime: string;
  lastMessageAt?: number | null;
  lifecycleStatus?: ChatLifecycleStatus;
  isPinned?: boolean;
  isFolded?: boolean;
  isStalled?: boolean;
  messages: MessageData[];
  metadata?: Record<string, unknown> | null;
}): ChatChannel {
  const baseChannel: ChatChannel = {
    id: record.chatId,
    title: record.title,
    avatar: normalizeAvatarPreset(record.avatarPreset || record.avatar),
    avatarPreset: normalizeAvatarPreset(record.avatarPreset || record.avatar),
    avatarUrl: record.avatarUrl || '',
    lastMsg: record.lastMsg,
    lastTime: record.lastTime,
    lastMessageAt: record.lastMessageAt ?? null,
    lifecycleStatus: record.lifecycleStatus || 'flowing',
    isPinned: Boolean(record.isPinned),
    isFolded: Boolean(record.isFolded),
    isStalled: Boolean(record.isStalled),
    messages: record.messages,
    metadata: record.metadata || null,
  };

  return syncChannelSummary(baseChannel, record.messages);
}

export function upsertChannel(channels: ChatChannel[], nextChannel: ChatChannel): ChatChannel[] {
  const existing = channels.find((item) => item.id === nextChannel.id);
  if (!existing) return [nextChannel, ...channels];
  return channels.map((item) => (item.id === nextChannel.id ? nextChannel : item));
}

export function syncChannelSummary(channel: ChatChannel, messages: MessageData[]): ChatChannel {
  const nextMessages = [...messages].sort((left, right) => (left.time || 0) - (right.time || 0));
  const lastMessage = nextMessages[nextMessages.length - 1] || null;
  const lastMessageAt = typeof lastMessage?.time === 'number'
    ? lastMessage.time
    : channel.lastMessageAt ?? null;

  return {
    ...channel,
    messages: nextMessages,
    lastMsg: buildMessagePreviewText(lastMessage),
    lastMessageAt,
    lastTime: formatTime(lastMessageAt),
  };
}

export function mergeStreamingMessages(record: ChatRecord, overlays: Map<string, MessageData> | null | undefined): ChatRecord {
  if (!overlays || overlays.size === 0) return record;

  const nextMessages = Array.isArray(record.messages) ? [...record.messages] : [];
  overlays.forEach((overlayMessage, messageId) => {
    const existingIndex = nextMessages.findIndex((message) => message.id === messageId);
    if (existingIndex >= 0) {
      nextMessages[existingIndex] = overlayMessage;
      return;
    }
    nextMessages.push(overlayMessage);
  });
  nextMessages.sort((left, right) => (left.time || 0) - (right.time || 0));

  const lastMessage = nextMessages[nextMessages.length - 1] || null;
  const lastMessageAt = typeof lastMessage?.time === 'number'
    ? lastMessage.time
    : record.lastMessageAt ?? null;

  return {
    ...record,
    messages: nextMessages,
    lastMsg: buildMessagePreviewText(lastMessage),
    lastMessageAt,
    lastTime: formatTime(lastMessageAt),
  };
}
