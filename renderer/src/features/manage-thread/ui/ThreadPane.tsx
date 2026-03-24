import { memo, useMemo, type RefObject } from 'react';
import { BubbleComposer } from '@/shared/ui/BubbleComposer';
import { BubbleItem } from '@/shared/ui/BubbleItem';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
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
  isCollapsed: boolean;
  limit: PaneLimit;
  currentUserAvatar: string;
  currentChannelAvatarUrl: string;
  isCurrentConversationDirect: boolean;
  threadTitle?: string | null;
  userProfile: UserProfileRecord;
  currentThreadDraft: DraftState;
  threadComposerEditBanner?: { title: string; onCancel: () => void } | null;
  threadPhotoInputRef: RefObject<HTMLInputElement | null>;
  threadFileInputRef: RefObject<HTMLInputElement | null>;
  replyCountByMessageId: Record<string, number>;
  replyCountByMessageBlockId: Record<string, number>;
  onResize: (delta: number) => void;
  onBackToChat: () => void;
  onClose: () => void;
  onExpand: () => void;
  onJumpToMsg: (targetId: string, blockId?: string) => void;
  onOpenThread: (messageId: string, blockId?: string) => void;
  onToggleLike: (messageId: string, blockId?: string) => void;
  onForwardMessage: (messageId: string) => void;
  onOpenFullscreen: (src: string, type: 'img' | 'video') => void;
  onOpenAttachment: (src: string) => void | Promise<void>;
  updateCurrentThreadDraft: (updater: (prev: DraftState) => DraftState) => void;
  onSendReply: () => void;
  onHandleThreadFiles: (files: File[]) => void | Promise<void>;
  onFocusComposer: () => void;
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
  replyCountByMessageId,
  replyCountByMessageBlockId,
  onJumpToMsg,
  onOpenThread,
  onToggleLike,
  onForwardMessage,
  onOpenFullscreen,
  onOpenAttachment,
}: {
  message: MessageData;
  avatarSrc: string;
  senderName: string;
  highlightedMsg?: string | null;
  replyCountByMessageId: Record<string, number>;
  replyCountByMessageBlockId: Record<string, number>;
  onJumpToMsg: (targetId: string, blockId?: string) => void;
  onOpenThread: (messageId: string, blockId?: string) => void;
  onToggleLike: (messageId: string, blockId?: string) => void;
  onForwardMessage: (messageId: string) => void;
  onOpenFullscreen: (src: string, type: 'img' | 'video') => void;
  onOpenAttachment: (src: string) => void | Promise<void>;
}) {
  return (
    <div className="thread-comment-item">
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
}

const ThreadEntriesPane = memo(function ThreadEntriesPane({
  threadMsg,
  threadReplies,
  threadBlockId,
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
}: ThreadEntriesPaneProps) {
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
          replyCountByMessageId={replyCountByMessageId}
          replyCountByMessageBlockId={replyCountByMessageIdMap[threadMsg.id] || {}}
          onJumpToMsg={onJumpToMsg}
          onOpenThread={onOpenThread}
          onToggleLike={onToggleLike}
          onForwardMessage={onForwardMessage}
          onOpenFullscreen={onOpenFullscreen}
          onOpenAttachment={onOpenAttachment}
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
            replyCountByMessageId={replyCountByMessageId}
            replyCountByMessageBlockId={replyCountByMessageIdMap[reply.id] || {}}
            onJumpToMsg={onJumpToMsg}
            onOpenThread={onOpenThread}
            onToggleLike={onToggleLike}
            onForwardMessage={onForwardMessage}
            onOpenFullscreen={onOpenFullscreen}
            onOpenAttachment={onOpenAttachment}
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
    onToggleLike,
    replyCountByMessageId,
    replyCountByMessageIdMap,
    threadBlockId,
    threadMsg,
    threadReplies,
  ]);

  return (
    <div className="thread-scroll">
      {threadEntries}
    </div>
  );
});

export function ThreadPane({
  threadMsgId,
  threadBlockId,
  threadMsg,
  threadReplies,
  isCollapsed,
  limit,
  currentUserAvatar,
  currentChannelAvatarUrl,
  isCurrentConversationDirect,
  threadTitle,
  userProfile,
  currentThreadDraft,
  threadComposerEditBanner,
  threadPhotoInputRef,
  threadFileInputRef,
  replyCountByMessageId,
  replyCountByMessageBlockId,
  onResize,
  onBackToChat,
  onClose,
  onExpand,
  onJumpToMsg,
  onOpenThread,
  onToggleLike,
  onForwardMessage,
  onOpenFullscreen,
  onOpenAttachment,
  updateCurrentThreadDraft,
  onSendReply,
  onHandleThreadFiles,
  onFocusComposer,
}: ThreadPaneProps) {
  const threadHeading = threadTitle?.trim() || null;

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
        />
        <ThreadComposer
          threadMsgId={threadMsgId}
          currentThreadDraft={currentThreadDraft}
          threadComposerEditBanner={threadComposerEditBanner}
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
                <div className="thread-close-btn desktop-only" onClick={onClose}>×</div>
              </div>
            </div>
            <ThreadEntriesPane
              threadMsg={threadMsg}
              threadReplies={threadReplies}
              threadBlockId={threadBlockId}
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
            />
            <ThreadComposer
              threadMsgId={threadMsgId}
              currentThreadDraft={currentThreadDraft}
              threadComposerEditBanner={threadComposerEditBanner}
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
