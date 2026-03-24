import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
  TouchEventHandler,
} from 'react';
import { type MessageData } from '@/entities/message';
import { BubbleItem } from '@/shared/ui/BubbleItem';
import { formatConversationDividerTime, formatTime } from '@/shared/lib/time';
import { publicIcon } from '@/shared/lib/asset';

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

interface ConversationFeedEntryProps {
  message: MessageData;
  rowId?: string;
  avatarSrc?: string;
  senderName?: string | null;
  showAvatar?: boolean;
  timestampLabel?: string | null;
  sourceLabel?: string | null;
  highlighted?: boolean;
  highlightedMsg?: string | null;
  surface?: 'plain' | 'card';
  displayMode?: 'default' | 'sorting';
  className?: string;
  onJumpToMsg?: (id: string, blockId?: string) => void;
  onFsOpen?: (src: string, type: 'img' | 'video') => void;
  onAttachmentOpen?: (src: string) => void;
  onTouchStart?: (event: ReactTouchEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  onTouchEnd?: TouchEventHandler;
  onTouchMove?: TouchEventHandler;
  onContextMenu?: (event: ReactMouseEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  onContainerContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onOpenThread?: (msgId: string, blockId?: string) => void;
  onToggleLike?: (msgId: string, blockId?: string) => void;
  onForward?: (msgId: string) => void;
  replyCount?: number;
  replyCountByBlock?: Record<string, number>;
}

export function ConversationFeedEntry({
  message,
  rowId,
  avatarSrc,
  senderName,
  showAvatar = true,
  timestampLabel,
  sourceLabel,
  highlighted = false,
  highlightedMsg,
  surface = 'plain',
  displayMode = 'default',
  className,
  onJumpToMsg,
  onFsOpen,
  onAttachmentOpen,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  onContextMenu,
  onContainerContextMenu,
  onOpenThread,
  onToggleLike,
  onForward,
  replyCount,
  replyCountByBlock,
}: ConversationFeedEntryProps) {
  const hasMetaRow = surface === 'card' && Boolean(message.time);

  return (
    <div
      id={rowId}
      className={cn(
        'conversation-feed-entry',
        surface === 'card' && 'conversation-feed-entry--card',
        className,
      )}
      onContextMenu={onContainerContextMenu}
    >
      {message.time ? (
        hasMetaRow ? (
          <div className="conversation-feed-meta">
            <span className="conversation-feed-time">{formatTime(message.time)}</span>
            {sourceLabel ? <em className="s-source-chip">{sourceLabel}</em> : <span />}
          </div>
        ) : timestampLabel ? (
          <div className="time-stamp">{timestampLabel || formatConversationDividerTime(message.time)}</div>
        ) : null
      ) : null}
      <div className={cn('msg-row', message.role === 'me' && 'me', highlighted && 'highlight', !showAvatar && 'msg-row--compact')}>
        {showAvatar ? (
          <div className="avatar">
            <img src={avatarSrc || publicIcon('ai_avatar.svg')} alt="avatar" />
          </div>
        ) : null}
        <div className={cn('bubble-wrapper', !showAvatar && 'bubble-wrapper--full')}>
          {message.role !== 'me' && senderName ? (
            <div className="conversation-feed-sender">{senderName}</div>
          ) : null}
          <BubbleItem
            msg={message}
            onJumpToMsg={onJumpToMsg}
            onFsOpen={onFsOpen}
            onAttachmentOpen={onAttachmentOpen}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchMove={onTouchMove}
            onContextMenu={onContextMenu}
            onOpenThread={onOpenThread}
            onToggleLike={onToggleLike}
            onForward={onForward}
            highlightedMsg={highlightedMsg ?? (highlighted ? message.id : null)}
            displayMode={displayMode}
            replyCount={replyCount}
            replyCountByBlock={replyCountByBlock}
          />
        </div>
      </div>
    </div>
  );
}
