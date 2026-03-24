import {
  useMemo,
  useRef,
  type ChangeEvent,
  type ClipboardEventHandler,
  type DragEventHandler,
  type MouseEvent,
} from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { createTextBubbleBlock } from '@/entities/message';
import {
  bubbleBlockToDraftItem,
  draftItemToBubbleBlock,
  getDraftBlocks,
} from '@/features/send-message/model/bubbleDraft';
import type { DraftState } from '@/features/send-message/model/draft';
import { CurrentStatusGlyph, SelectedStatusGlyph } from '@/shared/icons/StatusGlyph';
import { BubbleComposer } from '@/shared/ui/BubbleComposer';
import { StreamAvatar } from '@/shared/ui/StreamAvatar';
import type { SortingStream } from '@/entities/sorting';
import { SortingSourceBubbleCard } from '../bubble';
import { ChevronLeftIcon, EyeIcon, MessageCircleIcon, PanelLeftIcon } from '../icons';
import type { SortingComposerItem, SortingSourceBubble } from '../types';
import { cx, extractText, toSourceBubbleDraggableId } from '../utils';

function formatStreamPreview(stream: SortingStream) {
  const lastMessage = stream.messages[stream.messages.length - 1];
  if (!lastMessage) return '还没有泡泡';
  const text = extractText(lastMessage.content).replace(/\s+/g, ' ').trim();
  if (text) return text;
  if (lastMessage.type === 'img') return '[图片]';
  if (lastMessage.type === 'video') return '[视频]';
  if (lastMessage.type === 'audio') return '[音频]';
  if (lastMessage.type === 'file') return '[文件]';
  if (lastMessage.type === 'link') return '[链接]';
  if (lastMessage.type === 'location') return '[位置]';
  if (lastMessage.type === 'compound') return '[泡泡]';
  return '[泡泡]';
}

function formatStreamTimeLabel(timestamp: number | null | undefined) {
  if (!Number.isFinite(timestamp) || Number(timestamp) <= 0) return '';
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return isToday
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function buildComposerDraft(value: string, items: SortingComposerItem[]): DraftState {
  const blocks = [
    createTextBubbleBlock(value),
    ...items
      .map((item) => draftItemToBubbleBlock(item))
      .filter((item): item is NonNullable<ReturnType<typeof draftItemToBubbleBlock>> => Boolean(item)),
  ];

  return {
    text: '',
    items: [],
    blocks,
  };
}

function toSortingComposerDraft(draft: DraftState) {
  const blocks = getDraftBlocks(draft);
  let primaryTextResolved = false;
  let text = '';
  const items: SortingComposerItem[] = [];

  blocks.forEach((block) => {
    if (block.type === 'text' && !primaryTextResolved) {
      text = block.text || '';
      primaryTextResolved = true;
      return;
    }

    const item = bubbleBlockToDraftItem(block);
    if (!item) return;
    items.push({
      id: item.id,
      type: item.type,
      val: item.val,
      fileName: item.fileName,
    });
  });

  return {
    text,
    items,
  };
}

export function SortingSourcePanel({
  streams,
  selectedStreamIds,
  currentStream,
  bubbles,
  foldedBubbles,
  highlightedBubbleKey,
  isCollapsed,
  isListView,
  composerDraft,
  composerPlaceholder,
  composerDisabled,
  onComposerDraftChange,
  onComposerSend,
  onComposerFocus,
  onComposerPaste,
  onComposerDrop,
  onComposerDragOver,
  onComposerSelectFiles,
  onOpenBubbleMenu,
  onOpenBubbleThread,
  onToggleStreamSelection,
  onFocusStream,
  onOpenStream,
  onOpenSelectedStreams,
  onClearSelection,
  onBackToList,
  onToggleCollapse,
  onUnfoldBubble,
}: {
  streams: SortingStream[];
  selectedStreamIds: string[];
  currentStream: SortingStream | null;
  bubbles: SortingSourceBubble[];
  foldedBubbles: Set<string>;
  highlightedBubbleKey?: string | null;
  isCollapsed: boolean;
  isListView: boolean;
  sourceViewMode: 'focused' | 'all-selected';
  composerDraft: DraftState;
  composerPlaceholder: string;
  composerDisabled: boolean;
  onComposerDraftChange: (updater: (draft: DraftState) => DraftState) => void;
  onComposerSend: () => void;
  onComposerFocus: () => void;
  onComposerPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onComposerDrop: DragEventHandler<HTMLTextAreaElement>;
  onComposerDragOver: DragEventHandler<HTMLTextAreaElement>;
  onComposerSelectFiles: (files: FileList | null) => void;
  onOpenBubbleMenu: (event: MouseEvent<HTMLDivElement>, bubble: SortingSourceBubble) => void;
  onOpenBubbleThread: (bubble: SortingSourceBubble) => void;
  onToggleStreamSelection: (streamId: string) => void;
  onFocusStream: (streamId: string) => void;
  onOpenStream: (streamId: string) => void;
  onOpenSelectedStreams: () => void;
  onClearSelection: () => void;
  onBackToList: () => void;
  onToggleCollapse: () => void;
  onUnfoldBubble: (bubbleKey: string) => void;
}) {
  const streamCards = useMemo(() => streams
    .map((stream) => {
      const lastMessage = stream.messages[stream.messages.length - 1] || null;
      return {
        stream,
        preview: formatStreamPreview(stream),
        updatedAt: lastMessage?.time || 0,
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt), [streams]);
  const totalBubbleCount = useMemo(
    () => streams.reduce((sum, stream) => sum + stream.messages.length, 0),
    [streams],
  );
  const selectedStreamIdSet = useMemo(() => new Set(selectedStreamIds), [selectedStreamIds]);
  const selectedStreamCount = selectedStreamIds.length;
  const sourceToggleLabel = isCollapsed ? '展开泡泡流面板' : '收起泡泡流面板';
  const collapsedStreamCards = useMemo(() => {
    if (isListView) return streamCards;
    const selectedCards = streamCards.filter(({ stream }) => selectedStreamIdSet.has(stream.id));
    const orderedCards = currentStream
      ? [
        ...streamCards.filter(({ stream }) => stream.id === currentStream.id),
        ...selectedCards.filter(({ stream }) => stream.id !== currentStream.id),
      ]
      : selectedCards;
    return orderedCards;
  }, [currentStream, isListView, selectedStreamIdSet, streamCards]);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draggableEntries = useMemo(
    () => bubbles.filter((entry) => !foldedBubbles.has(entry.key)),
    [bubbles, foldedBubbles],
  );
  const draggableIndexByKey = useMemo(
    () => new Map(draggableEntries.map((entry, index) => [entry.key, index])),
    [draggableEntries],
  );
  const selectedFeedHint = useMemo(
    () => (currentStream ? `当前聚焦 ${currentStream.title}` : '点击一条流作为当前聚焦'),
    [currentStream],
  );
  const normalizedComposerDraft = useMemo(
    () => buildComposerDraft(composerDraft.text, composerDraft.items),
    [composerDraft.items, composerDraft.text],
  );
  const sourceBubbleListSection = useMemo(() => {
    if (isCollapsed || isListView || !currentStream) return null;
    return (
      <Droppable
        droppableId="bubble-source"
        type="ITEM"
        renderClone={(provided, snapshot, rubric) => {
          const entry = draggableEntries[rubric.source.index];
          if (!entry) return null;
          return (
            <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                <SortingSourceBubbleCard
                  bubble={entry.bubble}
                  bubbleKey={entry.key}
                  streamTitle={entry.streamTitle}
                  showSourceTag={selectedStreamCount > 1}
                  isHighlighted={highlightedBubbleKey === entry.key}
                  isDragging={snapshot.isDragging}
                  onOpenThread={() => onOpenBubbleThread(entry)}
                  onContextMenu={(event) => onOpenBubbleMenu(event, entry)}
                />
            </div>
          );
        }}
      >
        {(provided, snapshot) => (
          <div className="s-source-list" ref={provided.innerRef} {...provided.droppableProps}>
            {bubbles.map((entry) => {
              if (foldedBubbles.has(entry.key)) {
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className="s-source-list-row s-folded-bubble"
                    onClick={() => onUnfoldBubble(entry.key)}
                  >
                    <span>已折叠泡泡</span>
                    <strong>点击展开</strong>
                  </button>
                );
              }

              const draggableId = toSourceBubbleDraggableId(entry.streamId, entry.bubble.id);
              const draggableIndex = draggableIndexByKey.get(entry.key) ?? 0;

              if (snapshot.draggingFromThisWith === draggableId) {
                return (
                  <div key={entry.key} className="s-source-list-row">
                      <SortingSourceBubbleCard
                        bubble={entry.bubble}
                        bubbleKey={entry.key}
                        streamTitle={entry.streamTitle}
                        showSourceTag={selectedStreamCount > 1}
                        isHighlighted={highlightedBubbleKey === entry.key}
                        isDragging={false}
                        isDragOrigin
                        onOpenThread={() => onOpenBubbleThread(entry)}
                        onContextMenu={(event) => onOpenBubbleMenu(event, entry)}
                      />
                  </div>
                );
              }

              return (
                <Draggable key={entry.key} draggableId={draggableId} index={draggableIndex}>
                  {(dragProvided, dragSnapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      {...dragProvided.dragHandleProps}
                      className="s-source-list-row"
                      style={dragProvided.draggableProps.style}
                    >
                        <SortingSourceBubbleCard
                          bubble={entry.bubble}
                          bubbleKey={entry.key}
                          streamTitle={entry.streamTitle}
                          showSourceTag={selectedStreamCount > 1}
                          isHighlighted={highlightedBubbleKey === entry.key}
                          isDragging={dragSnapshot.isDragging}
                          onOpenThread={() => onOpenBubbleThread(entry)}
                          onContextMenu={(event) => onOpenBubbleMenu(event, entry)}
                        />
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    );
  }, [
    bubbles,
    currentStream,
    draggableEntries,
    draggableIndexByKey,
    foldedBubbles,
    isCollapsed,
    isListView,
    onOpenBubbleMenu,
    onUnfoldBubble,
    selectedStreamCount,
  ]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onComposerSelectFiles(event.target.files);
    event.target.value = '';
  };

  return (
    <section className={cx('s-source-panel', isCollapsed && 'is-collapsed')}>
      {isCollapsed ? (
        <button type="button" className="s-panel-toolbar s-collapsed-head-trigger" onClick={onToggleCollapse} aria-label={sourceToggleLabel} title="展开泡泡流面板">
          <div className="s-panel-toolbar-title">
            <div className="s-panel-toolbar-mark">
              <MessageCircleIcon size={18} />
            </div>
          </div>
        </button>
      ) : (
        <div className="s-panel-toolbar">
          <div className="s-panel-toolbar-title s-panel-toolbar-title--source">
            {!isListView && (
              <button type="button" className="s-toolbar-back" onClick={onBackToList} aria-label="返回泡泡流列表">
                <ChevronLeftIcon size={16} /> 返回
              </button>
            )}
            {isListView && (
              <div className="s-panel-toolbar-mark">
                <MessageCircleIcon size={18} />
              </div>
            )}

            <div className="s-source-toolbar-copy">
              <div className="s-source-toolbar-mainline">

                {!isListView && currentStream && (
                  <h2>发到{currentStream.title}</h2>
                )}
                <div className="s-panel-stats">
                  <span>{isListView ? `${streams.length} 个泡泡流` : `${selectedStreamCount} 个泡泡流`}</span>
                  <span>{isListView ? `${totalBubbleCount} 个泡泡` : `${bubbles.length} 个泡泡`}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="s-panel-toolbar-actions">
            <button type="button" className="s-toolbar-toggle" onClick={onToggleCollapse} aria-label={sourceToggleLabel} title={sourceToggleLabel}>
              <PanelLeftIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {isCollapsed && (
        <div className="s-source-collapsed-shell">
          <div className="s-source-collapsed-body">
            <div className="s-source-collapsed-stack">
              {collapsedStreamCards.length === 0 ? (
                <div className="s-source-collapsed-empty" aria-hidden="true">
                  <span className="s-source-collapsed-avatar-shell s-source-collapsed-avatar-shell--ghost">
                    <span className="s-source-collapsed-avatar-copy">空</span>
                  </span>
                </div>
              ) : collapsedStreamCards.map(({ stream }) => {
                const isSelected = selectedStreamIdSet.has(stream.id);
                const isCurrent = currentStream?.id === stream.id;
                const selectToggleLabel = isSelected
                  ? `取消选择 ${stream.title}`
                  : `选择 ${stream.title}`;
                const mainTriggerLabel = !isSelected
                  ? `选择并聚焦 ${stream.title}`
                  : isCurrent
                    ? `取消选择 ${stream.title}`
                    : `聚焦 ${stream.title}`;
                return (
                  <div
                    key={stream.id}
                    className={cx('s-source-collapsed-item', isSelected && 'is-selected', isCurrent && 'is-current')}
                  >
                    <button
                      type="button"
                      className="s-source-collapsed-main"
                      onClick={() => {
                        if (isListView) {
                          onFocusStream(stream.id);
                        } else {
                          onFocusStream(stream.id);
                          onToggleCollapse();
                        }
                      }}
                      title={stream.title}
                      aria-label={mainTriggerLabel}
                    >
                      <span className="s-source-collapsed-avatar-shell">
                        <StreamAvatar title={stream.title} idOffset={stream.id} className="h-10 w-10 rounded-[18px]" iconClassName="text-[20px] font-semibold text-white" />
                      </span>
                      {isCurrent ? (
                        <span className="s-source-collapsed-corner-badge" title="当前聚焦" aria-hidden="true">
                          <CurrentStatusGlyph size={10} />
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className={cx('s-source-collapsed-select-badge', isSelected && 'is-selected')}
                      onClick={() => onToggleStreamSelection(stream.id)}
                      title={selectToggleLabel}
                      aria-label={selectToggleLabel}
                      aria-pressed={isSelected}
                    >
                      {isSelected ? <SelectedStatusGlyph size={10} /> : null}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="s-source-collapsed-selection-bar">
            <button
              type="button"
              className="s-source-collapsed-selection-bar__primary"
              onClick={() => {
                onOpenSelectedStreams();
                onToggleCollapse();
              }}
              disabled={selectedStreamCount === 0}
              aria-label={selectedStreamCount > 0 ? `查看已选 ${selectedStreamCount} 条泡泡流详情` : '先选择泡泡流'}
              title={selectedStreamCount > 0 ? '查看详情' : '先选择泡泡流'}
            >
              <EyeIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {!isCollapsed && isListView && (
        <div className="s-source-stream-list-shell">
          <div className="s-source-stream-list">
            {streamCards.length === 0 ? (
              <div className="s-source-empty-state">
                <p className="mb-1 font-semibold text-[var(--text-primary)]">
                  这里还没有泡泡流
                </p>
                <span>回到聊天页后，新开一个泡泡流再来分箱。</span>
              </div>
            ) : (
              streamCards.map(({ stream, preview, updatedAt }) => {
                const isSelected = selectedStreamIdSet.has(stream.id);
                const isCurrent = currentStream?.id === stream.id;
                const selectToggleLabel = isSelected
                  ? `取消选择 ${stream.title}`
                  : `选择 ${stream.title}`;
                const mainTriggerLabel = !isSelected
                  ? `选择并聚焦 ${stream.title}`
                  : isCurrent
                    ? `取消选择 ${stream.title}`
                    : `聚焦 ${stream.title}`;
                return (
                  <div
                    key={stream.id}
                    className={cx('s-source-stream-row', isSelected && 'is-selected', isCurrent && 'is-focused')}
                  >
                    <button
                      type="button"
                      className="s-source-stream-row__check-trigger"
                      onClick={() => onToggleStreamSelection(stream.id)}
                      title={selectToggleLabel}
                      aria-label={selectToggleLabel}
                      aria-pressed={isSelected}
                    >
                      <span className={cx('s-source-check', 's-source-check--list', isCurrent && 'is-focused')} aria-hidden="true">
                        <span className={cx('s-source-check-dot', isSelected && 'is-selected')} />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="s-source-stream-row__main"
                      onClick={() => onFocusStream(stream.id)}
                      title={stream.title}
                      aria-label={mainTriggerLabel}
                      aria-current={isCurrent ? 'true' : undefined}
                    >
                      <span className="s-source-stream-row__icon">
                        <StreamAvatar title={stream.title} idOffset={stream.id} className="s-source-stream-row__avatar" iconClassName="text-[15px] font-semibold text-white" />
                      </span>
                      <span className="s-source-stream-row__body">
                        <span className="s-source-stream-row__top">
                          <strong>{stream.title}</strong>
                          {isCurrent ? <span className="s-source-stream-row__focus">
                            <CurrentStatusGlyph size={14} className="s-sidebar-item-icon" />
                          </span> : null}
                          <em>{formatStreamTimeLabel(updatedAt)}</em>
                        </span>
                        <span className="s-source-stream-row__bottom">
                          <span>{preview}</span>
                          <b>{stream.messages.length}</b>
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {streamCards.length > 0 && (
            <div className="s-source-selection-bar">
              <div className="s-source-selection-bar__copy">
                <strong>{selectedStreamCount > 0 ? `已选 ${selectedStreamCount} 条流` : '先选择泡泡流'}</strong>
                <span>{selectedStreamCount > 0 ? selectedFeedHint : '点击列表项可多选，再统一查看混合内容。'}</span>
              </div>
              <div className="s-source-selection-bar__actions">
                {selectedStreamCount > 0 && (
                  <button type="button" className="s-toolbar-action" onClick={onClearSelection}>
                    清空
                  </button>
                )}
                <button
                  type="button"
                  className="s-source-selection-bar__primary"
                  onClick={onOpenSelectedStreams}
                  disabled={selectedStreamCount === 0}
                >
                  <EyeIcon size={15} />
                  <span>详情</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!isCollapsed && !isListView && !currentStream && (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-[var(--text-secondary)]">
          <div className="rounded-[24px] border border-dashed border-black/10 bg-white/70 px-5 py-4">
            <p className="mb-1 font-semibold text-[var(--text-primary)]">
              先选择一个泡泡流
            </p>
            <span>再把需要的泡泡拖进箱列里整理。</span>
          </div>
        </div>
      )}

      {sourceBubbleListSection}

      {!isCollapsed && !isListView && currentStream && (
        <div className="s-source-composer">
          {selectedStreamCount > 1 && (
            <div className="s-source-composer-target">
              <span>当前发送目标</span>
              <strong>{currentStream.title}</strong>
            </div>
          )}
          <BubbleComposer
            draft={normalizedComposerDraft}
            placeholder={composerPlaceholder}
            disabled={composerDisabled}
            onDraftChange={(updater) => {
              onComposerDraftChange((prev) => toSortingComposerDraft(updater(buildComposerDraft(prev.text, prev.items))));
            }}
            onSend={onComposerSend}
            onFocus={onComposerFocus}
            onPaste={onComposerPaste}
            onDrop={onComposerDrop}
            onDragOver={onComposerDragOver}
            onOpenPhotoPicker={() => photoInputRef.current?.click()}
            onOpenFilePicker={() => fileInputRef.current?.click()}
          />

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={handleInputChange}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      )}
    </section>
  );
}
