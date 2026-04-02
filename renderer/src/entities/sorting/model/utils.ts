import { MarkerType } from '@xyflow/react';
import {
  buildMessagePreviewText as buildSharedMessagePreviewText,
  createMediaBubbleBlock,
  createTextBubbleBlock,
  deriveLegacyShapeFromBlocks,
  getBubbleBlockPreviewText,
  getMessageBlocks as getSharedMessageBlocks,
  normalizeBubbleBlocks,
  type BubbleBlock,
  type MessageData,
} from '@/entities/message';
import {
  buildDraftStateFromBlocks,
  getDraftMessageBlocks,
} from '@/features/send-message/model/bubbleDraft';
import { formatTime } from '@/shared/lib/time';
import { getLinkDisplayLabel } from '@/shared/lib/link';
import type {
  SortingBoxView,
  SortingCanvasEdgeView,
  SortingCanvasNodeView,
  SortingCardView,
  SortingColumnView,
  SortingLayerView,
  SortingStream,
} from './core';
import {
  CANVAS_DEFAULT_HEIGHT,
  CANVAS_DEFAULT_WIDTH,
  CANVAS_EDGE_COLOR,
} from './constants';
import type {
  SortingBubbleDraft,
  SortingBubbleBlock,
  SortingBubbleSourceInfo,
  SortingFlowEdge,
  SortingFlowNode,
} from './types';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function arrayEquals(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item: { type?: string; val?: string; fileName?: string }) => (
        item?.type === 'file'
          ? (item.fileName || item.val || '')
          : (item?.val || '')
      ))
      .join(' ')
      .trim();
  }
  if (content && typeof content === 'object' && 'name' in content) return String((content as { name?: string }).name || '').trim();
  return '';
}

export function normalizeTextForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeSortingColumnName(columnId: string | null | undefined, name: string) {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName) return '';
  const normalizedColumnId = typeof columnId === 'string' ? columnId.trim() : '';
  if ((normalizedColumnId === 'l_prog_todo' || normalizedColumnId.endsWith(':l_prog_todo')) && normalizedName === '开发 Todo') {
    return '开发任务';
  }
  return normalizedName;
}

function normalizePreviewText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function getFileLabel(value: unknown) {
  if (value && typeof value === 'object' && 'name' in value) {
    const fileName = String((value as { name?: string }).name || '').trim();
    if (fileName) return fileName;
  }
  const fallback = extractText(value);
  return fallback || '';
}

function getLinkLabel(value: unknown) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return getLinkDisplayLabel(trimmed);
}

export function buildMessagePreviewText(message: MessageData): string {
  return buildSharedMessagePreviewText(message);
}

export function getMessageBlocks(message: MessageData | null | undefined): SortingBubbleBlock[] {
  return getSharedMessageBlocks(message);
}

export function sanitizeBubbleBlocks(blocks: Array<Partial<SortingBubbleBlock> | null | undefined>): SortingBubbleBlock[] {
  const normalized = blocks.reduce<BubbleBlock[]>((result, block, index) => {
    if (!block || typeof block !== 'object') return result;

    const bubbleLike = normalizeBubbleBlocks([block as BubbleBlock]);
    if (bubbleLike.length > 0) {
      result.push(...bubbleLike);
      return result;
    }

    const rawType = typeof (block as { type?: unknown }).type === 'string'
      ? (block as { type: string }).type
      : '';
    const blockId = typeof (block as { id?: string }).id === 'string' && (block as { id?: string }).id?.trim()
      ? (block as { id: string }).id.trim()
      : `sorting-block-${index}`;

    if (rawType === 'text') {
      result.push({
        id: blockId,
        type: 'text',
        text: typeof (block as { val?: string }).val === 'string' ? (block as { val: string }).val : '',
      });
      return result;
    }

    if (rawType === 'img' || rawType === 'video' || rawType === 'audio' || rawType === 'link' || rawType === 'file') {
      result.push({
        id: blockId,
        type: rawType === 'img' ? 'image' : rawType,
        url: typeof (block as { val?: string }).val === 'string' ? (block as { val: string }).val : '',
        fileName: typeof (block as { fileName?: string }).fileName === 'string' ? (block as { fileName: string }).fileName : undefined,
      });
    }

    return result;
  }, []);

  return normalizeBubbleBlocks(normalized).filter((block) => {
    if (block.type === 'text') return Boolean(block.text?.trim());
    if (block.type === 'file') return Boolean((block.url || '').trim() || block.fileName?.trim());
    if (block.type === 'link') return Boolean((block.url || '').trim());
    if (block.type === 'image' || block.type === 'video' || block.type === 'audio') return Boolean((block.url || '').trim());
    if (block.type === 'quote') return Boolean(block.quote?.targetMessageId);
    return true;
  });
}

export function createDraftBlock(
  input?: Partial<SortingBubbleBlock> & { id?: string | null },
): SortingBubbleBlock {
  const rawType = typeof (input as { type?: unknown })?.type === 'string'
    ? (input as { type: string }).type
    : '';

  if (rawType === 'video' || rawType === 'audio' || rawType === 'file' || rawType === 'link') {
    return createMediaBubbleBlock(
      rawType,
      typeof (input as { url?: string }).url === 'string'
        ? (input as { url: string }).url
        : (typeof (input as { val?: string }).val === 'string' ? (input as { val: string }).val : ''),
      {
        fileName: typeof input?.fileName === 'string' ? input.fileName : undefined,
      },
    );
  }
  if (rawType === 'img' || rawType === 'image') {
    return createMediaBubbleBlock('image', typeof (input as { url?: string }).url === 'string'
      ? (input as { url: string }).url
      : (typeof (input as { val?: string }).val === 'string' ? (input as { val: string }).val : ''), {
      fileName: typeof input?.fileName === 'string' ? input.fileName : undefined,
    });
  }
  return createTextBubbleBlock(typeof (input as { text?: string }).text === 'string'
    ? (input as { text: string }).text
    : (typeof (input as { val?: string }).val === 'string' ? (input as { val: string }).val : ''));
}

export function buildDraftBlocks(blocks: Array<Partial<SortingBubbleBlock> | null | undefined>): SortingBubbleBlock[] {
  const normalized = sanitizeBubbleBlocks(blocks);
  if (normalized.length === 0) {
    return [createTextBubbleBlock('')];
  }
  return normalized.map((block) => ({ ...block }));
}

function formatBubbleTextByMessage(message: MessageData): string {
  if (message.type !== 'compound' || !Array.isArray(message.content)) {
    return extractText(message.content);
  }

  const blocks = message.content
    .map((item: { type?: string; val?: string }) => {
      const value = typeof item?.val === 'string' ? item.val.trim() : '';
      if (!value) return '';
      if (item.type === 'text' || item.type === 'link') return value;
      if (item.type === 'img') return `[图片] ${value}`;
      if (item.type === 'video') return `[视频] ${value}`;
      if (item.type === 'audio') return `[音频] ${value}`;
      if (item.type === 'file') return `[文件] ${value}`;
      return value;
    })
    .filter(Boolean);

  return blocks.join('\n\n');
}

function extractEditedBlocks(item: SortingCardView): SortingBubbleBlock[] {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : null;
  const editedBlocks = Array.isArray(metadata?.editedBlocks)
    ? sanitizeBubbleBlocks(metadata.editedBlocks as Array<Partial<SortingBubbleBlock>>)
    : [];
  return editedBlocks;
}

function buildMessageFromBlocks(blocks: SortingBubbleBlock[], base?: Partial<MessageData>): MessageData {
  const sanitizedBlocks = sanitizeBubbleBlocks(blocks);
  const legacy = deriveLegacyShapeFromBlocks(sanitizedBlocks);
  return {
    id: base?.id || crypto.randomUUID(),
    role: base?.role === 'ai' ? 'ai' : 'me',
    time: base?.time ?? Date.now(),
    blocks: sanitizedBlocks,
    type: legacy.type,
    content: legacy.content,
  };
}

export function buildDraftBubbleMessage(draft: SortingBubbleDraft, base?: Partial<MessageData>): MessageData {
  return buildMessageFromBlocks(getDraftMessageBlocks(draft), base);
}

export function buildBubbleContentSummary(blocks: SortingBubbleBlock[]) {
  return buildSharedMessagePreviewText(buildMessageFromBlocks(blocks, {
    id: 'preview',
    role: 'me',
    time: Date.now(),
  }));
}

export function buildBubblePreviewTitle(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '未命名泡泡';
  return normalized.slice(0, 22) + (normalized.length > 22 ? '…' : '');
}

export function buildSourceBubbleKey(streamId: string, bubbleId: string) {
  return `${streamId}:${bubbleId}`;
}

export function toSourceBubbleDraggableId(streamId: string, bubbleId: string) {
  return `bubble::${encodeURIComponent(streamId)}::${encodeURIComponent(bubbleId)}`;
}

export function parseSourceBubbleDraggableId(draggableId: string) {
  if (!draggableId.startsWith('bubble::')) return null;
  const [, streamPart, bubblePart] = draggableId.split('::');
  if (!streamPart || !bubblePart) return null;
  return {
    streamId: decodeURIComponent(streamPart),
    bubbleId: decodeURIComponent(bubblePart),
  };
}

export function toSidebarBoxDraggableId(boxId: string) {
  return `sidebar-box::${encodeURIComponent(boxId)}`;
}

export function parseSidebarBoxDraggableId(draggableId: string) {
  if (!draggableId.startsWith('sidebar-box::')) return null;
  const boxIdPart = draggableId.slice('sidebar-box::'.length);
  if (!boxIdPart) return null;
  return {
    boxId: decodeURIComponent(boxIdPart),
  };
}

export function isSortingBoxShortcut(item: SortingCardView | null | undefined) {
  if (!item || item.type !== 'box') return false;
  const metadata = item.metadata;
  return Boolean(metadata && typeof metadata === 'object' && metadata.boxShortcut === true);
}

function hasEditedSortingContent(item: SortingCardView) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : null;
  return Boolean(metadata?.contentEdited);
}

export function getSortingCardTypeLabel(item: SortingCardView) {
  if (item.type === 'box') return isSortingBoxShortcut(item) ? '快捷方式' : '箱子入口';
  return '泡泡';
}

export function getBubbleDisplayContent(item: SortingCardView) {
  const editedBlocks = extractEditedBlocks(item);
  if (editedBlocks.length > 0) {
    return buildBubbleContentSummary(editedBlocks);
  }
  const contentValue = typeof item.content === 'string' ? item.content.trim() : '';
  if (item.rawMessage) {
    if (!hasEditedSortingContent(item)) return buildMessagePreviewText(item.rawMessage);
  }
  if (contentValue) return contentValue;
  return '';
}

export function getBubbleDisplayLength(item: SortingCardView) {
  return getBubbleDisplayContent(item).length;
}

export function getSortingCardBlocks(item: SortingCardView): SortingBubbleBlock[] {
  const sortingMessage = buildSortingBubbleMessage(item);
  return getMessageBlocks(sortingMessage);
}

export function isProjectedBubble(item: SortingCardView) {
  return item.type === 'card' && (
    Boolean(item.sourceBubbleId)
    || (Array.isArray(item.sourceIds) && item.sourceIds.length > 0)
  );
}

export function isBlankBubbleDraft(draft: SortingBubbleDraft | null) {
  if (!draft) return true;
  return sanitizeBubbleBlocks(getDraftMessageBlocks(draft)).length === 0;
}

export function formatDateTime(timestamp?: number) {
  if (!timestamp) return '刚刚';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);
  } catch {
    return formatTime(timestamp);
  }
}

export function getBoxBubbleCount(boxId: string, columns: SortingColumnView[], itemMap: Record<string, SortingCardView>) {
  const columnIds = new Set(columns.filter((column) => column.boxId === boxId).map((column) => column.id));
  return Object.values(itemMap).filter((item) => item.type === 'card' && columnIds.has(item.columnId)).length;
}

export function buildBubbleDraft(item: SortingCardView) {
  const editedBlocks = extractEditedBlocks(item);
  if (editedBlocks.length > 0) {
    return buildDraftStateFromBlocks(editedBlocks);
  }

  if (item.rawMessage) {
    return buildDraftStateFromBlocks(getMessageBlocks(item.rawMessage));
  }

  return buildDraftStateFromBlocks([createTextBubbleBlock(typeof item.content === 'string' ? item.content : '')]);
}

export function buildSortingBubbleMessage(item: SortingCardView): MessageData {
  const editedBlocks = extractEditedBlocks(item);
  if (editedBlocks.length > 0) {
    return buildMessageFromBlocks(editedBlocks, {
      id: item.id,
      role: 'me',
      time: item.updatedAt || item.createdAt || Date.now(),
    });
  }

  if (item.rawMessage && !hasEditedSortingContent(item)) {
    return {
      ...item.rawMessage,
      id: item.id,
      time: item.rawMessage.time ?? item.updatedAt ?? item.createdAt ?? Date.now(),
    };
  }

  return {
    id: item.id,
    role: 'me',
    type: 'text',
    content: typeof item.content === 'string' ? item.content : '',
    time: item.updatedAt || item.createdAt || Date.now(),
  };
}

export function buildBubbleMessagePayload(item: SortingCardView) {
  const editedBlocks = extractEditedBlocks(item);
  if (editedBlocks.length > 0) {
    return buildMessageFromBlocks(editedBlocks, {
      id: item.id,
      role: 'me',
      time: item.updatedAt || item.createdAt || Date.now(),
    });
  }

  if (item.rawMessage && !hasEditedSortingContent(item)) {
    return {
      ...item.rawMessage,
      type: item.rawMessage.type,
      content: item.rawMessage.content,
    };
  }
  return buildMessageFromBlocks([createTextBubbleBlock(typeof item.content === 'string' ? item.content.trim() : '')], {
    id: item.id,
    role: 'me',
    time: item.updatedAt || item.createdAt || Date.now(),
  });
}

function getSortingColumnBoundLayerIds(column: SortingColumnView) {
  const legacyColumn = column as SortingColumnView & {
    layerId?: string | null;
    layerIds?: string[];
  };
  if (Array.isArray(column.boundLayerIds)) {
    return column.boundLayerIds
      .filter((layerId): layerId is string => typeof layerId === 'string' && Boolean(layerId.trim()))
      .map((layerId) => layerId.trim());
  }
  if (Array.isArray(legacyColumn.layerIds)) {
    return legacyColumn.layerIds
      .filter((layerId): layerId is string => typeof layerId === 'string' && Boolean(layerId.trim()))
      .map((layerId) => layerId.trim());
  }
  if (typeof legacyColumn.layerId === 'string' && legacyColumn.layerId.trim()) {
    return [legacyColumn.layerId.trim()];
  }
  return [];
}

function resolveSortingCardLayerId(
  item: SortingCardView,
  columnLayerIds: string[],
) {
  if (item.layerId) return item.layerId;
  return columnLayerIds.length === 1 ? columnLayerIds[0] : null;
}

function getMaxBacktickRun(text: string) {
  let maxRun = 0;
  for (const match of text.matchAll(/`+/g)) {
    maxRun = Math.max(maxRun, match[0]?.length || 0);
  }
  return maxRun;
}

function wrapMarkdownFence(text: string) {
  const fence = '`'.repeat(Math.max(3, getMaxBacktickRun(text) + 1));
  return `${fence}markdown\n${text}\n${fence}`;
}

function buildLocationCopyText(block: SortingBubbleBlock) {
  const location = block.location;
  if (!location) return '[位置]';
  const parts: string[] = [];
  const label = typeof location.label === 'string' ? location.label.trim() : '';
  const address = typeof location.address === 'string' ? location.address.trim() : '';
  if (label) parts.push(label);
  if (address && address !== label) parts.push(address);
  if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    parts.push(`${location.latitude}, ${location.longitude}`);
  }
  return parts.length > 0 ? `[位置] ${parts.join(' - ')}` : '[位置]';
}

function serializeSortingBlockForLlm(block: SortingBubbleBlock) {
  if (block.type === 'text') {
    return typeof block.text === 'string' ? block.text : '';
  }
  if (block.type === 'image') {
    return block.url ? `[图片] ${block.url}` : '[图片]';
  }
  if (block.type === 'video') {
    return block.url ? `[视频] ${block.url}` : '[视频]';
  }
  if (block.type === 'audio') {
    return block.url ? `[音频] ${block.url}` : '[音频]';
  }
  if (block.type === 'file') {
    const label = block.fileName || block.url || '';
    return label ? `[文件] ${label}` : '[文件]';
  }
  if (block.type === 'link') {
    const url = typeof block.url === 'string' ? block.url.trim() : '';
    const label = url ? getLinkDisplayLabel(url) : '';
    if (label && url && label !== url) {
      return `[链接] ${label} - ${url}`;
    }
    if (label) return `[链接] ${label}`;
    return url ? `[链接] ${url}` : '[链接]';
  }
  if (block.type === 'location') {
    return buildLocationCopyText(block);
  }
  if (block.type === 'quote') {
    return getBubbleBlockPreviewText(block)
      || (block.quote?.relationKind === 'forward' ? '[转发]' : '[引用]');
  }
  return '';
}

export function serializeSortingCardForLlm(
  item: SortingCardView,
  sourceInfo?: SortingBubbleSourceInfo | null,
) {
  const blocks = getMessageBlocks(buildSortingBubbleMessage(item));
  const body = blocks
    .map((block) => serializeSortingBlockForLlm(block))
    .filter((part) => part.length > 0)
    .join('\n\n');

  return {
    sourceLabel: sourceInfo?.originText || '手动',
    body,
    fencedBody: wrapMarkdownFence(body),
  };
}

export function buildSelectedLayersCopyText({
  box,
  selectedLayers,
  columns,
  columnItems,
  itemMap,
  sourceInfoMap,
}: {
  box: SortingBoxView;
  selectedLayers: SortingLayerView[];
  columns: SortingColumnView[];
  columnItems: Record<string, string[]>;
  itemMap: Record<string, SortingCardView>;
  sourceInfoMap: Record<string, SortingBubbleSourceInfo>;
}) {
  const sections = [`# ${box.name || '未命名箱子'}`];
  let hasAnyCard = false;

  selectedLayers.forEach((layer) => {
    const layerSections: string[] = [];

    columns.forEach((column) => {
      const columnLayerIds = getSortingColumnBoundLayerIds(column);
      if (!columnLayerIds.includes(layer.id)) return;

      const cards = (columnItems[column.id] || [])
        .map((itemId) => itemMap[itemId])
        .filter((item): item is SortingCardView => Boolean(item))
        .filter((item) => item.type === 'card')
        .filter((item) => resolveSortingCardLayerId(item, columnLayerIds) === layer.id);

      if (cards.length === 0) return;

      hasAnyCard = true;
      const columnSections = [
        `### 列：${normalizeSortingColumnName(column.id, column.name) || '未命名列'}`,
      ];

      cards.forEach((item, index) => {
        const serialized = serializeSortingCardForLlm(item, sourceInfoMap[item.id] || null);
        columnSections.push(
          `#### 卡片 ${index + 1}`,
          `来源：${serialized.sourceLabel}`,
          serialized.fencedBody,
        );
      });

      layerSections.push(columnSections.join('\n\n'));
    });

    if (layerSections.length > 0) {
      sections.push(
        [`## 层：${layer.name}`, ...layerSections].join('\n\n'),
      );
    }
  });

  return hasAnyCard ? sections.join('\n\n') : '';
}



export function getBubbleSourceInfo(item: SortingCardView, streamsById: Map<string, SortingStream>): SortingBubbleSourceInfo {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : null;
  const manualLabel = typeof metadata?.sourceLabel === 'string' ? metadata.sourceLabel.trim() : '';
  const keys = Array.isArray(item.sourceIds) && item.sourceIds.length > 0
    ? [...new Set(item.sourceIds.filter((value): value is string => typeof value === 'string' && value.includes(':')))]
    : item.sourceBubbleId && item.sourceStreamId
      ? [buildSourceBubbleKey(item.sourceStreamId, item.sourceBubbleId)]
      : [];
  const derivedLabels = [...new Set(
    keys
      .map((key) => {
        const [streamId] = key.split(':');
        return streamsById.get(streamId)?.title || streamId || '';
      })
      .filter(Boolean),
  )];
  const labels = manualLabel
    ? [manualLabel, ...derivedLabels.filter((label) => label !== manualLabel)]
    : derivedLabels;
  return {
    keys,
    labels,
    originText: labels.join(' / '),
    referenceCount: keys.length,
  };
}

export function formatSortingSourceBadge(sourceInfo: SortingBubbleSourceInfo | null | undefined) {
  if (!sourceInfo || sourceInfo.referenceCount <= 0) return null;
  if (sourceInfo.referenceCount > 1) return `${sourceInfo.referenceCount} 来源`;
  return sourceInfo.labels[0] || '已引用';
}

export function defaultCanvasNode(item: SortingCardView, index: number, boxId: string): SortingCanvasNodeView {
  return {
    id: `${boxId}:${item.id}`,
    boxId,
    cardId: item.id,
    x: 56 + (index % 4) * 320,
    y: 56 + Math.floor(index / 4) * 228,
    width: CANVAS_DEFAULT_WIDTH,
    height: item.type === 'box' ? 136 : CANVAS_DEFAULT_HEIGHT,
    zIndex: index,
  };
}

export function buildSortingFlowNode(
  item: SortingCardView,
  layout: SortingCanvasNodeView,
  previousNode?: SortingFlowNode,
): SortingFlowNode {
  return {
    id: item.id,
    type: 'sortingBubble',
    data: {
      itemId: item.id,
      itemType: item.type,
    },
    position: { x: layout.x, y: layout.y },
    width: layout.width,
    height: layout.height,
    initialWidth: layout.width,
    initialHeight: layout.height,
    zIndex: layout.zIndex,
    selected: previousNode?.selected ?? false,
    dragging: previousNode?.dragging ?? false,
    draggable: true,
    selectable: true,
    connectable: item.type === 'card',
    deletable: false,
    dragHandle: '.s-flow-drag-handle',
    style: {
      width: layout.width,
      minHeight: layout.height,
    },
  };
}

export function buildSortingFlowEdge(
  edge: SortingCanvasEdgeView,
  previousEdge?: SortingFlowEdge,
): SortingFlowEdge {
  return {
    id: edge.id,
    source: edge.fromCardId,
    target: edge.toCardId,
    label: edge.label,
    selected: previousEdge?.selected ?? false,
    deletable: false,
    reconnectable: false,
    style: {
      stroke: CANVAS_EDGE_COLOR,
      strokeWidth: 2.2,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: CANVAS_EDGE_COLOR,
    },
  };
}

export function normalizeSortingFlowEdges(
  edges: Array<Pick<SortingCanvasEdgeView, 'id' | 'boxId' | 'fromCardId' | 'toCardId' | 'label'>>,
  validCardIds: Set<string>,
): SortingCanvasEdgeView[] {
  const seenPairs = new Set<string>();
  const normalized: SortingCanvasEdgeView[] = [];
  edges.forEach((edge) => {
    if (!validCardIds.has(edge.fromCardId) || !validCardIds.has(edge.toCardId)) return;
    if (edge.fromCardId === edge.toCardId) return;
    const pairKey = `${edge.fromCardId}::${edge.toCardId}`;
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);
    normalized.push({
      id: typeof edge.id === 'string' && edge.id.trim()
        ? edge.id
        : `edge_${edge.fromCardId}_${edge.toCardId}`,
      boxId: edge.boxId,
      fromCardId: edge.fromCardId,
      toCardId: edge.toCardId,
      label: edge.label,
    });
  });
  return normalized;
}

export function getSortingFlowNodeSize(node: SortingFlowNode) {
  const style = node.style && typeof node.style === 'object' ? node.style : null;
  const styleWidth = typeof style?.width === 'number' ? style.width : Number(style?.width) || 0;
  const styleHeight = typeof style?.minHeight === 'number' ? style.minHeight : Number(style?.minHeight) || 0;
  return {
    width: node.measured?.width || node.width || styleWidth || CANVAS_DEFAULT_WIDTH,
    height: node.measured?.height || node.height || styleHeight || CANVAS_DEFAULT_HEIGHT,
  };
}
