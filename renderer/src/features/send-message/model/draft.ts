import type { BubbleBlock, BubbleDraftSource, BubbleTargetRef } from '@/entities/message';

export interface CompoundEditorItem {
  id: string;
  type: 'text' | 'img' | 'video' | 'audio' | 'link' | 'file';
  val: string;
  fileName?: string;
}

export type QuoteState = {
  targetMessageId: string;
  targetBlockId?: string;
  snapshotBlocks: BubbleBlock[];
  msgId?: string;
  subItemIndex?: number;
  media?: string | null;
  mediaType?: 'img' | 'video' | 'audio' | 'link' | 'file' | null;
  text?: string | null;
};

export type DraftState = {
  text: string;
  items: CompoundEditorItem[];
  blocks?: BubbleBlock[];
  quoteSource?: BubbleDraftSource;
  forwardSource?: BubbleDraftSource;
  replyTarget?: BubbleTargetRef;
  quote?: QuoteState;
};

export function createEmptyDraftState(): DraftState {
  return {
    text: '',
    items: [],
  };
}

export function buildThreadDraftKey(conversationId: string, messageId: string, blockId?: string) {
  return `${conversationId}:${messageId}:${blockId ?? 'root'}`;
}

export function classifyMessageFile(file: File, url: string): CompoundEditorItem {
  if (file.type.startsWith('image/')) return { id: crypto.randomUUID(), type: 'img', val: url, fileName: file.name };
  if (file.type.startsWith('video/')) return { id: crypto.randomUUID(), type: 'video', val: url, fileName: file.name };
  if (file.type.startsWith('audio/')) return { id: crypto.randomUUID(), type: 'audio', val: url, fileName: file.name };
  return { id: crypto.randomUUID(), type: 'file', val: url, fileName: file.name };
}

export function sanitizeDraftItems(items: CompoundEditorItem[]) {
  return items
    .map((item) => {
      const value = typeof item.val === 'string' ? item.val.trim() : '';
      if (item.type === 'text' || item.type === 'link' || item.type === 'file') {
        return { ...item, val: value };
      }
      return { ...item, val: item.val };
    })
    .filter((item) => {
      if (item.type === 'text' || item.type === 'link' || item.type === 'file') {
        return Boolean(item.val.trim());
      }
      return Boolean(item.val);
    });
}
