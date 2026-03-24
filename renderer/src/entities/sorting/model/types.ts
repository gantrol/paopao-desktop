import type { MouseEvent } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type {
  BubbleBlock,
  BubbleDraftSource,
  MessageData,
} from '@/entities/message';
import type {
  SortingBoxView,
  SortingCardView,
} from './core';

export interface SortingSourceBubble {
  key: string;
  streamId: string;
  streamTitle: string;
  bubble: MessageData;
}

export interface SortingBubbleDraft {
  text: string;
  items: SortingComposerItem[];
  blocks?: BubbleBlock[];
  quoteSource?: BubbleDraftSource;
  forwardSource?: BubbleDraftSource;
}

export interface SortingComposerItem {
  id: string;
  type: 'text' | 'img' | 'video' | 'audio' | 'link' | 'file';
  val: string;
  fileName?: string;
}

export type SortingBubbleBlock = BubbleBlock;
export type SortingBubbleDraftBlock = BubbleBlock;

export interface SortingBubbleSourceInfo {
  // 来源: 实际被引用的泡泡主键（streamId:bubbleId）
  keys: string[];
  // 源头: 人类可读的归属标签（手动说明优先，其次会话名）
  labels: string[];
  originText: string;
  referenceCount: number;
}

export interface SortingFlowNodeData extends Record<string, unknown> {
  itemId: string;
  itemType: SortingCardView['type'];
}

export interface SortingCanvasContextValue {
  itemMap: Record<string, SortingCardView>;
  boxes: SortingBoxView[];
  sourceInfoMap: Record<string, SortingBubbleSourceInfo>;
  editingBubbleId: string | null;
  editingBubbleDraft: SortingBubbleDraft | null;
  onStartEditBubble: (item: SortingCardView) => void;
  onBubbleDraftChange: (patch: Partial<SortingBubbleDraft>) => void;
  onSaveEditingBubble: () => void;
  onCancelEditingBubble: () => void;
  onOpenNodeMenu: (event: MouseEvent<HTMLDivElement>, item: SortingCardView) => void;
  onOpenCardCommentPicker: (item: SortingCardView) => void;
  onOpenBox: (boxId: string) => void;
}

export type SortingFlowNode = Node<SortingFlowNodeData, 'sortingBubble'>;
export type SortingFlowEdge = Edge<Record<string, never>>;
