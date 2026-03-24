export type MsgRole = 'me' | 'ai';
export type MsgType = 'text' | 'img' | 'video' | 'compound' | 'location' | 'audio' | 'file' | 'link';
export type BubbleBlockType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'link' | 'location' | 'quote';

export interface BubbleLocationValue {
  latitude: number;
  longitude: number;
  label?: string;
  address?: string;
}

export interface BubbleQuoteReference {
  relationKind: 'quote' | 'forward';
  targetMessageId: string;
  targetBlockId?: string;
  snapshotBlocks: BubbleBlock[];
}

export interface BubbleBlock {
  id: string;
  type: BubbleBlockType;
  text?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  location?: BubbleLocationValue;
  quote?: BubbleQuoteReference;
  metadata?: Record<string, unknown> | null;
}

export interface BubbleEngagement {
  commentCount: number;
  forwardCount: number;
  likeCount: number;
  likedByMe: boolean;
}

export interface BubbleTargetRef {
  messageId: string;
  blockId?: string;
}

export interface BubbleThreadNode {
  id: string;
  messageId: string;
  blockId?: string;
}

export interface BubbleDraftSource {
  relationKind: 'quote' | 'forward';
  targetMessageId: string;
  targetBlockId?: string;
  snapshotBlocks: BubbleBlock[];
}

export interface MessageData {
  id: string;
  role: MsgRole;
  type: MsgType;
  content: unknown;
  blocks?: BubbleBlock[];
  time: number | null;
  status?: 'sending' | 'streaming' | 'error' | 'success';
  tips?: string;
  senderId?: string;
  senderName?: string;
  senderAvatarUrl?: string;
  senderAvatarPreset?: string;
  replyToMessageId?: string;
  commentTarget?: BubbleTargetRef | null;
  engagement?: BubbleEngagement | null;
  metadata?: Record<string, unknown> | null;
}

export interface CompoundItem {
  type: 'text' | 'img' | 'video' | 'audio' | 'link' | 'file';
  val: string;
  fileName?: string;
}
