import type {
  ChangeEvent as ReactChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
  TouchEvent as ReactTouchEvent,
} from "react";
import { memo, useMemo } from "react";
import { BubbleComposer } from "@/shared/ui/BubbleComposer";
import { ConversationFeedEntry } from "@/shared/ui/ConversationFeedEntry";
import {
  PinnedStatusGlyph,
  StalledStatusGlyph,
} from "@/shared/icons/StatusGlyph";
import { ResizeHandle } from "@/shared/ui/ResizeHandle";
import type { PaneLimit } from "@/shared/hooks/useBoundedPaneSize";
import { AI_AVATAR } from "@/shared/config/avatar";
import { getMessageAvatarSrc } from "@/shared/lib/avatar";
import { type ChatChannel } from "@/entities/conversation";
import type { MessageData } from "@/entities/message";
import { isMessageStreaming } from "@/shared/lib/message";
import { renderChannelAvatar } from "@/shared/ui/StreamAvatar";
import { InlineSearchControl } from "@/shared/ui/InlineSearchControl";
import { CompactListSearch } from "@/shared/ui/CompactListSearch";
import {
  formatConversationListTime,
  getConversationDividerLabel,
} from "@/shared/lib/time";
import { publicIcon } from "@/shared/lib/asset";
import type { DraftState, ListViewMode } from "./model";
type MobileView = "list" | "chat" | "thread" | "sorting" | "factory";

type StreamListRow =
  | { type: "channel"; channel: ChatChannel }
  | { type: "folded-entry" };

interface StreamListPaneProps {
  rows: StreamListRow[];
  listViewMode: ListViewMode;
  foldedChannelCount: number;
  listSearchQuery: string;
  selectedChatId: string;
  isCollapsed: boolean;
  limit: PaneLimit;
  onCreateConversation: () => void;
  onListSearchQueryChange: (value: string) => void;
  onSelectChannel: (channelId: string) => void;
  onOpenChannelSettings: (channelId: string) => void;
  onToggleListCollapsed: (next: boolean) => void;
  onToggleFoldedList: () => void;
  onResize: (delta: number) => void;
}

interface StreamConversationPaneProps {
  currentChannel: ChatChannel | null;
  currentUserAvatar: string;
  isCurrentConversationDirect: boolean;
  sortedMessages: MessageData[];
  highlightedMsg: string | null;
  highlightedTitle: boolean;
  currentDraft: DraftState;
  searchQuery: string;
  searchOpen: boolean;
  searchPanelOpen: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchResultsView?: ReactNode;
  composerEditBanner?: { title: string; onCancel: () => void } | null;
  navStackDepth: number;
  mobileView: MobileView;
  isDragOver: boolean;
  msgAreaRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  streamPhotoInputRef: RefObject<HTMLInputElement | null>;
  streamFileInputRef: RefObject<HTMLInputElement | null>;
  onBackToList: () => void;
  onOpenCurrentChannelSettings: () => void;
  onMessageAreaScroll: () => void;
  onToggleSearch: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchInputFocus: () => void;
  onSearchInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onClearSearch: () => void;
  onJumpToMsg: (targetId: string, blockId?: string) => void;
  onOpenFullscreen: (src: string, type: "img" | "video") => void;
  onOpenAttachment: (src: string) => void | Promise<void>;
  onTouchStart: (
    event: ReactTouchEvent,
    msg: MessageData,
    blockId?: string,
    subIndex?: number,
  ) => void;
  onTouchEnd: () => void;
  onContextMenu: (
    event: ReactMouseEvent,
    msg: MessageData,
    blockId?: string,
    subIndex?: number,
  ) => void;
  onOpenThread: (messageId: string, blockId?: string) => void;
  onToggleLike: (messageId: string, blockId?: string) => void;
  onForwardMessage: (messageId: string) => void;
  replyCountByMessageId: Record<string, number>;
  replyCountByMessageBlockId: Record<string, number>;
  setCurrentDraft: (updater: (prev: DraftState) => DraftState) => void;
  onCancelQuote: () => void;
  onCancelForward: () => void;
  onSend: () => void;
  onNavBack: () => void;
  onFocusComposer: () => void;
  onComposerPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onComposerDrop: (event: ReactDragEvent<HTMLTextAreaElement>) => void;
  onComposerDragOver: (event: ReactDragEvent<HTMLTextAreaElement>) => void;
  onPhotoToolClick: () => void;
  onFileToolClick: () => void;
  onRootDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onRootDragLeave: () => void;
  onRootDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onStreamPhotoInputChange: (event: ReactChangeEvent<HTMLInputElement>) => void;
  onStreamFileInputChange: (event: ReactChangeEvent<HTMLInputElement>) => void;
}

interface StreamMessageAreaProps {
  currentUserAvatar: string;
  currentChannelAvatarUrl: string;
  isCurrentConversationDirect: boolean;
  sortedMessages: MessageData[];
  highlightedMsg: string | null;
  msgAreaRef: RefObject<HTMLDivElement | null>;
  onMessageAreaScroll: () => void;
  onJumpToMsg: (targetId: string, blockId?: string) => void;
  onOpenFullscreen: (src: string, type: "img" | "video") => void;
  onOpenAttachment: (src: string) => void | Promise<void>;
  onTouchStart: (
    event: ReactTouchEvent,
    msg: MessageData,
    blockId?: string,
    subIndex?: number,
  ) => void;
  onTouchEnd: () => void;
  onContextMenu: (
    event: ReactMouseEvent,
    msg: MessageData,
    blockId?: string,
    subIndex?: number,
  ) => void;
  onOpenThread: (messageId: string, blockId?: string) => void;
  onToggleLike: (messageId: string, blockId?: string) => void;
  onForwardMessage: (messageId: string) => void;
  replyCountByMessageId: Record<string, number>;
  replyCountByMessageBlockId: Record<string, number>;
}

export interface StreamWorkbenchProps {
  listPane?: StreamListPaneProps | null;
  conversationPane: StreamConversationPaneProps;
}

function getChannelRankTime(channel: ChatChannel) {
  if (typeof channel.lastMessageAt === "number" && channel.lastMessageAt > 0)
    return channel.lastMessageAt;
  return channel.messages[channel.messages.length - 1]?.time || 0;
}

function groupReplyCountByMessageBlock(
  replyCountByMessageBlockId: Record<string, number>,
) {
  const result: Record<string, Record<string, number>> = {};
  Object.entries(replyCountByMessageBlockId).forEach(([key, count]) => {
    const separatorIndex = key.indexOf(":");
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

function StreamListPane({
  rows,
  listViewMode,
  foldedChannelCount,
  listSearchQuery,
  selectedChatId,
  isCollapsed,
  limit,
  onCreateConversation,
  onListSearchQueryChange,
  onSelectChannel,
  onOpenChannelSettings,
  onToggleListCollapsed,
  onToggleFoldedList,
  onResize,
}: StreamListPaneProps) {
  return (
    <>
      <div className="pane-edge-wrapper">
        <div className={`pane list-pane ${isCollapsed ? "is-collapsed" : ""}`}>
          {isCollapsed ? (
            <>
              <button
                type="button"
                className="stream-list-collapsed-head s-collapsed-head-trigger"
                onClick={() => onToggleListCollapsed(false)}
                aria-label="展开会话列表"
                title="展开会话列表"
              >
                <span className="stream-list-collapsed-mark">
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </span>
              </button>
              <div className="stream-list-collapsed-body">
                <div className="stream-list-collapsed-stack">
                  {rows.map((row) => {
                    if (row.type === "folded-entry") {
                      return (
                        <button
                          key="__folded_space__"
                          type="button"
                          className={`stream-list-collapsed-item ${listViewMode === "folded" ? "is-active" : ""}`}
                          onClick={onToggleFoldedList}
                          title={
                            listViewMode === "folded"
                              ? "返回流动列表"
                              : "打开泡泡折叠空间"
                          }
                          aria-label={
                            listViewMode === "folded"
                              ? "返回流动列表"
                              : "打开泡泡折叠空间"
                          }
                        >
                          <span className="stream-list-collapsed-avatar-shell stream-list-collapsed-avatar-shell--ghost">
                            <span className="stream-list-collapsed-avatar-copy">
                              叠
                            </span>
                          </span>
                          {foldedChannelCount > 0 ? (
                            <span className="stream-list-collapsed-badge">
                              {foldedChannelCount}
                            </span>
                          ) : null}
                        </button>
                      );
                    }

                    const channel = row.channel;
                    return (
                      <button
                        key={channel.id}
                        type="button"
                        className={`stream-list-collapsed-item ${selectedChatId === channel.id ? "is-active" : ""}`}
                        onClick={() => onSelectChannel(channel.id)}
                        onDoubleClick={() => onOpenChannelSettings(channel.id)}
                        title={channel.title}
                        aria-label={channel.title}
                      >
                        <span className="stream-list-collapsed-avatar-shell">
                          {renderChannelAvatar(
                            channel,
                            "h-10 w-10 rounded-[18px]",
                            "text-[20px] font-semibold text-white",
                          )}
                        </span>
                        {channel.isPinned ? (
                          <span
                            className="stream-list-collapsed-corner-badge"
                            title="置顶"
                            aria-hidden="true"
                          >
                            <PinnedStatusGlyph size={12} />
                          </span>
                        ) : channel.isStalled ? (
                          <span
                            className="stream-list-collapsed-corner-badge"
                            title="停滞"
                            aria-hidden="true"
                          >
                            <StalledStatusGlyph size={12} />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="nav-bar">
                <div
                  className="nav-icon"
                  onClick={onCreateConversation}
                  style={{ cursor: "pointer" }}
                  title="新建会话"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="22"
                    height="22"
                    fill="var(--text-primary)"
                  >
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                  </svg>
                </div>
                <div className="nav-title">泡泡流</div>
                <div className="nav-right-actions">
                  <CompactListSearch
                    value={listSearchQuery}
                    placeholder="搜泡泡流标题或预览"
                    buttonLabel="筛选泡泡流"
                    onChange={onListSearchQueryChange}
                  />
                  <button
                    type="button"
                    className="stream-list-toggle nav-icon desktop-only"
                    onClick={() => onToggleListCollapsed(true)}
                    title="折叠会话列表"
                    aria-label="折叠会话列表"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="list-content-area">
                {rows.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-black/8 bg-black/[0.015] px-4 py-5 text-center text-sm text-[var(--text-secondary)]">
                    {listSearchQuery.trim()
                      ? "没有匹配的泡泡流"
                      : listViewMode === "folded"
                        ? "还没有主动折叠的泡泡流"
                        : "点击左上角 + 创建新的泡泡流"}
                  </div>
                ) : (
                  rows.map((row) => {
                    if (row.type === "folded-entry") {
                      return (
                        <button
                          key="__folded_space__"
                          type="button"
                          className="mb-2 flex w-full items-center justify-between rounded-[20px] border border-dashed border-[var(--accent)]/25 bg-[var(--bubble-me)]/55 px-4 py-3 text-left"
                          onClick={onToggleFoldedList}
                        >
                          <div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">
                              泡泡折叠空间
                            </div>
                            <div className="mt-1 text-xs text-[var(--text-secondary)]">
                              {listViewMode === "folded"
                                ? "点此返回流动列表"
                                : "这里收纳你主动折叠的泡泡流"}
                            </div>
                          </div>
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                            {listViewMode === "folded"
                              ? "返回"
                              : foldedChannelCount}
                          </span>
                        </button>
                      );
                    }

                    const channel = row.channel;
                    const lastChannelMessage =
                      channel.messages[channel.messages.length - 1] || null;
                    return (
                      <div
                        key={channel.id}
                        className={`chat-list-item ${selectedChatId === channel.id ? "selected" : ""}`}
                        onClick={() => onSelectChannel(channel.id)}
                        onDoubleClick={() => onOpenChannelSettings(channel.id)}
                      >
                        {renderChannelAvatar(
                          channel,
                          "chat-list-avatar h-12 w-12 rounded-2xl",
                          "text-[17px] font-semibold text-white",
                        )}
                        <div className="chat-list-info">
                          <div className="flex items-center gap-2">
                            <div className="chat-list-title">
                              {channel.title}
                            </div>
                            {channel.isPinned ? (
                              <span
                                className="status-chip status-chip--sm status-chip--accent chat-list-status-badge"
                                title="置顶"
                                aria-label="置顶"
                              >
                                <PinnedStatusGlyph size={12.5} />
                              </span>
                            ) : null}
                            {channel.isFolded ? (
                              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                                折叠
                              </span>
                            ) : null}
                            {channel.isStalled ? (
                              <span
                                className="status-chip status-chip--sm chat-list-status-badge"
                                title="停滞"
                                aria-label="停滞"
                              >
                                <StalledStatusGlyph size={12.5} />
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={`chat-list-desc ${isMessageStreaming(lastChannelMessage) ? "is-streaming" : ""}`}
                          >
                            {channel.lastMsg || "点击进入这个泡泡流"}
                          </div>
                        </div>
                        <div className="chat-list-time">
                          {formatConversationListTime(
                            getChannelRankTime(channel),
                          ) || channel.lastTime}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
        <ResizeHandle
          className="pane-resize-handle pane-resize-handle--list desktop-only"
          onDrag={onResize}
          ariaLabel="调整左侧会话列表宽度"
          limit={limit}
        />
      </div>
    </>
  );
}

const StreamMessageArea = memo(function StreamMessageArea({
  currentUserAvatar,
  currentChannelAvatarUrl,
  isCurrentConversationDirect,
  sortedMessages,
  highlightedMsg,
  msgAreaRef,
  onMessageAreaScroll,
  onJumpToMsg,
  onOpenFullscreen,
  onOpenAttachment,
  onTouchStart,
  onTouchEnd,
  onContextMenu,
  onOpenThread,
  onToggleLike,
  onForwardMessage,
  replyCountByMessageId,
  replyCountByMessageBlockId,
}: StreamMessageAreaProps) {
  const replyCountByMessageIdMap = useMemo(
    () => groupReplyCountByMessageBlock(replyCountByMessageBlockId),
    [replyCountByMessageBlockId],
  );
  const messageEntries = useMemo(
    () =>
      sortedMessages.map((msg, index) => (
        <ConversationFeedEntry
          key={msg.id}
          rowId={`msg-${msg.id}`}
          message={msg}
          timestampLabel={getConversationDividerLabel(
            msg.time,
            sortedMessages[index - 1]?.time || null,
          )}
          avatarSrc={getMessageAvatarSrc(msg, {
            userAvatarUrl: currentUserAvatar,
            conversationAvatarUrl: currentChannelAvatarUrl,
            fallbackAvatar: AI_AVATAR,
            forceConversationAvatar: isCurrentConversationDirect,
          })}
          senderName={msg.role === "me" ? "我" : msg.senderName || null}
          highlighted={highlightedMsg === msg.id}
          highlightedMsg={highlightedMsg}
          onJumpToMsg={onJumpToMsg}
          onFsOpen={onOpenFullscreen}
          onAttachmentOpen={(src) => {
            void onOpenAttachment(src);
          }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchMove={onTouchEnd}
          onContextMenu={onContextMenu}
          onOpenThread={onOpenThread}
          onToggleLike={onToggleLike}
          onForward={onForwardMessage}
          replyCount={replyCountByMessageId[msg.id] || 0}
          replyCountByBlock={replyCountByMessageIdMap[msg.id] || undefined}
        />
      )),
    [
      currentChannelAvatarUrl,
      currentUserAvatar,
      highlightedMsg,
      isCurrentConversationDirect,
      onContextMenu,
      onForwardMessage,
      onJumpToMsg,
      onOpenAttachment,
      onOpenFullscreen,
      onOpenThread,
      onToggleLike,
      onTouchEnd,
      onTouchStart,
      replyCountByMessageId,
      replyCountByMessageIdMap,
      sortedMessages,
    ],
  );

  return (
    <div className="msg-area" ref={msgAreaRef} onScroll={onMessageAreaScroll}>
      {messageEntries}
    </div>
  );
});

const StreamConversationPane = memo(function StreamConversationPane({
  currentChannel,
  currentUserAvatar,
  isCurrentConversationDirect,
  sortedMessages,
  highlightedMsg,
  highlightedTitle,
  currentDraft,
  searchQuery,
  searchOpen,
  searchPanelOpen,
  searchInputRef,
  searchResultsView,
  composerEditBanner,
  navStackDepth,
  mobileView,
  isDragOver,
  msgAreaRef,
  inputRef,
  streamPhotoInputRef,
  streamFileInputRef,
  onBackToList,
  onOpenCurrentChannelSettings,
  onMessageAreaScroll,
  onToggleSearch,
  onSearchQueryChange,
  onSearchInputFocus,
  onSearchInputKeyDown,
  onClearSearch,
  onJumpToMsg,
  onOpenFullscreen,
  onOpenAttachment,
  onTouchStart,
  onTouchEnd,
  onContextMenu,
  onOpenThread,
  onToggleLike,
  onForwardMessage,
  replyCountByMessageId,
  replyCountByMessageBlockId,
  setCurrentDraft,
  onCancelQuote,
  onCancelForward,
  onSend,
  onNavBack,
  onFocusComposer,
  onComposerPaste,
  onComposerDrop,
  onComposerDragOver,
  onPhotoToolClick,
  onFileToolClick,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  onStreamPhotoInputChange,
  onStreamFileInputChange,
}: StreamConversationPaneProps) {
  return (
    <div
      className={`pane chat-pane ${isDragOver ? "drag-over" : ""}`}
      onDragOver={onRootDragOver}
      onDragLeave={onRootDragLeave}
      onDrop={onRootDrop}
    >
      <div className="nav-bar">
        <div className="nav-left-actions">
          <div className="nav-back-btn" onClick={onBackToList}>
            <img
              src={publicIcon("nav_back.svg")}
              className="nav-icon"
              alt="back"
            />
          </div>
        </div>
        <div
          className={`nav-title ${highlightedTitle ? "is-highlighted" : ""}`}
        >
          {currentChannel?.title || "新泡泡流"}
        </div>
        <div className="nav-right-actions">
          <InlineSearchControl
            open={searchOpen}
            panelOpen={searchPanelOpen}
            query={searchQuery}
            placeholder="搜当前泡泡流"
            buttonLabel="搜索当前泡泡流"
            className="inline-search--nav"
            inputRef={searchInputRef}
            resultsView={searchResultsView}
            onToggle={onToggleSearch}
            onQueryChange={onSearchQueryChange}
            onInputFocus={onSearchInputFocus}
            onInputKeyDown={onSearchInputKeyDown}
            onClear={onClearSearch}
          />
          <div className="nav-icon" onClick={onOpenCurrentChannelSettings}>
            <img src={publicIcon("nav_more.svg")} alt="more" />
          </div>
        </div>
      </div>

      <StreamMessageArea
        currentUserAvatar={currentUserAvatar}
        currentChannelAvatarUrl={currentChannel?.avatarUrl || ""}
        isCurrentConversationDirect={isCurrentConversationDirect}
        sortedMessages={sortedMessages}
        highlightedMsg={highlightedMsg}
        msgAreaRef={msgAreaRef}
        onMessageAreaScroll={onMessageAreaScroll}
        onJumpToMsg={onJumpToMsg}
        onOpenFullscreen={onOpenFullscreen}
        onOpenAttachment={onOpenAttachment}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onContextMenu={onContextMenu}
        onOpenThread={onOpenThread}
        onToggleLike={onToggleLike}
        onForwardMessage={onForwardMessage}
        replyCountByMessageId={replyCountByMessageId}
        replyCountByMessageBlockId={replyCountByMessageBlockId}
      />

      <div className="input-area-wrapper">
        <BubbleComposer
          draft={currentDraft}
          placeholder="冒个泡泡..."
          textareaRef={inputRef}
          editBanner={composerEditBanner}
          onDraftChange={setCurrentDraft}
          onSend={onSend}
          onFocus={onFocusComposer}
          onPaste={onComposerPaste}
          onDrop={onComposerDrop}
          onDragOver={onComposerDragOver}
          onOpenPhotoPicker={onPhotoToolClick}
          onOpenFilePicker={onFileToolClick}
          onCancelQuote={onCancelQuote}
          onCancelForward={onCancelForward}
          onFsOpen={onOpenFullscreen}
          onAttachmentOpen={(src) => {
            void onOpenAttachment(src);
          }}
        />
      </div>

      {navStackDepth > 0 && mobileView === "chat" ? (
        <div className="nav-back-float show" onClick={onNavBack}>
          <svg viewBox="0 0 24 24">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
          <span>返回</span>
        </div>
      ) : null}

      <input
        type="file"
        ref={streamPhotoInputRef}
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={onStreamPhotoInputChange}
      />
      <input
        type="file"
        ref={streamFileInputRef}
        multiple
        style={{ display: "none" }}
        onChange={onStreamFileInputChange}
      />
    </div>
  );
});

export function StreamWorkbench({
  listPane,
  conversationPane,
}: StreamWorkbenchProps) {
  const listPaneElement = useMemo(
    () => (listPane ? <StreamListPane {...listPane} /> : null),
    [listPane],
  );
  const conversationPaneElement = useMemo(
    () => <StreamConversationPane {...conversationPane} />,
    [conversationPane],
  );

  return (
    <>
      {listPaneElement}
      {conversationPaneElement}
    </>
  );
}
