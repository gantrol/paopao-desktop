import type { ChatChannel } from '@/entities/conversation';
import {
  buildMessagePreviewText,
  getMessageBlocks,
  type BubbleBlock,
  type MessageData,
} from '@/entities/message';
import { getLinkDisplayLabel } from '@/shared/lib/link';

export type SearchScope = 'all' | 'streams' | 'comments' | 'sorting';
export type SearchMode = 'global' | 'local-stream' | 'local-sorting';

export type SearchResultType =
  | 'stream-message'
  | 'thread-reply'
  | 'stream-title'
  | 'sorting-card'
  | 'sorting-box'
  | 'sorting-layer'
  | 'sorting-column'
  | 'sorting-source';

export interface SearchRequest {
  query: string;
  scope: SearchScope;
  mode: SearchMode;
  offset: number;
  limit: number;
}

export interface SearchResultAction {
  label: string;
  target: SearchResultTarget;
}

export interface SearchResultTarget {
  type:
    | 'stream-message'
    | 'thread-reply'
    | 'stream-title'
    | 'sorting-result'
    | 'sorting-source';
  conversationId?: string;
  messageId?: string;
  blockId?: string;
  replyMessageId?: string;
  sorting?: SortingSearchLocatorPayload;
}

export interface SearchResult {
  id: string;
  type: SearchResultType;
  domain: 'stream' | 'sorting';
  sectionLabel: string;
  title: string;
  preview?: string;
  meta: string;
  time: number;
  score: number;
  contextScore: number;
  target: SearchResultTarget;
  auxiliaryAction?: SearchResultAction;
}

export interface SearchResponse {
  items: SearchResult[];
  total: number;
  hasMore: boolean;
}

export type SortingSearchProvider = (
  request: SearchRequest,
) => SearchResponse | Promise<SearchResponse>;

export interface SortingSearchLocatorPayload {
  type: SearchResultType;
  boxId?: string;
  layerId?: string;
  columnId?: string;
  itemId?: string;
  sourceBubbleKey?: string;
  sourceStreamId?: string;
  sourceMessageId?: string;
}

export type SortingSearchLocator = (
  payload: SortingSearchLocatorPayload,
) => void | Promise<void>;

const TITLE_EXACT_SCORE = 960;
const TITLE_PREFIX_SCORE = 900;
const TITLE_INCLUDE_SCORE = 840;
const CONTENT_EXACT_SCORE = 760;
const CONTENT_PREFIX_SCORE = 700;
const CONTENT_INCLUDE_SCORE = 640;
const META_INCLUDE_SCORE = 520;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeSearchQuery(value: string) {
  return normalizeWhitespace(value).toLocaleLowerCase();
}

function normalizeSearchText(value: string) {
  return normalizeWhitespace(value).toLocaleLowerCase();
}

export function paginateSearchResults(
  results: SearchResult[],
  offset: number,
  limit: number,
): SearchResponse {
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, limit);
  const items = results.slice(safeOffset, safeOffset + safeLimit);
  return {
    items,
    total: results.length,
    hasMore: safeOffset + safeLimit < results.length,
  };
}

export function compareSearchResults(left: SearchResult, right: SearchResult) {
  if (right.score !== left.score) return right.score - left.score;
  if (right.contextScore !== left.contextScore) {
    return right.contextScore - left.contextScore;
  }
  if (right.time !== left.time) return right.time - left.time;
  return left.title.localeCompare(right.title, 'zh-CN');
}

export function scoreSearchText(
  query: string,
  value: string,
  mode: 'title' | 'content' | 'meta',
): number {
  const normalizedQuery = normalizeSearchQuery(query);
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedQuery || !normalizedValue) return 0;
  if (normalizedValue === normalizedQuery) {
    if (mode === 'title') return TITLE_EXACT_SCORE;
    if (mode === 'content') return CONTENT_EXACT_SCORE;
    return META_INCLUDE_SCORE;
  }
  if (normalizedValue.startsWith(normalizedQuery)) {
    if (mode === 'title') return TITLE_PREFIX_SCORE;
    if (mode === 'content') return CONTENT_PREFIX_SCORE;
    return META_INCLUDE_SCORE;
  }
  if (normalizedValue.includes(normalizedQuery)) {
    if (mode === 'title') return TITLE_INCLUDE_SCORE;
    if (mode === 'content') return CONTENT_INCLUDE_SCORE;
    return META_INCLUDE_SCORE;
  }
  return 0;
}

function getSearchableBlockText(block: BubbleBlock) {
  if (block.type === 'text') return normalizeWhitespace(block.text || '');
  if (block.type === 'link') {
    return normalizeWhitespace(getLinkDisplayLabel(block.url || ''));
  }
  if (block.type === 'file') {
    return normalizeWhitespace(block.fileName || block.url || '');
  }
  if (block.type === 'location') {
    return normalizeWhitespace(block.location?.label || block.location?.address || '');
  }
  return '';
}

function getMessageMatch(
  query: string,
  message: MessageData,
): { score: number; blockId?: string; contextScore: number } {
  const blocks = getMessageBlocks(message);
  let bestScore = 0;
  let bestBlockId: string | undefined;
  let bestContextScore = 0;

  blocks.forEach((block) => {
    if (block.type === 'quote') return;
    const text = getSearchableBlockText(block);
    if (!text) return;
    const blockScore = scoreSearchText(
      query,
      text,
      block.type === 'link' || block.type === 'file' ? 'meta' : 'content',
    );
    if (blockScore > bestScore) {
      bestScore = blockScore;
      bestBlockId = block.id;
    }
    if (blockScore > bestContextScore) {
      bestContextScore = blockScore;
    }
  });

  return {
    score: bestScore,
    blockId: bestBlockId,
    contextScore: bestContextScore,
  };
}

export function searchChatResults(
  channels: ChatChannel[],
  request: SearchRequest,
): SearchResponse {
  const query = normalizeSearchQuery(request.query);
  if (!query) {
    return { items: [], total: 0, hasMore: false };
  }

  const results: SearchResult[] = [];
  const includeStreams = request.scope === 'all' || request.scope === 'streams';
  const includeComments = request.scope === 'all' || request.scope === 'comments';

  channels.forEach((channel) => {
    if (includeStreams) {
      const titleScore = scoreSearchText(query, channel.title, 'title');
      if (titleScore > 0) {
        results.push({
          id: `stream-title:${channel.id}`,
          type: 'stream-title',
          domain: 'stream',
          sectionLabel: '泡泡流',
          title: channel.title,
          preview: channel.lastMsg || '打开这条泡泡流',
          meta: `${channel.messages.length} 个泡泡`,
          time: channel.lastMessageAt || 0,
          score: titleScore,
          contextScore: titleScore,
          target: {
            type: 'stream-title',
            conversationId: channel.id,
          },
        });
      }
    }

    channel.messages.forEach((message) => {
      const preview = buildMessagePreviewText(message) || '泡泡';
      const messageTime = message.time || 0;

      if (!message.replyToMessageId && includeStreams) {
        const match = getMessageMatch(query, message);
        if (match.score > 0) {
          results.push({
            id: `stream-message:${channel.id}:${message.id}`,
            type: 'stream-message',
            domain: 'stream',
            sectionLabel: '泡泡流',
            title: preview,
            preview: channel.title,
            meta: `${channel.title}${messageTime ? ` · ${new Date(messageTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}`,
            time: messageTime,
            score: match.score,
            contextScore: match.contextScore,
            target: {
              type: 'stream-message',
              conversationId: channel.id,
              messageId: message.id,
              blockId: match.blockId,
            },
          });
        }
        return;
      }

      if (message.replyToMessageId && includeComments) {
        const match = getMessageMatch(query, message);
        if (match.score <= 0) return;
        const parentMessage =
          channel.messages.find((item) => item.id === message.replyToMessageId) || null;
        const parentPreview = parentMessage
          ? buildMessagePreviewText(parentMessage) || '原泡泡'
          : '原泡泡';
        const parentScore = parentMessage ? getMessageMatch(query, parentMessage).score : 0;
        results.push({
          id: `thread-reply:${channel.id}:${message.id}`,
          type: 'thread-reply',
          domain: 'stream',
          sectionLabel: '评论',
          title: preview,
          preview: `原泡泡：${parentPreview}`,
          meta: `${channel.title}${messageTime ? ` · ${new Date(messageTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}`,
          time: messageTime,
          score: match.score,
          contextScore: match.contextScore + parentScore,
          target: {
            type: 'thread-reply',
            conversationId: channel.id,
            messageId: message.replyToMessageId,
            blockId: message.commentTarget?.blockId,
            replyMessageId: message.id,
          },
        });
      }
    });
  });

  results.sort(compareSearchResults);
  return paginateSearchResults(results, request.offset, request.limit);
}
