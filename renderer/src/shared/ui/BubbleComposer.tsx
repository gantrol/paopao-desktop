import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEventHandler,
  type DragEventHandler,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react';
import { CompoundBubbleIcon } from '@/shared/icons/AvatarIcons';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileIcon,
  ImageIcon,
  LinkIcon,
  PlusIcon,
  SendIcon,
  TextIcon,
  XIcon,
} from '@/shared/icons/SortingIcons';
import {
  createMediaBubbleBlock,
  createTextBubbleBlock,
  getBubbleBlockPreviewText,
  type BubbleBlock,
  type BubbleDraftSource,
} from '@/entities/message';
import {
  getDraftBlocks,
  hasDraftContent,
  setDraftPrimaryText,
  updateDraftBlocks,
} from '@/features/send-message/model/bubbleDraft';
import type { DraftState } from '@/features/send-message/model/draft';
import { LinkPreviewCard } from '@/shared/ui/LinkPreviewCard';
import { UploadedItemPreview } from '@/shared/ui/UploadedItemPreview';

const PRIMARY_MIN_HEIGHT = 24;
const PRIMARY_MAX_HEIGHT = 160;
const BLOCK_TEXTAREA_MIN_HEIGHT = 84;
const BLOCK_TEXTAREA_MAX_HEIGHT = 220;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function syncTextareaHeight(
  node: HTMLTextAreaElement | null,
  options: { minHeight: number; maxHeight: number },
) {
  if (!node) return false;
  node.style.height = `${options.minHeight}px`;
  node.style.overflowY = 'hidden';
  const nextHeight = Math.min(options.maxHeight, Math.max(options.minHeight, node.scrollHeight));
  node.style.height = `${nextHeight}px`;
  if (node.scrollHeight > options.maxHeight) {
    node.style.overflowY = 'auto';
  }
  return nextHeight > options.minHeight;
}

function moveBlock(blocks: BubbleBlock[], blockId: string, delta: -1 | 1) {
  const currentIndex = blocks.findIndex((block) => block.id === blockId);
  if (currentIndex < 0) return blocks;
  const nextIndex = currentIndex + delta;
  if (nextIndex < 0 || nextIndex >= blocks.length) return blocks;
  const nextBlocks = blocks.map((block) => ({ ...block }));
  const [target] = nextBlocks.splice(currentIndex, 1);
  nextBlocks.splice(nextIndex, 0, target);
  return nextBlocks;
}

function ensureSupplementaryTextBlock(blocks: BubbleBlock[]) {
  if (blocks.length === 0) {
    return [createTextBubbleBlock(''), createTextBubbleBlock('')];
  }

  const firstTextIndex = blocks.findIndex((block) => block.type === 'text');
  if (firstTextIndex === -1) {
    return [createTextBubbleBlock(''), ...blocks, createTextBubbleBlock('')];
  }

  const nextBlocks = blocks.map((block) => ({ ...block }));
  const primaryText = nextBlocks[firstTextIndex].text || '';
  const hasSupplementary = nextBlocks.some((_, index) => index !== firstTextIndex);

  if (!hasSupplementary && primaryText.trim()) {
    nextBlocks[firstTextIndex] = {
      ...nextBlocks[firstTextIndex],
      text: '',
    };
    nextBlocks.push(createTextBubbleBlock(primaryText));
    return nextBlocks;
  }

  nextBlocks.push(createTextBubbleBlock(''));
  return nextBlocks;
}

function ComposerSourceChip({
  source,
  label,
  onClear,
}: {
  source: BubbleDraftSource;
  label: string;
  onClear?: () => void;
}) {
  const preview = source.snapshotBlocks
    .map((block) => getBubbleBlockPreviewText(block))
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="bubble-composer-source">
      <div className="bubble-composer-source__meta">
        <span>{label}</span>
        {onClear ? (
          <button
            type="button"
            className="bubble-composer-source__close"
            onClick={onClear}
            aria-label={`移除${label}`}
            title={`移除${label}`}
          >
            <XIcon size={14} />
          </button>
        ) : null}
      </div>
      <div className="bubble-composer-source__body">{preview || '原泡泡'}</div>
    </div>
  );
}

function BubbleDraftBlockCard({
  block,
  index,
  total,
  disabled,
  onChange,
  onMove,
  onRemove,
  onSend,
  canSend,
  onFsOpen,
  onAttachmentOpen,
}: {
  block: BubbleBlock;
  index: number;
  total: number;
  disabled: boolean;
  onChange: (patch: Partial<BubbleBlock>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onSend?: () => void;
  canSend: boolean;
  onFsOpen?: (src: string, type: 'img' | 'video') => void;
  onAttachmentOpen?: (src: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (block.type !== 'text') return;
    syncTextareaHeight(textareaRef.current, { minHeight: BLOCK_TEXTAREA_MIN_HEIGHT, maxHeight: BLOCK_TEXTAREA_MAX_HEIGHT });
  }, [block.type, block.text]);

  const blockLabel = block.type === 'text'
    ? '文本块'
    : block.type === 'image'
      ? '图片'
      : block.type === 'video'
        ? '视频'
        : block.type === 'audio'
          ? '音频'
          : block.type === 'file'
            ? '文件'
            : '链接';

  return (
    <div className="bubble-composer-block">
      <div className="bubble-composer-block__head">
        <span className="bubble-composer-block__type">{blockLabel}</span>
        <div className="bubble-composer-block__actions">
          <button
            type="button"
            className="bubble-composer-block__btn"
            disabled={index === 0 || disabled}
            onClick={() => onMove(-1)}
            aria-label="上移内容块"
            title="上移内容块"
          >
            <ArrowUpIcon size={13} />
          </button>
          <button
            type="button"
            className="bubble-composer-block__btn"
            disabled={index >= total - 1 || disabled}
            onClick={() => onMove(1)}
            aria-label="下移内容块"
            title="下移内容块"
          >
            <ArrowDownIcon size={13} />
          </button>
          <button
            type="button"
            className="bubble-composer-block__btn bubble-composer-block__btn--danger"
            disabled={disabled}
            onClick={onRemove}
            aria-label="删除内容块"
            title="删除内容块"
          >
            <XIcon size={13} />
          </button>
        </div>
      </div>

      {block.type === 'text' ? (
        <textarea
          ref={textareaRef}
          className="bubble-composer-block__textarea"
          placeholder="补充一个文本块..."
          value={block.text || ''}
          disabled={disabled}
          rows={3}
          onChange={(event) => {
            onChange({ text: event.target.value });
            syncTextareaHeight(event.target, { minHeight: BLOCK_TEXTAREA_MIN_HEIGHT, maxHeight: BLOCK_TEXTAREA_MAX_HEIGHT });
          }}
          onInput={(event) => syncTextareaHeight(event.currentTarget, { minHeight: BLOCK_TEXTAREA_MIN_HEIGHT, maxHeight: BLOCK_TEXTAREA_MAX_HEIGHT })}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !onSend) return;
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSend) {
              event.preventDefault();
              onSend();
            }
          }}
        />
      ) : null}

      {block.type === 'link' ? (
        <div className="space-y-3">
          <input
            type="url"
            className="bubble-composer-block__input"
            placeholder="粘贴链接 URL..."
            value={block.url || ''}
            disabled={disabled}
            onChange={(event) => onChange({ url: event.target.value })}
          />
          {(block.url || '').trim() ? <LinkPreviewCard url={(block.url || '').trim()} compact /> : null}
        </div>
      ) : null}

      {block.type === 'image' ? <UploadedItemPreview type="img" src={block.url || ''} fileName={block.fileName} onFsOpen={onFsOpen} onAttachmentOpen={onAttachmentOpen} /> : null}
      {block.type === 'video' ? <UploadedItemPreview type="video" src={block.url || ''} fileName={block.fileName} onFsOpen={onFsOpen} onAttachmentOpen={onAttachmentOpen} /> : null}
      {block.type === 'audio' ? <UploadedItemPreview type="audio" src={block.url || ''} fileName={block.fileName} onFsOpen={onFsOpen} onAttachmentOpen={onAttachmentOpen} /> : null}
      {block.type === 'file' ? (
        <div className="space-y-3">
          <input
            type="text"
            className="bubble-composer-block__input"
            placeholder="文件名称"
            value={block.fileName || ''}
            disabled={disabled}
            onChange={(event) => onChange({ fileName: event.target.value })}
          />
          <UploadedItemPreview type="file" src={block.url || ''} fileName={block.fileName || block.url} onFsOpen={onFsOpen} onAttachmentOpen={onAttachmentOpen} />
        </div>
      ) : null}
    </div>
  );
}

interface BubbleComposerProps {
  draft: DraftState;
  placeholder: string;
  disabled?: boolean;
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
  editBanner?: { title: string; onCancel: () => void } | null;
  onDraftChange: (updater: (prev: DraftState) => DraftState) => void;
  onSend: () => void;
  onFocus?: () => void;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onDrop?: DragEventHandler<HTMLTextAreaElement>;
  onDragOver?: DragEventHandler<HTMLTextAreaElement>;
  onOpenPhotoPicker?: () => void;
  onOpenFilePicker?: () => void;
  onCancelQuote?: () => void;
  onCancelForward?: () => void;
  onFsOpen?: (src: string, type: 'img' | 'video') => void;
  onAttachmentOpen?: (src: string) => void;
  showSendButton?: boolean;
  submitOnEnter?: boolean;
}

export function BubbleComposer({
  draft,
  placeholder,
  disabled = false,
  textareaRef,
  editBanner,
  onDraftChange,
  onSend,
  onFocus,
  onPaste,
  onDrop,
  onDragOver,
  onOpenPhotoPicker,
  onOpenFilePicker,
  onCancelQuote,
  onCancelForward,
  onFsOpen,
  onAttachmentOpen,
  showSendButton = true,
  submitOnEnter = true,
}: BubbleComposerProps) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const inputShellRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const canSend = !disabled && hasDraftContent(draft);
  const blocks = getDraftBlocks(draft, { includePlaceholder: true });
  const primaryTextIndex = blocks.findIndex((block) => block.type === 'text');
  const primaryText = primaryTextIndex >= 0 ? (blocks[primaryTextIndex].text || '') : '';
  const supplementaryBlocks = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ index }) => index !== primaryTextIndex);
  const hasSourceChip = Boolean(draft.forwardSource?.targetMessageId || draft.quoteSource?.targetMessageId);
  const hasExpandedSurface = Boolean(editBanner || hasSourceChip || supplementaryBlocks.length > 0);

  const syncPrimaryTextarea = useCallback((node: HTMLTextAreaElement | null) => {
    const expanded = syncTextareaHeight(node, { minHeight: PRIMARY_MIN_HEIGHT, maxHeight: PRIMARY_MAX_HEIGHT });
    setIsExpanded((prev) => (prev === expanded ? prev : expanded));
  }, []);

  useLayoutEffect(() => {
    syncPrimaryTextarea(innerRef.current);
  }, [primaryText, syncPrimaryTextarea]);

  useEffect(() => {
    const node = innerRef.current;
    const shell = inputShellRef.current;
    if (!node || !shell || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        syncPrimaryTextarea(node);
      });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [syncPrimaryTextarea]);

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!disabled) return;
    setToolsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (hasDraftContent(draft)) return;
    setToolsOpen(false);
  }, [draft]);

  const assignTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    innerRef.current = node;
    if (textareaRef) {
      textareaRef.current = node;
    }
    syncPrimaryTextarea(node);
  }, [syncPrimaryTextarea, textareaRef]);

  const mutateBlocks = useCallback((updater: (blocks: BubbleBlock[]) => BubbleBlock[]) => {
    onDraftChange((prev) => updateDraftBlocks(prev, updater(getDraftBlocks(prev))));
  }, [onDraftChange]);

  const handlePrimaryChange = useCallback((value: string) => {
    if (value === primaryText) return;
    onDraftChange((prev) => updateDraftBlocks(prev, setDraftPrimaryText(getDraftBlocks(prev), value)));
  }, [onDraftChange, primaryText]);

  const handlePrimaryKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!submitOnEnter || !showSendButton || event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  }, [canSend, onSend, showSendButton, submitOnEnter]);

  const handleFocus = useCallback(() => {
    setToolsOpen(false);
    onFocus?.();
  }, [onFocus]);

  const handleAddTextBlock = useCallback(() => {
    mutateBlocks((current) => ensureSupplementaryTextBlock(current));
    setToolsOpen(false);
  }, [mutateBlocks]);

  const handleAddLinkBlock = useCallback(() => {
    mutateBlocks((current) => [...current, createMediaBubbleBlock('link', '')]);
    setToolsOpen(false);
  }, [mutateBlocks]);

  const handleToggleTools = useCallback(() => {
    if (disabled) return;
    setToolsOpen((prev) => !prev);
  }, [disabled]);

  return (
    <div className={cn('bubble-composer', disabled && 'is-disabled')}>
      {hasExpandedSurface ? (
        <div className="bubble-composer-surface">
          {editBanner ? (
            <div className="bubble-composer-banner">
              <div className="bubble-composer-banner__copy">
                <span className="bubble-composer-banner__label">编辑中</span>
                <strong>{editBanner.title}</strong>
              </div>
              <button
                type="button"
                className="bubble-composer-banner__cancel"
                onClick={editBanner.onCancel}
                aria-label="取消编辑"
                title="取消编辑"
              >
                <XIcon size={14} />
              </button>
            </div>
          ) : null}

          {draft.forwardSource?.targetMessageId ? (
            <ComposerSourceChip source={draft.forwardSource} label="转发来源" onClear={onCancelForward} />
          ) : null}
          {draft.quoteSource?.targetMessageId ? (
            <ComposerSourceChip source={draft.quoteSource} label="引用来源" onClear={onCancelQuote} />
          ) : null}

          {supplementaryBlocks.length > 0 ? (
            <div className="bubble-composer-blocks">
              {supplementaryBlocks.map(({ block }, index) => (
                <BubbleDraftBlockCard
                  key={block.id}
                  block={block}
                  index={index}
                  total={supplementaryBlocks.length}
                  disabled={disabled}
                  canSend={canSend}
                  onSend={showSendButton ? onSend : undefined}
                  onChange={(patch) => mutateBlocks((current) => current.map((item) => (
                    item.id === block.id
                      ? {
                          ...item,
                          ...patch,
                        }
                      : item
                  )))}
                  onMove={(delta) => mutateBlocks((current) => moveBlock(current, block.id, delta))}
                  onRemove={() => mutateBlocks((current) => current.filter((item) => item.id !== block.id))}
                  onFsOpen={onFsOpen}
                  onAttachmentOpen={onAttachmentOpen}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={cn('bubble-composer-bar', isExpanded && 'is-expanded')}>
        <button
          type="button"
          className={cn('bubble-composer-icon-btn', toolsOpen && 'is-active')}
          onClick={handleToggleTools}
          disabled={disabled}
          aria-label="打开更多工具"
          title="打开更多工具"
        >
          <PlusIcon size={16} />
        </button>

        <div ref={inputShellRef} className="bubble-composer-input-shell">
          <textarea
            ref={assignTextareaRef}
            className="bubble-composer-input"
            rows={1}
            value={primaryText}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => {
              handlePrimaryChange(event.target.value);
              syncPrimaryTextarea(event.target);
            }}
            onInput={(event) => syncPrimaryTextarea(event.currentTarget)}
            onFocus={handleFocus}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onKeyDown={handlePrimaryKeyDown}
          />
        </div>

        <button
          type="button"
          className="bubble-composer-icon-btn bubble-composer-icon-btn--compound"
          onClick={handleAddTextBlock}
          disabled={disabled}
          aria-label="添加文本块"
          title="添加文本块"
        >
          <CompoundBubbleIcon style={{ width: 26, height: 26 }} />
        </button>

        {showSendButton ? (
          <button
            type="button"
            className={cn('bubble-composer-icon-btn', 'bubble-composer-icon-btn--send', canSend && 'is-active')}
            onClick={onSend}
            disabled={!canSend}
            aria-label="发送消息"
            title="发送消息"
          >
            <SendIcon size={16} />
          </button>
        ) : null}
      </div>

      <div className={cn('bubble-composer-tool-panel', toolsOpen && 'open')}>
        <button
          type="button"
          className="bubble-composer-tool-item"
          onClick={handleAddTextBlock}
          disabled={disabled}
          aria-label="添加文本块"
          title="添加文本块"
        >
          <span className="bubble-composer-tool-item__icon">
            <TextIcon size={16} />
          </span>
          <span className="bubble-composer-tool-item__label">文本块</span>
        </button>
        <button
          type="button"
          className="bubble-composer-tool-item"
          onClick={() => {
            onOpenPhotoPicker?.();
            setToolsOpen(false);
          }}
          disabled={disabled || !onOpenPhotoPicker}
          aria-label="添加图片或视频"
          title="添加图片或视频"
        >
          <span className="bubble-composer-tool-item__icon">
            <ImageIcon size={16} />
          </span>
          <span className="bubble-composer-tool-item__label">图片 / 视频</span>
        </button>
        <button
          type="button"
          className="bubble-composer-tool-item"
          onClick={() => {
            onOpenFilePicker?.();
            setToolsOpen(false);
          }}
          disabled={disabled || !onOpenFilePicker}
          aria-label="添加文件或音频"
          title="添加文件或音频"
        >
          <span className="bubble-composer-tool-item__icon">
            <FileIcon size={16} />
          </span>
          <span className="bubble-composer-tool-item__label">文件 / 音频</span>
        </button>
        <button
          type="button"
          className="bubble-composer-tool-item"
          onClick={handleAddLinkBlock}
          disabled={disabled}
          aria-label="添加链接"
          title="添加链接"
        >
          <span className="bubble-composer-tool-item__icon">
            <LinkIcon size={16} />
          </span>
          <span className="bubble-composer-tool-item__label">链接</span>
        </button>
      </div>
    </div>
  );
}
