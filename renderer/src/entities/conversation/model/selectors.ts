import type { BotTriggerResultItem } from '@/entities/bot';
import type { MessageData } from '@/entities/message';
import type { ChatChannel, ConversationUiState } from './types';

const HIDDEN_BOT_TRIGGER_REASONS = new Set([
  '未被 @，本次不回复',
  '该消息已有 bot 回复',
]);

export function getConversationContextMetadata(metadata?: Record<string, unknown> | null) {
  const raw = metadata && typeof metadata === 'object' ? metadata : {};
  return {
    activeTopicId: typeof raw.activeTopicId === 'string' ? raw.activeTopicId : '',
    activeIdentityId: typeof raw.activeIdentityId === 'string' ? raw.activeIdentityId : '',
    directBotId: typeof raw.directBotId === 'string' ? raw.directBotId : '',
    directBotName: typeof raw.directBotName === 'string' ? raw.directBotName : '',
    conversationMode: typeof raw.conversationMode === 'string' ? raw.conversationMode : '',
  };
}

export function isDirectConversationMetadata(metadata?: Record<string, unknown> | null) {
  const context = getConversationContextMetadata(metadata);
  return Boolean(context.directBotId || context.conversationMode === 'direct-bot');
}

export function getConversationUiState(metadata?: Record<string, unknown> | null): ConversationUiState {
  const rawUiState = metadata && typeof metadata === 'object' && metadata.uiState && typeof metadata.uiState === 'object'
    ? metadata.uiState as Record<string, unknown>
    : null;
  const rawThread = rawUiState?.thread && typeof rawUiState.thread === 'object'
    ? rawUiState.thread as Record<string, unknown>
    : null;
  const rawScrollTop = Number(rawUiState?.messageScrollTop);

  return {
    messageScrollTop: Number.isFinite(rawScrollTop) && rawScrollTop >= 0 ? rawScrollTop : 0,
    thread: {
      open: Boolean(rawThread?.open || rawThread?.messageId),
      messageId: typeof rawThread?.messageId === 'string' && rawThread.messageId.trim()
        ? rawThread.messageId.trim()
        : null,
      blockId: typeof rawThread?.blockId === 'string' && rawThread.blockId.trim()
        ? rawThread.blockId.trim()
        : undefined,
      subItemIndex: Number.isInteger(rawThread?.subItemIndex) ? Number(rawThread?.subItemIndex) : undefined,
      isCollapsed: Boolean(rawThread?.isCollapsed),
    },
  };
}

export function getChannelRankTime(channel: ChatChannel) {
  if (typeof channel.lastMessageAt === 'number' && channel.lastMessageAt > 0) return channel.lastMessageAt;
  return channel.messages[channel.messages.length - 1]?.time || 0;
}

export function sortMainChannels(channels: ChatChannel[]) {
  return [...channels].sort((left, right) => {
    const pinDelta = Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned));
    if (pinDelta !== 0) return pinDelta;
    return getChannelRankTime(right) - getChannelRankTime(left);
  });
}

export function sortByRecent(channels: ChatChannel[]) {
  return [...channels].sort((left, right) => getChannelRankTime(right) - getChannelRankTime(left));
}

export function shouldDisplayBotTriggerResult(item: BotTriggerResultItem | null | undefined) {
  if (!item) return false;
  if (item.status === 'error') return true;
  if (item.status !== 'skipped') return false;
  return !HIDDEN_BOT_TRIGGER_REASONS.has(item.reason || '');
}

export function getVisibleBotTriggerResults(results: BotTriggerResultItem[] | null | undefined) {
  return Array.isArray(results)
    ? results.filter((item) => shouldDisplayBotTriggerResult(item))
    : [];
}

export function attachBotTriggerStatusToMessages(messages: MessageData[], triggerMessageId: string, results: BotTriggerResultItem[]) {
  const visibleResults = getVisibleBotTriggerResults(results);
  let changed = false;

  const nextMessages = messages.map((message) => {
    if (message.id !== triggerMessageId) return message;
    changed = true;
    const currentMetadata = message.metadata && typeof message.metadata === 'object'
      ? { ...message.metadata }
      : {};
    if (visibleResults.length > 0) {
      currentMetadata.botTriggerStatus = {
        updatedAt: Date.now(),
        items: visibleResults,
      };
    } else {
      delete currentMetadata.botTriggerStatus;
    }
    return {
      ...message,
      metadata: Object.keys(currentMetadata).length > 0 ? currentMetadata : null,
    };
  });

  return changed ? nextMessages : messages;
}
