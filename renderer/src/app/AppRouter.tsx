import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { extractContextMenuData } from "@/features/manage-thread/model/context-menu";
import {
  createEmptyDraftState,
  classifyMessageFile,
  type DraftState,
  type QuoteState,
} from "@/features/send-message/model/draft";
import {
  buildDraftStateFromMessage,
  draftItemToBubbleBlock,
  getDraftBlocks,
  hasDraftContent,
  sanitizeDraftBlocks,
  updateDraftBlocks,
} from "@/features/send-message/model/bubbleDraft";
import { useStreamDrafts } from "@/features/send-message/model/useStreamDrafts";
import { StreamSettingsModal } from "@/features/manage-stream-settings/ui/StreamSettingsModal";
import { ThreadPane } from "@/features/manage-thread/ui/ThreadPane";
import { useConversationStreaming } from "@/features/conversation-streaming/model/useConversationStreaming";
import { useClampedMenuPosition } from "../shared/lib/useClampedMenuPosition";
import {
  deriveChannelFromRecord,
  getConversationUiState,
  isDirectConversationMetadata,
  sortByRecent,
  sortMainChannels,
  upsertChannel,
  type ChatChannel,
  type ChatLifecycleStatus,
  type ChatRecord,
  type ConversationUiState,
  type ListViewMode,
} from "@/entities/conversation";
import {
  buildMessagePreviewText,
  type BubbleBlock,
  type MessageData,
} from "@/entities/message";
import type { BotRecord } from "@/entities/bot";
import type { AiProviderRecord } from "@/entities/provider";
import type { UserProfileRecord } from "@/entities/user";
import type { ContextMenuState } from "@/shared/model";
import {
  DEFAULT_STREAM_AVATAR_PRESET,
  USER_AVATAR,
} from "@/shared/config/avatar";
import { getUserAvatarSrc } from "@/shared/lib/avatar";
import { getErrorMessage } from "@/shared/lib/error";
import { useBoundedPaneSize } from "@/shared/hooks/useBoundedPaneSize";
import { getDesktopBridge } from "@/shared/lib/desktop-bridge";
import {
  buildBubbleLink,
  resolveBubbleLinkBlocksForSubmit,
} from "@/shared/lib/bubble-link";
import {
  buildQuote,
  clearChatMessages,
  createChat,
  deleteChatMessage,
  getUserProfile,
  getChat,
  exportAppData,
  importAppData,
  listAiProviders,
  listBots,
  listChats,
  saveAiProvider,
  saveBot,
  saveUserProfile,
  sendChatMessage,
  sendComment,
  toggleLike,
  triggerConversationBots,
  triggerMachineRun,
  updateChatMessage,
  updateChatMeta,
} from "@/shared/api/desktop/chat";
import { uploadFile } from "@/shared/lib/upload";
import { PrimaryTabBar } from "@/widgets/primary-tab-bar/ui/PrimaryTabBar";
import { StreamPage } from "@/pages/stream/ui/StreamPage";
import { SortingPage } from "@/pages/sorting/ui/SortingPage";
import { FactoryPage } from "@/pages/factory/ui/FactoryPage";

const LIST_PANE_MIN = 240;
const LIST_PANE_MAX = 420;
const LIST_PANE_COLLAPSED_WIDTH = 92;
const THREAD_PANE_MIN = 260;
const THREAD_PANE_MAX = 460;
const THREAD_PANE_COLLAPSED_WIDTH = 92;

type ActiveChatPane = "assistant" | "sorting" | "factory";
type PrimaryTab = "chat" | "sorting" | "factory";
type ThreadOrigin = "chat" | "sorting";

interface ThreadContext {
  origin: ThreadOrigin;
  conversationId: string;
  messageId: string;
  blockId?: string;
}

interface SortingSourceLocatorPayload {
  conversationId: string;
  messageId: string;
  blockId?: string;
}

interface PendingJumpTarget {
  conversationId: string;
  messageId: string;
  blockId?: string;
}

type SortingSourceLocator = (
  payload: SortingSourceLocatorPayload,
) => void | Promise<void>;

function countRepliesByMessage(messages: MessageData[]) {
  const counts: Record<string, number> = {};
  messages.forEach((message) => {
    if (!message.replyToMessageId) return;
    counts[message.replyToMessageId] =
      (counts[message.replyToMessageId] || 0) + 1;
  });
  return counts;
}

function countRepliesByMessageBlock(messages: MessageData[]) {
  const counts: Record<string, number> = {};
  messages.forEach((message) => {
    if (!message.replyToMessageId || !message.commentTarget?.blockId) return;
    const key = `${message.replyToMessageId}:${message.commentTarget.blockId}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function downloadJsonFile(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AppRouter() {
  const bridge = getDesktopBridge();
  const [mobileView, setMobileView] = useState<
    "list" | "chat" | "thread" | "sorting" | "factory"
  >("list");
  const [activeChat, setActiveChat] = useState<ActiveChatPane>("assistant");
  const [selectedChatId, setSelectedChatId] = useState("");
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(
    null,
  );
  const [isListCollapsed, setIsListCollapsed] = useState(false);
  const [isThreadCollapsed, setIsThreadCollapsed] = useState(false);
  const [threadDialogOpen, setThreadDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PrimaryTab>("chat");
  const [listViewMode, setListViewMode] = useState<ListViewMode>("main");
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfileRecord>({
    avatarUrl: USER_AVATAR,
  });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showFileConfirm, setShowFileConfirm] = useState(false);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [showLinkConfirm, setShowLinkConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    show: false,
    x: 0,
    y: 0,
    conversationId: null,
    origin: "chat",
    pane: "stream",
    msgId: null,
    blockId: undefined,
    subItemIndex: undefined,
    content: null,
    media: null,
    mediaType: null,
  });
  const [toastMsg, setToastMsg] = useState("");
  const [navStack, setNavStack] = useState<number[]>([]);
  const [threadNavStack, setThreadNavStack] = useState<ThreadContext[]>([]);
  const [fsOpen, setFsOpen] = useState(false);
  const [fsType, setFsType] = useState<"img" | "video">("img");
  const [fsSrc, setFsSrc] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingThreadMessageId, setEditingThreadMessageId] = useState<
    string | null
  >(null);
  const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(
    null,
  );
  const [streamSettingsOpen, setStreamSettingsOpen] = useState(false);
  const [streamSettingsChatId, setStreamSettingsChatId] = useState<
    string | null
  >(null);
  const [factoryBots, setFactoryBots] = useState<BotRecord[]>([]);
  const [factoryProviders, setFactoryProviders] = useState<AiProviderRecord[]>(
    [],
  );
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState("");
  const [pendingJumpTarget, setPendingJumpTarget] =
    useState<PendingJumpTarget | null>(null);
  const [contextMenuSubmenu, setContextMenuSubmenu] = useState<
    "machines" | null
  >(null);

  const listPane = useBoundedPaneSize({
    initial: 304,
    min: LIST_PANE_MIN,
    max: LIST_PANE_MAX,
  });
  const threadPane = useBoundedPaneSize({
    initial: 348,
    min: THREAD_PANE_MIN,
    max: THREAD_PANE_MAX,
  });
  const msgAreaRef = useRef<HTMLDivElement>(null);
  const pressTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const scrollPersistTimerRef = useRef<number | null>(null);
  const sortingSourceLocatorRef = useRef<SortingSourceLocator | null>(null);
  const restoreConversationRef = useRef<string | null>(null);
  const skipNextConversationUiPersistRef = useRef(false);
  const previousMessageContextRef = useRef<{
    conversationId: string | null;
    count: number;
  }>({ conversationId: null, count: 0 });
  const mainEditRestoreRef = useRef<DraftState | null>(null);
  const threadEditRestoreRef = useRef<DraftState | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadInputRef = useRef<HTMLTextAreaElement>(null);
  const fsVideoRef = useRef<HTMLVideoElement>(null);
  const streamPhotoInputRef = useRef<HTMLInputElement>(null);
  const streamFileInputRef = useRef<HTMLInputElement>(null);
  const threadPhotoInputRef = useRef<HTMLInputElement>(null);
  const threadFileInputRef = useRef<HTMLInputElement>(null);
  const [highlightedMsg, setHighlightedMsg] = useState<string | null>(null);
  const threadOrigin = threadContext?.origin || null;
  const threadConversationId = threadContext?.conversationId || null;
  const threadMsgId = threadContext?.messageId || null;
  const threadBlockId = threadContext?.blockId;

  const currentChannel =
    channels.find((item) => item.id === selectedChatId) || channels[0];
  const streamSettingsChannel =
    channels.find((item) => item.id === streamSettingsChatId) || null;
  const manualMachineBots = useMemo(
    () =>
      factoryBots.filter(
        (bot) =>
          bot.enabled &&
          (bot.runtimeType === "llm" || bot.runtimeType === "external-codex"),
      ),
    [factoryBots],
  );
  const messages = currentChannel?.messages || [];
  const threadConversation =
    channels.find((item) => item.id === threadConversationId) || null;
  const threadMessages = threadConversation?.messages || [];
  const sortedMessages = useMemo(
    () =>
      [...messages].sort((left, right) => (left.time || 0) - (right.time || 0)),
    [messages],
  );
  const threadSortedMessages = useMemo(
    () =>
      [...threadMessages].sort(
        (left, right) => (left.time || 0) - (right.time || 0),
      ),
    [threadMessages],
  );
  const topLevelMessages = useMemo(
    () => sortedMessages.filter((message) => !message.replyToMessageId),
    [sortedMessages],
  );
  const replyCountByMessageId = useMemo(() => {
    return countRepliesByMessage(messages);
  }, [messages]);
  const replyCountByMessageBlockId = useMemo(() => {
    return countRepliesByMessageBlock(messages);
  }, [messages]);
  const threadReplyCountByMessageId = useMemo(() => {
    return countRepliesByMessage(threadMessages);
  }, [threadMessages]);
  const threadReplyCountByMessageBlockId = useMemo(() => {
    return countRepliesByMessageBlock(threadMessages);
  }, [threadMessages]);
  const {
    currentDraft,
    currentThreadDraft,
    currentThreadDraftKey,
    setCurrentDraft,
    updateCurrentThreadDraft,
  } = useStreamDrafts({
    selectedChatId,
    currentConversationId: threadConversationId,
    threadMsgId,
    threadBlockId,
  });
  const currentConversationUiState = useMemo(
    () => getConversationUiState(currentChannel?.metadata),
    [currentChannel?.metadata],
  );
  const isCurrentConversationDirect = useMemo(
    () => isDirectConversationMetadata(currentChannel?.metadata),
    [currentChannel?.metadata],
  );
  const currentUserAvatar = useMemo(
    () => getUserAvatarSrc(userProfile),
    [userProfile],
  );

  const threadConversationTitle = threadConversation?.title || null;
  const isThreadConversationDirect = useMemo(
    () => isDirectConversationMetadata(threadConversation?.metadata),
    [threadConversation?.metadata],
  );

  const openThreadPane = useCallback(
    (context: ThreadContext, options?: { preserveStack?: boolean }) => {
      if (!options?.preserveStack) {
        setThreadNavStack([]);
      }
      setThreadContext(context);
      setIsThreadCollapsed(false);
      setEditingThreadMessageId(null);
      threadEditRestoreRef.current = null;
      setMobileView("thread");
      if (window.innerWidth > 768 && window.innerWidth <= 1200) {
        setIsListCollapsed(true);
      }
    },
    [],
  );

  const closeThreadPane = useCallback(() => {
    const nextMobileView =
      activeChat === "factory"
        ? "factory"
        : activeChat === "sorting" || threadOrigin === "sorting"
          ? "sorting"
          : "chat";
    setThreadContext(null);
    setThreadNavStack([]);
    setIsThreadCollapsed(false);
    setThreadDialogOpen(false);
    setEditingThreadMessageId(null);
    threadEditRestoreRef.current = null;
    setMobileView(nextMobileView);
  }, [activeChat, threadOrigin]);

  const openThreadDialog = useCallback(() => {
    setThreadDialogOpen(true);
  }, []);

  const closeThreadDialog = useCallback(() => {
    setThreadDialogOpen(false);
  }, []);

  const openCurrentChatThreadPane = useCallback(
    (messageId: string, blockId?: string) => {
      if (!currentChannel) return;
      openThreadPane({
        origin: "chat",
        conversationId: currentChannel.id,
        messageId,
        blockId,
      });
    },
    [currentChannel, openThreadPane],
  );

  const openSortingThreadPane = useCallback(
    (payload: SortingSourceLocatorPayload) => {
      openThreadPane({
        origin: "sorting",
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        blockId: payload.blockId,
      });
    },
    [openThreadPane],
  );

  const registerSortingSourceLocator = useCallback(
    (locator: SortingSourceLocator | null) => {
      sortingSourceLocatorRef.current = locator;
    },
    [],
  );

  const showToast = useCallback((message: string) => {
    setToastMsg(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToastMsg(""), 2000);
  }, []);

  const copyTextToClipboard = useCallback(
    async (text: string, successMessage: string) => {
      if (!text.trim()) {
        showToast("没有可复制的内容");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage);
      } catch {
        showToast("当前环境不支持复制");
      }
    },
    [showToast],
  );

  const openAttachmentWithDefaultApp = useCallback(
    async (target: string) => {
      if (!bridge) return;
      try {
        await bridge.assets.open(target);
      } catch (error) {
        showToast(`打开附件失败：${getErrorMessage(error)}`);
      }
    },
    [bridge, showToast],
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (scrollPersistTimerRef.current) {
        window.clearTimeout(scrollPersistTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!bridge) return;
    void getUserProfile()
      .then((profile) => setUserProfile(profile))
      .catch(() => {
        setUserProfile({ avatarUrl: USER_AVATAR });
      });
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    void bridge.system
      .getInfo()
      .then((info) => setDefaultWorkspacePath(info.cwd || ""))
      .catch(() => {
        setDefaultWorkspacePath("");
      });
  }, [bridge]);

  const loadFactoryResources = useCallback(async () => {
    try {
      const [providers, bots] = await Promise.all([
        listAiProviders(),
        listBots(),
      ]);
      setFactoryProviders(providers);
      setFactoryBots(bots);
    } catch (error) {
      showToast(`加载工厂配置失败：${getErrorMessage(error)}`);
    }
  }, [showToast]);

  const handleExportAppJson = useCallback(async () => {
    try {
      const payload = await exportAppData();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadJsonFile(`paopao-export-${stamp}.json`, payload);
      showToast("已导出 JSON");
    } catch (error) {
      showToast(`导出失败：${getErrorMessage(error)}`);
    }
  }, [showToast]);

  const handleImportAppJson = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      void (async () => {
        try {
          const text = await file.text();
          const payload = JSON.parse(text) as Record<string, unknown>;
          await importAppData(payload);
          window.location.reload();
        } catch (error) {
          showToast(`导入失败：${getErrorMessage(error)}`);
        }
      })();
    };

    input.click();
  }, [showToast]);

  useEffect(() => {
    if (!bridge) return;
    void loadFactoryResources();
  }, [bridge, loadFactoryResources]);

  const { clearConversationStreamingState, mergeStreamingRecord } =
    useConversationStreaming({
      bridge,
      selectedChatId,
      activeChat,
      msgAreaRef,
      setChannels,
    });

  useEffect(() => {
    if (!bridge) return undefined;

    return bridge.ai.onMachineRunStream((event) => {
      if (!event || typeof event !== "object") return;
      if (event.runtimeType !== "external-codex") return;

      if (event.type === "run-requires-action") {
        showToast(`Codex 请求操作：${event.reason}`);
        return;
      }

      if (event.type === "run-error") {
        showToast(`Codex 运行失败：${event.error}`);
      }
    });
  }, [bridge, showToast]);

  const applyConversation = useCallback(
    (record: ChatRecord, options?: { select?: boolean }) => {
      const mergedRecord = mergeStreamingRecord(record);
      const nextChannel = deriveChannelFromRecord(mergedRecord);
      setChannels((prev) => upsertChannel(prev, nextChannel));
      if (options?.select ?? true) {
        setSelectedChatId(nextChannel.id);
      }
      return nextChannel;
    },
    [mergeStreamingRecord],
  );

  const maybeTriggerAutoMachines = useCallback(
    async (conversation: ChatRecord, messageId?: string | null) => {
      const resolvedMessageId =
        messageId ||
        conversation.messages[conversation.messages.length - 1]?.id ||
        "";
      if (!resolvedMessageId) return;
      const sourceMessage =
        conversation.messages.find(
          (message) => message.id === resolvedMessageId,
        ) || null;
      if (
        !sourceMessage ||
        sourceMessage.role !== "me" ||
        sourceMessage.replyToMessageId
      ) {
        return;
      }
      const [replyResult, commentResult] = await Promise.allSettled([
        triggerConversationBots({
          conversationId: conversation.chatId,
          triggerMessageId: resolvedMessageId,
        }),
        triggerMachineRun({
          conversationId: conversation.chatId,
          sourceMessageId: resolvedMessageId,
        }),
      ]);

      if (
        replyResult.status === "fulfilled" &&
        replyResult.value?.conversation
      ) {
        applyConversation(replyResult.value.conversation, {
          select: selectedChatId === conversation.chatId,
        });
      } else if (replyResult.status === "rejected") {
        showToast(`触发流内回复失败：${getErrorMessage(replyResult.reason)}`);
      }

      if (commentResult.status === "rejected") {
        showToast(`触发自动评论失败：${getErrorMessage(commentResult.reason)}`);
      }
    },
    [applyConversation, selectedChatId, showToast],
  );

  const persistConversationMeta = useCallback(
    async (
      payload: {
        conversationId: string;
        title?: string;
        avatarPreset?: string;
        avatarUrl?: string;
        lifecycleStatus?: ChatLifecycleStatus;
        isPinned?: boolean;
        isFolded?: boolean;
        activeTopicId?: string | null;
        activeIdentityId?: string | null;
        uiState?: ConversationUiState;
      },
      options?: { select?: boolean; syncListViewMode?: boolean },
    ) => {
      const updated = await updateChatMeta(payload);
      const nextChannel = applyConversation(updated, {
        select: options?.select,
      });

      if (options?.syncListViewMode ?? true) {
        if (nextChannel.lifecycleStatus === "flowing" && nextChannel.isFolded) {
          setListViewMode("folded");
        } else {
          setListViewMode("main");
        }
      }

      return nextChannel;
    },
    [applyConversation],
  );
  const buildCurrentConversationUiState = useCallback(
    (overrides?: { messageScrollTop?: number }): ConversationUiState | null => {
      if (!currentChannel) return null;
      const fallbackScrollTop = currentConversationUiState.messageScrollTop;
      const nextScrollTop =
        overrides?.messageScrollTop ??
        msgAreaRef.current?.scrollTop ??
        fallbackScrollTop ??
        0;
      const isCurrentConversationThreadOpen =
        threadOrigin === "chat" &&
        threadConversationId === currentChannel.id &&
        Boolean(threadMsgId);

      return {
        messageScrollTop: Math.max(0, Math.round(nextScrollTop)),
        thread: {
          open: isCurrentConversationThreadOpen,
          messageId: isCurrentConversationThreadOpen ? threadMsgId : null,
          blockId: isCurrentConversationThreadOpen ? threadBlockId : undefined,
          isCollapsed: Boolean(
            isCurrentConversationThreadOpen && isThreadCollapsed,
          ),
        },
      };
    },
    [
      currentChannel,
      currentConversationUiState.messageScrollTop,
      isThreadCollapsed,
      threadBlockId,
      threadConversationId,
      threadMsgId,
      threadOrigin,
    ],
  );

  const persistCurrentConversationUiState = useCallback(
    (options?: { immediate?: boolean; messageScrollTop?: number }) => {
      if (!currentChannel) return;
      if (threadOrigin === "sorting") return;
      const nextUiState = buildCurrentConversationUiState({
        messageScrollTop: options?.messageScrollTop,
      });
      if (!nextUiState) return;

      const currentPersistedState = getConversationUiState(
        currentChannel.metadata,
      );
      if (
        JSON.stringify(currentPersistedState) === JSON.stringify(nextUiState)
      ) {
        return;
      }

      const runPersist = () => {
        scrollPersistTimerRef.current = null;
        void persistConversationMeta(
          {
            conversationId: currentChannel.id,
            uiState: nextUiState,
          },
          {
            select: false,
            syncListViewMode: false,
          },
        );
      };

      if (options?.immediate) {
        if (scrollPersistTimerRef.current) {
          window.clearTimeout(scrollPersistTimerRef.current);
          scrollPersistTimerRef.current = null;
        }
        runPersist();
        return;
      }

      if (scrollPersistTimerRef.current) {
        window.clearTimeout(scrollPersistTimerRef.current);
      }
      scrollPersistTimerRef.current = window.setTimeout(runPersist, 220);
    },
    [
      buildCurrentConversationUiState,
      currentChannel,
      persistConversationMeta,
      threadOrigin,
    ],
  );

  useEffect(() => {
    const buildInitialTransferAssistantChat = () => {
      const ts = Date.now();

      return {
        title: "泡泡传输助手",
        avatarPreset: DEFAULT_STREAM_AVATAR_PRESET,
        avatar: DEFAULT_STREAM_AVATAR_PRESET,
        lastMsg: "来冒个泡吧",
        messages: [
          {
            id: globalThis.crypto.randomUUID(),
            role: "ai",
            type: "text",
            content: "来冒个泡吧",
            time: ts,
            status: "success",
            senderName: "泡泡传输助手",
            senderAvatarPreset: DEFAULT_STREAM_AVATAR_PRESET,
            metadata: {
              senderType: "system",
              builtinConversation: "bubble-transfer-assistant",
            },
          },
        ],
      };
    };
    const loadChannels = async () => {
      try {
        if (!bridge) return;
        const list = await listChats();
        if (list.length === 0) {
          const created = await createChat(buildInitialTransferAssistantChat());
          const nextChannel = deriveChannelFromRecord(created);
          setChannels([nextChannel]);
          setSelectedChatId(nextChannel.id);
          return;
        }

        const loaded = (
          await Promise.allSettled(
            list.map(async (item) => {
              const record = await getChat(item.id);
              return record ? deriveChannelFromRecord(record) : null;
            }),
          )
        ).flatMap((result) =>
          result.status === "fulfilled" && result.value ? [result.value] : [],
        );

        setChannels(loaded);
        setSelectedChatId(
          (prev) =>
            prev ||
            loaded.find(
              (channel) =>
                (channel.lifecycleStatus || "flowing") === "flowing" &&
                !channel.isFolded,
            )?.id ||
            loaded[0]?.id ||
            "",
        );
      } catch (error) {
        showToast(`加载会话失败：${getErrorMessage(error)}`);
      }
    };

    void loadChannels();
  }, [bridge, showToast]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setThreadDialogOpen(false);
      }
      if (window.innerWidth > 768 && mobileView === "list") {
        if (activeChat === "assistant") setMobileView("chat");
        else if (activeChat === "sorting") setMobileView("sorting");
        else if (activeChat === "factory") setMobileView("factory");
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [activeChat, mobileView]);

  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.show) {
        setContextMenu((prev) => ({ ...prev, show: false }));
        setContextMenuSubmenu(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [contextMenu.show]);

  useLayoutEffect(() => {
    if (!currentChannel) return;
    if (activeChat !== "assistant") return;
    skipNextConversationUiPersistRef.current = true;
    restoreConversationRef.current = currentChannel.id;
    if (
      currentConversationUiState.thread.open &&
      currentConversationUiState.thread.messageId
    ) {
      setThreadContext({
        origin: "chat",
        conversationId: currentChannel.id,
        messageId: currentConversationUiState.thread.messageId,
        blockId: currentConversationUiState.thread.blockId,
      });
    } else {
      setThreadContext(null);
    }
    setIsThreadCollapsed(
      Boolean(
        currentConversationUiState.thread.open &&
        currentConversationUiState.thread.isCollapsed,
      ),
    );
    setNavStack([]);
    setThreadNavStack([]);
  }, [activeChat, currentChannel?.id]);

  useEffect(() => {
    if (
      !currentChannel ||
      activeChat !== "assistant" ||
      mobileView === "sorting"
    )
      return;
    const conversationChanged =
      previousMessageContextRef.current.conversationId !== currentChannel.id;
    const nextMessageCount = messages.length;

    window.setTimeout(() => {
      if (!msgAreaRef.current || !currentChannel) return;
      if (
        restoreConversationRef.current === currentChannel.id ||
        conversationChanged
      ) {
        const targetScrollTop = currentConversationUiState.messageScrollTop;
        msgAreaRef.current.scrollTop =
          targetScrollTop > 0
            ? targetScrollTop
            : msgAreaRef.current.scrollHeight;
        restoreConversationRef.current = null;
      } else if (nextMessageCount > previousMessageContextRef.current.count) {
        msgAreaRef.current.scrollTop = msgAreaRef.current.scrollHeight;
      }
      previousMessageContextRef.current = {
        conversationId: currentChannel.id,
        count: nextMessageCount,
      };
    }, 50);
  }, [
    activeChat,
    currentChannel,
    currentConversationUiState.messageScrollTop,
    messages.length,
    mobileView,
  ]);

  useEffect(() => {
    if (!currentChannel) return;
    if (threadOrigin === "sorting") return;
    if (skipNextConversationUiPersistRef.current) {
      skipNextConversationUiPersistRef.current = false;
      return;
    }
    persistCurrentConversationUiState();
  }, [
    currentChannel?.id,
    isThreadCollapsed,
    persistCurrentConversationUiState,
    threadBlockId,
    threadMsgId,
    threadOrigin,
  ]);

  useEffect(() => {
    setEditingMessageId(null);
    mainEditRestoreRef.current = null;
  }, [selectedChatId]);

  useEffect(() => {
    if (!editingMessageId) return;
    if (messages.some((message) => message.id === editingMessageId)) return;
    setEditingMessageId(null);
    mainEditRestoreRef.current = null;
    setCurrentDraft(() => createEmptyDraftState());
  }, [editingMessageId, messages, setCurrentDraft]);

  useEffect(() => {
    if (threadMsgId !== null) return;
    setThreadDialogOpen(false);
  }, [threadMsgId]);

  useEffect(() => {
    if (!editingThreadMessageId) return;
    if (threadMessages.some((message) => message.id === editingThreadMessageId))
      return;
    setEditingThreadMessageId(null);
    threadEditRestoreRef.current = null;
    updateCurrentThreadDraft(() => createEmptyDraftState());
  }, [editingThreadMessageId, threadMessages, updateCurrentThreadDraft]);

  useEffect(() => {
    if (!threadMsgId) return;
    if (!threadConversation) {
      closeThreadPane();
      return;
    }
    if (
      threadConversation.messages.some((message) => message.id === threadMsgId)
    )
      return;
    closeThreadPane();
  }, [closeThreadPane, threadConversation, threadMsgId]);

  const activeChannels = useMemo(
    () =>
      channels.filter(
        (channel) => (channel.lifecycleStatus || "flowing") === "flowing",
      ),
    [channels],
  );
  const forwardTargets = useMemo(
    () => sortByRecent([...activeChannels]),
    [activeChannels],
  );
  const mainChannels = useMemo(
    () =>
      sortMainChannels(activeChannels.filter((channel) => !channel.isFolded)),
    [activeChannels],
  );
  const foldedChannels = useMemo(
    () => sortByRecent(activeChannels.filter((channel) => channel.isFolded)),
    [activeChannels],
  );
  const listRows = useMemo<
    Array<{ type: "channel"; channel: ChatChannel } | { type: "folded-entry" }>
  >(() => {
    if (listViewMode === "folded") {
      return [
        { type: "folded-entry" as const },
        ...foldedChannels.map((channel) => ({
          type: "channel" as const,
          channel,
        })),
      ];
    }

    const rows: Array<
      { type: "channel"; channel: ChatChannel } | { type: "folded-entry" }
    > = mainChannels.map((channel) => ({ type: "channel" as const, channel }));
    if (foldedChannels.length === 0) return rows;
    rows.splice(Math.min(20, rows.length), 0, {
      type: "folded-entry" as const,
    });
    return rows;
  }, [foldedChannels, listViewMode, mainChannels]);

  const sortingStreams = useMemo(
    () =>
      activeChannels.map((channel) => ({
        id: channel.id,
        title: channel.title,
        messages: channel.messages,
      })),
    [activeChannels],
  );
  const contextMenuConversation = useMemo(
    () =>
      contextMenu.conversationId
        ? channels.find((channel) => channel.id === contextMenu.conversationId) ||
          null
        : null,
    [channels, contextMenu.conversationId],
  );
  const contextMenuMessage = useMemo(
    () =>
      contextMenu.msgId && contextMenuConversation
        ? contextMenuConversation.messages.find(
            (message) => message.id === contextMenu.msgId,
          ) || null
        : null,
    [contextMenu.msgId, contextMenuConversation],
  );

  const { ref: contextMenuRef, pos: clampedContextMenuPos } =
    useClampedMenuPosition(contextMenu.x, contextMenu.y, [
      contextMenu.show,
      contextMenuSubmenu,
      manualMachineBots.length,
      contextMenu.msgId,
      contextMenuMessage?.role,
    ]);

  const resizeListPane = useCallback(
    (delta: number) => {
      if (isListCollapsed) {
        if (delta > 0) {
          setIsListCollapsed(false);
          listPane.setSize(
            Math.min(
              LIST_PANE_MAX,
              Math.max(LIST_PANE_MIN, LIST_PANE_COLLAPSED_WIDTH + delta),
            ),
          );
        }
        return;
      }

      if (listPane.getSize() + delta <= LIST_PANE_MIN) {
        setIsListCollapsed(true);
        return;
      }

      listPane.resizeBy(delta);
    },
    [isListCollapsed, listPane],
  );

  const resizeThreadPane = useCallback(
    (delta: number) => {
      if (isThreadCollapsed) {
        if (delta < 0) {
          setIsThreadCollapsed(false);
          threadPane.setSize(
            Math.min(
              THREAD_PANE_MAX,
              Math.max(THREAD_PANE_MIN, THREAD_PANE_COLLAPSED_WIDTH - delta),
            ),
          );
        }
        return;
      }

      if (threadPane.getSize() - delta <= THREAD_PANE_MIN) {
        setIsThreadCollapsed(true);
        return;
      }
      threadPane.resizeBy(-delta);
    },
    [isThreadCollapsed, threadPane],
  );

  const shellStyle = useMemo(
    () =>
      ({
        "--list-pane-width": `${isListCollapsed ? LIST_PANE_COLLAPSED_WIDTH : listPane.size}px`,
        "--thread-pane-width": `${isThreadCollapsed ? THREAD_PANE_COLLAPSED_WIDTH : threadPane.size}px`,
      }) as CSSProperties,
    [isListCollapsed, isThreadCollapsed, listPane.size, threadPane.size],
  );

  const handleMessageAreaScroll = useCallback(() => {
    if (!msgAreaRef.current) return;
    persistCurrentConversationUiState({
      messageScrollTop: msgAreaRef.current.scrollTop,
    });
  }, [persistCurrentConversationUiState]);

  const classifyFile = async (file: File): Promise<BubbleBlock> => {
    const url = await uploadFile(file);
    const item = classifyMessageFile(file, url);
    const block = draftItemToBubbleBlock(item);
    if (!block) {
      throw new Error(`Unsupported file type: ${file.type || file.name}`);
    }
    return {
      ...block,
      fileName: item.fileName || block.fileName,
    };
  };

  const buildDraftPayload = useCallback(
    (draft: DraftState) => ({
      ...draft,
      blocks: sanitizeDraftBlocks(getDraftBlocks(draft)),
      text: "",
      items: [],
    }),
    [],
  );

  const prepareDraftPayload = useCallback(
    async (draft: DraftState) => {
      const nextDraft = buildDraftPayload(draft);
      return {
        ...nextDraft,
        blocks: await resolveBubbleLinkBlocksForSubmit(nextDraft.blocks),
      };
    },
    [buildDraftPayload],
  );

  const appendMainBlocks = useCallback(
    (blocks: BubbleBlock[]) => {
      if (blocks.length === 0) return;
      setCurrentDraft((prev) =>
        updateDraftBlocks(prev, [...getDraftBlocks(prev), ...blocks]),
      );
    },
    [setCurrentDraft],
  );

  const appendThreadBlocks = useCallback(
    (blocks: BubbleBlock[]) => {
      if (blocks.length === 0) return;
      updateCurrentThreadDraft((prev) =>
        updateDraftBlocks(prev, [...getDraftBlocks(prev), ...blocks]),
      );
    },
    [updateCurrentThreadDraft],
  );

  const sendRawMessage = useCallback(
    async (message: MessageData) => {
      if (!currentChannel) return null;
      const updated = await sendChatMessage({
        conversationId: currentChannel.id,
        message,
      });
      applyConversation(updated);
      await maybeTriggerAutoMachines(updated, message.id);
      return updated;
    },
    [applyConversation, currentChannel, maybeTriggerAutoMachines],
  );

  const handleSendAction = useCallback(async () => {
    try {
      if (!currentChannel) return;
      const baseDraft = buildDraftPayload(currentDraft);
      if (!hasDraftContent(baseDraft)) return;
      const draft = await prepareDraftPayload(currentDraft);

      const updated = editingMessageId
        ? await updateChatMessage({
            conversationId: currentChannel.id,
            messageId: editingMessageId,
            draft,
          })
        : await sendChatMessage({
            conversationId: currentChannel.id,
            draft,
          });
      applyConversation(updated);
      if (!editingMessageId) {
        await maybeTriggerAutoMachines(updated);
      }
      setCurrentDraft(() => createEmptyDraftState());
      setEditingMessageId(null);
      mainEditRestoreRef.current = null;
      if (editingMessageId) {
        showToast("泡泡已更新");
      }
    } catch (error) {
      showToast(
        `${editingMessageId ? "更新" : "发送"}失败：${getErrorMessage(error)}`,
      );
    }
  }, [
    applyConversation,
    buildDraftPayload,
    currentChannel,
    currentDraft,
    editingMessageId,
    maybeTriggerAutoMachines,
    prepareDraftPayload,
    setCurrentDraft,
    showToast,
  ]);

  const openStreamSettings = useCallback((conversationId: string) => {
    setStreamSettingsChatId(conversationId);
    setStreamSettingsOpen(true);
  }, []);

  const handleSaveFactoryBot = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const savedId = await saveBot(payload);
        await loadFactoryResources();
        showToast("泡泡机已保存");
        return savedId;
      } catch (error) {
        showToast(`保存泡泡机失败：${getErrorMessage(error)}`);
        throw error;
      }
    },
    [loadFactoryResources, showToast],
  );

  const handleSaveFactoryProvider = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const savedId = await saveAiProvider(payload);
        await loadFactoryResources();
        showToast("供应商已保存");
        return savedId;
      } catch (error) {
        showToast(`保存供应商失败：${getErrorMessage(error)}`);
        throw error;
      }
    },
    [loadFactoryResources, showToast],
  );

  const handleRunContextMachine = useCallback(
    async (botId: string) => {
      try {
        if (!contextMenu.conversationId || !contextMenu.msgId) return;
        setContextMenu((prev) => ({ ...prev, show: false }));
        setContextMenuSubmenu(null);
        await triggerMachineRun({
          conversationId: contextMenu.conversationId,
          sourceMessageId: contextMenu.msgId,
          targetBlockId: contextMenu.blockId,
          botId,
        });
        openThreadPane({
          origin: contextMenu.origin,
          conversationId: contextMenu.conversationId,
          messageId: contextMenu.msgId,
          blockId: contextMenu.blockId,
        });
        showToast("已投入泡泡机");
      } catch (error) {
        showToast(`启动泡泡机失败：${getErrorMessage(error)}`);
      }
    },
    [
      contextMenu.blockId,
      contextMenu.conversationId,
      contextMenu.msgId,
      contextMenu.origin,
      openThreadPane,
      showToast,
    ],
  );

  const addNewChat = useCallback(async () => {
    try {
      const created = await createChat({
        title: "新泡泡流",
        avatarPreset: DEFAULT_STREAM_AVATAR_PRESET,
        avatar: DEFAULT_STREAM_AVATAR_PRESET,
      });
      applyConversation(created);
      setListViewMode("main");
      setActiveTab("chat");
      setActiveChat("assistant");
      setMobileView("chat");
      setThreadContext(null);
      setIsThreadCollapsed(false);
      openStreamSettings(created.chatId);
    } catch (error) {
      showToast(`新建失败：${getErrorMessage(error)}`);
    }
  }, [applyConversation, openStreamSettings, showToast]);

  const selectChannel = useCallback(
    (channelId: string) => {
      if (selectedChatId === channelId) {
        if (activeTab !== "sorting") {
          setActiveChat("assistant");
          setMobileView("chat");
        }
        return;
      }
      persistCurrentConversationUiState({ immediate: true });
      setSelectedChatId(channelId);
      if (activeTab === "sorting") {
        setActiveChat("sorting");
        setMobileView("sorting");
        return;
      }
      setActiveChat("assistant");
      setMobileView("chat");
    },
    [activeTab, persistCurrentConversationUiState, selectedChatId],
  );

  const cancelQuote = useCallback(() => {
    setCurrentDraft((prev) => {
      const next = { ...prev };
      delete next.quote;
      delete next.quoteSource;
      return next;
    });
  }, [setCurrentDraft]);

  const cancelForwardSource = useCallback(() => {
    setCurrentDraft((prev) => {
      const next = { ...prev };
      delete next.forwardSource;
      return next;
    });
  }, [setCurrentDraft]);

  const handleThreadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      try {
        const nextBlocks = await Promise.all(files.map(classifyFile));
        appendThreadBlocks(nextBlocks);
      } catch (error) {
        showToast(`资源上传失败：${getErrorMessage(error)}`);
      }
    },
    [appendThreadBlocks, classifyFile, showToast],
  );

  const sendThreadReply = useCallback(async () => {
    try {
      const baseDraft = buildDraftPayload(currentThreadDraft);
      if (!hasDraftContent(baseDraft)) return;
      const draft = await prepareDraftPayload(currentThreadDraft);
      if (!threadMsgId || !threadConversation || !currentThreadDraftKey) return;
      const updated = editingThreadMessageId
        ? await updateChatMessage({
            conversationId: threadConversation.id,
            messageId: editingThreadMessageId,
            draft,
          })
        : await sendComment({
            conversationId: threadConversation.id,
            messageId: threadMsgId,
            draft,
            targetBlockId: threadBlockId,
          });
      applyConversation(updated, { select: threadOrigin === "chat" });
      updateCurrentThreadDraft(() => createEmptyDraftState());
      setEditingThreadMessageId(null);
      threadEditRestoreRef.current = null;
      if (editingThreadMessageId) {
        showToast("评论已更新");
      }
    } catch (error) {
      showToast(
        `评论${editingThreadMessageId ? "更新" : "发送"}失败：${getErrorMessage(error)}`,
      );
    }
  }, [
    applyConversation,
    buildDraftPayload,
    currentThreadDraft,
    currentThreadDraftKey,
    editingThreadMessageId,
    showToast,
    threadBlockId,
    threadConversation,
    threadMsgId,
    threadOrigin,
    updateCurrentThreadDraft,
    prepareDraftPayload,
  ]);

  const openContextMenuAt = useCallback(
    ({
      x,
      y,
      msg,
      blockId,
      subIndex,
      conversationId,
      origin,
      pane,
    }: {
      x: number;
      y: number;
      msg: MessageData;
      blockId?: string;
      subIndex?: number;
      conversationId: string;
      origin: ThreadOrigin;
      pane: "stream" | "thread";
    }) => {
      const data = extractContextMenuData(msg, blockId, subIndex);
      setContextMenuSubmenu(null);
      setContextMenu({
        show: true,
        x,
        y,
        conversationId,
        origin,
        pane,
        msgId: msg.id,
        ...data,
      });
    },
    [],
  );

  const handleTouchStart = useCallback(
    (
      event: React.TouchEvent,
      msg: MessageData,
      blockId?: string,
      subIndex?: number,
    ) => {
      const touch = event.touches[0];
      if (!touch || !currentChannel?.id) return;
      const x = touch.clientX;
      const y = touch.clientY;
      pressTimerRef.current = window.setTimeout(() => {
        openContextMenuAt({
          x,
          y,
          msg,
          blockId,
          subIndex,
          conversationId: currentChannel.id,
          origin: "chat",
          pane: "stream",
        });
      }, 600);
    },
    [currentChannel?.id, openContextMenuAt],
  );

  const handleThreadTouchStart = useCallback(
    (
      event: React.TouchEvent,
      msg: MessageData,
      blockId?: string,
      subIndex?: number,
    ) => {
      const touch = event.touches[0];
      if (!touch || !threadConversationId || !threadOrigin) return;
      const x = touch.clientX;
      const y = touch.clientY;
      pressTimerRef.current = window.setTimeout(() => {
        openContextMenuAt({
          x,
          y,
          msg,
          blockId,
          subIndex,
          conversationId: threadConversationId,
          origin: threadOrigin,
          pane: "thread",
        });
      }, 600);
    },
    [openContextMenuAt, threadConversationId, threadOrigin],
  );

  const handleMouseRightClick = useCallback(
    (
      event: React.MouseEvent,
      msg: MessageData,
      blockId?: string,
      subIndex?: number,
    ) => {
      event.preventDefault();
      if (!currentChannel?.id) return;
      openContextMenuAt({
        x: event.clientX,
        y: event.clientY,
        msg,
        blockId,
        subIndex,
        conversationId: currentChannel.id,
        origin: "chat",
        pane: "stream",
      });
    },
    [currentChannel?.id, openContextMenuAt],
  );

  const handleThreadMouseRightClick = useCallback(
    (
      event: React.MouseEvent,
      msg: MessageData,
      blockId?: string,
      subIndex?: number,
    ) => {
      event.preventDefault();
      if (!threadConversationId || !threadOrigin) return;
      openContextMenuAt({
        x: event.clientX,
        y: event.clientY,
        msg,
        blockId,
        subIndex,
        conversationId: threadConversationId,
        origin: threadOrigin,
        pane: "thread",
      });
    },
    [openContextMenuAt, threadConversationId, threadOrigin],
  );

  const handlePressEnd = useCallback(() => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
  }, []);

  const onTriggerQuote = async () => {
    try {
      if (!contextMenu.msgId || !contextMenu.conversationId) return;
      const payload = (await buildQuote({
        conversationId: contextMenu.conversationId,
        messageId: contextMenu.msgId,
        blockId: contextMenu.blockId,
        subItemIndex: contextMenu.subItemIndex,
      })) as QuoteState;
      const nextQuoteState = {
        quoteSource: {
          relationKind: "quote" as const,
          targetMessageId: payload.targetMessageId,
          targetBlockId: payload.targetBlockId,
          snapshotBlocks: payload.snapshotBlocks || [],
        },
        quote: {
          targetMessageId: payload.targetMessageId,
          targetBlockId: payload.targetBlockId,
          snapshotBlocks: payload.snapshotBlocks || [],
          msgId: payload.msgId,
          subItemIndex: payload.subItemIndex,
          media: payload.media || null,
          mediaType: payload.mediaType || null,
          text: payload.text || null,
        },
      };

      if (contextMenu.pane === "thread") {
        updateCurrentThreadDraft((prev) => ({
          ...prev,
          ...nextQuoteState,
        }));
      } else {
        setCurrentDraft((prev) => ({
          ...prev,
          ...nextQuoteState,
        }));
      }
      setContextMenu((prev) => ({ ...prev, show: false }));
      if (contextMenu.pane === "thread") {
        threadInputRef.current?.focus();
      } else {
        inputRef.current?.focus();
      }
    } catch (error) {
      showToast(`引用失败：${getErrorMessage(error)}`);
    }
  };

  const onTriggerComment = () => {
    const id = contextMenu.msgId;
    const blockId = contextMenu.blockId;
    const conversationId = contextMenu.conversationId;
    const origin = contextMenu.origin;
    setContextMenu((prev) => ({ ...prev, show: false }));
    if (id && conversationId) {
      openThreadPane({
        origin,
        conversationId,
        messageId: id,
        blockId,
      });
    }
  };

  const cancelMainEdit = useCallback(() => {
    setEditingMessageId(null);
    setCurrentDraft(
      () => mainEditRestoreRef.current || createEmptyDraftState(),
    );
    mainEditRestoreRef.current = null;
  }, [setCurrentDraft]);

  const cancelThreadEdit = useCallback(() => {
    setEditingThreadMessageId(null);
    updateCurrentThreadDraft(
      () => threadEditRestoreRef.current || createEmptyDraftState(),
    );
    threadEditRestoreRef.current = null;
  }, [updateCurrentThreadDraft]);

  const startEditingMessage = useCallback(
    (
      messageId: string,
      options?: { conversationId?: string | null; origin?: ThreadOrigin },
    ) => {
      const targetConversationId =
        options?.conversationId || currentChannel?.id || null;
      const targetConversation = targetConversationId
        ? channels.find((channel) => channel.id === targetConversationId) || null
        : null;
      const targetMessage =
        targetConversation?.messages.find((message) => message.id === messageId) ||
        null;
      if (!targetMessage) {
        showToast("消息未找到");
        return;
      }
      if (targetMessage.role !== "me") {
        showToast("当前仅支持编辑自己发送的泡泡");
        return;
      }

      setContextMenu((prev) => ({ ...prev, show: false }));
      const nextDraft = buildDraftStateFromMessage(targetMessage);
      const origin = options?.origin || "chat";

      if (targetMessage.replyToMessageId) {
        threadEditRestoreRef.current = currentThreadDraft;
        setEditingThreadMessageId(messageId);
        updateCurrentThreadDraft(() => nextDraft);
        if (!targetConversationId) return;
        if (
          targetConversationId !== threadConversationId ||
          targetMessage.replyToMessageId !== threadMsgId ||
          targetMessage.commentTarget?.blockId !== threadBlockId
        ) {
          openThreadPane({
            origin,
            conversationId: targetConversationId,
            messageId: targetMessage.replyToMessageId,
            blockId: targetMessage.commentTarget?.blockId,
          });
        } else {
          setMobileView("thread");
          window.setTimeout(() => threadInputRef.current?.focus(), 30);
        }
        return;
      }

      if (targetConversationId !== currentChannel?.id || origin !== "chat") {
        showToast("请回到泡泡流里编辑这条泡泡");
        return;
      }

      mainEditRestoreRef.current = currentDraft;
      setEditingMessageId(messageId);
      setCurrentDraft(() => nextDraft);
      setActiveTab("chat");
      setActiveChat("assistant");
      setMobileView("chat");
      window.setTimeout(() => inputRef.current?.focus(), 30);
    },
    [
      channels,
      currentChannel,
      currentDraft,
      currentThreadDraft,
      openThreadPane,
      setCurrentDraft,
      threadBlockId,
      threadConversationId,
      threadInputRef,
      showToast,
      threadMsgId,
      updateCurrentThreadDraft,
    ],
  );

  const onCopyBubble = async () => {
    const text = (contextMenu.content || contextMenu.media || "").trim();
    if (!text) {
      showToast("当前泡泡没有可复制内容");
      setContextMenu((prev) => ({ ...prev, show: false }));
      return;
    }
    await copyTextToClipboard(text, "已复制泡泡");
    setContextMenu((prev) => ({ ...prev, show: false }));
  };

  const onCopyBubbleLink = useCallback(async () => {
    if (!contextMenu.conversationId || !contextMenu.msgId) {
      showToast("当前泡泡没有可复制链接");
      setContextMenu((prev) => ({ ...prev, show: false }));
      return;
    }

    await copyTextToClipboard(
      buildBubbleLink({
        conversationId: contextMenu.conversationId,
        messageId: contextMenu.msgId,
        blockId: contextMenu.blockId,
      }),
      "已复制泡泡链接",
    );
    setContextMenu((prev) => ({ ...prev, show: false }));
  }, [
    contextMenu.blockId,
    contextMenu.conversationId,
    contextMenu.msgId,
    copyTextToClipboard,
    showToast,
  ]);

  const scrollToMessage = useCallback(
    (targetId: string, blockId?: string, options?: { pushNav?: boolean }) => {
      if (!msgAreaRef.current) return false;
      if (options?.pushNav !== false) {
        const scroll = msgAreaRef.current.scrollTop;
        setNavStack((prev) => [...prev, scroll]);
      }
      const element = document.getElementById(`msg-${targetId}`);
      if (!element) {
        if (options?.pushNav !== false) {
          setNavStack((prev) => prev.slice(0, -1));
        }
        return false;
      }
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      const highlightId = blockId ? `${targetId}:${blockId}` : targetId;
      setHighlightedMsg(highlightId);
      window.setTimeout(() => setHighlightedMsg(null), 1500);
      return true;
    },
    [],
  );

  const jumpToMsg = useCallback(
    (targetId: string, blockId?: string) => {
      if (scrollToMessage(targetId, blockId, { pushNav: true })) {
        return;
      }

      const targetChannel =
        channels.find((channel) =>
          channel.messages.some((message) => message.id === targetId),
        ) || null;
      if (!targetChannel) {
        showToast("消息未找到");
        return;
      }

      setPendingJumpTarget({
        conversationId: targetChannel.id,
        messageId: targetId,
        blockId,
      });
      setThreadContext(null);
      setIsThreadCollapsed(false);
      setActiveTab("chat");
      setActiveChat("assistant");
      setMobileView("chat");
      setSelectedChatId(targetChannel.id);
    },
    [channels, scrollToMessage, showToast],
  );

  useEffect(() => {
    if (!pendingJumpTarget) return undefined;
    if (currentChannel?.id !== pendingJumpTarget.conversationId)
      return undefined;

    const timer = window.setTimeout(() => {
      const jumped = scrollToMessage(
        pendingJumpTarget.messageId,
        pendingJumpTarget.blockId,
        { pushNav: false },
      );
      if (!jumped) {
        showToast("消息未找到");
      }
      setPendingJumpTarget(null);
    }, 60);

    return () => window.clearTimeout(timer);
  }, [currentChannel?.id, pendingJumpTarget, scrollToMessage, showToast]);

  const navBackMsg = useCallback(() => {
    if (navStack.length === 0 || !msgAreaRef.current) return;
    const prevScroll = navStack[navStack.length - 1];
    msgAreaRef.current.scrollTo({ top: prevScroll, behavior: "smooth" });
    setNavStack((prev) => prev.slice(0, -1));
  }, [navStack]);

  const handleThreadJumpToMsg = useCallback(
    (targetId: string, blockId?: string) => {
      if (threadOrigin === "sorting") {
        if (!threadConversationId || !sortingSourceLocatorRef.current) return;
        void sortingSourceLocatorRef.current({
          conversationId: threadConversationId,
          messageId: targetId,
          blockId,
        });
        return;
      }
      jumpToMsg(targetId, blockId);
    },
    [jumpToMsg, threadConversationId, threadOrigin],
  );

  const handleStreamPhotoSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      try {
        if (event.target.files && event.target.files.length > 0) {
          const nextBlocks = await Promise.all(
            Array.from(event.target.files).map(classifyFile),
          );
          appendMainBlocks(nextBlocks);
        }
        event.target.value = "";
      } catch (error) {
        showToast(`添加图片失败：${getErrorMessage(error)}`);
        event.target.value = "";
      }
    },
    [appendMainBlocks, classifyFile, showToast],
  );

  const handleStreamFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      try {
        if (event.target.files && event.target.files.length > 0) {
          const nextBlocks = await Promise.all(
            Array.from(event.target.files).map(classifyFile),
          );
          appendMainBlocks(nextBlocks);
        }
        event.target.value = "";
      } catch (error) {
        showToast(`添加附件失败：${getErrorMessage(error)}`);
        event.target.value = "";
      }
    },
    [appendMainBlocks, classifyFile, showToast],
  );

  const threadMsg = useMemo(
    () =>
      threadMsgId
        ? threadMessages.find((item) => item.id === threadMsgId) || null
        : null,
    [threadMessages, threadMsgId],
  );
  const threadReplies = useMemo(
    () =>
      threadMsgId
        ? threadSortedMessages.filter(
            (item) =>
              item.replyToMessageId === threadMsgId &&
              (!threadBlockId || item.commentTarget?.blockId === threadBlockId),
          )
        : [],
    [threadBlockId, threadMsgId, threadSortedMessages],
  );

  const handleChatPaneDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (activeChat !== "assistant") return;
      event.preventDefault();
      setIsDragOver(true);
    },
    [activeChat],
  );

  const handleChatPaneDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleChatPaneDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (activeChat !== "assistant") return;
      event.preventDefault();
      setIsDragOver(false);
      const files = event.dataTransfer.files;
      if (!files.length) return;
      const fileArr = Array.from(files);
      if (hasDraftContent(currentDraft)) {
        void Promise.all(fileArr.map(classifyFile))
          .then((blocks) => {
            appendMainBlocks(blocks);
          })
          .catch((error) => {
            showToast(`处理文件失败：${getErrorMessage(error)}`);
          });
        return;
      }
      setPendingFiles(fileArr);
      setShowFileConfirm(true);
    },
    [activeChat, appendMainBlocks, classifyFile, currentDraft, showToast],
  );

  const handleMainComposerPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (event.clipboardData.files.length > 0) {
        event.preventDefault();
        const fileArr = Array.from(event.clipboardData.files);
        if (hasDraftContent(currentDraft)) {
          void Promise.all(fileArr.map(classifyFile))
            .then((blocks) => {
              appendMainBlocks(blocks);
            })
            .catch((error) => {
              showToast(`处理粘贴文件失败：${getErrorMessage(error)}`);
            });
        } else {
          setPendingFiles(fileArr);
          setShowFileConfirm(true);
        }
        return;
      }
      const text = event.clipboardData.getData("text");
      if (
        text &&
        text.startsWith("http") &&
        !hasDraftContent(currentDraft) &&
        !text.match(/\s/)
      ) {
        event.preventDefault();
        setPendingLink(text);
        setShowLinkConfirm(true);
      }
    },
    [appendMainBlocks, classifyFile, currentDraft, showToast],
  );

  const handleMainComposerDrop = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      const files = event.dataTransfer.files;
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      void Promise.all(Array.from(files).map(classifyFile))
        .then((blocks) => {
          appendMainBlocks(blocks);
        })
        .catch((error) => {
          showToast(`处理拖拽文件失败：${getErrorMessage(error)}`);
        });
    },
    [appendMainBlocks, classifyFile, showToast],
  );

  const handleMainComposerDragOver = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      event.preventDefault();
    },
    [],
  );

  const noop = useCallback(() => undefined, []);
  const handleCreateConversation = useCallback(() => {
    void addNewChat();
  }, [addNewChat]);
  const handleToggleFoldedList = useCallback(() => {
    setListViewMode((prev) => (prev === "folded" ? "main" : "folded"));
  }, []);
  const handleBackToList = useCallback(() => {
    closeThreadPane();
    setMobileView("list");
  }, [closeThreadPane]);
  const handleOpenGlobalBotSettings = useCallback(() => {
    persistCurrentConversationUiState({ immediate: true });
    setStreamSettingsOpen(false);
    setActiveTab("factory");
    setActiveChat("factory");
    setMobileView("factory");
  }, [persistCurrentConversationUiState]);
  const handleOpenCurrentChannelSettings = useCallback(() => {
    if (currentChannel) openStreamSettings(currentChannel.id);
  }, [currentChannel, openStreamSettings]);
  const handleStreamPhotoToolClick = useCallback(() => {
    streamPhotoInputRef.current?.click();
  }, []);
  const handleStreamFileToolClick = useCallback(() => {
    streamFileInputRef.current?.click();
  }, []);
  const handleConversationSend = useCallback(() => {
    void handleSendAction();
  }, [handleSendAction]);
  const handleThreadBackToChat = useCallback(() => {
    if (threadNavStack.length > 0) {
      const previousContext = threadNavStack[threadNavStack.length - 1];
      setThreadNavStack((prev) => prev.slice(0, -1));
      openThreadPane(previousContext, { preserveStack: true });
      return;
    }
    closeThreadPane();
  }, [closeThreadPane, openThreadPane, threadNavStack]);
  const handleThreadDialogBack = useCallback(() => {
    if (threadNavStack.length > 0) {
      const previousContext = threadNavStack[threadNavStack.length - 1];
      setThreadNavStack((prev) => prev.slice(0, -1));
      openThreadPane(previousContext, { preserveStack: true });
      return;
    }
    closeThreadDialog();
  }, [closeThreadDialog, openThreadPane, threadNavStack]);
  const handleThreadReplySend = useCallback(() => {
    void sendThreadReply();
  }, [sendThreadReply]);

  const listPaneProps = useMemo(
    () =>
      activeChat === "assistant"
        ? {
            rows: listRows,
            listViewMode,
            foldedChannelCount: foldedChannels.length,
            selectedChatId,
            isCollapsed: isListCollapsed,
            limit: listPane.limit,
            onCreateConversation: handleCreateConversation,
            onSelectChannel: selectChannel,
            onOpenChannelSettings: openStreamSettings,
            onToggleListCollapsed: setIsListCollapsed,
            onToggleFoldedList: handleToggleFoldedList,
            onResize: resizeListPane,
          }
        : null,
    [
      activeChat,
      foldedChannels.length,
      handleCreateConversation,
      handleToggleFoldedList,
      isListCollapsed,
      listPane.limit,
      listRows,
      listViewMode,
      openStreamSettings,
      resizeListPane,
      selectChannel,
      selectedChatId,
    ],
  );

  const openFullscreenMedia = useCallback(
    (src: string, type: "img" | "video") => {
      setFsSrc(src);
      setFsType(type);
      setFsOpen(true);
    },
    [],
  );

  const handleThreadOpenThread = useCallback(
    (messageId: string, blockId?: string) => {
      if (!threadConversationId || !threadOrigin || !threadContext) return;
      setThreadNavStack((prev) => [...prev, threadContext]);
      openThreadPane(
        {
          origin: threadOrigin,
          conversationId: threadConversationId,
          messageId,
          blockId,
        },
        { preserveStack: true },
      );
    },
    [openThreadPane, threadContext, threadConversationId, threadOrigin],
  );

  const handleToggleLike = useCallback(
    async (messageId: string, blockId?: string) => {
      try {
        if (!currentChannel) return;
        const updated = await toggleLike({
          conversationId: currentChannel.id,
          messageId,
          blockId,
        });
        applyConversation(updated, { select: true });
      } catch (error) {
        showToast(`点赞失败：${getErrorMessage(error)}`);
      }
    },
    [applyConversation, currentChannel, showToast],
  );

  const handleThreadToggleLike = useCallback(
    async (messageId: string, blockId?: string) => {
      try {
        if (!threadConversationId) return;
        const updated = await toggleLike({
          conversationId: threadConversationId,
          messageId,
          blockId,
        });
        applyConversation(updated, { select: threadOrigin === "chat" });
      } catch (error) {
        showToast(`点赞失败：${getErrorMessage(error)}`);
      }
    },
    [applyConversation, showToast, threadConversationId, threadOrigin],
  );

  const handleForwardMessage = useCallback((messageId: string) => {
    setForwardingMessageId(messageId);
  }, []);

  const handleSelectForwardConversation = useCallback(
    async (conversationId: string) => {
      try {
        if (!forwardingMessageId) return;
        const updated = await sendChatMessage({
          conversationId,
          forwardOfMessageId: forwardingMessageId,
          draft: { text: "", items: [] },
        });
        const targetChannel = channels.find(
          (channel) => channel.id === conversationId,
        );
        applyConversation(updated, {
          select: conversationId === currentChannel?.id,
        });
        setForwardingMessageId(null);
        showToast(`已转发到「${targetChannel?.title || "目标泡泡流"}」`);
      } catch (error) {
        showToast(`转发失败：${getErrorMessage(error)}`);
      }
    },
    [
      applyConversation,
      channels,
      currentChannel?.id,
      forwardingMessageId,
      showToast,
    ],
  );

  const saveRefinedBubble = async ({
    message,
    sourceIds,
    cardId,
    conversationId,
  }: {
    message: MessageData;
    sourceIds: string[];
    cardId?: string;
    conversationId?: string;
  }): Promise<{ conversationId: string; messageId: string } | null> => {
    try {
      if (!bridge) return null;
      const targetConversationId = conversationId || currentChannel?.id;
      if (!targetConversationId) return null;

      const updated = await sendChatMessage({
        conversationId: targetConversationId,
        message: {
          id: crypto.randomUUID(),
          role: "me",
          type: message.type,
          content: message.content,
          blocks: message.blocks,
          tips: `提炼完成：已整理 ${sourceIds.length} 条关联记录，可继续调整`,
          time: Date.now(),
        },
      });

      applyConversation(updated);
      await maybeTriggerAutoMachines(updated);

      const latestMessage = updated.messages[updated.messages.length - 1];
      if (!latestMessage) return null;

      if (cardId) {
        await bridge.sorting.update({
          streamId: targetConversationId,
          action: "link-output-message",
          cardId,
          outputMessageId: latestMessage.id,
          outputConversationId: targetConversationId,
          sourceIds,
        });
      }

      setActiveTab("chat");
      setActiveChat("assistant");
      setMobileView("chat");
      showToast("已保存提炼泡泡");

      return {
        conversationId: targetConversationId,
        messageId: latestMessage.id,
      };
    } catch (error) {
      showToast(`保存提炼泡泡失败：${getErrorMessage(error)}`);
      return null;
    }
  };

  const sendSortingSourceMessage = async ({
    conversationId,
    draft,
  }: {
    conversationId: string;
    draft: {
      text: string;
      items: Array<{
        type: "text" | "img" | "video" | "audio" | "link" | "file";
        val: string;
        fileName?: string;
      }>;
    };
  }) => {
    const preparedDraft = await prepareDraftPayload(draft as DraftState);
    const updated = await sendChatMessage({
      conversationId,
      draft: preparedDraft,
    });
    applyConversation(updated);
    await maybeTriggerAutoMachines(updated);
  };

  const updateCurrentStreamBasics = async ({
    title,
    avatarPreset,
    avatarUrl,
  }: {
    title: string;
    avatarPreset: string;
    avatarUrl: string;
  }) => {
    try {
      if (!streamSettingsChannel) return;
      await persistConversationMeta({
        conversationId: streamSettingsChannel.id,
        title,
        avatarPreset,
        avatarUrl,
      });
      showToast("流设置已保存");
    } catch (error) {
      showToast(`保存流设置失败：${getErrorMessage(error)}`);
    }
  };

  const clearCurrentStreamMessages = async () => {
    try {
      if (!streamSettingsChannel) return;
      const confirmed = window.confirm(
        `清空「${streamSettingsChannel.title}」里的全部聊天记录？此操作不可撤销。`,
      );
      if (!confirmed) return;
      const cleared = await clearChatMessages(streamSettingsChannel.id);
      applyConversation(cleared, {
        select: selectedChatId === streamSettingsChannel.id,
      });
      setHighlightedMsg(null);
      if (threadConversationId === streamSettingsChannel.id) {
        closeThreadPane();
      }
      if (selectedChatId === streamSettingsChannel.id) {
        setContextMenu((prev) => ({
          ...prev,
          show: false,
          msgId: null,
          blockId: undefined,
          subItemIndex: undefined,
          content: null,
          media: null,
          mediaType: null,
        }));
      }
      showToast("聊天已清空");
    } catch (error) {
      showToast(`清空聊天失败：${getErrorMessage(error)}`);
    }
  };

  const toggleCurrentStreamPinned = async () => {
    try {
      if (!streamSettingsChannel) return;
      await persistConversationMeta({
        conversationId: streamSettingsChannel.id,
        isPinned: !streamSettingsChannel.isPinned,
      });
    } catch (error) {
      showToast(`更新置顶状态失败：${getErrorMessage(error)}`);
    }
  };

  const toggleCurrentStreamFolded = async () => {
    try {
      if (!streamSettingsChannel) return;
      await persistConversationMeta({
        conversationId: streamSettingsChannel.id,
        isFolded: !streamSettingsChannel.isFolded,
      });
    } catch (error) {
      showToast(`更新折叠状态失败：${getErrorMessage(error)}`);
    }
  };

  const setCurrentStreamLifecycle = async (status: ChatLifecycleStatus) => {
    try {
      if (!streamSettingsChannel) return;
      await persistConversationMeta({
        conversationId: streamSettingsChannel.id,
        lifecycleStatus: status,
      });
      if (status === "deleted") {
        showToast("已移到最近删除");
      } else if (status === "archived") {
        showToast("已归档");
      } else {
        showToast("已恢复到流动");
      }
    } catch (error) {
      showToast(`更新流状态失败：${getErrorMessage(error)}`);
    }
  };

  const handleDeleteContextMessage = async () => {
    try {
      const messageId = contextMenu.msgId;
      const conversationId = contextMenu.conversationId;
      if (!messageId || !conversationId) return;
      setContextMenu((prev) => ({ ...prev, show: false }));
      const confirmed = window.confirm("删除这条消息？");
      if (!confirmed) return;
      const updated = await deleteChatMessage({
        conversationId,
        messageId,
      });
      applyConversation(updated, { select: contextMenu.origin === "chat" });
      setHighlightedMsg(null);
      if (
        threadConversationId === conversationId &&
        threadMsgId &&
        !updated.messages.some((item) => item.id === threadMsgId)
      ) {
        closeThreadPane();
      }
      showToast("消息已删除");
    } catch (error) {
      showToast(`删除消息失败：${getErrorMessage(error)}`);
    }
  };

  const handleSaveUserAvatar = useCallback(
    async (payload: { avatarUrl: string }) => {
      try {
        const saved = await saveUserProfile(payload);
        setUserProfile(saved);
        showToast("我的头像已全局更新");
      } catch (error) {
        showToast(`保存我的头像失败：${getErrorMessage(error)}`);
      }
    },
    [showToast],
  );

  const editingMessage = editingMessageId
    ? messages.find((message) => message.id === editingMessageId) || null
    : null;
  const editingThreadMessage = editingThreadMessageId
    ? threadMessages.find((message) => message.id === editingThreadMessageId) ||
      null
    : null;
  const composerEditBanner = editingMessage
    ? {
        title: buildMessagePreviewText(editingMessage) || "编辑泡泡",
        onCancel: cancelMainEdit,
      }
    : null;
  const threadComposerEditBanner = editingThreadMessage
    ? {
        title: buildMessagePreviewText(editingThreadMessage) || "编辑评论",
        onCancel: cancelThreadEdit,
      }
    : null;
  const threadPaneSharedProps = {
    threadMsgId,
    threadBlockId,
    threadMsg: threadMsg || null,
    threadReplies,
    isCollapsed: isThreadCollapsed,
    limit: threadPane.limit,
    currentUserAvatar,
    currentChannelAvatarUrl: threadConversation?.avatarUrl || "",
    isCurrentConversationDirect: isThreadConversationDirect,
    threadTitle: threadConversationTitle,
    userProfile,
    currentThreadDraft,
    threadComposerEditBanner,
    threadInputRef,
    threadPhotoInputRef,
    threadFileInputRef,
    replyCountByMessageId: threadReplyCountByMessageId,
    replyCountByMessageBlockId: threadReplyCountByMessageBlockId,
    onResize: resizeThreadPane,
    onBackToChat: handleThreadBackToChat,
    onClose: closeThreadPane,
    onExpand: () => setIsThreadCollapsed(false),
    onJumpToMsg: handleThreadJumpToMsg,
    onOpenThread: handleThreadOpenThread,
    onToggleLike: handleThreadToggleLike,
    onForwardMessage: handleForwardMessage,
    onOpenFullscreen: openFullscreenMedia,
    onOpenAttachment: openAttachmentWithDefaultApp,
    onTouchStart: handleThreadTouchStart,
    onTouchEnd: handlePressEnd,
    onContextMenu: handleThreadMouseRightClick,
    updateCurrentThreadDraft,
    onSendReply: handleThreadReplySend,
    onHandleThreadFiles: handleThreadFiles,
    onFocusComposer: noop,
  } satisfies Parameters<typeof ThreadPane>[0];

  if (!bridge) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,#f8faf6_0%,#eff4ee_100%)] px-6 py-10">
        <div className="max-w-xl rounded-[32px] border border-black/10 bg-white p-8 shadow-xl">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--text-secondary)]">
            Runtime Missing
          </div>
          <h1 className="mt-3 text-3xl font-bold text-[var(--text-primary)]">
            请从 Electron 启动桌面端
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)]">
            开发时请运行 `npm run dev --workspace desktop`。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-container"
      style={shellStyle}
      data-view={mobileView}
      data-chat={activeChat}
      data-list-collapsed={isListCollapsed}
      data-thread={threadMsgId !== null ? "true" : "false"}
      data-thread-origin={threadOrigin || "none"}
      data-thread-collapsed={isThreadCollapsed ? "true" : "false"}
    >
      <StreamPage
        listPane={listPaneProps}
        conversationPane={{
          currentChannel: currentChannel || null,
          currentUserAvatar,
          isCurrentConversationDirect,
          sortedMessages: topLevelMessages,
          highlightedMsg,
          currentDraft,
          composerEditBanner,
          navStackDepth: navStack.length,
          mobileView,
          isDragOver,
          msgAreaRef,
          inputRef,
          streamPhotoInputRef,
          streamFileInputRef,
          onBackToList: handleBackToList,
          onOpenCurrentChannelSettings: handleOpenCurrentChannelSettings,
          onMessageAreaScroll: handleMessageAreaScroll,
          onJumpToMsg: jumpToMsg,
          onOpenFullscreen: openFullscreenMedia,
          onOpenAttachment: openAttachmentWithDefaultApp,
          onTouchStart: handleTouchStart,
          onTouchEnd: handlePressEnd,
          onContextMenu: handleMouseRightClick,
          onOpenThread: openCurrentChatThreadPane,
          onToggleLike: handleToggleLike,
          onForwardMessage: handleForwardMessage,
          replyCountByMessageId,
          replyCountByMessageBlockId,
          setCurrentDraft,
          onCancelQuote: cancelQuote,
          onCancelForward: cancelForwardSource,
          onSend: handleConversationSend,
          onNavBack: navBackMsg,
          onFocusComposer: noop,
          onComposerPaste: handleMainComposerPaste,
          onComposerDrop: handleMainComposerDrop,
          onComposerDragOver: handleMainComposerDragOver,
          onPhotoToolClick: handleStreamPhotoToolClick,
          onFileToolClick: handleStreamFileToolClick,
          onRootDragOver: handleChatPaneDragOver,
          onRootDragLeave: handleChatPaneDragLeave,
          onRootDrop: handleChatPaneDrop,
          onStreamPhotoInputChange: handleStreamPhotoSelect,
          onStreamFileInputChange: handleStreamFileSelect,
        }}
      />

      <SortingPage
        streams={sortingStreams}
        selectedStreamId={selectedChatId}
        bots={factoryBots}
        defaultWorkspacePath={defaultWorkspacePath}
        onBack={() => {
          persistCurrentConversationUiState({ immediate: true });
          setActiveTab("chat");
          setActiveChat("assistant");
          setMobileView("chat");
        }}
        onSaveAsBubble={saveRefinedBubble}
        onSendToStream={(payload) => void sendSortingSourceMessage(payload)}
        onOpenSourceThread={openSortingThreadPane}
        onRegisterSourceLocator={registerSortingSourceLocator}
        onOpenGlobalBotSettings={handleOpenGlobalBotSettings}
      />

      <FactoryPage
        bots={factoryBots}
        providers={factoryProviders}
        defaultWorkspacePath={defaultWorkspacePath}
        runtime={bridge?.environment.runtime || "desktop"}
        onSaveBot={handleSaveFactoryBot}
        onSaveProvider={handleSaveFactoryProvider}
        onExportJson={handleExportAppJson}
        onImportJson={handleImportAppJson}
      />
      <ThreadPane
        {...threadPaneSharedProps}
        presentation="pane"
        onOpenDialog={openThreadDialog}
      />

      {threadDialogOpen && threadMsgId !== null ? (
        <div className="settings-overlay" onClick={closeThreadDialog}>
          <section
            className="thread-dialog-shell"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="评论区弹窗"
          >
            <ThreadPane
              {...threadPaneSharedProps}
              presentation="dialog"
              onBackToChat={handleThreadDialogBack}
              onClose={closeThreadDialog}
            />
          </section>
        </div>
      ) : null}

      <PrimaryTabBar
        activeTab={activeTab}
        showListToggle={activeChat === "assistant"}
        isListCollapsed={isListCollapsed}
        onSelectChat={() => {
          setActiveTab("chat");
          setActiveChat("assistant");
          setMobileView("chat");
        }}
        onSelectSorting={() => {
          persistCurrentConversationUiState({ immediate: true });
          setActiveTab("sorting");
          setActiveChat("sorting");
          setMobileView("sorting");
        }}
        onSelectFactory={() => {
          persistCurrentConversationUiState({ immediate: true });
          setActiveTab("factory");
          setActiveChat("factory");
          setMobileView("factory");
        }}
        onToggleList={() => setIsListCollapsed((prev) => !prev)}
      />

      <div className={`toast ${toastMsg ? "show" : ""}`}>{toastMsg}</div>
      {fsOpen && (
        <div
          className="fullscreen-overlay show"
          onClick={() => {
            setFsOpen(false);
            fsVideoRef.current?.pause();
          }}
        >
          <div className="fullscreen-close">×</div>
          {fsType === "img" ? (
            <img src={fsSrc} className="fullscreen-content" alt="fullscreen" />
          ) : (
            <video
              src={fsSrc}
              className="fullscreen-content"
              controls
              ref={fsVideoRef}
              autoPlay
              onClick={(event) => event.stopPropagation()}
            />
          )}
        </div>
      )}
      {contextMenu.show && (
        <div
          ref={contextMenuRef}
          className="context-menu show"
          style={{
            top: clampedContextMenuPos.y,
            left: clampedContextMenuPos.x,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              void onCopyBubble();
            }}
          >
            复制泡泡
          </div>
          <div
            className="context-menu-item"
            onClick={() => {
              void onCopyBubbleLink();
            }}
          >
            复制泡泡链接
          </div>
          {contextMenuMessage?.role === "me" ? (
            <div
              className="context-menu-item"
              onClick={() => {
                if (contextMenu.msgId) {
                  startEditingMessage(contextMenu.msgId, {
                    conversationId: contextMenu.conversationId,
                    origin: contextMenu.origin,
                  });
                }
              }}
            >
              编辑泡泡
            </div>
          ) : null}
          <div
            className="context-menu-item"
            onClick={() => {
              void onTriggerQuote();
            }}
          >
            引用
          </div>
          <div className="context-menu-item" onClick={onTriggerComment}>
            评论
          </div>
          {manualMachineBots.length > 0 && contextMenu.msgId ? (
            <>
              <div
                className="context-menu-item"
                onClick={() =>
                  setContextMenuSubmenu((prev) =>
                    prev === "machines" ? null : "machines",
                  )
                }
              >
                <span>投入泡泡机</span>
                <span
                  className={`context-menu-caret ${contextMenuSubmenu === "machines" ? "is-open" : ""}`}
                >
                  ›
                </span>
              </div>
              {contextMenuSubmenu === "machines" ? (
                <div className="context-menu-subgroup">
                  {manualMachineBots.map((bot) => (
                    <button
                      key={bot.id}
                      type="button"
                      className="context-menu-subitem"
                      onClick={() => {
                        void handleRunContextMachine(bot.id);
                      }}
                    >
                      <span>{bot.name}</span>
                      <span>
                        {bot.runtimeType === "external-codex"
                          ? "Codex"
                          : bot.providerName || "LLM"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="context-menu-item is-disabled">
              当前没有可用泡泡机
            </div>
          )}
          <div
            className="context-menu-item"
            onClick={() => {
              if (contextMenu.msgId) handleForwardMessage(contextMenu.msgId);
              setContextMenu((prev) => ({ ...prev, show: false }));
            }}
          >
            转发到...
          </div>
          <div
            className="context-menu-item"
            onClick={() => {
              void handleDeleteContextMessage();
            }}
          >
            删除消息
          </div>
        </div>
      )}

      {forwardingMessageId ? (
        <div
          className="confirm-dialog-overlay"
          onClick={() => setForwardingMessageId(null)}
        >
          <div
            className="confirm-dialog forward-picker"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-title">选择转发到的泡泡流</div>
            <div className="confirm-desc">
              选择一个目标泡泡流，直接完成纯转发。
            </div>
            <div className="forward-picker-list">
              {forwardTargets.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className={`forward-picker-item ${channel.id === currentChannel?.id ? "is-current" : ""}`}
                  onClick={() => {
                    void handleSelectForwardConversation(channel.id);
                  }}
                >
                  <div className="forward-picker-item__body">
                    <strong>{channel.title}</strong>
                    <span>{channel.lastMsg || "暂无内容"}</span>
                  </div>
                  {channel.id === currentChannel?.id ? (
                    <span className="forward-picker-item__badge">当前</span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="confirm-actions">
              <button
                className="btn-secondary"
                onClick={() => setForwardingMessageId(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showFileConfirm && (
        <div
          className="confirm-dialog-overlay"
          onClick={() => setShowFileConfirm(false)}
        >
          <div
            className="confirm-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-title">检测到文件/图片</div>
            <div className="confirm-desc">
              您希望直接发送这些内容，还是先放进当前泡泡的内容块托盘？
            </div>
            <div className="confirm-actions">
              <button
                className="btn-secondary"
                onClick={async () => {
                  try {
                    setShowFileConfirm(false);
                    const blocks = await Promise.all(
                      pendingFiles.map(classifyFile),
                    );
                    appendMainBlocks(blocks);
                    setPendingFiles([]);
                  } catch (error) {
                    showToast(`处理文件失败：${getErrorMessage(error)}`);
                  }
                }}
              >
                加入内容块
              </button>
              <button
                className="btn-primary"
                onClick={async () => {
                  try {
                    setShowFileConfirm(false);
                    for (const file of pendingFiles) {
                      const url = await uploadFile(file);
                      const item = classifyMessageFile(file, url);
                      if (item.type === "file") {
                        await sendRawMessage({
                          id: crypto.randomUUID(),
                          role: "me",
                          type: "file",
                          content: {
                            name: file.name,
                            size: `${(file.size / 1024).toFixed(1)} KB`,
                            url,
                          },
                          time: Date.now(),
                        });
                      } else {
                        await sendRawMessage({
                          id: crypto.randomUUID(),
                          role: "me",
                          type: item.type as MessageData["type"],
                          content: item.val,
                          time: Date.now(),
                        });
                      }
                    }
                    setPendingFiles([]);
                  } catch (error) {
                    showToast(`直接发送失败：${getErrorMessage(error)}`);
                  }
                }}
              >
                直接发送
              </button>
            </div>
          </div>
        </div>
      )}

      {showLinkConfirm && (
        <div
          className="confirm-dialog-overlay"
          onClick={() => setShowLinkConfirm(false)}
        >
          <div
            className="confirm-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-title">检测到链接</div>
            <div className="confirm-desc">
              是否将此链接加入当前泡泡的内容块，或直接发送成单独泡泡？
            </div>
            <div className="confirm-actions">
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowLinkConfirm(false);
                  if (pendingLink) {
                    setCurrentDraft((prev) =>
                      updateDraftBlocks(prev, [
                        ...getDraftBlocks(prev),
                        {
                          id: crypto.randomUUID(),
                          type: "text",
                          text: pendingLink,
                        },
                      ]),
                    );
                  }
                  setPendingLink(null);
                }}
              >
                作为文本
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setShowLinkConfirm(false);
                  if (pendingLink) {
                    setCurrentDraft((prev) =>
                      updateDraftBlocks(prev, [
                        ...getDraftBlocks(prev),
                        {
                          id: crypto.randomUUID(),
                          type: "link",
                          url: pendingLink,
                        },
                      ]),
                    );
                  }
                  setPendingLink(null);
                }}
              >
                加入内容块
              </button>
            </div>
          </div>
        </div>
      )}

      <StreamSettingsModal
        open={streamSettingsOpen}
        channel={streamSettingsChannel}
        userProfile={userProfile}
        defaultWorkspacePath={defaultWorkspacePath}
        onClose={() => setStreamSettingsOpen(false)}
        onSaveBasics={updateCurrentStreamBasics}
        onSaveUserAvatar={handleSaveUserAvatar}
        onClearMessages={clearCurrentStreamMessages}
        onTogglePinned={toggleCurrentStreamPinned}
        onToggleFolded={toggleCurrentStreamFolded}
        onSetLifecycleStatus={setCurrentStreamLifecycle}
        onOpenGlobalBotSettings={handleOpenGlobalBotSettings}
      />
    </div>
  );
}
