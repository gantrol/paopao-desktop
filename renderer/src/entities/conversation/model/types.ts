import type { MessageData } from '@/entities/message';

export type ChatLifecycleStatus = 'flowing' | 'archived' | 'deleted';
export type ListViewMode = 'main' | 'folded';

export interface ChatSummary {
  id: string;
  title: string;
  avatar: string;
  avatarPreset?: string;
  avatarUrl?: string;
  lastMsg: string;
  lastTime: string;
  lastMessageAt?: number | null;
  messageCount: number;
  lifecycleStatus?: ChatLifecycleStatus;
  isPinned?: boolean;
  isFolded?: boolean;
  isStalled?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface ChatRecord {
  chatId: string;
  title: string;
  avatar: string;
  avatarPreset?: string;
  avatarUrl?: string;
  lastMsg: string;
  lastTime: string;
  lastMessageAt?: number | null;
  messages: MessageData[];
  lifecycleStatus?: ChatLifecycleStatus;
  isPinned?: boolean;
  isFolded?: boolean;
  isStalled?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface ChatChannel {
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
  isStalled?: boolean;
  messages: MessageData[];
  metadata?: Record<string, unknown> | null;
}

export interface ConversationThreadUiState {
  open: boolean;
  messageId: string | null;
  blockId?: string;
  subItemIndex?: number;
  isCollapsed: boolean;
}

export interface ConversationUiState {
  messageScrollTop: number;
  thread: ConversationThreadUiState;
}
