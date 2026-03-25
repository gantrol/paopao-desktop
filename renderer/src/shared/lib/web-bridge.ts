import type { ChatRecord, ChatSummary } from "@/entities/conversation";
import type { MessageData } from "@/entities/message";
import type { SortingWorkspaceView } from "@/entities/sorting";
import type { AiProviderRecord } from "@/entities/provider";
import type {
  BotConversationRecord,
  BotRecord,
  ConversationBotStreamEvent,
  ConversationBotTriggerResult,
  MachineRunStreamEvent,
  MachineRunTriggerResult,
} from "@/entities/bot";
import type { UserProfileRecord } from "@/entities/user";
import type { ImportedAsset, LinkPreviewMeta } from "@/shared/model";
import { USER_AVATAR } from "@/shared/config/avatar";
import type { DesktopBridge } from "@/shared/lib/desktop-bridge";
import {
  extractFirstHttpUrl,
  getLinkDisplayLabel,
  normalizeLinkInput,
} from "@/shared/lib/link";

const DB_NAME = "paopao-web-demo";
const DB_VERSION = 1;
const KV_STORE = "kv";
const ASSET_STORE = "assets";

const KEY_CONVERSATIONS = "conversations";
const KEY_SORTING = "sortingWorkspace";
const KEY_PROVIDERS = "aiProviders";
const KEY_BOTS = "bots";
const KEY_USER = "userProfile";
const KEY_BINDINGS = "conversationBotBindings";

const ASSET_PREFIX = "paopao-asset://asset/";

type AssetKind = "image" | "video" | "audio" | "file";

interface StoredAsset extends ImportedAsset {
  canonicalUrl: string;
  blob: Blob;
}

interface ExportAssetItem {
  assetId: string;
  kind: AssetKind;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  url: string;
  dataBase64: string;
}

interface AppExportPayload {
  version: number;
  app: string;
  exportedAt: number;
  conversations: ChatRecord[];
  sortingWorkspace: SortingWorkspaceView | null;
  aiProviders: AiProviderRecord[];
  bots: BotRecord[];
  userProfile: UserProfileRecord | null;
  assets: ExportAssetItem[];
}

type BindingMap = Record<string, Record<string, any>>;

const assetIdToObjectUrl = new Map<string, string>();
const objectUrlToAssetId = new Map<string, string>();
let assetRuntimeReady: Promise<void> | null = null;

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return Date.now();
}

function randomId() {
  return globalThis.crypto.randomUUID();
}

function createCanonicalAssetUrl(assetId: string) {
  return `${ASSET_PREFIX}${assetId}`;
}

function parseCanonicalAssetUrl(url: unknown) {
  if (typeof url !== "string") return "";
  return url.startsWith(ASSET_PREFIX) ? url.slice(ASSET_PREFIX.length) : "";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE);
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: "assetId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB open failed"));
  });
}

async function idbGet<T>(
  storeName: string,
  key: IDBValidKey,
  fallback: T,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () =>
      resolve((request.result as T | undefined) ?? fallback);
    request.onerror = () =>
      reject(request.error || new Error(`IndexedDB get failed: ${storeName}`));
  });
}

async function idbSet(
  storeName: string,
  key: IDBValidKey,
  value: unknown,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request =
      storeName === KV_STORE ? store.put(value, key) : store.put(value);
    request.onerror = () =>
      reject(request.error || new Error(`IndexedDB put failed: ${storeName}`));
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error || new Error(`IndexedDB tx failed: ${storeName}`));
  });
}

async function idbClear(storeName: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onerror = () =>
      reject(
        request.error || new Error(`IndexedDB clear failed: ${storeName}`),
      );
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error || new Error(`IndexedDB tx failed: ${storeName}`));
  });
}

async function idbGetAllAssets(): Promise<StoredAsset[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, "readonly");
    const store = tx.objectStore(ASSET_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result || []) as StoredAsset[]);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB getAll assets failed"));
  });
}

async function readState() {
  const [
    conversations,
    sortingWorkspace,
    aiProviders,
    bots,
    userProfile,
    bindings,
  ] = await Promise.all([
    idbGet<ChatRecord[]>(KV_STORE, KEY_CONVERSATIONS, []),
    idbGet<SortingWorkspaceView | null>(KV_STORE, KEY_SORTING, null),
    idbGet<AiProviderRecord[]>(KV_STORE, KEY_PROVIDERS, []),
    idbGet<BotRecord[]>(KV_STORE, KEY_BOTS, []),
    idbGet<UserProfileRecord | null>(KV_STORE, KEY_USER, {
      avatarUrl: USER_AVATAR,
    }),
    idbGet<BindingMap>(KV_STORE, KEY_BINDINGS, {}),
  ]);

  return {
    conversations,
    sortingWorkspace,
    aiProviders,
    bots,
    userProfile: userProfile || { avatarUrl: USER_AVATAR },
    bindings,
  };
}

async function writeState(next: {
  conversations?: ChatRecord[];
  sortingWorkspace?: SortingWorkspaceView | null;
  aiProviders?: AiProviderRecord[];
  bots?: BotRecord[];
  userProfile?: UserProfileRecord | null;
  bindings?: BindingMap;
}) {
  const current = await readState();
  const merged = {
    ...current,
    ...next,
  };

  await Promise.all([
    idbSet(KV_STORE, KEY_CONVERSATIONS, merged.conversations),
    idbSet(KV_STORE, KEY_SORTING, merged.sortingWorkspace),
    idbSet(KV_STORE, KEY_PROVIDERS, merged.aiProviders),
    idbSet(KV_STORE, KEY_BOTS, merged.bots),
    idbSet(KV_STORE, KEY_USER, merged.userProfile),
    idbSet(KV_STORE, KEY_BINDINGS, merged.bindings),
  ]);

  return merged;
}

function emptySortingWorkspace(): SortingWorkspaceView {
  return {
    workspaceId: "web-demo-workspace",
    title: "网页 Demo 分拣台",
    activeBoxId: "",
    luggageColumnId: null,
    sidebarSectionLayout: {
      boxes: 240,
      layers: 240,
      sources: 320,
    },
    selectedSourceIds: [],
    focusedSourceId: null,
    sourceViewMode: "all-selected",
    boxSourceSelections: {},
    selectedLayerIds: [],
    currentLayerId: null,
    boxes: [],
    layers: [],
    columns: [],
    columnItems: {},
    itemMap: {},
    canvasNodes: [],
    canvasEdges: [],
  };
}

function getMessagePreviewText(message: any): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content.trim();

  if (Array.isArray(message.blocks)) {
    const parts = message.blocks
      .map((block: any) => {
        switch (block?.type) {
          case "text":
            return block.text || "";
          case "img":
            return "[图片]";
          case "video":
            return "[视频]";
          case "audio":
            return "[音频]";
          case "link":
            return `[链接] ${block.url || block.text || ""}`;
          case "file":
            return `[文件] ${block.fileName || block.text || "未命名文件"}`;
          case "quote":
            return "[引用]";
          default:
            return "";
        }
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }

  if (Array.isArray(message.content)) {
    const parts = message.content
      .map((item: any) => {
        switch (item?.type) {
          case "text":
            return item.val || "";
          case "img":
            return "[图片]";
          case "video":
            return "[视频]";
          case "audio":
            return "[音频]";
          case "link":
            return `[链接] ${item.val || ""}`;
          case "file":
            return `[文件] ${item.fileName || item.val || "未命名文件"}`;
          default:
            return "";
        }
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }

  return "";
}

function normalizeConversation(
  record: Partial<ChatRecord> & { id?: string; chatId?: string },
): ChatRecord {
  const chatId = record.chatId || record.id || randomId();
  const messages = Array.isArray(record.messages)
    ? deepClone(record.messages)
    : [];
  const lastMessage = messages[messages.length - 1];

  return {
    chatId,
    title: record.title || "新泡泡流",
    avatar: record.avatar || record.avatarPreset || "bubble",
    avatarPreset: record.avatarPreset || record.avatar || "bubble",
    avatarUrl: record.avatarUrl || "",
    lastMsg: record.lastMsg || getMessagePreviewText(lastMessage) || "",
    lastTime:
      record.lastTime ||
      (lastMessage?.time
        ? new Date(lastMessage.time).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : ""),
    lastMessageAt: lastMessage?.time ?? record.lastMessageAt ?? null,
    messages,
    lifecycleStatus: record.lifecycleStatus || "flowing",
    isPinned: Boolean(record.isPinned),
    isFolded: Boolean(record.isFolded),
    isStalled: Boolean(record.isStalled),
    metadata:
      record.metadata && typeof record.metadata === "object"
        ? deepClone(record.metadata)
        : {},
  };
}

function buildSummary(record: ChatRecord): ChatSummary {
  return {
    id: record.chatId,
    title: record.title,
    avatar: record.avatar,
    avatarPreset: record.avatarPreset,
    avatarUrl: record.avatarUrl,
    lastMsg: record.lastMsg || "",
    lastTime: record.lastTime || "",
    lastMessageAt: record.lastMessageAt ?? null,
    messageCount: Array.isArray(record.messages) ? record.messages.length : 0,
    lifecycleStatus: record.lifecycleStatus || "flowing",
    isPinned: Boolean(record.isPinned),
    isFolded: Boolean(record.isFolded),
    isStalled: Boolean(record.isStalled),
    metadata: record.metadata || {},
  };
}

function upsertByChatId(conversations: ChatRecord[], record: ChatRecord) {
  const next = [...conversations];
  const index = next.findIndex((item) => item.chatId === record.chatId);
  if (index >= 0) {
    next[index] = record;
  } else {
    next.unshift(record);
  }
  return next.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
}

function canonicalizeAssetUrlsDeep<T>(value: T): T {
  if (typeof value === "string") {
    const assetId = objectUrlToAssetId.get(value);
    return (assetId ? createCanonicalAssetUrl(assetId) : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeAssetUrlsDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => [key, canonicalizeAssetUrlsDeep(item)],
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function materializeAssetUrlsDeep<T>(value: T): T {
  if (typeof value === "string") {
    const assetId = parseCanonicalAssetUrl(value);
    if (!assetId) return value;
    return (assetIdToObjectUrl.get(assetId) || value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => materializeAssetUrlsDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => [key, materializeAssetUrlsDeep(item)],
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}

async function ensureAssetRuntimeMap() {
  if (assetRuntimeReady) return assetRuntimeReady;

  assetRuntimeReady = (async () => {
    const assets = await idbGetAllAssets();
    assets.forEach((asset) => {
      if (assetIdToObjectUrl.has(asset.assetId)) return;
      const objectUrl = URL.createObjectURL(asset.blob);
      assetIdToObjectUrl.set(asset.assetId, objectUrl);
      objectUrlToAssetId.set(objectUrl, asset.assetId);
    });
  })();

  return assetRuntimeReady;
}

async function materialize<T>(value: T): Promise<T> {
  await ensureAssetRuntimeMap();
  return materializeAssetUrlsDeep(value);
}

function createMessageFromDraft(
  draft: Record<string, any> | undefined,
): MessageData {
  const blocks = Array.isArray(draft?.blocks) ? deepClone(draft.blocks) : [];
  const text = typeof draft?.text === "string" ? draft.text : "";

  return {
    id: randomId(),
    role: "me",
    type: "text",
    content: blocks.length > 0 ? blocks : text,
    blocks,
    time: now(),
    status: "success",
    engagement: {
      commentCount: 0,
      forwardCount: 0,
      likeCount: 0,
      likedByMe: false,
    },
    metadata: {},
  };
}

function ensureMessageDefaults(message: MessageData): MessageData {
  return {
    ...message,
    id: message.id || randomId(),
    time: typeof message.time === "number" ? message.time : now(),
    status: message.status || "success",
    engagement: message.engagement || {
      commentCount: 0,
      forwardCount: 0,
      likeCount: 0,
      likedByMe: false,
    },
  };
}

function buildFallbackLinkPreview(url: string): LinkPreviewMeta {
  const normalizedUrl = extractFirstHttpUrl(url);

  try {
    const parsed = new URL(normalizedUrl || url);
    const title = decodeURIComponent(
      parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname,
    );
    return {
      title,
      description: "",
      image: "",
      siteName: parsed.hostname.replace(/^www\./i, ""),
      url: parsed.toString(),
    };
  } catch {
    return {
      title: normalizeLinkInput(url),
      description: "",
      image: "",
      siteName: getLinkDisplayLabel(url),
      url: normalizedUrl || normalizeLinkInput(url),
    };
  }
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error || new Error("blobToBase64 failed"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

async function putAssetFromBlob(input: {
  assetId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  kind: AssetKind;
  blob: Blob;
}) {
  const canonicalUrl = createCanonicalAssetUrl(input.assetId);

  await idbSet(ASSET_STORE, input.assetId, {
    assetId: input.assetId,
    originalName: input.originalName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    kind: input.kind,
    url: canonicalUrl,
    canonicalUrl,
    blob: input.blob,
  });

  if (!assetIdToObjectUrl.has(input.assetId)) {
    const objectUrl = URL.createObjectURL(input.blob);
    assetIdToObjectUrl.set(input.assetId, objectUrl);
    objectUrlToAssetId.set(objectUrl, input.assetId);
  }

  return {
    assetId: input.assetId,
    url: assetIdToObjectUrl.get(input.assetId) || canonicalUrl,
    originalName: input.originalName,
    sizeBytes: input.sizeBytes,
    mimeType: input.mimeType,
    kind: input.kind,
  } satisfies ImportedAsset;
}

function detectAssetKind(mimeType: string): AssetKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function buildQuoteSnapshot(message: MessageData, blockId?: string) {
  const snapshotBlocks =
    Array.isArray(message.blocks) && message.blocks.length > 0
      ? deepClone(message.blocks)
      : [
          {
            id: randomId(),
            type: "text",
            text: getMessagePreviewText(message),
          },
        ];

  return {
    targetMessageId: message.id,
    targetBlockId: blockId,
    snapshotBlocks,
  };
}

function createWebBridge(): DesktopBridge {
  const bridge: DesktopBridge = {
    environment: {
      runtime: "web",
    },

    conversations: {
      async list() {
        const state = await readState();
        const summaries = state.conversations.map(buildSummary);
        return materialize(summaries);
      },

      async get(conversationId: string) {
        const state = await readState();
        const found =
          state.conversations.find((item) => item.chatId === conversationId) ||
          null;
        return found ? materialize(found) : null;
      },

      async save(payload: ChatRecord) {
        const state = await readState();
        const nextRecord = normalizeConversation(
          canonicalizeAssetUrlsDeep(payload),
        );
        const conversations = upsertByChatId(state.conversations, nextRecord);
        await writeState({ conversations });
        return materialize(nextRecord);
      },

      async create(payload?: Partial<ChatRecord>) {
        const nextRecord = normalizeConversation(
          canonicalizeAssetUrlsDeep(payload || {}),
        );
        const state = await readState();
        const conversations = upsertByChatId(state.conversations, nextRecord);
        await writeState({ conversations });
        return materialize(nextRecord);
      },

      async clear(conversationId: string) {
        const state = await readState();
        const found = state.conversations.find(
          (item) => item.chatId === conversationId,
        );
        if (!found)
          throw new Error(`Conversation not found: ${conversationId}`);
        const nextRecord = normalizeConversation({
          ...found,
          messages: [],
          lastMsg: "",
          lastTime: "",
          lastMessageAt: null,
        });
        const conversations = upsertByChatId(state.conversations, nextRecord);
        await writeState({ conversations });
        return materialize(nextRecord);
      },

      async updateMeta(payload: Record<string, unknown>) {
        const conversationId =
          typeof payload.conversationId === "string"
            ? payload.conversationId
            : "";
        const state = await readState();
        const found = state.conversations.find(
          (item) => item.chatId === conversationId,
        );
        if (!found)
          throw new Error(`Conversation not found: ${conversationId}`);

        const nextRecord = normalizeConversation({
          ...found,
          title:
            typeof payload.title === "string" ? payload.title : found.title,
          avatarPreset:
            typeof payload.avatarPreset === "string"
              ? payload.avatarPreset
              : found.avatarPreset,
          avatarUrl:
            typeof payload.avatarUrl === "string"
              ? payload.avatarUrl
              : found.avatarUrl,
          lifecycleStatus: payload.lifecycleStatus ?? found.lifecycleStatus,
          isPinned: payload.isPinned ?? found.isPinned,
          isFolded: payload.isFolded ?? found.isFolded,
          metadata: {
            ...(found.metadata || {}),
            ...(payload.uiState !== undefined
              ? { uiState: canonicalizeAssetUrlsDeep(payload.uiState) }
              : {}),
            ...(payload.activeTopicId !== undefined
              ? { activeTopicId: payload.activeTopicId }
              : {}),
            ...(payload.activeIdentityId !== undefined
              ? { activeIdentityId: payload.activeIdentityId }
              : {}),
          },
        });

        const conversations = upsertByChatId(
          state.conversations,
          canonicalizeAssetUrlsDeep(nextRecord),
        );
        await writeState({ conversations });
        return materialize(nextRecord);
      },
    },

    messages: {
      async send(payload: Record<string, unknown>) {
        const conversationId =
          typeof payload.conversationId === "string"
            ? payload.conversationId
            : "";
        const state = await readState();
        const conversation = state.conversations.find(
          (item) => item.chatId === conversationId,
        );
        if (!conversation)
          throw new Error(`Conversation not found: ${conversationId}`);

        const nextConversation = deepClone(conversation);
        const incoming = payload.message
          ? ensureMessageDefaults(
              canonicalizeAssetUrlsDeep(payload.message as MessageData),
            )
          : createMessageFromDraft(
              canonicalizeAssetUrlsDeep(payload.draft as Record<string, any>),
            );

        if (
          typeof payload.replyToMessageId === "string" &&
          payload.replyToMessageId
        ) {
          incoming.replyToMessageId = payload.replyToMessageId;
        }
        if (
          typeof payload.targetBlockId === "string" &&
          payload.targetBlockId &&
          incoming.replyToMessageId
        ) {
          incoming.commentTarget = {
            messageId: incoming.replyToMessageId,
            blockId: payload.targetBlockId,
          };
        }

        nextConversation.messages.push(incoming);

        if (incoming.replyToMessageId) {
          const parent = nextConversation.messages.find(
            (item) => item.id === incoming.replyToMessageId,
          );
          if (parent) {
            parent.engagement = parent.engagement || {
              commentCount: 0,
              forwardCount: 0,
              likeCount: 0,
              likedByMe: false,
            };
            parent.engagement.commentCount += 1;
          }
        }

        const normalizedConversation = normalizeConversation(nextConversation);
        const conversations = upsertByChatId(
          state.conversations,
          normalizedConversation,
        );
        await writeState({ conversations });
        return materialize(normalizedConversation);
      },

      async update(payload: Record<string, unknown>) {
        const conversationId =
          typeof payload.conversationId === "string"
            ? payload.conversationId
            : "";
        const messageId =
          typeof payload.messageId === "string" ? payload.messageId : "";
        const state = await readState();
        const conversation = state.conversations.find(
          (item) => item.chatId === conversationId,
        );
        if (!conversation)
          throw new Error(`Conversation not found: ${conversationId}`);

        const nextConversation = deepClone(conversation);
        const target = nextConversation.messages.find(
          (item) => item.id === messageId,
        );
        if (!target) throw new Error(`Message not found: ${messageId}`);

        const nextDraft = canonicalizeAssetUrlsDeep(
          payload.draft as Record<string, any>,
        );
        const nextBlocks = Array.isArray(nextDraft?.blocks)
          ? deepClone(nextDraft.blocks)
          : [];
        target.blocks = nextBlocks;
        target.content =
          nextBlocks.length > 0
            ? nextBlocks
            : typeof nextDraft?.text === "string"
              ? nextDraft.text
              : target.content;
        target.status = "success";

        const normalizedConversation = normalizeConversation(nextConversation);
        const conversations = upsertByChatId(
          state.conversations,
          normalizedConversation,
        );
        await writeState({ conversations });
        return materialize(normalizedConversation);
      },

      async delete(payload: Record<string, unknown>) {
        const conversationId =
          typeof payload.conversationId === "string"
            ? payload.conversationId
            : "";
        const messageId =
          typeof payload.messageId === "string" ? payload.messageId : "";
        const state = await readState();
        const conversation = state.conversations.find(
          (item) => item.chatId === conversationId,
        );
        if (!conversation)
          throw new Error(`Conversation not found: ${conversationId}`);

        const deleteIds = new Set([messageId]);
        let changed = true;
        while (changed) {
          changed = false;
          conversation.messages.forEach((message) => {
            if (
              message.replyToMessageId &&
              deleteIds.has(message.replyToMessageId) &&
              !deleteIds.has(message.id)
            ) {
              deleteIds.add(message.id);
              changed = true;
            }
          });
        }

        const nextConversation = normalizeConversation({
          ...conversation,
          messages: conversation.messages.filter(
            (item) => !deleteIds.has(item.id),
          ),
        });

        const conversations = upsertByChatId(
          state.conversations,
          nextConversation,
        );
        await writeState({ conversations });
        return materialize(nextConversation);
      },

      async quote(payload: Record<string, unknown>) {
        const conversationId =
          typeof payload.conversationId === "string"
            ? payload.conversationId
            : "";
        const messageId =
          typeof payload.messageId === "string" ? payload.messageId : "";
        const blockId =
          typeof payload.blockId === "string" ? payload.blockId : undefined;

        const state = await readState();
        const conversation = state.conversations.find(
          (item) => item.chatId === conversationId,
        );
        const message = conversation?.messages.find(
          (item) => item.id === messageId,
        );
        if (!message) throw new Error(`Message not found: ${messageId}`);

        return materialize(buildQuoteSnapshot(message, blockId));
      },

      async comment(payload: Record<string, unknown>) {
        return bridge.messages.send({
          conversationId: payload.conversationId,
          message: payload.message,
          draft: payload.draft || { text: payload.content || "", items: [] },
          replyToMessageId: payload.messageId,
          targetBlockId: payload.targetBlockId,
        });
      },

      async toggleLike(payload: Record<string, unknown>) {
        const conversationId =
          typeof payload.conversationId === "string"
            ? payload.conversationId
            : "";
        const messageId =
          typeof payload.messageId === "string" ? payload.messageId : "";
        const state = await readState();
        const conversation = state.conversations.find(
          (item) => item.chatId === conversationId,
        );
        if (!conversation)
          throw new Error(`Conversation not found: ${conversationId}`);

        const nextConversation = deepClone(conversation);
        const message = nextConversation.messages.find(
          (item) => item.id === messageId,
        );
        if (!message) throw new Error(`Message not found: ${messageId}`);

        message.engagement = message.engagement || {
          commentCount: 0,
          forwardCount: 0,
          likeCount: 0,
          likedByMe: false,
        };

        if (message.engagement.likedByMe) {
          message.engagement.likedByMe = false;
          message.engagement.likeCount = Math.max(
            0,
            (message.engagement.likeCount || 1) - 1,
          );
        } else {
          message.engagement.likedByMe = true;
          message.engagement.likeCount =
            (message.engagement.likeCount || 0) + 1;
        }

        const normalizedConversation = normalizeConversation(nextConversation);
        const conversations = upsertByChatId(
          state.conversations,
          normalizedConversation,
        );
        await writeState({ conversations });
        return materialize(normalizedConversation);
      },
    },

    assets: {
      async importFile(payload) {
        const assetId = randomId();
        const mimeType = payload.type || "application/octet-stream";
        const blob = new Blob([payload.buffer], { type: mimeType });

        return putAssetFromBlob({
          assetId,
          originalName: payload.name,
          mimeType,
          sizeBytes: payload.size,
          kind: detectAssetKind(mimeType),
          blob,
        });
      },

      async importFiles(payloads) {
        return Promise.all(
          payloads.map((payload) => bridge.assets.importFile(payload)),
        );
      },

      async open(target: string) {
        const normalized = normalizeLinkInput(target);
        if (!normalized) throw new Error("Attachment URL is required");
        window.open(normalized, "_blank", "noopener,noreferrer");
        return { ok: true as const };
      },
    },

    sorting: {
      async get() {
        const state = await readState();
        return deepClone(state.sortingWorkspace || emptySortingWorkspace());
      },

      async save(payload: Record<string, unknown>) {
        const state = await readState();
        const current = state.sortingWorkspace || emptySortingWorkspace();

        if (typeof payload.action === "string") {
          return deepClone(current);
        }

        const nextWorkspace = {
          ...current,
          ...deepClone(payload),
        } as SortingWorkspaceView;

        await writeState({
          sortingWorkspace: canonicalizeAssetUrlsDeep(nextWorkspace),
        });
        return deepClone(nextWorkspace);
      },

      async move() {
        const state = await readState();
        return deepClone(state.sortingWorkspace || emptySortingWorkspace());
      },

      async update() {
        const state = await readState();
        return deepClone(state.sortingWorkspace || emptySortingWorkspace());
      },
    },

    linkPreview: {
      async get(url: string) {
        return buildFallbackLinkPreview(url);
      },
    },

    ai: {
      async refine() {
        throw new Error("Web demo 暂不支持 AI refine。");
      },
      async filter() {
        throw new Error("Web demo 暂不支持 AI filter。");
      },
      async triggerConversationBots() {
        throw new Error("Web demo 暂不支持自动触发泡泡机。");
      },
      async triggerMachineRun() {
        throw new Error("Web demo 暂不支持泡泡机运行。");
      },
      async cancelMachineRun() {
        throw new Error("Web demo 暂不支持取消运行。");
      },
      onConversationBotStream(
        _listener: (payload: ConversationBotStreamEvent) => void,
      ) {
        return () => {};
      },
      onMachineRunStream(_listener: (payload: MachineRunStreamEvent) => void) {
        return () => {};
      },
    },

    settings: {
      async listAiProviders() {
        const state = await readState();
        return materialize(state.aiProviders);
      },

      async saveAiProvider(payload: Record<string, unknown>) {
        const state = await readState();
        const id =
          typeof payload.id === "string" && payload.id
            ? payload.id
            : randomId();
        const next: AiProviderRecord = {
          id,
          name: typeof payload.name === "string" ? payload.name : "",
          kind:
            typeof payload.kind === "string"
              ? payload.kind
              : "openai-compatible",
          baseUrl: typeof payload.baseUrl === "string" ? payload.baseUrl : "",
          defaultModel:
            typeof payload.defaultModel === "string"
              ? payload.defaultModel
              : "",
          apiKeyRef: "",
          hasApiKey: false,
          apiKeyStorage: "Browser Memory",
          apiKeyStorageKind: "browser-demo",
          availableModels: [],
          enabled: payload.enabled !== false,
        };

        const list = [...state.aiProviders];
        const index = list.findIndex((item) => item.id === id);
        if (index >= 0) list[index] = next;
        else list.unshift(next);

        await writeState({ aiProviders: list });
        return id;
      },

      async listBots(payload?: Record<string, unknown>) {
        const state = await readState();
        const conversationId =
          typeof payload?.conversationId === "string"
            ? payload.conversationId
            : "";
        const bindings = state.bindings[conversationId] || {};

        const list = state.bots.map((bot) => {
          const binding = conversationId
            ? bindings[bot.id] || {
                conversationId,
                botId: bot.id,
                enabled: false,
                replyMode: "auto",
                triggerMode: "auto",
                outputMode: "stream-reply",
                alias: "",
                sortOrder: 0,
                metadata: null,
              }
            : null;

          return {
            ...bot,
            binding,
          };
        });

        return materialize(list);
      },

      async listBotConversations(botId: string) {
        const state = await readState();
        const result: BotConversationRecord[] = [];

        state.conversations.forEach((conversation) => {
          const binding = state.bindings[conversation.chatId]?.[botId];
          const metadata = (conversation.metadata || {}) as Record<
            string,
            unknown
          >;
          const isDirectConversation = metadata.directBotId === botId;

          if (!binding && !isDirectConversation) return;

          result.push({
            ...buildSummary(conversation),
            invited: Boolean(binding?.enabled || isDirectConversation),
            isDirectConversation,
            replyMode: binding?.replyMode || "auto",
            triggerMode: binding?.triggerMode || "auto",
            outputMode: binding?.outputMode || "stream-reply",
            alias: binding?.alias || "",
            sortOrder: binding?.sortOrder || 0,
            binding: binding || null,
          });
        });

        return materialize(result);
      },

      async saveBot(payload: Record<string, unknown>) {
        const state = await readState();
        const id =
          typeof payload.id === "string" && payload.id
            ? payload.id
            : randomId();

        const next: BotRecord = {
          id,
          name:
            typeof payload.name === "string" ? payload.name : "未命名泡泡机",
          slug: typeof payload.slug === "string" ? payload.slug : "",
          introduction:
            typeof payload.introduction === "string"
              ? payload.introduction
              : "",
          avatarUrl:
            typeof payload.avatarUrl === "string" ? payload.avatarUrl : "",
          avatarPreset:
            typeof payload.avatarPreset === "string"
              ? payload.avatarPreset
              : "machine",
          providerId:
            typeof payload.providerId === "string" ? payload.providerId : "",
          providerName: "",
          providerKind: "",
          providerBaseUrl: "",
          providerDefaultModel: "",
          providerApiKeyRef: "",
          providerHasApiKey: false,
          providerEnabled: true,
          providerMetadata: null,
          model: typeof payload.model === "string" ? payload.model : "",
          runtimeType:
            payload.runtimeType === "external-codex" ? "external-codex" : "llm",
          runtimeConfig:
            payload.runtimeConfig && typeof payload.runtimeConfig === "object"
              ? deepClone(payload.runtimeConfig)
              : {},
          systemPrompt:
            typeof payload.systemPrompt === "string"
              ? payload.systemPrompt
              : "",
          enabled: payload.enabled !== false,
          sortOrder:
            typeof payload.sortOrder === "number" ? payload.sortOrder : 0,
          metadata:
            payload.metadata && typeof payload.metadata === "object"
              ? deepClone(payload.metadata)
              : null,
          binding: null,
          identityBinding: null,
        } as BotRecord;

        const list = [...state.bots];
        const index = list.findIndex((item) => item.id === id);
        if (index >= 0) list[index] = canonicalizeAssetUrlsDeep(next);
        else list.unshift(canonicalizeAssetUrlsDeep(next));

        await writeState({ bots: list });
        return id;
      },

      async getUserProfile() {
        const state = await readState();
        return materialize(state.userProfile || { avatarUrl: USER_AVATAR });
      },

      async saveUserProfile(payload: Record<string, unknown>) {
        const state = await readState();
        const nextProfile: UserProfileRecord = canonicalizeAssetUrlsDeep({
          ...(state.userProfile || { avatarUrl: USER_AVATAR }),
          ...(payload && typeof payload === "object" ? payload : {}),
        });
        await writeState({ userProfile: nextProfile });
        return materialize(nextProfile);
      },
    },

    bots: {
      async ensureDirectConversation(botId: string) {
        const state = await readState();
        const bot = state.bots.find((item) => item.id === botId);
        if (!bot) throw new Error(`Bot not found: ${botId}`);

        const existing = state.conversations.find((item) => {
          const metadata =
            item.metadata && typeof item.metadata === "object"
              ? (item.metadata as Record<string, unknown>)
              : {};
          return metadata.directBotId === botId;
        });

        if (existing) {
          return materialize(existing);
        }

        const conversation = normalizeConversation({
          chatId: `direct_${botId}`,
          title: bot.name,
          avatar: bot.avatarPreset || "machine",
          avatarPreset: bot.avatarPreset || "machine",
          avatarUrl: bot.avatarUrl || "",
          metadata: {
            directBotId: bot.id,
            directBotName: bot.name,
            conversationMode: "direct-bot",
          },
          messages: [],
        });

        const conversations = upsertByChatId(
          state.conversations,
          canonicalizeAssetUrlsDeep(conversation),
        );
        const bindings = {
          ...state.bindings,
          [conversation.chatId]: {
            ...(state.bindings[conversation.chatId] || {}),
            [bot.id]: {
              conversationId: conversation.chatId,
              botId: bot.id,
              enabled: true,
              replyMode: "auto",
              triggerMode:
                bot.runtimeType === "external-codex" ? "manual" : "auto",
              outputMode:
                bot.runtimeType === "external-codex"
                  ? "thread-comment"
                  : "stream-reply",
              alias: "",
              sortOrder: 0,
              metadata: null,
            },
          },
        };

        await writeState({ conversations, bindings });
        return materialize(conversation);
      },

      async saveBinding(payload: Record<string, unknown>) {
        const state = await readState();
        const conversationId =
          typeof payload.conversationId === "string"
            ? payload.conversationId
            : "";
        const botId = typeof payload.botId === "string" ? payload.botId : "";
        if (!conversationId) throw new Error("conversationId is required.");
        if (!botId) throw new Error("botId is required.");

        const nextBindings: BindingMap = deepClone(state.bindings);
        nextBindings[conversationId] = nextBindings[conversationId] || {};

        if (payload.enabled === false) {
          delete nextBindings[conversationId][botId];
        } else {
          nextBindings[conversationId][botId] = {
            conversationId,
            botId,
            enabled: true,
            replyMode: payload.replyMode === "mention" ? "mention" : "auto",
            triggerMode: payload.triggerMode || payload.replyMode || "auto",
            outputMode: payload.outputMode || "stream-reply",
            alias: typeof payload.alias === "string" ? payload.alias : "",
            sortOrder:
              typeof payload.sortOrder === "number" ? payload.sortOrder : 0,
            metadata:
              payload.metadata && typeof payload.metadata === "object"
                ? deepClone(payload.metadata)
                : null,
          };
        }

        await writeState({ bindings: nextBindings });
        return bridge.settings.listBots({ conversationId });
      },
    },

    system: {
      async getInfo() {
        return {
          runtime: "web" as const,
          dataRoot: "",
          dbPath: "indexeddb://paopao-web-demo",
          cwd: "",
        };
      },

      async exportData() {
        const state = await readState();
        const assets = await idbGetAllAssets();

        const exportedAssets: ExportAssetItem[] = await Promise.all(
          assets.map(async (asset) => ({
            assetId: asset.assetId,
            kind: asset.kind,
            mimeType: asset.mimeType,
            originalName: asset.originalName,
            sizeBytes: asset.sizeBytes,
            url: createCanonicalAssetUrl(asset.assetId),
            dataBase64: await blobToBase64(asset.blob),
          })),
        );

        const payload: AppExportPayload = {
          version: 1,
          app: "paopao",
          exportedAt: now(),
          conversations: state.conversations,
          sortingWorkspace: state.sortingWorkspace || emptySortingWorkspace(),
          aiProviders: state.aiProviders.map((item) => ({
            ...item,
            apiKeyRef: "",
            hasApiKey: false,
          })),
          bots: state.bots.map((item) => ({
            ...item,
            providerApiKeyRef: "",
            providerHasApiKey: false,
          })),
          userProfile: state.userProfile || { avatarUrl: USER_AVATAR },
          assets: exportedAssets,
        };

        return payload as unknown as Record<string, unknown>;
      },

      async importData(payload: Record<string, unknown>) {
        const normalized = payload as Partial<AppExportPayload>;

        await idbClear(KV_STORE);
        await idbClear(ASSET_STORE);

        assetRuntimeReady = null;
        assetIdToObjectUrl.forEach((url) => URL.revokeObjectURL(url));
        assetIdToObjectUrl.clear();
        objectUrlToAssetId.clear();

        const assets = Array.isArray(normalized.assets)
          ? normalized.assets
          : [];
        for (const asset of assets) {
          const blob = base64ToBlob(
            asset.dataBase64 || "",
            asset.mimeType || "application/octet-stream",
          );
          await putAssetFromBlob({
            assetId: asset.assetId || randomId(),
            originalName: asset.originalName || "asset",
            mimeType: asset.mimeType || "application/octet-stream",
            sizeBytes: asset.sizeBytes || blob.size,
            kind: asset.kind || detectAssetKind(asset.mimeType || ""),
            blob,
          });
        }

        await writeState({
          conversations: Array.isArray(normalized.conversations)
            ? normalized.conversations.map((item) =>
                normalizeConversation(item),
              )
            : [],
          sortingWorkspace:
            normalized.sortingWorkspace || emptySortingWorkspace(),
          aiProviders: Array.isArray(normalized.aiProviders)
            ? normalized.aiProviders
            : [],
          bots: Array.isArray(normalized.bots) ? normalized.bots : [],
          userProfile: normalized.userProfile || { avatarUrl: USER_AVATAR },
          bindings: {},
        });

        return { ok: true as const };
      },
    },
  };

  return bridge;
}

if (typeof window !== "undefined" && !window.paopao) {
  window.paopao = createWebBridge();
}

export {};
