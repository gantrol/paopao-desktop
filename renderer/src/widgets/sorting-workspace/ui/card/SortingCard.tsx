import { memo, type MouseEvent } from 'react';
import { BubbleItem } from '@/shared/ui/BubbleItem';
import { InitialAvatar } from '@/shared/ui/StreamAvatar';
import type { MessageData } from '@/entities/message';
import type { SortingBoxView, SortingCardView } from '@/entities/sorting';
import { BoxIcon } from '../icons';
import type { SortingBubbleDraft, SortingBubbleSourceInfo } from '../types';
import {
  cx,
  buildSortingBubbleMessage,
  formatDateTime,
  formatSortingSourceBadge,
  getSortingCardTypeLabel,
  isSortingBoxShortcut,
} from '../utils';

const SortingSourceBubbleCardInner = ({
  bubble,
  bubbleKey,
  streamTitle,
  showSourceTag = false,
  isHighlighted = false,
  isDragging,
  isDragOrigin = false,
  onOpenThread,
  onContextMenu,
}: {
  bubble: MessageData;
  bubbleKey: string;
  streamTitle: string;
  showSourceTag?: boolean;
  isHighlighted?: boolean;
  isDragging: boolean;
  isDragOrigin?: boolean;
  onOpenThread?: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
}) => {
  return (
    <div
      className={cx(
        's-sorting-bubble-entry',
        's-source-bubble-card',
        isDragging && 'is-dragging',
        isDragOrigin && 'is-drag-origin',
        isHighlighted && 'is-highlighted',
      )}
      onContextMenu={onContextMenu}
      data-bubble-type={bubble.type}
      data-sorting-source-key={bubbleKey}
    >
      <div className="s-sorting-bubble-meta">
        <div className="s-sorting-bubble-meta__left">
          {showSourceTag ? <em className="s-source-bubble-card__tag">{streamTitle}</em> : null}
          <span className="s-sorting-bubble-type">泡泡</span>
        </div>
        <span className="s-sorting-bubble-time">{bubble.time ? formatDateTime(bubble.time) : '刚刚'}</span>
      </div>
      <BubbleItem msg={bubble} displayMode="sorting" onOpenThread={onOpenThread ? () => onOpenThread() : undefined} />
    </div>
  );
};

const SortingBubbleNodeInner = ({
  item,
  boxes,
  sourceInfo,
  isDragging,
  isDimmed = false,
  useInitialBoxAvatar = false,
  isEditing,
  editingDraft,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onOpenCommentPicker,
  onDoubleClick,
  onContextMenu,
}: {
  item: SortingCardView;
  boxes: SortingBoxView[];
  sourceInfo?: SortingBubbleSourceInfo | null;
  isDragging: boolean;
  isDimmed?: boolean;
  useInitialBoxAvatar?: boolean;
  enableOverflowCollapse?: boolean;
  isOverflowExpanded?: boolean;
  isEditing: boolean;
  editingDraft: SortingBubbleDraft | null;
  onDraftChange: (patch: Partial<SortingBubbleDraft>) => void;
  onToggleOverflowExpanded?: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onOpenCommentPicker?: () => void;
  onDoubleClick: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
}) => {
  const sourceBadge = formatSortingSourceBadge(sourceInfo);
  const timeLabel = formatDateTime(item.updatedAt || item.createdAt);
  const cardTypeLabel = getSortingCardTypeLabel(item);
  const targetBox = item.type === 'box'
    ? boxes.find((box) => box.id === item.childBoxId) || null
    : null;

  if (item.type === 'box') {
    const boxBadgeLabel = isSortingBoxShortcut(item) ? '快捷方式' : '箱子';
    return (
      <div
        className={cx('s-node-card is-box', isDragging && 'is-dragging', isDimmed && 'is-dimmed')}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <div className="s-node-card-head">
          <span className="s-node-card-badge is-muted">{boxBadgeLabel}</span>
        </div>
        <div className="s-node-card-boxline">
          {useInitialBoxAvatar ? (
            <InitialAvatar
              label={targetBox?.name || '未知箱子'}
              seed={targetBox?.id || item.childBoxId || item.id}
              tone={targetBox?.tone}
              className="s-node-card-icon rounded-xl"
              textClassName="text-[13px] font-semibold text-white"
            />
          ) : (
            <div className="s-node-card-icon">
              <BoxIcon size={16} />
            </div>
          )}
          <div className="s-node-card-copy">
            <strong>{targetBox?.name || '未知箱子'}</strong>
            <span>双击进入</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx('s-sorting-bubble-entry', 's-node-card', isDragging && 'is-dragging', isDimmed && 'is-dimmed')}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      data-sorting-bubble-id={item.id}
    >
      <div className="s-sorting-bubble-meta">
        <div className="s-sorting-bubble-meta__left">
          {sourceBadge ? <span className="s-node-card-badge">{sourceBadge}</span> : <span className="s-node-card-badge is-muted">手动</span>}
          <span className="s-sorting-bubble-type">
            <span>{cardTypeLabel}</span>
          </span>
        </div>
        <span className="s-sorting-bubble-time">{timeLabel}</span>
      </div>
      <BubbleItem
        msg={buildSortingBubbleMessage(item)}
        displayMode="sorting"
        onOpenThread={onOpenCommentPicker ? () => onOpenCommentPicker() : undefined}
      />
    </div>
  );
};

export const SortingSourceBubbleCard = memo(SortingSourceBubbleCardInner);
export const SortingBubbleNode = memo(SortingBubbleNodeInner);
