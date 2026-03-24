import type { ChatLifecycleStatus, ChatRecord } from '@/entities/conversation';
import type { MessageData } from '@/entities/message';

export type BotRuntimeType = 'llm' | 'external-codex';
export type BotTriggerMode = 'auto' | 'mention' | 'manual';
export type BotOutputMode = 'stream-reply' | 'thread-comment';

export interface BotBindingRecord {
  conversationId: string;
  botId: string;
  enabled: boolean;
  replyMode: string;
  triggerMode: BotTriggerMode;
  outputMode: BotOutputMode;
  alias?: string;
  sortOrder?: number;
  metadata?: Record<string, unknown> | null;
}

export interface BotIdentityBindingRecord {
  botId: string;
  identityId: string;
  enabled: boolean;
  relationPrompt: string;
  metadata?: Record<string, unknown> | null;
}

export interface BotRecord {
  id: string;
  name: string;
  slug?: string;
  introduction?: string;
  avatarUrl?: string;
  avatarPreset?: string;
  providerId?: string;
  providerName?: string;
  providerBaseUrl?: string;
  providerDefaultModel?: string;
  providerEnabled?: boolean | null;
  providerHasApiKey?: boolean;
  providerApiKeyStorage?: string;
  providerMetadata?: Record<string, unknown> | null;
  model?: string;
  runtimeType: BotRuntimeType;
  runtimeConfig?: Record<string, unknown> | null;
  systemPrompt: string;
  enabled: boolean;
  sortOrder?: number;
  metadata?: Record<string, unknown> | null;
  binding?: BotBindingRecord | null;
  identityBinding?: BotIdentityBindingRecord | null;
}

export interface BotConversationRecord {
  id: string;
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
  invited: boolean;
  isDirectConversation?: boolean;
  replyMode: 'auto' | 'mention';
  triggerMode: BotTriggerMode;
  outputMode: BotOutputMode;
  alias?: string;
  sortOrder?: number;
  binding?: BotBindingRecord | null;
}

export interface BotTriggerResultItem {
  botId: string;
  botName: string;
  status: 'replied' | 'skipped' | 'error';
  reason?: string;
  messageId?: string;
  model?: string;
}

export interface ConversationBotTriggerResult {
  conversation: ChatRecord;
  results: BotTriggerResultItem[];
}

export interface MachineRunTriggerResult {
  status: string;
  conversationId?: string;
  sourceMessageId?: string;
  botId?: string;
  runId?: string;
  messageId?: string;
  cancelled?: boolean;
}

export type ConversationBotStreamEvent =
  | {
    type: 'reply-start';
    conversationId: string;
    triggerMessageId: string;
    botId: string;
    botName: string;
    message: MessageData;
  }
  | {
    type: 'reply-delta';
    conversationId: string;
    triggerMessageId: string;
    botId: string;
    botName: string;
    messageId: string;
    delta: string;
    content: string;
    model?: string;
  }
  | {
    type: 'reply-complete';
    conversationId: string;
    triggerMessageId: string;
    botId: string;
    botName: string;
    messageId: string;
    content: string;
    model?: string;
  }
  | {
    type: 'reply-error';
    conversationId: string;
    triggerMessageId: string;
    botId: string;
    botName: string;
    messageId: string;
    error: string;
  };

export type MachineRunStreamEvent =
  | {
    type: 'run-start';
    runId: string;
    conversationId: string;
    sourceMessageId: string;
    targetBlockId?: string;
    botId: string;
    botName: string;
    runtimeType: BotRuntimeType;
    message: MessageData;
  }
  | {
    type: 'run-delta';
    runId: string;
    conversationId: string;
    sourceMessageId: string;
    targetBlockId?: string;
    botId: string;
    botName: string;
    runtimeType: BotRuntimeType;
    messageId: string;
    delta: string;
    content: string;
    model?: string;
  }
  | {
    type: 'run-complete';
    runId: string;
    conversationId: string;
    sourceMessageId: string;
    targetBlockId?: string;
    botId: string;
    botName: string;
    runtimeType: BotRuntimeType;
    messageId: string;
    content: string;
    model?: string;
  }
  | {
    type: 'run-error';
    runId: string;
    conversationId: string;
    sourceMessageId: string;
    targetBlockId?: string;
    botId: string;
    botName: string;
    runtimeType: BotRuntimeType;
    messageId: string;
    error: string;
  }
  | {
    type: 'run-requires-action';
    runId: string;
    conversationId: string;
    sourceMessageId: string;
    targetBlockId?: string;
    botId: string;
    botName: string;
    runtimeType: BotRuntimeType;
    messageId: string;
    reason: string;
    requestMethod?: string;
  };
