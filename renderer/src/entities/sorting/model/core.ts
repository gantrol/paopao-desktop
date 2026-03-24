import type { MessageData } from '@/entities/message';

export interface SortingScopedBotBindingView {
  enabled: boolean;
  triggerMode: 'auto' | 'mention' | 'manual';
  outputMode: 'stream-reply' | 'thread-comment';
  alias?: string;
  metadata?: Record<string, unknown> | null;
}

export interface SortingBoxView {
  id: string;
  name: string;
  tone: string;
  description: string;
  viewMode?: 'kanban' | 'canvas' | 'table';
  botBindings?: Record<string, SortingScopedBotBindingView>;
}

export interface SortingLayerView {
  id: string;
  boxId: string;
  name: string;
  sortOrder?: number;
}

export interface SortingColumnView {
  id: string;
  boxId: string | null;
  boundLayerIds?: string[];
  instanceId?: string;
  instanceLayerId?: string | null;
  instanceLayerName?: string | null;
  name: string;
  kind?: string;
  systemKey?: string | null;
  sortOrder?: number;
}

export interface SortingCardView {
  id: string;
  columnId: string;
  layerId: string | null;
  type: 'card' | 'box';
  childBoxId?: string;
  sourceBubbleId?: string;
  sourceStreamId?: string;
  title?: string;
  content?: string;
  rawMessage?: MessageData;
  sourceIds?: string[];
  metadata?: Record<string, unknown> | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface SortingCanvasNodeView {
  id: string;
  boxId: string;
  cardId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface SortingCanvasEdgeView {
  id: string;
  boxId: string;
  fromCardId: string;
  toCardId: string;
  label?: string;
}

export interface SortingWorkspaceSourceSelectionView {
  selectedSourceIds: string[];
  focusedSourceId: string | null;
  sourceViewMode?: 'focused' | 'all-selected';
}

export interface SortingWorkspaceView {
  workspaceId: string;
  title: string;
  activeBoxId: string;
  luggageColumnId: string | null;
  sidebarSectionLayout?: {
    boxes: number;
    layers: number;
    sources: number;
  };
  selectedSourceIds: string[];
  focusedSourceId: string | null;
  sourceViewMode?: 'focused' | 'all-selected';
  boxSourceSelections?: Record<string, SortingWorkspaceSourceSelectionView>;
  selectedLayerIds: string[];
  currentLayerId: string | null;
  boxes: SortingBoxView[];
  layers: SortingLayerView[];
  columns: SortingColumnView[];
  columnItems: Record<string, string[]>;
  itemMap: Record<string, SortingCardView>;
  canvasNodes: SortingCanvasNodeView[];
  canvasEdges: SortingCanvasEdgeView[];
}

export interface SortingStream {
  id: string;
  title: string;
  messages: MessageData[];
}
