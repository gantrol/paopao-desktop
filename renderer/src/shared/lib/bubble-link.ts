import {
  createQuoteBubbleBlock,
  normalizeBubbleBlocks,
  type BubbleBlock,
} from '@/entities/message';
import { buildQuote } from '@/shared/api/desktop/chat';
import { normalizeLinkInput } from '@/shared/lib/link';

const BUBBLE_LINK_PROTOCOL = 'paopao:';
const BUBBLE_LINK_HOST = 'bubble';

export interface BubbleLinkTarget {
  conversationId: string;
  messageId: string;
  blockId?: string;
}

interface QuoteSnapshotPayload {
  targetMessageId?: string;
  targetBlockId?: string;
  snapshotBlocks?: BubbleBlock[] | null;
}

export function buildBubbleLink(target: BubbleLinkTarget): string {
  const url = new URL(`${BUBBLE_LINK_PROTOCOL}//${BUBBLE_LINK_HOST}`);
  url.pathname = `/${encodeURIComponent(target.conversationId)}/${encodeURIComponent(target.messageId)}`;
  if (target.blockId) {
    url.searchParams.set('blockId', target.blockId);
  }
  return url.toString();
}

export function parseBubbleLink(value: unknown): BubbleLinkTarget | null {
  const normalized = normalizeLinkInput(value);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== BUBBLE_LINK_PROTOCOL || parsed.hostname !== BUBBLE_LINK_HOST) {
      return null;
    }

    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    const conversationId = segments[0] || parsed.searchParams.get('conversationId') || '';
    const messageId = segments[1] || parsed.searchParams.get('messageId') || '';
    const blockId = parsed.searchParams.get('blockId') || undefined;

    if (!conversationId || !messageId) return null;
    return {
      conversationId,
      messageId,
      blockId,
    };
  } catch {
    return null;
  }
}

function getBubbleLinkTargetFromBlock(block: BubbleBlock): BubbleLinkTarget | null {
  if (block.type === 'text') {
    return parseBubbleLink(block.text);
  }
  if (block.type === 'link') {
    return parseBubbleLink(block.url);
  }
  return null;
}

async function resolveBubbleLinkTargetAsQuoteBlock(target: BubbleLinkTarget): Promise<BubbleBlock | null> {
  const payload = await buildQuote({
    conversationId: target.conversationId,
    messageId: target.messageId,
    blockId: target.blockId,
  }) as QuoteSnapshotPayload;

  if (!payload?.targetMessageId) return null;
  return createQuoteBubbleBlock({
    relationKind: 'quote',
    targetMessageId: payload.targetMessageId,
    targetBlockId: payload.targetBlockId,
    snapshotBlocks: normalizeBubbleBlocks(payload.snapshotBlocks || []),
  });
}

export async function resolveBubbleLinkBlocksForSubmit(
  blocksInput: BubbleBlock[] | null | undefined,
): Promise<BubbleBlock[]> {
  const blocks = normalizeBubbleBlocks(blocksInput);
  if (blocks.length === 0) return blocks;

  const quoteBlockCache = new Map<string, Promise<BubbleBlock | null>>();

  const resolvedBlocks = await Promise.all(blocks.map(async (block) => {
    const target = getBubbleLinkTargetFromBlock(block);
    if (!target) return block;

    const cacheKey = buildBubbleLink(target);
    if (!quoteBlockCache.has(cacheKey)) {
      quoteBlockCache.set(cacheKey, resolveBubbleLinkTargetAsQuoteBlock(target).catch(() => null));
    }

    const quoteBlockPromise = quoteBlockCache.get(cacheKey);
    if (!quoteBlockPromise) return block;
    return await quoteBlockPromise || block;
  }));

  return normalizeBubbleBlocks(resolvedBlocks);
}
