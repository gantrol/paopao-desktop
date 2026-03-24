import { getLinkDisplayLabel } from '@/shared/lib/link';
import type {
  BubbleBlock,
  BubbleBlockType,
  BubbleDraftSource,
  MessageData,
  MsgType,
} from './types';

function normalizePreviewText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function slicePreview(text: string, maxLength = 36) {
  const normalized = normalizePreviewText(text);
  if (!normalized) return '';
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) return normalized;
  return `${chars.slice(0, maxLength).join('')}…`;
}

function normalizeFileLabel(fileName?: string, url?: string) {
  const label = typeof fileName === 'string' && fileName.trim()
    ? fileName.trim()
    : typeof url === 'string'
      ? url.trim()
      : '';
  return label;
}

export function flattenBubbleQuoteSnapshotBlocks(
  blocksInput: BubbleBlock[] | null | undefined,
  depth = 0,
): BubbleBlock[] {
  const blocks = normalizeBubbleBlocks(blocksInput);
  if (blocks.length === 0) return [];

  return blocks.flatMap((block) => {
    if (block.type !== 'quote' || !block.quote) {
      return [block];
    }
    if (depth >= 6) {
      return [];
    }
    return flattenBubbleQuoteSnapshotBlocks(block.quote.snapshotBlocks || [], depth + 1);
  });
}

export function getMessageStreamingState(message: MessageData | null | undefined) {
  const metadata = message?.metadata;
  if (!metadata || typeof metadata !== 'object') return '';
  const value = metadata.streamingState;
  return typeof value === 'string' ? value : '';
}

export function isMessageStreaming(message: MessageData | null | undefined) {
  return getMessageStreamingState(message) === 'streaming';
}

function blockTypeToLegacyType(type: BubbleBlockType): MsgType {
  if (type === 'image') return 'img';
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  if (type === 'file') return 'file';
  if (type === 'link') return 'link';
  if (type === 'location') return 'location';
  return 'text';
}

function buildLegacyFileContent(block: BubbleBlock) {
  return {
    name: normalizeFileLabel(block.fileName, block.url) || '文件',
    size: '未知',
    url: block.url,
  };
}

function normalizeBlockText(block: BubbleBlock) {
  if (block.type === 'text') return typeof block.text === 'string' ? block.text : '';
  if (block.type === 'file') return normalizeFileLabel(block.fileName, block.url);
  if (block.type === 'link') return typeof block.url === 'string' ? getLinkDisplayLabel(block.url) : '';
  if (block.type === 'quote' && block.quote) {
    return flattenBubbleQuoteSnapshotBlocks(block.quote.snapshotBlocks || [])
      .map((item) => getBubbleBlockPreviewText(item))
      .filter(Boolean)
      .join(' · ');
  }
  if (block.type === 'location') return block.location?.label || '[位置]';
  return typeof block.url === 'string' ? block.url : '';
}

export function normalizeBubbleBlocks(blocks: BubbleBlock[] | null | undefined) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block): block is BubbleBlock => Boolean(block && typeof block === 'object' && typeof block.id === 'string' && block.id.trim()))
    .map((block, index) => {
      const nextType = block.type;
      const nextBlock: BubbleBlock = {
        ...block,
        id: block.id || `block-${index}`,
        type: nextType,
        metadata: block.metadata && typeof block.metadata === 'object' ? { ...block.metadata } : null,
      };
      if (nextType === 'text') {
        nextBlock.text = typeof block.text === 'string' ? block.text : '';
      }
      if (nextType === 'image' || nextType === 'video' || nextType === 'audio' || nextType === 'file' || nextType === 'link') {
        nextBlock.url = typeof block.url === 'string' ? block.url : '';
      }
      if (nextType === 'file') {
        nextBlock.fileName = typeof block.fileName === 'string' ? block.fileName : undefined;
      }
      if (nextType === 'location') {
        nextBlock.location = block.location && typeof block.location === 'object'
          ? { ...block.location }
          : undefined;
      }
      if (nextType === 'quote' && block.quote) {
        nextBlock.quote = {
          relationKind: block.quote.relationKind === 'forward' ? 'forward' : 'quote',
          targetMessageId: block.quote.targetMessageId,
          targetBlockId: block.quote.targetBlockId,
          snapshotBlocks: normalizeBubbleBlocks(block.quote.snapshotBlocks || []),
        };
      }
      return nextBlock;
    });
}

function normalizeLegacyItem(item: { type?: string; val?: string; fileName?: string }, index: number): BubbleBlock | null {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'text') {
    return {
      id: `legacy-${index}`,
      type: 'text',
      text: item.val || '',
    };
  }
  if (item.type === 'img' || item.type === 'video' || item.type === 'audio' || item.type === 'link') {
    return {
      id: `legacy-${index}`,
      type: item.type === 'img' ? 'image' : item.type,
      url: item.val || '',
    };
  }
  if (item.type === 'file') {
    return {
      id: `legacy-${index}`,
      type: 'file',
      url: item.val || '',
      fileName: item.fileName,
    };
  }
  return null;
}

export function getMessageBlocks(message: MessageData | null | undefined): BubbleBlock[] {
  if (!message || typeof message !== 'object') return [];
  if (Array.isArray(message.blocks) && message.blocks.length > 0) {
    return normalizeBubbleBlocks(message.blocks);
  }

  if (message.type === 'compound' && Array.isArray(message.content)) {
    return message.content
      .map((item, index) => normalizeLegacyItem(item as { type?: string; val?: string; fileName?: string }, index))
      .filter((item): item is BubbleBlock => Boolean(item));
  }
  if (message.type === 'text') {
    const text = typeof message.content === 'string' ? message.content : '';
    return text ? [{ id: 'legacy-text', type: 'text', text }] : [];
  }
  if (message.type === 'img' || message.type === 'video' || message.type === 'audio' || message.type === 'link') {
    const url = typeof message.content === 'string' ? message.content : '';
    return url ? [{ id: `legacy-${message.type}`, type: message.type === 'img' ? 'image' : message.type, url }] : [];
  }
  if (message.type === 'file') {
    const content = message.content && typeof message.content === 'object' ? message.content as { name?: string; url?: string } : null;
    const url = typeof content?.url === 'string' ? content.url : '';
    const fileName = typeof content?.name === 'string' ? content.name : undefined;
    if (!url && !fileName) return [];
    return [{ id: 'legacy-file', type: 'file', url, fileName }];
  }
  if (message.type === 'location') {
    return [{ id: 'legacy-location', type: 'location', location: message.content as BubbleBlock['location'] }];
  }
  return [];
}

export function deriveLegacyShapeFromBlocks(blocksInput: BubbleBlock[] | null | undefined): { type: MsgType; content: unknown } {
  const blocks = normalizeBubbleBlocks(blocksInput);
  const renderableBlocks = blocks.filter((block) => block.type !== 'quote');

  if (renderableBlocks.length === 0) {
    return { type: 'text', content: '' };
  }

  if (renderableBlocks.length === 1) {
    const [block] = renderableBlocks;
    if (block.type === 'text') {
      return { type: 'text', content: block.text || '' };
    }
    if (block.type === 'file') {
      return { type: 'file', content: buildLegacyFileContent(block) };
    }
    if (block.type === 'location') {
      return { type: 'location', content: block.location || null };
    }
    return {
      type: blockTypeToLegacyType(block.type),
      content: block.url || '',
    };
  }

  return {
    type: 'compound',
    content: renderableBlocks.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', val: block.text || '' };
      }
      if (block.type === 'file') {
        return { type: 'file', val: block.url || '', fileName: block.fileName };
      }
      return {
        type: block.type === 'image' ? 'img' : block.type,
        val: block.url || '',
      };
    }),
  };
}

export function withNormalizedMessageBlocks(message: MessageData): MessageData {
  const blocks = getMessageBlocks(message);
  const legacy = deriveLegacyShapeFromBlocks(blocks);
  return {
    ...message,
    blocks,
    type: legacy.type,
    content: legacy.content,
  };
}

export function createTextBubbleBlock(text = ''): BubbleBlock {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    text,
  };
}

export function createMediaBubbleBlock(
  type: 'image' | 'video' | 'audio' | 'file' | 'link',
  url: string,
  options?: { fileName?: string; mimeType?: string },
): BubbleBlock {
  return {
    id: crypto.randomUUID(),
    type,
    url,
    fileName: options?.fileName,
    mimeType: options?.mimeType,
  };
}

export function createQuoteBubbleBlock(source: BubbleDraftSource): BubbleBlock {
  return {
    id: crypto.randomUUID(),
    type: 'quote',
    quote: {
      relationKind: source.relationKind,
      targetMessageId: source.targetMessageId,
      targetBlockId: source.targetBlockId,
      snapshotBlocks: normalizeBubbleBlocks(source.snapshotBlocks),
    },
  };
}

export function findMessageBlock(message: MessageData | null | undefined, blockId?: string | null) {
  if (!blockId) return null;
  return getMessageBlocks(message).find((block) => block.id === blockId) || null;
}

export function getMessageTextContent(message: MessageData | null | undefined) {
  return getMessageBlocks(message)
    .map((block) => normalizeBlockText(block))
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function getBubbleBlockPreviewText(block: BubbleBlock | null | undefined): string {
  if (!block) return '';
  if (block.type === 'text') return slicePreview(block.text || '');
  if (block.type === 'image') return '[图片]';
  if (block.type === 'video') return '[视频]';
  if (block.type === 'audio') return '[音频]';
  if (block.type === 'location') return '[位置]';
  if (block.type === 'link') {
    const label = typeof block.url === 'string' ? getLinkDisplayLabel(block.url) : '';
    return label ? `[链接] ${slicePreview(label, 24)}` : '[链接]';
  }
  if (block.type === 'file') {
    const label = normalizeFileLabel(block.fileName, block.url);
    return label ? `[文件] ${slicePreview(label, 24)}` : '[文件]';
  }
  if (block.type === 'quote') {
    const label = block.quote?.relationKind === 'forward' ? '转发' : '引用';
    const preview = flattenBubbleQuoteSnapshotBlocks(block.quote?.snapshotBlocks || [])
      .map((item) => getBubbleBlockPreviewText(item))
      .filter(Boolean)
      .join(' · ');
    return preview ? `[${label}] ${slicePreview(preview, 30)}` : `[${label}]`;
  }
  return '';
}

export function buildMessagePreviewText(message: MessageData | null | undefined) {
  if (!message || typeof message !== 'object') return '';
  const parts = getMessageBlocks(message)
    .map((block) => getBubbleBlockPreviewText(block))
    .filter(Boolean);

  if (parts.length > 0) {
    return slicePreview(parts.join(' · '), 42);
  }
  if (isMessageStreaming(message)) {
    return '正在输入…';
  }
  if (message.status === 'error') {
    return '生成失败';
  }
  return '';
}
