import type { MouseEvent, ReactNode, TouchEvent, TouchEventHandler } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import {
  flattenBubbleQuoteSnapshotBlocks,
  getMessageBlocks,
  getMessageStreamingState,
  type BubbleBlock,
  type MessageData,
} from '@/entities/message';
import { LinkPreviewCard, ExternalAnchor } from '@/shared/ui/LinkPreviewCard';
import {
  getAttachmentOpenTarget,
  isRenderableMediaSrc,
  MediaUnavailable,
  useInteractiveAssetActions,
} from '@/shared/ui/media-helpers';
import { publicIcon } from '@/shared/lib/asset';

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function getMessageMetadata(msg: MessageData) {
  return msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
}

function getAiTrace(msg: MessageData) {
  const metadata = getMessageMetadata(msg);
  const trace = metadata.aiTrace;
  return trace && typeof trace === 'object' ? trace as Record<string, unknown> : null;
}

function getBotTriggerStatus(msg: MessageData) {
  const metadata = getMessageMetadata(msg);
  const status = metadata.botTriggerStatus;
  if (!status || typeof status !== 'object') return [];
  return Array.isArray((status as Record<string, unknown>).items)
    ? ((status as Record<string, unknown>).items as Array<Record<string, unknown>>)
    : [];
}

function getAiStatusTitle(msg: MessageData, aiTrace: Record<string, unknown> | null, streamingState: string) {
  const botName = typeof aiTrace?.botName === 'string' && aiTrace.botName.trim() ? aiTrace.botName.trim() : (msg.senderName || 'AI');
  if (msg.status === 'error') return `${botName} 生成失败`;
  if (typeof aiTrace?.phase === 'string' && aiTrace.phase === 'requires-action') return `${botName} 需要额外操作`;
  if (streamingState === 'streaming' || msg.status === 'streaming') return `${botName} 正在生成`;
  return botName;
}

function getAiStatusMeta(msg: MessageData, aiTrace: Record<string, unknown> | null) {
  const parts: string[] = [];
  const kind = typeof aiTrace?.kind === 'string' ? aiTrace.kind : '';
  const runtimeType = typeof aiTrace?.runtimeType === 'string' ? aiTrace.runtimeType : '';
  const model = typeof aiTrace?.model === 'string' && aiTrace.model.trim() ? aiTrace.model.trim() : '';
  const runId = typeof aiTrace?.runId === 'string' && aiTrace.runId.trim() ? aiTrace.runId.trim() : '';

  if (kind === 'machine-run') {
    parts.push(runtimeType === 'external-codex' ? 'Codex' : 'Machine');
  } else if (kind === 'bot-reply') {
    parts.push('LLM');
  }
  if (model) {
    parts.push(model);
  }
  if (runId) {
    parts.push(`Run ${runId.slice(0, 8)}`);
  }
  const errorMessage = typeof getMessageMetadata(msg).errorMessage === 'string' ? String(getMessageMetadata(msg).errorMessage) : '';
  const traceError = typeof aiTrace?.errorMessage === 'string' ? aiTrace.errorMessage : '';
  const requestReason = typeof aiTrace?.requestReason === 'string' ? aiTrace.requestReason : '';

  return {
    meta: parts.join(' · '),
    detail: requestReason || traceError || errorMessage,
  };
}

function getTriggerStatusTitle(item: Record<string, unknown>) {
  const botName = typeof item.botName === 'string' && item.botName.trim() ? item.botName.trim() : '泡泡机';
  const status = typeof item.status === 'string' ? item.status : '';
  if (status === 'error') return `${botName} 执行失败`;
  if (status === 'skipped') return `${botName} 未执行`;
  return botName;
}

function BubbleActionButton({
  active = false,
  count = 0,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  count?: number;
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors',
        active ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      aria-label={label}
    >
      {children}
      {count > 0 ? <span>{count}</span> : null}
    </button>
  );
}

function QuotePreview({
  block,
  onJumpToMsg,
}: {
  block: BubbleBlock;
  onJumpToMsg?: (id: string, blockId?: string) => void;
}) {
  if (!block.quote) return null;
  const label = block.quote.relationKind === 'forward' ? '转发' : '引用';
  const snapshotBlocks = flattenBubbleQuoteSnapshotBlocks(block.quote.snapshotBlocks || []);
  return (
    <button
      type="button"
      className="w-full rounded-2xl border border-black/6 bg-white/80 px-3 py-3 text-left"
      onClick={(event) => {
        event.stopPropagation();
        onJumpToMsg?.(block.quote!.targetMessageId, block.quote!.targetBlockId);
      }}
    >
      <div className="mb-2 text-xs font-semibold tracking-[0.08em] text-[var(--text-secondary)]">{label}</div>
      <div className="space-y-2">
        {snapshotBlocks.length === 0 ? (
          <div className="text-sm leading-6 text-[var(--text-secondary)]">原泡泡</div>
        ) : null}
        {snapshotBlocks.slice(0, 3).map((item) => (
          <div key={item.id} className="min-w-0">
            {item.type === 'text' ? (
              <div className="line-clamp-3 text-sm leading-6 text-[var(--text-primary)]">{item.text}</div>
            ) : null}
            {item.type === 'image' ? (
              isRenderableMediaSrc(item.url)
                ? <img src={item.url} className="max-h-[180px] w-full rounded-xl object-cover" alt="quote" />
                : <MediaUnavailable label="图片不可用" />
            ) : null}
            {item.type === 'video' ? (
              isRenderableMediaSrc(item.url)
                ? <video src={item.url} className="max-h-[180px] w-full rounded-xl object-cover" controls preload="metadata" />
                : <MediaUnavailable label="视频不可用" />
            ) : null}
            {item.type === 'audio' ? (
              isRenderableMediaSrc(item.url)
                ? <audio src={item.url} controls style={{ width: '100%' }} />
                : <MediaUnavailable label="音频不可用" />
            ) : null}
            {item.type === 'file' ? (
              <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-xs text-[var(--text-secondary)]">📎 {item.fileName || item.url || '文件'}</div>
            ) : null}
            {item.type === 'link' ? <LinkPreviewCard url={item.url || ''} compact /> : null}
          </div>
        ))}
      </div>
    </button>
  );
}

function BlockRenderer({
  block,
  msg,
  blockIndex,
  isSortingMode,
  highlighted,
  onJumpToMsg,
  onFsOpen,
  onAttachmentOpen,
  onTouchStart,
  onContextMenu,
  onOpenThread,
  blockReplyCount,
}: {
  block: BubbleBlock;
  msg: MessageData;
  blockIndex: number;
  isSortingMode: boolean;
  highlighted: boolean;
  onJumpToMsg?: (id: string, blockId?: string) => void;
  onFsOpen?: (src: string, type: 'img' | 'video') => void;
  onAttachmentOpen?: (src: string) => void;
  onTouchStart?: (e: TouchEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  onContextMenu?: (e: MouseEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  onOpenThread?: (msgId: string, blockId?: string) => void;
  blockReplyCount?: number;
}) {
  const { openAttachment, openMediaPreview, previewOverlay } = useInteractiveAssetActions({ onFsOpen, onAttachmentOpen });
  const isStreaming = getMessageStreamingState(msg) === 'streaming' || msg.status === 'streaming';
  const blockShellClass = cn(
    'overflow-hidden rounded-2xl',
    highlighted && 'shadow-[0_0_0_2px_rgba(94,155,122,0.28)]',
  );
  const blockHandlers = {
    onTouchStart: onTouchStart ? (event: TouchEvent) => { event.stopPropagation(); onTouchStart(event, msg, block.id, blockIndex); } : undefined,
    onContextMenu: onContextMenu ? (event: MouseEvent) => { event.stopPropagation(); onContextMenu(event, msg, block.id, blockIndex); } : undefined,
  };

  return (
    <>
      <div className={blockShellClass} {...blockHandlers}>
        {block.type === 'quote' ? <QuotePreview block={block} onJumpToMsg={onJumpToMsg} /> : null}
        {block.type === 'text' ? (
          <div className={cn(
            'markdown-body text-sm leading-7 text-[var(--text-primary)]',
            isSortingMode && 'max-h-[220px] overflow-y-auto pr-1',
            isStreaming && 'markdown-body--streaming',
          )}>
            {block.text
              ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={{ a: ({ node: _node, ...props }) => <ExternalAnchor {...props} /> }}
                >
                  {block.text}
                </ReactMarkdown>
              )
              : getMessageStreamingState(msg) === 'streaming'
                ? (
                  <span className="bubble-typing-placeholder" aria-label="正在输入">
                    <span />
                    <span />
                    <span />
                  </span>
                )
                : null}
          </div>
        ) : null}
        {block.type === 'image' ? (
          isRenderableMediaSrc(block.url)
            ? <img className={cn('block w-full cursor-zoom-in object-cover', isSortingMode ? 'max-h-[240px]' : 'max-h-[360px]')} src={block.url} alt="img" onClick={() => openMediaPreview(block.url, 'img')} />
            : <MediaUnavailable label="图片不可用" />
        ) : null}
        {block.type === 'video' ? (
          isRenderableMediaSrc(block.url)
            ? <video className={cn('block w-full object-cover', isSortingMode ? 'max-h-[240px]' : 'max-h-[360px]')} src={block.url} controls preload="metadata" onDoubleClick={() => openMediaPreview(block.url, 'video')} />
            : <MediaUnavailable label="视频不可用" />
        ) : null}
        {block.type === 'audio' ? (
          isRenderableMediaSrc(block.url)
            ? <audio src={block.url} controls style={{ width: '100%' }} />
            : <MediaUnavailable label="音频不可用" />
        ) : null}
        {block.type === 'link' ? <LinkPreviewCard url={block.url || ''} /> : null}
        {block.type === 'file' ? (
          <button
            type="button"
            className={cn('flex w-full items-center gap-3 rounded-[22px] px-4 py-3 text-left shadow-sm', getAttachmentOpenTarget(block.url, block.fileName) && 'cursor-pointer')}
            onClick={(event) => {
              event.stopPropagation();
              openAttachment(getAttachmentOpenTarget(block.url, block.fileName));
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openAttachment(getAttachmentOpenTarget(block.url, block.fileName));
            }}
            title={getAttachmentOpenTarget(block.url, block.fileName) ? '单击或双击用系统默认应用打开' : '当前附件不可打开'}
          >
            <div className="file-icon"><img src={publicIcon('tool_folder.svg')} style={{ width: 32 }} alt="file" /></div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{block.fileName || block.url || '文件'}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">附件</div>
            </div>
          </button>
        ) : null}
      </div>

      {blockReplyCount && blockReplyCount > 0 && onOpenThread ? (
        <div className="mt-2 flex items-center gap-2 px-1">
          <div className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-[var(--text-secondary)] shadow-sm" onClick={(event) => { event.stopPropagation(); onOpenThread(msg.id, block.id); }}>
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" /></svg>
            <span>{blockReplyCount}</span>
          </div>
        </div>
      ) : null}
      {previewOverlay}
    </>
  );
}

export function BubbleItem({
  msg,
  onJumpToMsg,
  onFsOpen,
  onAttachmentOpen,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  onContextMenu,
  onOpenThread,
  onToggleLike,
  onForward,
  highlightedMsg,
  displayMode = 'default',
  replyCount,
  replyCountByBlock,
}: {
  msg: MessageData;
  onJumpToMsg?: (id: string, blockId?: string) => void;
  onFsOpen?: (src: string, type: 'img' | 'video') => void;
  onAttachmentOpen?: (src: string) => void;
  onTouchStart?: (e: TouchEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  onTouchEnd?: TouchEventHandler;
  onTouchMove?: TouchEventHandler;
  onContextMenu?: (e: MouseEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  onOpenThread?: (msgId: string, blockId?: string) => void;
  onToggleLike?: (msgId: string, blockId?: string) => void;
  onForward?: (msgId: string) => void;
  highlightedMsg?: string | null;
  displayMode?: 'default' | 'sorting';
  replyCount?: number;
  replyCountByBlock?: Record<string, number>;
}) {
  const isSortingMode = displayMode === 'sorting';
  const bubbleSurfaceClass = msg.role === 'me' ? 'bg-[var(--bubble-me)]' : 'bg-[var(--bubble-other)]';
  const streamingState = getMessageStreamingState(msg);
  const aiTrace = getAiTrace(msg);
  const triggerStatusItems = getBotTriggerStatus(msg);
  const blocks = getMessageBlocks(msg);
  const displayBlocks = blocks.length > 0
    ? blocks
    : (msg.role === 'ai' && msg.type === 'text' && (streamingState === 'streaming' || msg.status === 'error')
      ? [{ id: `${msg.id}__placeholder__`, type: 'text', text: '' } satisfies BubbleBlock]
      : []);
  const hasAiStatus = msg.role === 'ai' && (streamingState === 'streaming' || msg.status === 'error' || aiTrace?.phase === 'requires-action');
  const aiStatus = hasAiStatus ? getAiStatusMeta(msg, aiTrace) : null;
  const bubbleClass = cn(
    'bubble rounded-[22px] px-4 py-3 text-sm leading-7 shadow-sm',
    bubbleSurfaceClass,
    streamingState === 'streaming' && 'bubble--streaming',
    msg.status === 'error' && 'bubble--error',
  );
  const effectiveReplyCount = typeof replyCount === 'number'
    ? replyCount
    : (msg.engagement?.commentCount || 0);
  const likeCount = msg.engagement?.likeCount || 0;
  const forwardCount = msg.engagement?.forwardCount || 0;
  const likedByMe = Boolean(msg.engagement?.likedByMe);
  const hasMultipleBlocks = displayBlocks.length > 1;

  return (
    <div
      className="relative"
      onTouchStart={onTouchStart ? (event) => onTouchStart(event, msg) : undefined}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
      onContextMenu={onContextMenu ? (event) => onContextMenu(event, msg) : undefined}
    >
      {msg.tips ? (
        <div className="group absolute -left-1 -top-1">
          <svg className="h-4 w-4 fill-[#F57C00]" viewBox="0 0 24 24">
            <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
          <div className="absolute left-6 top-0 hidden w-52 rounded-xl bg-[#1b1d20] px-3 py-2 text-xs leading-5 text-white shadow-lg group-hover:block">{msg.tips}</div>
        </div>
      ) : null}

      <div className={cn(bubbleClass, hasMultipleBlocks && 'space-y-3')}>
        {displayBlocks.map((block, index) => (
          <BlockRenderer
            key={block.id}
            block={block}
            msg={msg}
            blockIndex={index}
            isSortingMode={isSortingMode}
            highlighted={highlightedMsg === `${msg.id}:${block.id}`}
            onJumpToMsg={onJumpToMsg}
            onFsOpen={onFsOpen}
            onAttachmentOpen={onAttachmentOpen}
            onTouchStart={onTouchStart}
            onContextMenu={onContextMenu}
            onOpenThread={onOpenThread}
            blockReplyCount={replyCountByBlock?.[block.id] || 0}
          />
        ))}
      </div>

      {hasAiStatus && aiStatus ? (
        <div className={cn(
          'conversation-feed-bot-status',
          msg.status === 'error' && 'conversation-feed-bot-status--error',
          aiTrace?.phase === 'requires-action' && 'conversation-feed-bot-status--warning',
        )}>
          <div className="conversation-feed-bot-status__header">
            <span>{getAiStatusTitle(msg, aiTrace, streamingState)}</span>
            {aiStatus.meta ? <span className="conversation-feed-bot-status__meta">{aiStatus.meta}</span> : null}
          </div>
          {aiStatus.detail ? (
            <div className="conversation-feed-bot-status__body">{aiStatus.detail}</div>
          ) : streamingState === 'streaming' ? (
            <div className="conversation-feed-bot-status__body">流式响应中，内容会持续追加到这条回复里。</div>
          ) : null}
        </div>
      ) : null}

      {triggerStatusItems.length > 0 ? (
        <div className="conversation-feed-bot-status conversation-feed-bot-status--summary">
          <div className="conversation-feed-bot-status__header">
            <span>泡泡机执行状态</span>
            <span className="conversation-feed-bot-status__meta">{triggerStatusItems.length} 条</span>
          </div>
          <div className="conversation-feed-bot-status__list">
            {triggerStatusItems.map((item, index) => {
              const reason = typeof item.reason === 'string' ? item.reason : '';
              const status = typeof item.status === 'string' ? item.status : '';
              return (
                <div key={`${String(item.botId || index)}-${index}`} className={cn(
                  'conversation-feed-bot-status__item',
                  status === 'error' && 'is-error',
                )}>
                  <div className="conversation-feed-bot-status__item-title">{getTriggerStatusTitle(item)}</div>
                  {reason ? <div className="conversation-feed-bot-status__item-copy">{reason}</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2 px-1">
        <BubbleActionButton label="评论" count={effectiveReplyCount} onClick={onOpenThread ? () => onOpenThread(msg.id) : undefined}>
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" /></svg>
        </BubbleActionButton>
        <BubbleActionButton label="转发" count={forwardCount} onClick={onForward ? () => onForward(msg.id) : undefined}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m7 17-5-5 5-5" /><path d="M2 12h12a8 8 0 0 1 8 8" /></svg>
        </BubbleActionButton>
        <BubbleActionButton label="点赞" count={likeCount} active={likedByMe} onClick={onToggleLike ? () => onToggleLike(msg.id) : undefined}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill={likedByMe ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12.001 20.727 10.55 19.41C5.4 14.76 2 11.689 2 7.92 2 4.85 4.42 2.5 7.5 2.5c1.74 0 3.41.81 4.5 2.09 1.09-1.28 2.76-2.09 4.5-2.09C19.58 2.5 22 4.85 22 7.92c0 3.769-3.4 6.84-8.55 11.5l-1.449 1.307Z" /></svg>
        </BubbleActionButton>
      </div>
    </div>
  );
}
