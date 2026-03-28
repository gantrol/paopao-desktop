import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { BubbleComposer } from '@/shared/ui/BubbleComposer';
import { BubbleItem } from '@/shared/ui/BubbleItem';
import { ExpandIcon } from '@/shared/icons/SortingIcons';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { InlineSearchControl } from '@/shared/ui/InlineSearchControl';
import type { PaneLimit } from '@/shared/hooks/useBoundedPaneSize';
import { AI_AVATAR } from '@/shared/config/avatar';
import { getMessageAvatarSrc } from '@/shared/lib/avatar';
import type { MessageData } from '@/entities/message';
import type { UserProfileRecord } from '@/entities/user';
import type { DraftState } from './model';
import { publicIcon } from '@/shared/lib/asset';

interface ThreadPaneProps {
  threadMsgId: string | null;
  threadBlockId?: string;
  threadMsg: MessageData | null;
  threadReplies: MessageData[];
  highlightedReplyMessageId?: string | null;
  searchQuery?: string;
  searchOpen?: boolean;
  searchPanelOpen?: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchResultsView?: ReactNode;
  isCollapsed: boolean;
  limit: PaneLimit;
  currentUserAvatar: string;
  currentChannelAvatarUrl: string;
  isCurrentConversationDirect: boolean;
  threadTitle?: string | null;
  userProfile: UserProfileRecord;
  currentThreadDraft: DraftState;
  threadComposerEditBanner?: { title: string; onCancel: () => void } | null;
  threadInputRef: RefObject<HTMLTextAreaElement | null>;
  threadPhotoInputRef: RefObject<HTMLInputElement | null>;
  threadFileInputRef: RefObject<HTMLInputElement | null>;
  replyCountByMessageId: Record<string, number>;
  replyCountByMessageBlockId: Record<string, number>;
  onResize: (delta: number) => void;
  onBackToChat: () => void;
  onClose: () => void;
  onExpand: () => void;
  onToggleSearch?: () => void;
  onSearchQueryChange?: (value: string) => void;
  onSearchInputFocus?: () => void;
  onSearchInputKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onClearSearch?: () => void;
  onJumpToMsg: (targetId: string, blockId?: string) => void;
  onOpenThread: (messageId: string, blockId?: string) => void;
  onToggleLike: (messageId: string, blockId?: string) => void;
  onForwardMessage: (messageId: string) => void;
  onOpenFullscreen: (src: string, type: 'img' | 'video') => void;
  onOpenAttachment: (src: string) => void | Promise<void>;
  onTouchStart: (event: ReactTouchEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  onTouchEnd: () => void;
  onContextMenu: (event: ReactMouseEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  updateCurrentThreadDraft: (updater: (prev: DraftState) => DraftState) => void;
  onSendReply: () => void;
  onHandleThreadFiles: (files: File[]) => void | Promise<void>;
  onFocusComposer: () => void;
  presentation?: 'pane' | 'dialog' | 'window';
  onOpenDialog?: () => void;
}

function groupReplyCountByMessageBlock(replyCountByMessageBlockId: Record<string, number>) {
  const result: Record<string, Record<string, number>> = {};
  Object.entries(replyCountByMessageBlockId).forEach(([key, count]) => {
    const separatorIndex = key.indexOf(':');
    if (separatorIndex <= 0) return;
    const messageId = key.slice(0, separatorIndex);
    const blockId = key.slice(separatorIndex + 1);
    if (!messageId || !blockId) return;
    if (!result[messageId]) {
      result[messageId] = {};
    }
    result[messageId][blockId] = count;
  });
  return result;
}

function ThreadEntry({
  message,
  avatarSrc,
  senderName,
  highlightedMsg,
  highlightedReplyMessageId,
  replyCountByMessageId,
  replyCountByMessageBlockId,
  onJumpToMsg,
  onOpenThread,
  onToggleLike,
  onForwardMessage,
  onOpenFullscreen,
  onOpenAttachment,
  onTouchStart,
  onTouchEnd,
  onContextMenu,
}: {
  message: MessageData;
  avatarSrc: string;
  senderName: string;
  highlightedMsg?: string | null;
  highlightedReplyMessageId?: string | null;
  replyCountByMessageId: Record<string, number>;
  replyCountByMessageBlockId: Record<string, number>;
  onJumpToMsg: (targetId: string, blockId?: string) => void;
  onOpenThread: (messageId: string, blockId?: string) => void;
  onToggleLike: (messageId: string, blockId?: string) => void;
  onForwardMessage: (messageId: string) => void;
  onOpenFullscreen: (src: string, type: 'img' | 'video') => void;
  onOpenAttachment: (src: string) => void | Promise<void>;
  onTouchStart: (event: ReactTouchEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  onTouchEnd: () => void;
  onContextMenu: (event: ReactMouseEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
}) {
  return (
    <div
      className={`thread-comment-item ${highlightedReplyMessageId === message.id ? 'is-highlighted' : ''}`}
      data-thread-reply-id={message.id}
    >
      <img src={avatarSrc} className="thread-avatar" alt="Avatar" />
      <div className="thread-content">
        <div className="thread-name">{senderName}</div>
        <div className="thread-text">
          <BubbleItem
            msg={message}
            onJumpToMsg={onJumpToMsg}
            onOpenThread={onOpenThread}
            onToggleLike={onToggleLike}
            onForward={onForwardMessage}
            onFsOpen={onOpenFullscreen}
            onAttachmentOpen={(src) => { void onOpenAttachment(src); }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchMove={onTouchEnd}
            onContextMenu={onContextMenu}
            highlightedMsg={highlightedMsg}
            replyCount={replyCountByMessageId[message.id] || 0}
            replyCountByBlock={replyCountByMessageBlockId}
          />
        </div>
      </div>
    </div>
  );
}

interface ThreadEntriesPaneProps {
  threadMsg: MessageData | null;
  threadReplies: MessageData[];
  threadBlockId?: string;
  highlightedReplyMessageId?: string | null;
  currentUserAvatar: string;
  currentChannelAvatarUrl: string;
  isCurrentConversationDirect: boolean;
  replyCountByMessageId: Record<string, number>;
  replyCountByMessageBlockId: Record<string, number>;
  onJumpToMsg: (targetId: string, blockId?: string) => void;
  onOpenThread: (messageId: string, blockId?: string) => void;
  onToggleLike: (messageId: string, blockId?: string) => void;
  onForwardMessage: (messageId: string) => void;
  onOpenFullscreen: (src: string, type: 'img' | 'video') => void;
  onOpenAttachment: (src: string) => void | Promise<void>;
  onTouchStart: (event: ReactTouchEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
  onTouchEnd: () => void;
  onContextMenu: (event: ReactMouseEvent, msg: MessageData, blockId?: string, subIndex?: number) => void;
}

const ThreadEntriesPane = memo(function ThreadEntriesPane({
  threadMsg,
  threadReplies,
  threadBlockId,
  highlightedReplyMessageId,
  currentUserAvatar,
  currentChannelAvatarUrl,
  isCurrentConversationDirect,
  replyCountByMessageId,
  replyCountByMessageBlockId,
  onJumpToMsg,
  onOpenThread,
  onToggleLike,
  onForwardMessage,
  onOpenFullscreen,
  onOpenAttachment,
  onTouchStart,
  onTouchEnd,
  onContextMenu,
}: ThreadEntriesPaneProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const replyCountByMessageIdMap = useMemo(
    () => groupReplyCountByMessageBlock(replyCountByMessageBlockId),
    [replyCountByMessageBlockId],
  );
  const threadEntries = useMemo(() => {
    if (!threadMsg) return null;
    return (
      <>
        <ThreadEntry
          message={threadMsg}
          avatarSrc={getMessageAvatarSrc(threadMsg, {
            userAvatarUrl: currentUserAvatar,
            conversationAvatarUrl: currentChannelAvatarUrl,
            fallbackAvatar: AI_AVATAR,
            forceConversationAvatar: isCurrentConversationDirect,
          })}
          senderName={threadMsg.role === 'me' ? '原泡泡 · 我' : `原泡泡 · ${threadMsg.senderName || '助手'}`}
          highlightedMsg={threadBlockId ? `${threadMsg.id}:${threadBlockId}` : threadMsg.id}
          highlightedReplyMessageId={highlightedReplyMessageId}
          replyCountByMessageId={replyCountByMessageId}
          replyCountByMessageBlockId={replyCountByMessageIdMap[threadMsg.id] || {}}
          onJumpToMsg={onJumpToMsg}
          onOpenThread={onOpenThread}
          onToggleLike={onToggleLike}
          onForwardMessage={onForwardMessage}
          onOpenFullscreen={onOpenFullscreen}
          onOpenAttachment={onOpenAttachment}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onContextMenu={onContextMenu}
        />
        {threadReplies.map((reply) => (
          <ThreadEntry
            key={reply.id}
            message={reply}
            avatarSrc={getMessageAvatarSrc(reply, {
              userAvatarUrl: currentUserAvatar,
              conversationAvatarUrl: currentChannelAvatarUrl || AI_AVATAR,
              fallbackAvatar: AI_AVATAR,
              forceConversationAvatar: isCurrentConversationDirect,
            })}
            senderName={reply.role === 'me' ? '我' : (reply.senderName || '助手')}
            highlightedReplyMessageId={highlightedReplyMessageId}
            replyCountByMessageId={replyCountByMessageId}
            replyCountByMessageBlockId={replyCountByMessageIdMap[reply.id] || {}}
            onJumpToMsg={onJumpToMsg}
            onOpenThread={onOpenThread}
            onToggleLike={onToggleLike}
            onForwardMessage={onForwardMessage}
            onOpenFullscreen={onOpenFullscreen}
            onOpenAttachment={onOpenAttachment}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onContextMenu={onContextMenu}
          />
        ))}
      </>
    );
  }, [
    currentChannelAvatarUrl,
    currentUserAvatar,
    isCurrentConversationDirect,
    onForwardMessage,
    onJumpToMsg,
    onOpenAttachment,
    onOpenFullscreen,
    onOpenThread,
    onContextMenu,
    onTouchEnd,
    onTouchStart,
    onToggleLike,
    replyCountByMessageId,
    replyCountByMessageIdMap,
    threadBlockId,
    threadMsg,
    threadReplies,
  ]);

  useEffect(() => {
    if (!highlightedReplyMessageId) return;
    const container = scrollRef.current;
    if (!container) return;
    const selector = `[data-thread-reply-id="${highlightedReplyMessageId}"]`;
    const target = container.querySelector<HTMLElement>(selector);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedReplyMessageId, threadReplies]);

  return (
    <div className="thread-scroll" ref={scrollRef}>
      {threadEntries}
    </div>
  );
});

export function ThreadPane({
  threadMsgId,
  threadBlockId,
  threadMsg,
  threadReplies,
  highlightedReplyMessageId,
  searchQuery = '',
  searchOpen = false,
  searchPanelOpen = false,
  searchInputRef,
  searchResultsView,
  isCollapsed,
  limit,
  currentUserAvatar,
  currentChannelAvatarUrl,
  isCurrentConversationDirect,
  threadTitle,
  userProfile,
  currentThreadDraft,
  threadComposerEditBanner,
  threadInputRef,
  threadPhotoInputRef,
  threadFileInputRef,
  replyCountByMessageId,
  replyCountByMessageBlockId,
  onResize,
  onBackToChat,
  onClose,
  onExpand,
  onToggleSearch,
  onSearchQueryChange,
  onSearchInputFocus,
  onSearchInputKeyDown,
  onClearSearch,
  onJumpToMsg,
  onOpenThread,
  onToggleLike,
  onForwardMessage,
  onOpenFullscreen,
  onOpenAttachment,
  onTouchStart,
  onTouchEnd,
  onContextMenu,
  updateCurrentThreadDraft,
  onSendReply,
  onHandleThreadFiles,
  onFocusComposer,
  presentation = 'pane',
  onOpenDialog,
}: ThreadPaneProps) {
  const threadHeading = threadTitle?.trim() || null;
  const isDialog = presentation === 'dialog';
  const isWindow = presentation === 'window';
  const searchControl = onToggleSearch && onSearchQueryChange && onSearchInputKeyDown && onClearSearch && searchInputRef ? (
    <InlineSearchControl
      open={searchOpen}
      panelOpen={searchPanelOpen}
      query={searchQuery}
      placeholder="搜当前详情页"
      buttonLabel="搜索当前详情页"
      className="inline-search--thread"
      inputRef={searchInputRef}
      resultsView={searchResultsView}
      onToggle={onToggleSearch}
      onQueryChange={onSearchQueryChange}
      onInputFocus={onSearchInputFocus}
      onInputKeyDown={onSearchInputKeyDown}
      onClear={onClearSearch}
    />
  ) : null;

  if (isDialog || isWindow) {
    if (threadMsgId === null) return null;

    return (
      <div className={`pane thread-pane ${isDialog ? 'thread-pane--dialog' : 'thread-pane--window'}`}>
        <div className="thread-header">
          <div className="nav-left-actions">
            <button type="button" className="nav-back-btn thread-back-btn" onClick={onBackToChat} aria-label="返回">
              <img src={publicIcon('nav_back.svg')} className="nav-icon" alt="back" style={{ width: 20 }} />
            </button>
            <div className="thread-header-copy" style={{ marginLeft: 8 }}>
              <span>评论</span>
              {threadHeading ? <small className="thread-header-subtitle">{threadHeading}</small> : null}
            </div>
          </div>
          <div className="nav-right-actions">
            {searchControl}
            <button type="button" className="thread-close-btn" onClick={onClose} aria-label={isWindow ? '关闭评论窗口' : '关闭评论弹窗'}>
              ×
            </button>
          </div>
        </div>
        <ThreadEntriesPane
          threadMsg={threadMsg}
          threadReplies={threadReplies}
          threadBlockId={threadBlockId}
          highlightedReplyMessageId={highlightedReplyMessageId}
          currentUserAvatar={currentUserAvatar}
          currentChannelAvatarUrl={currentChannelAvatarUrl}
          isCurrentConversationDirect={isCurrentConversationDirect}
          replyCountByMessageId={replyCountByMessageId}
          replyCountByMessageBlockId={replyCountByMessageBlockId}
          onJumpToMsg={onJumpToMsg}
          onOpenThread={onOpenThread}
          onToggleLike={onToggleLike}
          onForwardMessage={onForwardMessage}
          onOpenFullscreen={onOpenFullscreen}
          onOpenAttachment={onOpenAttachment}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onContextMenu={onContextMenu}
        />
        <ThreadComposer
          threadMsgId={threadMsgId}
          currentThreadDraft={currentThreadDraft}
          threadComposerEditBanner={threadComposerEditBanner}
          threadInputRef={threadInputRef}
          threadPhotoInputRef={threadPhotoInputRef}
          threadFileInputRef={threadFileInputRef}
          updateCurrentThreadDraft={updateCurrentThreadDraft}
          onSendReply={onSendReply}
          onHandleThreadFiles={onHandleThreadFiles}
          onOpenFullscreen={onOpenFullscreen}
          onOpenAttachment={onOpenAttachment}
          onFocusComposer={onFocusComposer}
        />
      </div>
    );
  }

  if (threadMsgId === null) {
    return (
      <div className="pane thread-pane">
        <div className="thread-header">
          <div className="nav-left-actions">
            <button type="button" className="nav-back-btn thread-back-btn" onClick={onBackToChat} aria-label="返回">
              <img src={publicIcon('nav_back.svg')} className="nav-icon" alt="back" style={{ width: 20 }} />
            </button>
            <div className="thread-header-copy" style={{ marginLeft: 8 }}>
              <span>评论</span>
            </div>
          </div>
          <div className="thread-close-btn desktop-only" onClick={onClose}>×</div>
        </div>
        <ThreadEntriesPane
          threadMsg={null}
          threadReplies={[]}
          threadBlockId={threadBlockId}
          highlightedReplyMessageId={highlightedReplyMessageId}
          currentUserAvatar={currentUserAvatar}
          currentChannelAvatarUrl={currentChannelAvatarUrl}
          isCurrentConversationDirect={isCurrentConversationDirect}
          replyCountByMessageId={replyCountByMessageId}
          replyCountByMessageBlockId={replyCountByMessageBlockId}
          onJumpToMsg={onJumpToMsg}
          onOpenThread={onOpenThread}
          onToggleLike={onToggleLike}
          onForwardMessage={onForwardMessage}
          onOpenFullscreen={onOpenFullscreen}
          onOpenAttachment={onOpenAttachment}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onContextMenu={onContextMenu}
        />
        <ThreadComposer
          threadMsgId={threadMsgId}
          currentThreadDraft={currentThreadDraft}
          threadComposerEditBanner={threadComposerEditBanner}
          threadInputRef={threadInputRef}
          threadPhotoInputRef={threadPhotoInputRef}
          threadFileInputRef={threadFileInputRef}
          updateCurrentThreadDraft={updateCurrentThreadDraft}
          onSendReply={onSendReply}
          onHandleThreadFiles={onHandleThreadFiles}
          onOpenFullscreen={onOpenFullscreen}
          onOpenAttachment={onOpenAttachment}
          onFocusComposer={onFocusComposer}
        />
      </div>
    );
  }

  return (
    <div className="pane-edge-wrapper pane-edge-wrapper--thread">
      <ResizeHandle className="pane-resize-handle pane-resize-handle--thread desktop-only" onDrag={onResize} ariaLabel="调整右侧评论边栏宽度" limit={limit} />
      <div className={`pane thread-pane${isCollapsed ? ' thread-pane--collapsed' : ''}`}>
        {isCollapsed ? (
          <div className="thread-collapsed-rail">
            <button
              type="button"
              className="thread-collapsed-trigger"
              onClick={onExpand}
              aria-label="展开评论区"
              title="展开评论区"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.53-.29-3.63-.8L3 21l1.73-4.63A8.46 8.46 0 0 1 4 11.5 8.5 8.5 0 1 1 21 11.5Z" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            <div className="thread-header">
              <div className="nav-left-actions">
                <button type="button" className="nav-back-btn thread-back-btn" onClick={onBackToChat} aria-label="返回">
                  <img src={publicIcon('nav_back.svg')} className="nav-icon" alt="back" style={{ width: 20 }} />
                </button>
                <div className="thread-header-copy" style={{ marginLeft: 8 }}>
                  <span>评论</span>
                  {threadHeading ? <small className="thread-header-subtitle">{threadHeading}</small> : null}
                </div>
              </div>
              <div className="nav-right-actions">
                {searchControl}
                {onOpenDialog ? (
                  <button
                    type="button"
                    className="nav-icon desktop-only"
                    onClick={onOpenDialog}
                    aria-label="弹出评论区"
                    title="弹出评论区"
                  >
                    <ExpandIcon size={16} />
                  </button>
                ) : null}
                <div className="thread-close-btn desktop-only" onClick={onClose}>×</div>
              </div>
            </div>
            <ThreadEntriesPane
              threadMsg={threadMsg}
              threadReplies={threadReplies}
              threadBlockId={threadBlockId}
              highlightedReplyMessageId={highlightedReplyMessageId}
              currentUserAvatar={currentUserAvatar}
              currentChannelAvatarUrl={currentChannelAvatarUrl}
              isCurrentConversationDirect={isCurrentConversationDirect}
              replyCountByMessageId={replyCountByMessageId}
              replyCountByMessageBlockId={replyCountByMessageBlockId}
              onJumpToMsg={onJumpToMsg}
              onOpenThread={onOpenThread}
              onToggleLike={onToggleLike}
              onForwardMessage={onForwardMessage}
              onOpenFullscreen={onOpenFullscreen}
              onOpenAttachment={onOpenAttachment}
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
              onContextMenu={onContextMenu}
            />
            <ThreadComposer
              threadMsgId={threadMsgId}
              currentThreadDraft={currentThreadDraft}
              threadComposerEditBanner={threadComposerEditBanner}
              threadInputRef={threadInputRef}
              threadPhotoInputRef={threadPhotoInputRef}
              threadFileInputRef={threadFileInputRef}
              updateCurrentThreadDraft={updateCurrentThreadDraft}
              onSendReply={onSendReply}
              onHandleThreadFiles={onHandleThreadFiles}
              onOpenFullscreen={onOpenFullscreen}
              onOpenAttachment={onOpenAttachment}
              onFocusComposer={onFocusComposer}
            />
          </>
        )}
      </div>
    </div>
  );
}

interface ThreadComposerProps {
  threadMsgId: string | null;
  currentThreadDraft: DraftState;
  threadComposerEditBanner?: { title: string; onCancel: () => void } | null;
  threadInputRef: RefObject<HTMLTextAreaElement | null>;
  threadPhotoInputRef: RefObject<HTMLInputElement | null>;
  threadFileInputRef: RefObject<HTMLInputElement | null>;
  updateCurrentThreadDraft: (updater: (prev: DraftState) => DraftState) => void;
  onSendReply: () => void;
  onHandleThreadFiles: (files: File[]) => void | Promise<void>;
  onOpenFullscreen: (src: string, type: 'img' | 'video') => void;
  onOpenAttachment: (src: string) => void | Promise<void>;
  onFocusComposer: () => void;
}

function ThreadComposer({
  threadMsgId,
  currentThreadDraft,
  threadComposerEditBanner,
  threadInputRef,
  threadPhotoInputRef,
  threadFileInputRef,
  updateCurrentThreadDraft,
  onSendReply,
  onHandleThreadFiles,
  onOpenFullscreen,
  onOpenAttachment,
  onFocusComposer,
}: ThreadComposerProps) {
  return (
    <div className="thread-input">
      <BubbleComposer
        draft={currentThreadDraft}
        placeholder={threadMsgId ? '写评论...' : '先打开一条泡泡再评论...'}
        disabled={!threadMsgId}
        textareaRef={threadInputRef}
        editBanner={threadComposerEditBanner}
        onDraftChange={updateCurrentThreadDraft}
        onSend={onSendReply}
        onFocus={onFocusComposer}
        onOpenPhotoPicker={() => threadPhotoInputRef.current?.click()}
        onOpenFilePicker={() => threadFileInputRef.current?.click()}
        onFsOpen={onOpenFullscreen}
        onAttachmentOpen={(src) => { void onOpenAttachment(src); }}
      />
      <input
        ref={threadPhotoInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = event.target.files ? Array.from(event.target.files) : [];
          if (files.length > 0) {
            void onHandleThreadFiles(files);
          }
          event.target.value = '';
        }}
      />
      <input
        ref={threadFileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = event.target.files ? Array.from(event.target.files) : [];
          if (files.length > 0) {
            void onHandleThreadFiles(files);
          }
          event.target.value = '';
        }}
      />
    </div>
  );
}
