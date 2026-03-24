const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  BlobStore,
  createAssetUrl,
  parseAssetUrl,
  guessMimeFromName,
} = require('./blobStore');
const {
  BUILTIN_AI_PROVIDERS,
  BUILTIN_BOTS,
} = require('./botPresets');
const {
  extractFirstHttpUrl,
  getLinkHostname,
} = require('./linkUrl');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeJsonParse(rawText, fallback) {
  if (!rawText) return fallback;
  try {
    return JSON.parse(rawText);
  } catch {
    return fallback;
  }
}

function safeJsonStringify(value) {
  return JSON.stringify(value ?? null);
}

function extractLegacyUploadFileName(value) {
  if (typeof value !== 'string') return null;
  const matched = value.match(/\/uploads\/([^/?#]+)/i);
  if (!matched) return null;
  return decodeURIComponent(matched[1]);
}

function isBrokenBlobValue(value) {
  return typeof value === 'string' && value.startsWith('blob:');
}

function isResolvedMediaValue(value) {
  return typeof value === 'string' && value.trim() && !isBrokenBlobValue(value);
}

function buildMediaRepairSignature(message) {
  if (!message || typeof message !== 'object') return null;

  if (message.type === 'compound' && Array.isArray(message.content)) {
    return JSON.stringify({
      type: message.type,
      content: message.content.map((item) => {
        if (!item || typeof item !== 'object') return item;
        if (item.type === 'img' || item.type === 'video' || item.type === 'audio' || item.type === 'file') {
          return { ...item, val: '__media__' };
        }
        return item;
      }),
    });
  }

  if (message.type === 'img' || message.type === 'video' || message.type === 'audio' || message.type === 'file') {
    return JSON.stringify({ type: message.type, content: '__media__' });
  }

  return null;
}

function hasResolvedMedia(message) {
  if (!message || typeof message !== 'object') return false;
  if (typeof message.content === 'string') return isResolvedMediaValue(message.content);
  if (!Array.isArray(message.content)) return false;
  return message.content.some((item) => item && typeof item === 'object' && isResolvedMediaValue(item.val));
}

function buildResolvedMediaCandidateLookup(candidates) {
  const lookup = new Map();
  if (!Array.isArray(candidates)) return lookup;
  candidates.forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const signature = buildMediaRepairSignature(candidate);
    if (!signature || !hasResolvedMedia(candidate) || lookup.has(signature)) return;
    lookup.set(signature, candidate);
  });
  return lookup;
}

function now() {
  return Date.now();
}

const CONVERSATION_LIFECYCLE_STATUSES = new Set(['flowing', 'archived', 'deleted']);
const DEFAULT_CONVERSATION_AVATAR_PRESET = 'bubble';
const CONVERSATION_STALLED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BOT_RUNTIME_TYPES = new Set(['llm', 'external-codex']);
const BOT_TRIGGER_MODES = new Set(['auto', 'mention', 'manual']);
const BOT_OUTPUT_MODES = new Set(['stream-reply', 'thread-comment']);

function normalizeBotRuntimeType(value) {
  return BOT_RUNTIME_TYPES.has(value) ? value : 'llm';
}

function normalizeBotRuntimeConfig(value) {
  if (!value || typeof value !== 'object') return null;
  return safeJsonParse(safeJsonStringify(value), null);
}

function normalizeBotTriggerMode(value) {
  return BOT_TRIGGER_MODES.has(value) ? value : 'auto';
}

function normalizeBotOutputMode(value) {
  return BOT_OUTPUT_MODES.has(value) ? value : 'stream-reply';
}

function getTableColumnNames(db, tableName) {
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name),
  );
}

function ensureTableColumn(db, tableName, columnName, definitionSql) {
  const existing = getTableColumnNames(db, tableName);
  if (existing.has(columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
}

function normalizeConversationAvatarPreset(value) {
  if (typeof value !== 'string') return DEFAULT_CONVERSATION_AVATAR_PRESET;
  const normalized = value.trim();
  return normalized || DEFAULT_CONVERSATION_AVATAR_PRESET;
}

function normalizeConversationAvatarUrl(value, fallback = '') {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  if (typeof fallback === 'string') {
    const normalizedFallback = fallback.trim();
    if (normalizedFallback) return normalizedFallback;
  }
  return '';
}

function normalizeConversationMetadata(metadata, fallback = {}) {
  const next = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const fallbackLifecycle = CONVERSATION_LIFECYCLE_STATUSES.has(fallback.lifecycleStatus)
    ? fallback.lifecycleStatus
    : 'flowing';
  next.lifecycleStatus = CONVERSATION_LIFECYCLE_STATUSES.has(next.lifecycleStatus)
    ? next.lifecycleStatus
    : fallbackLifecycle;
  next.isPinned = typeof next.isPinned === 'boolean' ? next.isPinned : Boolean(fallback.isPinned);
  next.isFolded = typeof next.isFolded === 'boolean' ? next.isFolded : Boolean(fallback.isFolded);
  next.avatarPreset = normalizeConversationAvatarPreset(
    next.avatarPreset
      || next.avatar
      || fallback.avatarPreset
      || fallback.avatar,
  );
  const hasExplicitAvatarUrl = Object.prototype.hasOwnProperty.call(next, 'avatarUrl');
  next.avatarUrl = hasExplicitAvatarUrl
    ? normalizeConversationAvatarUrl(next.avatarUrl)
    : normalizeConversationAvatarUrl('', fallback.avatarUrl);
  return next;
}

function normalizeUserProfile(profile) {
  const next = profile && typeof profile === 'object' ? { ...profile } : {};
  return {
    avatarUrl: normalizeConversationAvatarUrl(next.avatarUrl, USER_AVATAR),
  };
}

function mergeConversationUiState(currentUiState, patchUiState) {
  const current = currentUiState && typeof currentUiState === 'object' ? currentUiState : {};
  const patch = patchUiState && typeof patchUiState === 'object' ? patchUiState : {};
  const currentThread = current.thread && typeof current.thread === 'object' ? current.thread : {};
  const patchThread = patch.thread && typeof patch.thread === 'object' ? patch.thread : {};

  return {
    ...current,
    ...patch,
    thread: {
      ...currentThread,
      ...patchThread,
    },
  };
}

function deriveConversationIsStalled(lastMessageAt) {
  return typeof lastMessageAt === 'number'
    && lastMessageAt > 0
    && (now() - lastMessageAt) >= CONVERSATION_STALLED_WINDOW_MS;
}

function buildConversationSummary(row, options = {}) {
  const metadata = normalizeConversationMetadata(
    safeJsonParse(row.metadataJson, null),
    { avatar: row.avatar },
  );
  const summaryFields = resolveConversationSummaryFields(row, options.latestMessage || null);
  const rankTime = typeof summaryFields.lastMessageAt === 'number'
    ? summaryFields.lastMessageAt
    : typeof row.rankTime === 'number'
      ? row.rankTime
      : null;

  return {
    id: row.id,
    title: row.title,
    avatar: metadata.avatarPreset,
    avatarPreset: metadata.avatarPreset,
    avatarUrl: metadata.avatarUrl || '',
    lastMsg: summaryFields.lastMsg,
    lastTime: summaryFields.lastTime,
    lastMessageAt: rankTime,
    messageCount: row.messageCount || 0,
    lifecycleStatus: metadata.lifecycleStatus,
    isPinned: metadata.isPinned,
    isFolded: metadata.isFolded,
    isStalled: deriveConversationIsStalled(rankTime),
    metadata,
  };
}

function toChatPayload(summary, messages) {
  return {
    chatId: summary.id,
    title: summary.title,
    avatar: summary.avatar,
    avatarPreset: summary.avatarPreset || summary.avatar,
    avatarUrl: summary.avatarUrl || '',
    lastMsg: summary.lastMsg,
    lastTime: summary.lastTime,
    lastMessageAt: summary.lastMessageAt ?? null,
    lifecycleStatus: summary.lifecycleStatus || 'flowing',
    isPinned: Boolean(summary.isPinned),
    isFolded: Boolean(summary.isFolded),
    isStalled: Boolean(summary.isStalled),
    metadata: summary.metadata || null,
    messages,
  };
}

function deriveLastMessageText(chat) {
  const last = Array.isArray(chat.messages) ? chat.messages[chat.messages.length - 1] : null;
  if (!last) {
    if (typeof chat.lastMsg === 'string' && chat.lastMsg.trim()) {
      return chat.lastMsg.trim();
    }
    return '';
  }

  return deriveMessagePreviewText(last);
}

function createBlockId(prefix = 'block') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeBubbleBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block) => block && typeof block === 'object')
    .map((block, index) => {
      const next = {
        ...block,
        id: typeof block.id === 'string' && block.id.trim() ? block.id.trim() : createBlockId(`block-${index}`),
      };
      if (block.type === 'text') {
        next.text = typeof block.text === 'string' ? block.text : '';
      }
      if (block.type === 'image' || block.type === 'video' || block.type === 'audio' || block.type === 'file' || block.type === 'link') {
        next.url = typeof block.url === 'string' ? block.url : '';
      }
      if (block.type === 'file') {
        next.fileName = typeof block.fileName === 'string' ? block.fileName : undefined;
      }
      if (block.type === 'location') {
        next.location = block.location && typeof block.location === 'object'
          ? { ...block.location }
          : undefined;
      }
      if (block.type === 'quote' && block.quote && typeof block.quote === 'object') {
        next.quote = {
          relationKind: block.quote.relationKind === 'forward' ? 'forward' : 'quote',
          targetMessageId: typeof block.quote.targetMessageId === 'string' ? block.quote.targetMessageId : '',
          targetBlockId: typeof block.quote.targetBlockId === 'string' ? block.quote.targetBlockId : undefined,
          snapshotBlocks: normalizeBubbleBlocks(block.quote.snapshotBlocks || []),
        };
      }
      next.metadata = next.metadata && typeof next.metadata === 'object' ? { ...next.metadata } : null;
      return next;
    });
}

function expandQuoteSnapshotBlocks(blocksInput, depth = 0) {
  const blocks = normalizeBubbleBlocks(blocksInput);
  if (blocks.length === 0) return [];

  return blocks.flatMap((block) => {
    if (block.type !== 'quote' || !block.quote) {
      return [block];
    }
    if (depth >= 6) {
      return [];
    }
    return expandQuoteSnapshotBlocks(block.quote.snapshotBlocks || [], depth + 1);
  });
}

function normalizeLegacyCompoundItem(item, index) {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'text') {
    return {
      id: createBlockId(`legacy-text-${index}`),
      type: 'text',
      text: typeof item.val === 'string' ? item.val : '',
    };
  }
  if (item.type === 'img' || item.type === 'video' || item.type === 'audio' || item.type === 'link') {
    return {
      id: createBlockId(`legacy-${item.type}-${index}`),
      type: item.type === 'img' ? 'image' : item.type,
      url: typeof item.val === 'string' ? item.val : '',
    };
  }
  if (item.type === 'file') {
    return {
      id: createBlockId(`legacy-file-${index}`),
      type: 'file',
      url: typeof item.val === 'string' ? item.val : '',
      fileName: typeof item.fileName === 'string' ? item.fileName : undefined,
    };
  }
  return null;
}

function getMessageBlocks(message) {
  if (!message || typeof message !== 'object') return [];
  if (Array.isArray(message.blocks) && message.blocks.length > 0) {
    return normalizeBubbleBlocks(message.blocks);
  }
  if (message.type === 'compound' && Array.isArray(message.content)) {
    return message.content
      .map((item, index) => normalizeLegacyCompoundItem(item, index))
      .filter(Boolean);
  }
  if (message.type === 'text') {
    const text = typeof message.content === 'string' ? message.content : '';
    return text ? [{ id: createBlockId('legacy-text'), type: 'text', text }] : [];
  }
  if (message.type === 'img' || message.type === 'video' || message.type === 'audio' || message.type === 'link') {
    const url = typeof message.content === 'string' ? message.content : '';
    return url ? [{ id: createBlockId(`legacy-${message.type}`), type: message.type === 'img' ? 'image' : message.type, url }] : [];
  }
  if (message.type === 'file') {
    const file = message.content && typeof message.content === 'object' ? message.content : null;
    const url = typeof file?.url === 'string' ? file.url : '';
    const fileName = typeof file?.name === 'string' ? file.name : undefined;
    if (!url && !fileName) return [];
    return [{
      id: createBlockId('legacy-file'),
      type: 'file',
      url,
      fileName,
    }];
  }
  if (message.type === 'location') {
    return [{
      id: createBlockId('legacy-location'),
      type: 'location',
      location: message.content && typeof message.content === 'object' ? { ...message.content } : undefined,
    }];
  }
  return [];
}

function deriveLegacyShapeFromBlocks(blocksInput) {
  const blocks = normalizeBubbleBlocks(blocksInput);
  const renderableBlocks = blocks.filter((block) => block.type !== 'quote');

  if (renderableBlocks.length === 0) {
    return {
      type: 'text',
      content: '',
    };
  }

  if (renderableBlocks.length === 1) {
    const [block] = renderableBlocks;
    if (block.type === 'text') {
      return { type: 'text', content: block.text || '' };
    }
    if (block.type === 'image' || block.type === 'video' || block.type === 'audio' || block.type === 'link') {
      return { type: block.type === 'image' ? 'img' : block.type, content: block.url || '' };
    }
    if (block.type === 'file') {
      return {
        type: 'file',
        content: {
          name: block.fileName || block.url || '文件',
          size: '未知',
          url: block.url || undefined,
        },
      };
    }
    if (block.type === 'location') {
      return { type: 'location', content: block.location || null };
    }
  }

  return {
    type: 'compound',
    content: renderableBlocks.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', val: block.text || '' };
      }
      if (block.type === 'file') {
        return { type: 'file', val: block.url || '', fileName: block.fileName };
      }
      return {
        type: block.type === 'image' ? 'img' : block.type,
        val: block.url || '',
      };
    }),
  };
}

function withLegacyMessageShape(message) {
  const blocks = getMessageBlocks(message);
  const legacy = deriveLegacyShapeFromBlocks(blocks);
  return {
    ...message,
    blocks,
    type: legacy.type,
    content: legacy.content,
  };
}

function buildStorageBlocks(message) {
  const blocks = getMessageBlocks(message);
  if (blocks.length === 0) {
    return [{ kind: 'text', textValue: '' }];
  }

  return blocks.map((block) => {
    if (block.type === 'text') {
      return {
        id: block.id,
        kind: 'text',
        textValue: block.text || '',
        payload: null,
      };
    }
    if (block.type === 'image' || block.type === 'video' || block.type === 'audio') {
      return {
        id: block.id,
        kind: block.type === 'image' ? 'image' : block.type,
        assetId: parseAssetUrl(block.url),
        urlValue: block.url || null,
        payload: { url: block.url || null, mimeType: block.mimeType || null },
      };
    }
    if (block.type === 'link') {
      return {
        id: block.id,
        kind: 'link',
        urlValue: block.url || null,
        payload: { url: block.url || null },
      };
    }
    if (block.type === 'file') {
      return {
        id: block.id,
        kind: 'file',
        textValue: block.fileName || '',
        urlValue: block.url || null,
        payload: { url: block.url || null, fileName: block.fileName || null, mimeType: block.mimeType || null },
      };
    }
    if (block.type === 'location') {
      return {
        id: block.id,
        kind: 'location',
        payload: block.location || null,
      };
    }
    if (block.type === 'quote') {
      return {
        id: block.id,
        kind: 'quote',
        payload: cloneJson(block.quote || null),
      };
    }
    return {
      id: block.id,
      kind: 'card',
      payload: { raw: block },
    };
  });
}

function deserializeStoredBlock(row) {
  const payload = safeJsonParse(row.payloadJson, null);
  if (row.kind === 'text') {
    return {
      id: row.id,
      type: 'text',
      text: row.textValue || '',
    };
  }
  if (row.kind === 'image' || row.kind === 'video' || row.kind === 'audio') {
    return {
      id: row.id,
      type: row.kind === 'image' ? 'image' : row.kind,
      url: row.urlValue || payload?.url || '',
      mimeType: payload?.mimeType || undefined,
    };
  }
  if (row.kind === 'link') {
    return {
      id: row.id,
      type: 'link',
      url: row.urlValue || payload?.url || '',
    };
  }
  if (row.kind === 'file') {
    return {
      id: row.id,
      type: 'file',
      url: row.urlValue || payload?.url || '',
      fileName: row.textValue || payload?.fileName || undefined,
      mimeType: payload?.mimeType || undefined,
    };
  }
  if (row.kind === 'location') {
    return {
      id: row.id,
      type: 'location',
      location: payload && typeof payload === 'object' ? payload : undefined,
    };
  }
  if (row.kind === 'quote') {
    return {
      id: row.id,
      type: 'quote',
      quote: payload && typeof payload === 'object'
        ? {
            relationKind: payload.relationKind === 'forward' ? 'forward' : 'quote',
            targetMessageId: payload.targetMessageId || '',
            targetBlockId: payload.targetBlockId || undefined,
            snapshotBlocks: normalizeBubbleBlocks(payload.snapshotBlocks || []),
          }
        : undefined,
    };
  }
  return null;
}

const USER_AVATAR = 'https://api.dicebear.com/7.x/avataaars/svg?seed=https://api.dicebear.com/7.x/avataaars/svg?seed=gggg';
const USER_PROFILE_SETTING_KEY = 'user_profile';
const SECRET_REF_PREFIX = 'secret://';
const DEFAULT_IDENTITY_AVATAR_PRESET = 'sun';
const BUILTIN_IDENTITIES = [
  {
    id: 'builtin-identity-default-self',
    name: '默认的我',
    description: '未特别指定场景时使用的默认身份。',
    avatarPreset: DEFAULT_IDENTITY_AVATAR_PRESET,
    enabled: true,
    sortOrder: 10,
  },
];
const SORTING_LUGGAGE_COLUMN_KEY = 'luggage';
const DEFAULT_SORTING_WORKSPACE_STREAM_ID = '__default__';
const DEFAULT_SORTING_WORKSPACE_TITLE = '默认工作区';
const DEFAULT_SORTING_LAYER_NAME = '默认层';
const SORTING_BOX_VIEW_MODES = new Set(['kanban', 'canvas', 'table']);
const SORTING_SOURCE_VIEW_MODES = new Set(['focused', 'all-selected']);
const DEFAULT_SORTING_SIDEBAR_SECTION_LAYOUT = Object.freeze({
  boxes: 1 / 3,
  layers: 1 / 3,
  sources: 1 / 3,
});
const SORTING_BOX_TEMPLATE_COLUMNS = ['灵感', '素材', '段落', '疑问'];
const DEFAULT_SORTING_BOXES = [
  { id: 'b_root', name: '箱体世界', tone: '#2A8A61', description: '总入口，管理全部子箱与项目脉络。' },
  { id: 'b_prog', name: '泡泡程序箱', tone: '#266D8A', description: '承接产品、开发、验证与迭代素材。' },
  { id: 'b_life', name: '生活与哲学', tone: '#A56C2E', description: '沉淀观察、观念与长期思考。' },
  { id: 'b_aicando_periodical', name: 'AICanDo半月刊', tone: '#7E6AAE', description: '承接 AICanDo 半月刊的主题、素材与写作提纲。' },
];
const DEFAULT_SORTING_BOX_ID_SET = new Set(DEFAULT_SORTING_BOXES.map((box) => box.id));
const DEFAULT_SORTING_COLUMNS = [
  { id: 'l_root_inbox', boxId: 'b_root', name: '收件箱' },
  { id: 'l_prog_inbox', boxId: 'b_prog', name: '待处理' },
  { id: 'l_prog_mat', boxId: 'b_prog', name: '相关素材' },
  { id: 'l_life_inbox', boxId: 'b_life', name: '收件箱' },
  { id: 'l_life_idea', boxId: 'b_life', name: '观念 Ideas' },
  { id: 'l_aicando_idea', boxId: 'b_aicando_periodical', name: '灵感' },
  { id: 'l_aicando_source', boxId: 'b_aicando_periodical', name: '素材' },
  { id: 'l_aicando_paragraph', boxId: 'b_aicando_periodical', name: '段落' },
  { id: 'l_aicando_question', boxId: 'b_aicando_periodical', name: '疑问' },
];
const LEGACY_SORTING_COLUMN_NAME_MIGRATIONS = Object.freeze([]);
const DEFAULT_SORTING_CARDS = [
  { id: 'i_b1', layerId: 'l_root_inbox', type: 'box', childBoxId: 'b_prog' },
  { id: 'i_b2', layerId: 'l_root_inbox', type: 'box', childBoxId: 'b_life' },
  { id: 'i_b3', layerId: 'l_root_inbox', type: 'box', childBoxId: 'b_aicando_periodical' },
];

function toSortingEntityId(workspaceId, rawId) {
  return `${workspaceId}:${rawId}`;
}

function buildProviderApiSecretId(providerId) {
  return `provider:${providerId}:api-key`;
}

function buildProviderApiSecretRef(providerId) {
  return `${SECRET_REF_PREFIX}${buildProviderApiSecretId(providerId)}`;
}

function isSecretRef(value) {
  return typeof value === 'string' && value.startsWith(SECRET_REF_PREFIX);
}

function parseSecretRef(secretRef) {
  if (!isSecretRef(secretRef)) return null;
  return secretRef.slice(SECRET_REF_PREFIX.length);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function normalizeDeletedDefaultSortingBoxIds(value) {
  return normalizeStringArray(value).filter((boxId) => DEFAULT_SORTING_BOX_ID_SET.has(boxId));
}

function normalizeSortingSourceSelection(value, fallbackSourceIds = []) {
  const next = value && typeof value === 'object' ? value : {};
  const selectedSourceIds = normalizeStringArray(
    Array.isArray(next.selectedSourceIds)
      ? next.selectedSourceIds
      : fallbackSourceIds,
  );
  const requestedFocusedSourceId = typeof next.focusedSourceId === 'string'
    ? next.focusedSourceId.trim()
    : '';
  return {
    selectedSourceIds,
    focusedSourceId: selectedSourceIds.includes(requestedFocusedSourceId)
      ? requestedFocusedSourceId
      : (selectedSourceIds[0] || null),
    sourceViewMode: SORTING_SOURCE_VIEW_MODES.has(next.sourceViewMode)
      ? next.sourceViewMode
      : 'focused',
  };
}

function normalizeSortingBoxSourceSelectionsMap(value) {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value)
    .map(([boxId, selection]) => {
      if (typeof boxId !== 'string' || !boxId.trim()) return null;
      const normalizedSelection = normalizeSortingSourceSelection(selection);
      if (normalizedSelection.selectedSourceIds.length === 0 && !normalizedSelection.focusedSourceId) {
        return null;
      }
      return [boxId.trim(), normalizedSelection];
    })
    .filter(Boolean);
  return Object.fromEntries(entries);
}

function resolveSortingBoxSourceSelection(selectionMap, boxId, fallbackSelection) {
  const normalizedFallbackSelection = normalizeSortingSourceSelection(fallbackSelection);
  if (!boxId) return normalizedFallbackSelection;
  const normalizedSelections = normalizeSortingBoxSourceSelectionsMap(selectionMap);
  const candidateSelection = normalizedSelections[boxId];
  if (!candidateSelection) return normalizedFallbackSelection;
  return normalizeSortingSourceSelection(
    candidateSelection,
    normalizedFallbackSelection.selectedSourceIds,
  );
}

function normalizeSortingCanvasEdge(edge) {
  if (!edge || typeof edge !== 'object') return null;
  const fromCardId = typeof edge.fromCardId === 'string' ? edge.fromCardId.trim() : '';
  const toCardId = typeof edge.toCardId === 'string' ? edge.toCardId.trim() : '';
  if (!fromCardId || !toCardId || fromCardId === toCardId) return null;
  const id = typeof edge.id === 'string' && edge.id.trim()
    ? edge.id.trim()
    : `edge_${fromCardId}_${toCardId}`;
  const label = typeof edge.label === 'string' ? edge.label.trim() : '';
  return {
    id,
    fromCardId,
    toCardId,
    label: label || undefined,
  };
}

function normalizeSortingCanvasEdgeList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  value.forEach((edge) => {
    const nextEdge = normalizeSortingCanvasEdge(edge);
    if (!nextEdge || seen.has(nextEdge.id)) return;
    seen.add(nextEdge.id);
    normalized.push(nextEdge);
  });
  return normalized;
}

function normalizeSortingCanvasEdgeMap(value) {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value)
    .map(([boxId, edges]) => {
      if (typeof boxId !== 'string' || !boxId.trim()) return null;
      const normalized = normalizeSortingCanvasEdgeList(edges);
      if (normalized.length === 0) return null;
      return [boxId.trim(), normalized];
    })
    .filter(Boolean);
  return Object.fromEntries(entries);
}

function removeSortingCanvasEdgesByCardIds(edgeMap, cardIds) {
  const nextMap = {};
  let changed = false;
  Object.entries(normalizeSortingCanvasEdgeMap(edgeMap)).forEach(([boxId, edges]) => {
    const filtered = edges.filter((edge) => (
      !cardIds.has(edge.fromCardId) && !cardIds.has(edge.toCardId)
    ));
    if (filtered.length > 0) nextMap[boxId] = filtered;
    if (filtered.length !== edges.length) changed = true;
  });
  return {
    nextMap,
    changed,
  };
}

function normalizeSortingBoxLayerSelection(value) {
  const next = value && typeof value === 'object' ? value : {};
  const selectedLayerIds = normalizeStringArray(next.selectedLayerIds);
  const requestedCurrentLayerId = typeof next.currentLayerId === 'string'
    ? next.currentLayerId.trim()
    : (
      typeof next.focusedLayerId === 'string'
        ? next.focusedLayerId.trim()
        : ''
    );
  const currentLayerId = selectedLayerIds.includes(requestedCurrentLayerId)
    ? requestedCurrentLayerId
    : (selectedLayerIds[0] || null);
  return {
    selectedLayerIds,
    currentLayerId,
  };
}

function normalizeSortingBoxLayerSelectionsMap(value) {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value)
    .map(([boxId, selection]) => {
      if (typeof boxId !== 'string' || !boxId.trim()) return null;
      const normalizedSelection = normalizeSortingBoxLayerSelection(selection);
      if (normalizedSelection.selectedLayerIds.length === 0 && !normalizedSelection.currentLayerId) {
        return null;
      }
      return [boxId.trim(), normalizedSelection];
    })
    .filter(Boolean);
  return Object.fromEntries(entries);
}

function normalizeScopedBotConfig(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const systemPrompt = typeof raw.systemPrompt === 'string' ? raw.systemPrompt.trim() : '';
  const workspacePath = typeof raw.workspacePath === 'string' ? raw.workspacePath.trim() : '';
  const next = {};
  if (systemPrompt) next.systemPrompt = systemPrompt;
  if (workspacePath) next.workspacePath = workspacePath;
  return next;
}

function normalizeScopedBotBindingMetadata(value) {
  const raw = value && typeof value === 'object' ? { ...value } : {};
  const scopedConfig = normalizeScopedBotConfig(raw.scopedConfig);
  if (Object.keys(scopedConfig).length > 0) {
    raw.scopedConfig = scopedConfig;
  } else {
    delete raw.scopedConfig;
  }
  return Object.keys(raw).length > 0 ? raw : null;
}

function normalizeSortingScopedBotBinding(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    enabled: raw.enabled !== false,
    triggerMode: normalizeBotTriggerMode(raw.triggerMode || raw.replyMode || 'auto'),
    outputMode: normalizeBotOutputMode(raw.outputMode || 'stream-reply'),
    alias: typeof raw.alias === 'string' ? raw.alias.trim() : '',
    metadata: normalizeScopedBotBindingMetadata(raw.metadata),
  };
}

function normalizeSortingBoxBotBindingsMap(value) {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value)
    .map(([boxId, bindings]) => {
      if (typeof boxId !== 'string' || !boxId.trim() || !bindings || typeof bindings !== 'object') return null;
      const normalizedBindings = Object.fromEntries(
        Object.entries(bindings)
          .map(([botId, binding]) => {
            if (typeof botId !== 'string' || !botId.trim()) return null;
            return [botId.trim(), normalizeSortingScopedBotBinding(binding)];
          })
          .filter(Boolean),
      );
      if (Object.keys(normalizedBindings).length === 0) return null;
      return [boxId.trim(), normalizedBindings];
    })
    .filter(Boolean);
  return Object.fromEntries(entries);
}

function resolveSortingBoxLayerSelection(selectionMap, boxId, layerIds) {
  const availableLayerIds = normalizeStringArray(layerIds);
  if (!boxId || availableLayerIds.length === 0) {
    return {
      selectedLayerIds: [],
      currentLayerId: null,
    };
  }

  const normalizedSelections = normalizeSortingBoxLayerSelectionsMap(selectionMap);
  const candidateSelection = normalizedSelections[boxId];
  const selectedLayerIds = normalizeStringArray(candidateSelection?.selectedLayerIds)
    .filter((layerId) => availableLayerIds.includes(layerId));
  const resolvedSelectedLayerIds = selectedLayerIds.length > 0 ? selectedLayerIds : availableLayerIds;
  const currentLayerId = (
    typeof candidateSelection?.currentLayerId === 'string'
    && resolvedSelectedLayerIds.includes(candidateSelection.currentLayerId)
  )
    ? candidateSelection.currentLayerId
    : (resolvedSelectedLayerIds[0] || null);

  return {
    selectedLayerIds: resolvedSelectedLayerIds,
    currentLayerId,
  };
}

function isDefaultSortingBoxLayerSelection(selection, layerIds) {
  const availableLayerIds = normalizeStringArray(layerIds);
  const normalizedSelection = resolveSortingBoxLayerSelection({ current: selection }, 'current', availableLayerIds);
  const sameLayerSet = normalizedSelection.selectedLayerIds.length === availableLayerIds.length
    && normalizedSelection.selectedLayerIds.every((layerId, index) => layerId === availableLayerIds[index]);
  return sameLayerSet
    && normalizedSelection.currentLayerId === (availableLayerIds[0] || null);
}

function buildSortingLayerId(boxId, rawId = 'default') {
  return `${boxId}:layer:${rawId}`;
}

function buildDefaultSortingLayer(boxId) {
  return {
    id: buildSortingLayerId(boxId, 'default'),
    boxId,
    name: DEFAULT_SORTING_LAYER_NAME,
    sortOrder: 0,
  };
}

function buildInitialSortingBoxLayers(boxIds) {
  return Object.fromEntries(
    normalizeStringArray(boxIds).map((boxId) => [boxId, [buildDefaultSortingLayer(boxId)]]),
  );
}

function normalizeSortingLayerDefinition(value, boxId, fallbackSortOrder = 0) {
  if (!value || typeof value !== 'object') return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const nextBoxId = typeof value.boxId === 'string' && value.boxId.trim() ? value.boxId.trim() : boxId;
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '';
  if (!id || !nextBoxId || !name) return null;
  const numericSortOrder = Number.isFinite(Number(value.sortOrder))
    ? Number(value.sortOrder)
    : fallbackSortOrder;
  return {
    id,
    boxId: nextBoxId,
    name,
    sortOrder: numericSortOrder,
  };
}

function normalizeSortingLayerDefinitionList(value, boxId) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  value.forEach((item, index) => {
    const nextLayer = normalizeSortingLayerDefinition(item, boxId, index);
    if (!nextLayer || seen.has(nextLayer.id)) return;
    seen.add(nextLayer.id);
    normalized.push(nextLayer);
  });
  normalized.sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.name.localeCompare(right.name, 'zh-CN');
  });
  return normalized.map((layer, index) => ({
    ...layer,
    boxId,
    sortOrder: index,
  }));
}

function normalizeSortingBoxLayersMap(value) {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value)
    .map(([boxId, layers]) => {
      if (typeof boxId !== 'string' || !boxId.trim()) return null;
      const normalizedLayers = normalizeSortingLayerDefinitionList(layers, boxId.trim());
      if (normalizedLayers.length === 0) return null;
      return [boxId.trim(), normalizedLayers];
    })
    .filter(Boolean);
  return Object.fromEntries(entries);
}

function normalizeSortingColumnLayerBindings(value) {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value)
    .map(([columnId, layerValue]) => {
      if (typeof columnId !== 'string' || !columnId.trim()) return null;
      const normalizedLayerIds = normalizeStringArray(
        Array.isArray(layerValue)
          ? layerValue
          : (typeof layerValue === 'string' ? [layerValue] : []),
      );
      if (normalizedLayerIds.length === 0) return null;
      return [columnId.trim(), normalizedLayerIds];
    })
    .filter(Boolean);
  return Object.fromEntries(entries);
}

function normalizeSortingColumnDropCardKinds(value) {
  return {};
}

function resolveSortingColumnDropCardKind(value, columnId) {
  return null;
}

function resolveSortingBoxLayers(layerMap, boxId) {
  if (!boxId) return [];
  const normalizedMap = normalizeSortingBoxLayersMap(layerMap);
  const layers = normalizedMap[boxId];
  if (layers && layers.length > 0) return layers;
  return [buildDefaultSortingLayer(boxId)];
}

function resolveSortingColumnLayerBindings(bindingMap, columns, layers) {
  const normalizedBindings = normalizeSortingColumnLayerBindings(bindingMap);
  const layerOrder = layers.map((layer) => layer.id);
  const validLayerIds = new Set(layerOrder);
  const fallbackLayerId = layerOrder[0] || null;
  return Object.fromEntries(columns.map((column) => {
    const boundLayerIds = Array.isArray(normalizedBindings[column.id])
      ? normalizedBindings[column.id]
      : [];
    const boundLayerIdSet = new Set(boundLayerIds.filter((layerId) => validLayerIds.has(layerId)));
    const nextLayerIds = layerOrder.filter((layerId) => boundLayerIdSet.has(layerId));
    if (nextLayerIds.length === 0 && fallbackLayerId) {
      nextLayerIds.push(fallbackLayerId);
    }
    return [column.id, nextLayerIds];
  }));
}

function ensureSortingColumnBoundToLayer(metadata, column, layerId) {
  if (!column?.boxId || typeof layerId !== 'string' || !layerId.trim()) {
    return {
      metadata,
      changed: false,
      layerIds: [],
    };
  }

  const requestedLayerId = layerId.trim();
  const boxLayers = resolveSortingBoxLayers(metadata.boxLayers, column.boxId);
  if (!boxLayers.some((layer) => layer.id === requestedLayerId)) {
    return {
      metadata,
      changed: false,
      layerIds: resolveSortingColumnLayerBindings(
        metadata.columnLayerBindings,
        [column],
        boxLayers,
      )[column.id] || [],
    };
  }

  const nextBindings = normalizeSortingColumnLayerBindings(metadata.columnLayerBindings);
  const resolvedBindings = resolveSortingColumnLayerBindings(nextBindings, [column], boxLayers);
  const currentLayerIds = resolvedBindings[column.id] || [];
  if (currentLayerIds.includes(requestedLayerId)) {
    return {
      metadata,
      changed: false,
      layerIds: currentLayerIds,
    };
  }

  nextBindings[column.id] = normalizeStringArray([...currentLayerIds, requestedLayerId]);
  const nextMetadata = {
    ...metadata,
    columnLayerBindings: nextBindings,
  };

  return {
    metadata: nextMetadata,
    changed: true,
    layerIds: resolveSortingColumnLayerBindings(nextMetadata.columnLayerBindings, [column], boxLayers)[column.id] || [],
  };
}

function normalizeSortingCardMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = { ...value };
  delete normalized.cardKind;
  delete normalized.todoStatus;
  delete normalized.todoPriority;
  delete normalized.todoDueAt;
  return normalized;
}

function extractSortingCardKind(metadata) {
  return null;
}

function extractSortingTodoStatus(metadata) {
  return null;
}

function extractSortingTodoPriority(metadata) {
  return null;
}

function extractSortingTodoDueAt(metadata) {
  return null;
}

function resolveSortingTodoStatus(metadata, cardKind, preferredStatus) {
  return null;
}

function extractSortingCardLayerId(metadata) {
  const normalizedMetadata = normalizeSortingCardMetadata(metadata);
  const rawLayerId = typeof normalizedMetadata.layerId === 'string'
    ? normalizedMetadata.layerId.trim()
    : '';
  return rawLayerId || null;
}

function resolveSortingCardLayerId(metadata, availableLayerIds = [], options = {}) {
  const { allowSingleLayerFallback = true } = options || {};
  const rawLayerId = extractSortingCardLayerId(metadata);
  if (availableLayerIds.length === 0) {
    return rawLayerId;
  }
  if (rawLayerId && availableLayerIds.includes(rawLayerId)) {
    return rawLayerId;
  }
  if (allowSingleLayerFallback && availableLayerIds.length === 1) {
    return availableLayerIds[0] || null;
  }
  return null;
}

function withSortingCardLayerId(metadata, layerId) {
  const normalizedMetadata = normalizeSortingCardMetadata(metadata);
  if (typeof layerId === 'string' && layerId.trim()) {
    normalizedMetadata.layerId = layerId.trim();
  } else {
    delete normalizedMetadata.layerId;
  }
  return Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : null;
}

function withSortingCardKind(metadata, cardKind) {
  const normalizedMetadata = normalizeSortingCardMetadata(metadata);
  delete normalizedMetadata.cardKind;
  return Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : null;
}

function withSortingTodoStatus(metadata, todoStatus, cardKind) {
  const normalizedMetadata = normalizeSortingCardMetadata(metadata);
  delete normalizedMetadata.todoStatus;
  return Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : null;
}

function withSortingTodoPriority(metadata, todoPriority, cardKind) {
  const normalizedMetadata = normalizeSortingCardMetadata(metadata);
  delete normalizedMetadata.todoPriority;
  return Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : null;
}

function withSortingTodoDueAt(metadata, todoDueAt, cardKind) {
  const normalizedMetadata = normalizeSortingCardMetadata(metadata);
  delete normalizedMetadata.todoDueAt;
  return Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : null;
}

function normalizeSortingSidebarSectionLayout(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const next = {
    boxes: typeof candidate.boxes === 'number' && Number.isFinite(candidate.boxes) && candidate.boxes > 0
      ? candidate.boxes
      : DEFAULT_SORTING_SIDEBAR_SECTION_LAYOUT.boxes,
    layers: typeof candidate.layers === 'number' && Number.isFinite(candidate.layers) && candidate.layers > 0
      ? candidate.layers
      : DEFAULT_SORTING_SIDEBAR_SECTION_LAYOUT.layers,
    sources: typeof candidate.sources === 'number' && Number.isFinite(candidate.sources) && candidate.sources > 0
      ? candidate.sources
      : DEFAULT_SORTING_SIDEBAR_SECTION_LAYOUT.sources,
  };
  const total = next.boxes + next.layers + next.sources;
  if (!(total > 0)) {
    return { ...DEFAULT_SORTING_SIDEBAR_SECTION_LAYOUT };
  }
  return {
    boxes: next.boxes / total,
    layers: next.layers / total,
    sources: next.sources / total,
  };
}

function normalizeSortingWorkspaceMetadata(metadata, fallbackSourceIds = []) {
  const next = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const sourceSelection = normalizeSortingSourceSelection(next, fallbackSourceIds);
  next.selectedSourceIds = sourceSelection.selectedSourceIds;
  next.focusedSourceId = sourceSelection.focusedSourceId;
  next.sourceViewMode = sourceSelection.sourceViewMode;
  next.deletedDefaultBoxIds = normalizeDeletedDefaultSortingBoxIds(next.deletedDefaultBoxIds);
  next.sidebarSectionLayout = normalizeSortingSidebarSectionLayout(next.sidebarSectionLayout);
  const rawBoxViewModes = next.boxViewModes && typeof next.boxViewModes === 'object'
    ? next.boxViewModes
    : {};
  next.boxViewModes = Object.fromEntries(
    Object.entries(rawBoxViewModes).filter(([, value]) => SORTING_BOX_VIEW_MODES.has(value)),
  );
  next.boxSourceSelections = normalizeSortingBoxSourceSelectionsMap(next.boxSourceSelections);
  next.boxCanvasEdges = normalizeSortingCanvasEdgeMap(next.boxCanvasEdges);
  next.boxLayers = normalizeSortingBoxLayersMap(next.boxLayers);
  next.columnLayerBindings = normalizeSortingColumnLayerBindings(next.columnLayerBindings);
  next.columnDropCardKinds = normalizeSortingColumnDropCardKinds(next.columnDropCardKinds);
  next.boxLayerSelections = normalizeSortingBoxLayerSelectionsMap(next.boxLayerSelections);
  next.boxBotBindings = normalizeSortingBoxBotBindingsMap(next.boxBotBindings);
  return next;
}

function normalizeSortingBoxViewMode(value) {
  return SORTING_BOX_VIEW_MODES.has(value) ? value : 'kanban';
}

function extractText(content) {
  if (content && typeof content === 'object' && Array.isArray(content.blocks)) {
    return normalizeBubbleBlocks(content.blocks).map((block) => {
      if (block.type === 'text') return block.text || '';
      if (block.type === 'file') return block.fileName || block.url || '';
      if (block.type === 'link') return block.url || '';
      if (block.type === 'quote' && block.quote) {
        return expandQuoteSnapshotBlocks(block.quote.snapshotBlocks || []).map((item) => {
          if (item.type === 'text') return item.text || '';
          if (item.type === 'file') return item.fileName || item.url || '';
          return item.url || '';
        }).join(' ');
      }
      return block.url || '';
    }).join(' ').trim();
  }
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (item.type === 'file') {
        return item.fileName || item.val || '';
      }
      return item.val || '';
    }).join(' ');
  }
  if (content && typeof content === 'object' && typeof content.name === 'string') return content.name;
  return '';
}

function normalizePreviewText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function slicePreviewText(text, maxLength = 36) {
  const normalized = normalizePreviewText(text);
  if (!normalized) return '';
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) return normalized;
  return `${chars.slice(0, maxLength).join('')}…`;
}

function getLinkPreviewLabel(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return getLinkHostname(normalized);
}

function deriveMessagePreviewText(message) {
  if (!message || typeof message !== 'object') return '';

  const blocks = getMessageBlocks(message);
  if (blocks.length > 0) {
    const parts = blocks.map((block) => {
      if (block.type === 'text') return normalizePreviewText(block.text || '');
      if (block.type === 'image') return '[图片]';
      if (block.type === 'video') return '[视频]';
      if (block.type === 'audio') return '[音频]';
      if (block.type === 'location') return '[位置]';
      if (block.type === 'link') {
        const label = getLinkPreviewLabel(block.url);
        return label ? `[链接] ${label}` : '[链接]';
      }
      if (block.type === 'file') {
        const fileName = normalizePreviewText(block.fileName || block.url || '');
        return fileName ? `[文件] ${fileName}` : '[文件]';
      }
      if (block.type === 'quote' && block.quote) {
        const preview = expandQuoteSnapshotBlocks(block.quote.snapshotBlocks || []).map((item) => {
          if (item.type === 'text') return normalizePreviewText(item.text || '');
          if (item.type === 'image') return '[图片]';
          if (item.type === 'video') return '[视频]';
          if (item.type === 'audio') return '[音频]';
          if (item.type === 'file') return `[文件] ${normalizePreviewText(item.fileName || item.url || '')}`;
          if (item.type === 'link') return item.url ? `[链接] ${getLinkPreviewLabel(item.url)}` : '[链接]';
          return '';
        }).filter(Boolean).join(' · ');
        const label = block.quote.relationKind === 'forward' ? '转发' : '引用';
        return preview ? `[${label}] ${preview}` : `[${label}]`;
      }
      return normalizePreviewText(block.url || '');
    }).filter(Boolean);

    if (parts.length > 0) {
      return slicePreviewText(parts.join(' · '), 42) || '[泡泡]';
    }
  }

  if (message.type === 'text') {
    return slicePreviewText(typeof message.content === 'string' ? message.content : '');
  }
  if (message.type === 'img') return '[图片]';
  if (message.type === 'video') return '[视频]';
  if (message.type === 'audio') return '[音频]';
  if (message.type === 'location') return '[位置]';
  if (message.type === 'file') {
    const fileName = message.content && typeof message.content === 'object' ? message.content.name || '' : '';
    return fileName ? `[文件] ${slicePreviewText(fileName, 24)}` : '[文件]';
  }
  if (message.type === 'link') {
    const label = getLinkPreviewLabel(message.content);
    return label ? `[链接] ${slicePreviewText(label, 24)}` : '[链接]';
  }
  if (message.type === 'compound' && Array.isArray(message.content)) {
    const parts = message.content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        if (item.type === 'text') return normalizePreviewText(item.val || '');
        if (item.type === 'img') return '[图片]';
        if (item.type === 'video') return '[视频]';
        if (item.type === 'audio') return '[音频]';
        if (item.type === 'link') {
          const label = getLinkPreviewLabel(item.val);
          return label ? `[链接] ${label}` : '[链接]';
        }
        if (item.type === 'file') {
          const fileName = normalizePreviewText(item.fileName || item.val || '');
          return fileName ? `[文件] ${fileName}` : '[文件]';
        }
        return normalizePreviewText(item.val || '');
      })
      .filter(Boolean);
    return slicePreviewText(parts.join(' · '), 42) || '[复合消息]';
  }

  return slicePreviewText(extractText(message.content)) || '[消息]';
}

function resolveConversationSummaryFields(row, latestMessage = null) {
  const normalizedLatestMessage = latestMessage && typeof latestMessage === 'object'
    ? latestMessage
    : (typeof row?.lastMessageJson === 'string' ? safeJsonParse(row.lastMessageJson, null) : null);
  const lastMessageAt = typeof normalizedLatestMessage?.time === 'number'
    ? normalizedLatestMessage.time
    : typeof row?.lastMessageAt === 'number'
      ? row.lastMessageAt
      : typeof row?.rankTime === 'number'
        ? row.rankTime
        : null;
  const lastMsg = normalizedLatestMessage
    ? deriveMessagePreviewText(normalizedLatestMessage)
    : normalizePreviewText(row?.lastMsg || '');
  const lastTime = lastMessageAt
    ? new Date(lastMessageAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : (row?.lastTime || '');

  return {
    lastMsg,
    lastTime,
    lastMessageAt,
  };
}

function findTargetBlock(message, payload = {}) {
  const blocks = getMessageBlocks(message);
  if (typeof payload.blockId === 'string' && payload.blockId.trim()) {
    return blocks.find((block) => block.id === payload.blockId.trim()) || null;
  }
  if (typeof payload.subItemIndex === 'number' && payload.subItemIndex >= 0) {
    return blocks[payload.subItemIndex] || null;
  }
  return null;
}

function buildQuoteSnapshot(message, payload = {}) {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const targetBlock = findTargetBlock(message, payload);
  const rawSnapshotBlocks = targetBlock ? [targetBlock] : getMessageBlocks(message);
  const snapshotBlocks = cloneJson(expandQuoteSnapshotBlocks(rawSnapshotBlocks));
  const textBlock = (targetBlock && targetBlock.type === 'text')
    ? targetBlock
    : snapshotBlocks.find((block) => block.type === 'text');
  const mediaBlock = targetBlock && targetBlock.type !== 'text' && targetBlock.type !== 'quote'
    ? targetBlock
    : snapshotBlocks.find((block) => block.type !== 'text' && block.type !== 'quote');
  const mediaType = mediaBlock?.type === 'image'
    ? 'img'
    : (mediaBlock?.type === 'video' || mediaBlock?.type === 'audio' || mediaBlock?.type === 'link' || mediaBlock?.type === 'file'
      ? mediaBlock.type
      : null);
  return {
    msgId: message.id,
    targetMessageId: message.id,
    targetBlockId: targetBlock?.id,
    subItemIndex: typeof payload.subItemIndex === 'number' ? payload.subItemIndex : undefined,
    media: mediaBlock?.type === 'file' ? (mediaBlock.fileName || mediaBlock.url || null) : (mediaBlock?.url || null),
    mediaType,
    text: textBlock?.text || null,
    snapshotBlocks,
  };
}

function prependSourceBlock(message, source, relationKind) {
  if (!source?.targetMessageId) return withLegacyMessageShape(message);
  const currentBlocks = getMessageBlocks(message);
  const nextBlocks = [{
    id: createBlockId(relationKind),
    type: 'quote',
    quote: {
      relationKind,
      targetMessageId: source.targetMessageId,
      targetBlockId: source.targetBlockId,
      snapshotBlocks: normalizeBubbleBlocks(source.snapshotBlocks || []),
    },
  }, ...currentBlocks];
  return withLegacyMessageShape({
    ...message,
    blocks: nextBlocks,
  });
}

function extractEmbeddedSource(message, relationKind) {
  const sourceBlock = getMessageBlocks(message).find((block) => (
    block.type === 'quote'
    && block.quote?.relationKind === relationKind
    && block.quote?.targetMessageId
  ));
  if (!sourceBlock?.quote?.targetMessageId) return null;
  return {
    relationKind,
    targetMessageId: sourceBlock.quote.targetMessageId,
    targetBlockId: sourceBlock.quote.targetBlockId,
    snapshotBlocks: normalizeBubbleBlocks(sourceBlock.quote.snapshotBlocks || []),
  };
}

function createMessageFromDraft(draft) {
  const text = typeof draft?.text === 'string' ? draft.text.trim() : '';
  const inputBlocks = Array.isArray(draft?.blocks)
    ? draft.blocks
    : Array.isArray(draft?.items)
      ? draft.items
      : [];
  const blocks = inputBlocks
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      if (item.type === 'text') {
        return {
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createBlockId('draft-text'),
          type: 'text',
          text: typeof item.text === 'string'
            ? item.text
            : (typeof item.val === 'string' ? item.val.trim() : ''),
        };
      }
      if (item.type === 'image' || item.type === 'video' || item.type === 'audio' || item.type === 'file' || item.type === 'link') {
        return {
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createBlockId(`draft-${item.type}`),
          type: item.type,
          url: typeof item.url === 'string'
            ? item.url
            : (typeof item.val === 'string'
              ? (item.type === 'link' ? (extractFirstHttpUrl(item.val) || item.val.trim()) : item.val)
              : ''),
          fileName: typeof item.fileName === 'string' ? item.fileName : undefined,
          mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
        };
      }
      if (item.type === 'quote' && item.quote) {
        return {
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createBlockId('draft-quote'),
          type: 'quote',
          quote: {
            relationKind: item.quote.relationKind === 'forward' ? 'forward' : 'quote',
            targetMessageId: item.quote.targetMessageId,
            targetBlockId: item.quote.targetBlockId,
            snapshotBlocks: normalizeBubbleBlocks(item.quote.snapshotBlocks || []),
          },
        };
      }
      return null;
    })
    .filter((item) => item && (item.type === 'quote' || item.text || item.url || item.fileName));

  if (text) {
    blocks.push({
      id: createBlockId('draft-text-tail'),
      type: 'text',
      text,
    });
  }

  if (draft?.quoteSource && typeof draft.quoteSource === 'object') {
    blocks.unshift({
      id: createBlockId('draft-quote'),
      type: 'quote',
      quote: {
        relationKind: 'quote',
        targetMessageId: draft.quoteSource.targetMessageId,
        targetBlockId: draft.quoteSource.targetBlockId,
        snapshotBlocks: normalizeBubbleBlocks(draft.quoteSource.snapshotBlocks || []),
      },
    });
  }

  if (draft?.forwardSource && typeof draft.forwardSource === 'object') {
    blocks.unshift({
      id: createBlockId('draft-forward'),
      type: 'quote',
      quote: {
        relationKind: 'forward',
        targetMessageId: draft.forwardSource.targetMessageId,
        targetBlockId: draft.forwardSource.targetBlockId,
        snapshotBlocks: normalizeBubbleBlocks(draft.forwardSource.snapshotBlocks || []),
      },
    });
  }

  const base = {
    id: crypto.randomUUID(),
    role: 'me',
    blocks: normalizeBubbleBlocks(blocks),
    time: now(),
  };
  return withLegacyMessageShape(base);
}

function normalizeOutgoingMessage(message) {
  const base = {
    id: typeof message?.id === 'string' && message.id.trim() ? message.id.trim() : crypto.randomUUID(),
    role: message?.role || 'me',
    type: message?.type || 'text',
    content: message?.content ?? '',
    time: typeof message?.time === 'number' ? message.time : now(),
    status: message?.status || 'success',
    tips: message?.tips,
    senderId: typeof message?.senderId === 'string' ? message.senderId : undefined,
    senderName: typeof message?.senderName === 'string' ? message.senderName : undefined,
    senderAvatarUrl: typeof message?.senderAvatarUrl === 'string' ? message.senderAvatarUrl : undefined,
    senderAvatarPreset: typeof message?.senderAvatarPreset === 'string' ? message.senderAvatarPreset : undefined,
    replyToMessageId: typeof message?.replyToMessageId === 'string' ? message.replyToMessageId : undefined,
    commentTarget: message?.commentTarget && typeof message.commentTarget === 'object'
      ? cloneJson(message.commentTarget)
      : null,
    engagement: message?.engagement && typeof message.engagement === 'object'
      ? cloneJson(message.engagement)
      : null,
    metadata: message?.metadata && typeof message.metadata === 'object'
      ? JSON.parse(JSON.stringify(message.metadata))
      : undefined,
  };
  if (Array.isArray(message?.blocks)) {
    base.blocks = normalizeBubbleBlocks(message.blocks);
  }
  return withLegacyMessageShape(base);
}

class LocalDataStore {
  constructor({ dataRoot, legacyDataDir, secretStore = null }) {
    this.dataRoot = dataRoot;
    this.legacyDataDir = legacyDataDir;
    this.dbDir = path.join(dataRoot, 'db');
    this.dbPath = path.join(this.dbDir, 'paopao.sqlite');
    this.blobStore = new BlobStore(dataRoot);
    this.secretStore = secretStore;
    this.legacyUploadCache = new Map();
    this.db = null;
  }

  initialize() {
    ensureDir(this.dataRoot);
    ensureDir(this.dbDir);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        avatar TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'chat',
        last_msg TEXT NOT NULL DEFAULT '',
        last_time TEXT NOT NULL DEFAULT '',
        last_message_at INTEGER,
        summary TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT,
        message_type TEXT NOT NULL,
        time_ms INTEGER,
        sort_order INTEGER NOT NULL,
        reply_to_message_id TEXT,
        quote_message_id TEXT,
        raw_json TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS message_blocks (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        text_value TEXT,
        asset_id TEXT,
        url_value TEXT,
        payload_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS message_relations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        target_message_id TEXT NOT NULL,
        body TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_reactions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        block_id TEXT,
        reaction_kind TEXT NOT NULL,
        actor_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        extension TEXT,
        original_name TEXT NOT NULL,
        sha256 TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL,
        relative_path TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS derived_artifacts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        asset_id TEXT,
        text_content TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        parent_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collection_items (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        item_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        note TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_url TEXT,
        default_model TEXT NOT NULL,
        api_key_ref TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT,
        introduction TEXT,
        avatar_url TEXT,
        avatar_preset TEXT,
        provider_id TEXT,
        model TEXT,
        system_prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_bots (
        conversation_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        reply_mode TEXT NOT NULL DEFAULT 'auto',
        alias TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, bot_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        avatar_url TEXT,
        avatar_preset TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bot_identities (
        bot_id TEXT NOT NULL,
        identity_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        relation_prompt TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (bot_id, identity_id),
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
        FOREIGN KEY (identity_id) REFERENCES identities(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversation_topics (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        start_after_message_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        bot_id TEXT,
        identity_id TEXT,
        topic_id TEXT,
        kind TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
        FOREIGN KEY (identity_id) REFERENCES identities(id) ON DELETE CASCADE,
        FOREIGN KEY (topic_id) REFERENCES conversation_topics(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_runs (
        id TEXT PRIMARY KEY,
        provider_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT NOT NULL,
        conversation_id TEXT,
        trigger_message_id TEXT,
        input_ref_ids_json TEXT NOT NULL,
        output_message_id TEXT,
        output_artifact_id TEXT,
        prompt_text TEXT,
        response_text TEXT,
        error_message TEXT,
        usage_json TEXT,
        metadata_json TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sorting_workspaces (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        active_box_id TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sorting_boxes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        tone TEXT NOT NULL,
        description TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sorting_layers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        box_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'user',
        system_key TEXT,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sorting_cards (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        layer_id TEXT NOT NULL,
        type TEXT NOT NULL,
        box_ref_id TEXT,
        source_bubble_id TEXT,
        title TEXT,
        content TEXT,
        raw_message_json TEXT,
        source_ids_json TEXT NOT NULL,
        metadata_json TEXT,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sorting_canvas_nodes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        box_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        z_index INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(workspace_id, box_id, card_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_sort
      ON messages (conversation_id, sort_order);

      CREATE INDEX IF NOT EXISTS idx_message_blocks_message_sort
      ON message_blocks (message_id, sort_order, created_at);

      CREATE INDEX IF NOT EXISTS idx_message_relations_source
      ON message_relations (source_message_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_message_relations_target
      ON message_relations (target_message_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_message_reactions_message
      ON message_reactions (message_id, block_id);

      CREATE INDEX IF NOT EXISTS idx_sorting_boxes_workspace_sort
      ON sorting_boxes (workspace_id, sort_order);

      CREATE INDEX IF NOT EXISTS idx_sorting_layers_workspace_box_sort
      ON sorting_layers (workspace_id, box_id, sort_order);

      CREATE INDEX IF NOT EXISTS idx_sorting_cards_workspace_layer_sort
      ON sorting_cards (workspace_id, layer_id, sort_order, created_at);

      CREATE INDEX IF NOT EXISTS idx_sorting_canvas_nodes_workspace_box_z
      ON sorting_canvas_nodes (workspace_id, box_id, z_index, updated_at);
    `);

    ensureTableColumn(this.db, 'bots', 'runtime_type', `TEXT NOT NULL DEFAULT 'llm'`);
    ensureTableColumn(this.db, 'bots', 'runtime_config_json', 'TEXT');
    ensureTableColumn(this.db, 'conversation_bots', 'trigger_mode', `TEXT NOT NULL DEFAULT 'auto'`);
    ensureTableColumn(this.db, 'conversation_bots', 'output_mode', `TEXT NOT NULL DEFAULT 'stream-reply'`);

    this.db.prepare(`
      UPDATE bots
      SET runtime_type = 'llm'
      WHERE runtime_type IS NULL OR TRIM(runtime_type) = ''
    `).run();
    this.db.prepare(`
      UPDATE conversation_bots
      SET trigger_mode = CASE
        WHEN reply_mode = 'mention' THEN 'mention'
        WHEN reply_mode = 'manual' THEN 'manual'
        ELSE 'auto'
      END
      WHERE trigger_mode IS NULL OR TRIM(trigger_mode) = ''
    `).run();
    this.db.prepare(`
      UPDATE conversation_bots
      SET output_mode = 'stream-reply'
      WHERE output_mode IS NULL OR TRIM(output_mode) = ''
    `).run();

    this.importLegacyDataIfNeeded();
    this.migrateSortingWorkspaces();
    this.migrateLegacySortingColumnNames();
    this.seedBuiltInAiProviders();
    this.seedBuiltInBots();
    this.seedBuiltInIdentities();
    this.migrateBuiltInBotModelPresets();
    this.migrateAiProviderSecrets();
    this.repairLegacyDirectBotConversations();
    this.cleanupDeprecatedSortingTodoData();
    this.migrateLegacyBubbleRecords();
  }

  cleanupDeprecatedSortingTodoData() {
    const workspaceRows = this.db.prepare(`
      SELECT id, metadata_json AS metadataJson
      FROM sorting_workspaces
    `).all();
    workspaceRows.forEach((row) => {
      const metadata = normalizeSortingWorkspaceMetadata(
        safeJsonParse(row.metadataJson, null),
        this.getInitialSortingSourceSelection(),
      );
      if (!metadata.columnDropCardKinds) return;
      delete metadata.columnDropCardKinds;
      this.db.prepare(`
        UPDATE sorting_workspaces
        SET metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        safeJsonStringify(metadata),
        now(),
        row.id,
      );
    });

    const cardRows = this.db.prepare(`
      SELECT id, metadata_json AS metadataJson
      FROM sorting_cards
      WHERE metadata_json IS NOT NULL AND metadata_json != ''
    `).all();
    cardRows.forEach((row) => {
      const rawMetadata = safeJsonParse(row.metadataJson, null);
      const nextMetadata = normalizeSortingCardMetadata(rawMetadata);
      if (safeJsonStringify(rawMetadata) === safeJsonStringify(nextMetadata)) return;
      this.db.prepare(`
        UPDATE sorting_cards
        SET metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        safeJsonStringify(Object.keys(nextMetadata).length > 0 ? nextMetadata : null),
        now(),
        row.id,
      );
    });
  }

  migrateLegacyBubbleRecords() {
    const messageRows = this.db.prepare(`
      SELECT
        id,
        conversation_id AS conversationId,
        role,
        status,
        message_type AS messageType,
        time_ms AS timeMs,
        sort_order AS sortOrder,
        reply_to_message_id AS replyToMessageId,
        raw_json AS rawJson,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM messages
      ORDER BY conversation_id ASC, sort_order ASC, COALESCE(time_ms, created_at) ASC
    `).all();
    if (messageRows.length === 0) return;

    const maxSortOrderByConversation = new Map();
    this.db.prepare(`
      SELECT conversation_id AS conversationId, MAX(sort_order) AS maxSortOrder
      FROM messages
      GROUP BY conversation_id
    `).all().forEach((row) => {
      maxSortOrderByConversation.set(row.conversationId, Number.isFinite(row.maxSortOrder) ? row.maxSortOrder : 0);
    });

    this.db.exec('BEGIN IMMEDIATE');
    try {
      messageRows.forEach((row) => {
        const rawMessage = safeJsonParse(row.rawJson, null);
        if (!rawMessage || typeof rawMessage !== 'object') return;
        const normalizedMessage = withLegacyMessageShape({
          ...rawMessage,
          id: row.id,
          role: rawMessage.role || row.role || 'me',
          status: rawMessage.status || row.status || 'success',
          time: typeof row.timeMs === 'number' ? row.timeMs : (rawMessage.time || row.createdAt || now()),
          replyToMessageId: row.replyToMessageId || rawMessage.replyToMessageId || undefined,
          metadata: safeJsonParse(row.metadataJson, null) || rawMessage.metadata || null,
        });
        const existingBlockCount = this.db.prepare(`
          SELECT COUNT(*) AS count
          FROM message_blocks
          WHERE message_id = ?
        `).get(row.id)?.count || 0;
        if (existingBlockCount === 0) {
          buildStorageBlocks(normalizedMessage).forEach((block, blockIndex) => {
            this.db.prepare(`
              INSERT INTO message_blocks (
                id, message_id, kind, sort_order, text_value, asset_id, url_value, payload_json, created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              block.id || crypto.randomUUID(),
              row.id,
              block.kind,
              blockIndex,
              block.textValue || null,
              block.assetId || null,
              block.urlValue || null,
              safeJsonStringify(block.payload || null),
              row.createdAt || now(),
            );
          });
        }

        if (!Array.isArray(rawMessage.comments) || rawMessage.comments.length === 0) {
          return;
        }

        rawMessage.comments.forEach((comment, index) => {
          const replyId = typeof comment?.id === 'string' && comment.id.trim()
            ? comment.id.trim()
            : `legacy-comment:${row.id}:${index}`;
          const exists = this.db.prepare(`
            SELECT 1
            FROM messages
            WHERE id = ?
            LIMIT 1
          `).get(replyId);
          if (exists) return;

          const targetBlockId = findTargetBlock(normalizedMessage, { subItemIndex: comment?.targetSubItemIndex })?.id;
          const replyMessage = normalizeOutgoingMessage({
            id: replyId,
            role: comment?.role || ((comment?.name === 'Me' || comment?.name === '我') ? 'me' : 'ai'),
            type: comment?.type || 'text',
            content: comment?.content ?? '',
            time: comment?.time || normalizedMessage.time || now(),
            senderName: typeof comment?.name === 'string' ? comment.name : undefined,
            senderAvatarUrl: typeof comment?.avatar === 'string' ? comment.avatar : undefined,
            replyToMessageId: row.id,
            commentTarget: {
              messageId: row.id,
              blockId: targetBlockId,
            },
          });
          const nextSortOrder = (maxSortOrderByConversation.get(row.conversationId) || 0) + 1;
          maxSortOrderByConversation.set(row.conversationId, nextSortOrder);

          this.db.prepare(`
            INSERT INTO messages (
              id, conversation_id, role, status, message_type, time_ms, sort_order,
              reply_to_message_id, quote_message_id, raw_json, metadata_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            replyMessage.id,
            row.conversationId,
            replyMessage.role || 'me',
            replyMessage.status || 'success',
            replyMessage.type || 'text',
            replyMessage.time || row.createdAt || now(),
            nextSortOrder,
            row.id,
            null,
            safeJsonStringify(replyMessage),
            safeJsonStringify(replyMessage.metadata || null),
            replyMessage.time || row.createdAt || now(),
            row.updatedAt || now(),
          );

          buildStorageBlocks(replyMessage).forEach((block, blockIndex) => {
            this.db.prepare(`
              INSERT INTO message_blocks (
                id, message_id, kind, sort_order, text_value, asset_id, url_value, payload_json, created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              block.id || crypto.randomUUID(),
              replyMessage.id,
              block.kind,
              blockIndex,
              block.textValue || null,
              block.assetId || null,
              block.urlValue || null,
              safeJsonStringify(block.payload || null),
              replyMessage.time || row.createdAt || now(),
            );
          });

          this.db.prepare(`
            INSERT INTO message_relations (
              id, kind, source_message_id, target_message_id, body, metadata_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            'comment',
            replyMessage.id,
            row.id,
            extractText({ blocks: replyMessage.blocks }) || null,
            safeJsonStringify({ targetBlockId: targetBlockId || null }),
            replyMessage.time || row.createdAt || now(),
          );
        });
      });

      const conversationIds = [...new Set(messageRows.map((row) => row.conversationId))];
      conversationIds.forEach((conversationId) => {
        const latestRow = this.db.prepare(`
          SELECT raw_json AS rawJson, COALESCE(time_ms, created_at) AS rankTime
          FROM messages
          WHERE conversation_id = ?
          ORDER BY sort_order DESC, COALESCE(time_ms, created_at) DESC
          LIMIT 1
        `).get(conversationId);
        const latestMessage = latestRow?.rawJson ? safeJsonParse(latestRow.rawJson, null) : null;
        const rankTime = latestRow?.rankTime || now();
        this.db.prepare(`
          UPDATE conversations
          SET last_msg = ?, last_time = ?, last_message_at = ?, updated_at = ?
          WHERE id = ?
        `).run(
          latestMessage ? deriveMessagePreviewText(latestMessage) : '',
          new Date(rankTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          rankTime,
          now(),
          conversationId,
        );
      });

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listConversations() {
    const rows = this.db.prepare(`
      SELECT
        id,
        title,
        avatar,
        last_msg AS lastMsg,
        last_time AS lastTime,
        last_message_at AS lastMessageAt,
        (
          SELECT raw_json
          FROM messages
          WHERE conversation_id = conversations.id
          ORDER BY sort_order DESC, COALESCE(time_ms, created_at) DESC
          LIMIT 1
        ) AS lastMessageJson,
        metadata_json AS metadataJson,
        COALESCE(last_message_at, updated_at) AS rank_time,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) AS messageCount
      FROM conversations
      ORDER BY rank_time DESC
    `).all();

    return rows.map((row) => buildConversationSummary({
      ...row,
      rankTime: row.rank_time,
    }));
  }

  getConversation(conversationId) {
    const row = this.db.prepare(`
      SELECT
        id,
        title,
        avatar,
        last_msg AS lastMsg,
        last_time AS lastTime,
        last_message_at AS lastMessageAt,
        metadata_json AS metadataJson,
        COALESCE(last_message_at, updated_at) AS rank_time,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) AS messageCount
      FROM conversations
      WHERE id = ?
    `).get(conversationId);
    if (!row) return null;

    const messageRows = this.db.prepare(`
      SELECT
        id,
        role,
        status,
        message_type AS messageType,
        time_ms AS timeMs,
        sort_order AS sortOrder,
        reply_to_message_id AS replyToMessageId,
        quote_message_id AS quoteMessageId,
        raw_json AS rawJson,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM messages
      WHERE conversation_id = ?
      ORDER BY sort_order ASC, COALESCE(time_ms, created_at) ASC
    `).all(conversationId);
    const messageIds = messageRows.map((messageRow) => messageRow.id);
    const blockRows = messageIds.length > 0
      ? this.db.prepare(`
        SELECT
          id,
          message_id AS messageId,
          kind,
          sort_order AS sortOrder,
          text_value AS textValue,
          url_value AS urlValue,
          payload_json AS payloadJson,
          created_at AS createdAt
        FROM message_blocks
        WHERE message_id IN (${messageIds.map(() => '?').join(',')})
        ORDER BY message_id ASC, sort_order ASC, created_at ASC
      `).all(...messageIds)
      : [];
    const relationRows = messageIds.length > 0
      ? this.db.prepare(`
        SELECT
          id,
          kind,
          source_message_id AS sourceMessageId,
          target_message_id AS targetMessageId,
          body,
          metadata_json AS metadataJson,
          created_at AS createdAt
        FROM message_relations
        WHERE source_message_id IN (${messageIds.map(() => '?').join(',')})
           OR target_message_id IN (${messageIds.map(() => '?').join(',')})
        ORDER BY created_at ASC
      `).all(...messageIds, ...messageIds)
      : [];
    const reactionRows = messageIds.length > 0
      ? this.db.prepare(`
        SELECT
          id,
          message_id AS messageId,
          block_id AS blockId,
          reaction_kind AS reactionKind,
          actor_key AS actorKey
        FROM message_reactions
        WHERE message_id IN (${messageIds.map(() => '?').join(',')})
      `).all(...messageIds)
      : [];

    const blocksByMessageId = new Map();
    blockRows.forEach((blockRow) => {
      const current = blocksByMessageId.get(blockRow.messageId) || [];
      const block = deserializeStoredBlock(blockRow);
      if (block) current.push(block);
      blocksByMessageId.set(blockRow.messageId, current);
    });

    const normalizedRawMessages = messageRows.map((messageRow) => (
      this.rewriteLegacyMessageMedia(safeJsonParse(messageRow.rawJson, null))
    ));
    const repairedMediaCandidates = buildResolvedMediaCandidateLookup(normalizedRawMessages);

    const messages = messageRows.map((messageRow, index) => {
      const normalizedLegacyMessage = normalizedRawMessages[index] && typeof normalizedRawMessages[index] === 'object'
        ? normalizedRawMessages[index]
        : {};
      const repairedLegacyMessage = this.repairBrokenMessageMedia(
        normalizedLegacyMessage,
        repairedMediaCandidates,
      );
      const repairedFilesMessage = this.repairMessageFileTargets(repairedLegacyMessage);
      const storedBlocks = normalizeBubbleBlocks(blocksByMessageId.get(messageRow.id) || []);
      const fallbackBlocks = getMessageBlocks(repairedFilesMessage);
      return withLegacyMessageShape({
        ...repairedFilesMessage,
        id: messageRow.id,
        role: repairedFilesMessage.role || messageRow.role || 'me',
        status: repairedFilesMessage.status || messageRow.status || 'success',
        time: typeof messageRow.timeMs === 'number' ? messageRow.timeMs : (repairedFilesMessage.time || messageRow.createdAt || now()),
        replyToMessageId: messageRow.replyToMessageId || repairedFilesMessage.replyToMessageId || undefined,
        metadata: safeJsonParse(messageRow.metadataJson, null) || repairedFilesMessage.metadata || null,
        blocks: storedBlocks.length > 0 ? storedBlocks : fallbackBlocks,
        engagement: {
          commentCount: 0,
          forwardCount: 0,
          likeCount: 0,
          likedByMe: false,
        },
      });
    });
    const messageMap = new Map(messages.map((message) => [message.id, message]));

    relationRows.forEach((relationRow) => {
      const metadata = safeJsonParse(relationRow.metadataJson, null) || {};
      if (relationRow.kind === 'comment') {
        const sourceMessage = messageMap.get(relationRow.sourceMessageId);
        if (sourceMessage) {
          sourceMessage.commentTarget = {
            messageId: relationRow.targetMessageId,
            blockId: typeof metadata.targetBlockId === 'string' ? metadata.targetBlockId : undefined,
          };
        }
        return;
      }

      if (relationRow.kind === 'quote' || relationRow.kind === 'forward') {
        const sourceMessage = messageMap.get(relationRow.sourceMessageId);
        if (!sourceMessage) return;
        const existingQuoteBlocks = getMessageBlocks(sourceMessage).filter((block) => (
          block.type === 'quote'
          && block.quote?.relationKind === (relationRow.kind === 'forward' ? 'forward' : 'quote')
          && block.quote?.targetMessageId === relationRow.targetMessageId
        ));
        const targetMessage = messageMap.get(relationRow.targetMessageId);
        const snapshotBlocks = normalizeBubbleBlocks(metadata.snapshotBlocks || [])
          .filter(Boolean);
        const fallbackBlocks = targetMessage
          ? (
            expandQuoteSnapshotBlocks(
              typeof metadata.targetBlockId === 'string'
                ? getMessageBlocks(targetMessage).filter((block) => block.id === metadata.targetBlockId)
                : getMessageBlocks(targetMessage),
            )
          )
          : [];
        const resolvedSnapshotBlocks = snapshotBlocks.length > 0 ? snapshotBlocks : fallbackBlocks;
        if (existingQuoteBlocks.length > 0) {
          const nextBlocks = getMessageBlocks(sourceMessage).map((block) => {
            if (block.type !== 'quote' || !block.quote) return block;
            const isTargetBlock = existingQuoteBlocks.some((item) => item.id === block.id);
            if (!isTargetBlock || normalizeBubbleBlocks(block.quote.snapshotBlocks || []).length > 0) {
              return block;
            }
            return {
              ...block,
              quote: {
                ...block.quote,
                snapshotBlocks: resolvedSnapshotBlocks,
              },
            };
          });
          const normalizedSource = withLegacyMessageShape({
            ...sourceMessage,
            blocks: nextBlocks,
          });
          messageMap.set(sourceMessage.id, normalizedSource);
          return;
        }
        const nextBlocks = [{
          id: typeof metadata.sourceBlockId === 'string' ? metadata.sourceBlockId : createBlockId(`legacy-${relationRow.kind}`),
          type: 'quote',
          quote: {
            relationKind: relationRow.kind === 'forward' ? 'forward' : 'quote',
            targetMessageId: relationRow.targetMessageId,
            targetBlockId: typeof metadata.targetBlockId === 'string' ? metadata.targetBlockId : undefined,
            snapshotBlocks: resolvedSnapshotBlocks,
          },
        }, ...getMessageBlocks(sourceMessage)];
        const normalizedSource = withLegacyMessageShape({
          ...sourceMessage,
          blocks: nextBlocks,
        });
        messageMap.set(sourceMessage.id, normalizedSource);
      }
    });

    messages.forEach((message) => {
      if (message.replyToMessageId) {
        const parent = messageMap.get(message.replyToMessageId);
        if (parent?.engagement) {
          parent.engagement.commentCount += 1;
        }
      }
    });
    relationRows.forEach((relationRow) => {
      if (relationRow.kind !== 'forward') return;
      const target = messageMap.get(relationRow.targetMessageId);
      if (target?.engagement) {
        target.engagement.forwardCount += 1;
      }
    });
    reactionRows.forEach((reactionRow) => {
      const target = messageMap.get(reactionRow.messageId);
      if (!target?.engagement) return;
      if (reactionRow.reactionKind === 'like') {
        target.engagement.likeCount += 1;
        if (reactionRow.actorKey === 'self') {
          target.engagement.likedByMe = true;
        }
      }
    });

    const orderedMessages = messageRows
      .map((messageRow) => messageMap.get(messageRow.id))
      .filter(Boolean);

    return toChatPayload(buildConversationSummary({
      ...row,
      rankTime: row.rank_time,
    }, {
      latestMessage: orderedMessages[orderedMessages.length - 1] || null,
    }), orderedMessages);
  }

  upsertConversation(chat) {
    const timestamp = now();
    const conversationId = chat.chatId || chat.id;
    const sourceMessages = Array.isArray(chat.messages) ? chat.messages : [];
    const lastMessage = sourceMessages[sourceMessages.length - 1] || null;
    const lastMessageAt = typeof lastMessage?.time === 'number'
      ? lastMessage.time
      : typeof chat.lastMessageAt === 'number'
        ? chat.lastMessageAt
        : timestamp;
    const lastTime = lastMessage
      ? new Date(lastMessageAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : typeof chat.lastTime === 'string' && chat.lastTime
        ? chat.lastTime
        : new Date(lastMessageAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const existingRow = conversationId
      ? this.db.prepare(`
        SELECT avatar, metadata_json AS metadataJson
        FROM conversations
        WHERE id = ?
      `).get(conversationId)
      : null;
    const metadata = normalizeConversationMetadata(
      safeJsonParse(chat.metadataJson, null)
      || safeJsonParse(existingRow?.metadataJson, null),
      {
        avatar: chat.avatar || existingRow?.avatar,
        avatarPreset: chat.avatarPreset,
        avatarUrl: chat.avatarUrl,
        lifecycleStatus: chat.lifecycleStatus,
        isPinned: chat.isPinned,
        isFolded: chat.isFolded,
      },
    );
    const existingMessageIds = conversationId
      ? this.db.prepare(`
        SELECT id
        FROM messages
        WHERE conversation_id = ?
      `).all(conversationId).map((row) => row.id)
      : [];
    const existingReactionRows = existingMessageIds.length > 0
      ? this.db.prepare(`
        SELECT id, message_id AS messageId, block_id AS blockId, reaction_kind AS reactionKind, actor_key AS actorKey, created_at AS createdAt
        FROM message_reactions
        WHERE message_id IN (${existingMessageIds.map(() => '?').join(',')})
      `).all(...existingMessageIds)
      : [];
    const conversation = {
      id: conversationId,
      title: chat.title || '新泡泡流',
      avatar: normalizeConversationAvatarPreset(chat.avatarPreset || chat.avatar || existingRow?.avatar),
      kind: 'chat',
      lastMsg: deriveLastMessageText(chat),
      lastTime,
      lastMessageAt,
      metadata,
    };

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO conversations (
          id, title, avatar, kind, last_msg, last_time, last_message_at, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          avatar = excluded.avatar,
          kind = excluded.kind,
          last_msg = excluded.last_msg,
          last_time = excluded.last_time,
          last_message_at = excluded.last_message_at,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(
        conversation.id,
        conversation.title,
        conversation.avatar,
        conversation.kind,
        conversation.lastMsg,
        conversation.lastTime,
        conversation.lastMessageAt,
        safeJsonStringify(conversation.metadata),
        timestamp,
        timestamp,
      );

      this.db.prepare(`
        DELETE FROM message_relations
        WHERE source_message_id IN (SELECT id FROM messages WHERE conversation_id = ?)
           OR target_message_id IN (SELECT id FROM messages WHERE conversation_id = ?)
      `).run(conversation.id, conversation.id);
      this.db.prepare(`
        DELETE FROM message_blocks
        WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)
      `).run(conversation.id);
      this.db.prepare(`
        DELETE FROM message_reactions
        WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)
      `).run(conversation.id);
      this.db.prepare(`
        DELETE FROM messages
        WHERE conversation_id = ?
      `).run(conversation.id);

      const messages = this.normalizeMessagesForInsert(sourceMessages).map((message) => withLegacyMessageShape(message));
      messages.forEach((message, index) => {
        const messageId = message.id || crypto.randomUUID();
        const createdAt = typeof message.time === 'number' ? message.time : timestamp;
        const messageBlocks = getMessageBlocks(message);
        const quoteBlocks = messageBlocks.filter((block) => block.type === 'quote' && block.quote?.targetMessageId);
        const primaryQuoteBlock = quoteBlocks.find((block) => block.quote?.relationKind === 'quote') || null;
        this.db.prepare(`
          INSERT INTO messages (
            id, conversation_id, role, status, message_type, time_ms, sort_order,
            reply_to_message_id, quote_message_id, raw_json, metadata_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          messageId,
          conversation.id,
          message.role || 'me',
          message.status || 'done',
          message.type || 'text',
          typeof message.time === 'number' ? message.time : null,
          index,
          message.replyToMessageId || null,
          primaryQuoteBlock?.quote?.targetMessageId || message.label?.quoteId || null,
          safeJsonStringify({ ...message, id: messageId, blocks: messageBlocks }),
          safeJsonStringify(message.metadata || null),
          createdAt,
          timestamp,
        );

        const blocks = buildStorageBlocks(message);
        blocks.forEach((block, blockIndex) => {
          this.db.prepare(`
            INSERT INTO message_blocks (
              id, message_id, kind, sort_order, text_value, asset_id, url_value, payload_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            block.id || crypto.randomUUID(),
            messageId,
            block.kind,
            blockIndex,
            block.textValue || null,
            block.assetId || null,
            block.urlValue || null,
            safeJsonStringify(block.payload || null),
            createdAt,
          );
        });

        quoteBlocks.forEach((block) => {
          this.db.prepare(`
            INSERT INTO message_relations (
              id, kind, source_message_id, target_message_id, body, metadata_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            block.quote.relationKind,
            messageId,
            block.quote.targetMessageId,
            extractText({ blocks: block.quote.snapshotBlocks }) || null,
            safeJsonStringify({
              sourceBlockId: block.id,
              targetBlockId: block.quote.targetBlockId || null,
              snapshotBlocks: block.quote.snapshotBlocks,
            }),
            createdAt,
          );
        });

        if (message.commentTarget?.messageId) {
          this.db.prepare(`
            INSERT INTO message_relations (
              id, kind, source_message_id, target_message_id, body, metadata_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            'comment',
            messageId,
            message.commentTarget.messageId,
            extractText({ blocks: messageBlocks }) || null,
            safeJsonStringify({ targetBlockId: message.commentTarget.blockId || null }),
            createdAt,
          );
        }

        if (quoteBlocks.length === 0 && message.label?.quoteId) {
          this.db.prepare(`
            INSERT INTO message_relations (
              id, kind, source_message_id, target_message_id, body, metadata_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            'quote',
            messageId,
            message.label.quoteId,
            message.label.text || null,
            safeJsonStringify({ quoteSubItemIndex: message.label.quoteSubItemIndex ?? null }),
            createdAt,
          );
        }
      });

      const nextMessageIds = new Set(messages.map((message) => message.id));
      existingReactionRows.forEach((row) => {
        if (!nextMessageIds.has(row.messageId)) return;
        this.db.prepare(`
          INSERT INTO message_reactions (
            id, message_id, block_id, reaction_kind, actor_key, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          row.id || crypto.randomUUID(),
          row.messageId,
          row.blockId || null,
          row.reactionKind,
          row.actorKey,
          row.createdAt || timestamp,
        );
      });

      this.db.exec('COMMIT');
      return this.getConversation(conversation.id);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  normalizeMessagesForInsert(messages) {
    const seenIds = new Set();
    const idMap = new Map();

    const normalized = messages.map((message) => {
      const next = JSON.parse(JSON.stringify(message));
      const originalId = typeof next.id === 'string' && next.id.trim() ? next.id.trim() : crypto.randomUUID();
      let resolvedId = originalId;

      while (seenIds.has(resolvedId) || this.db.prepare(`SELECT 1 FROM messages WHERE id = ? LIMIT 1`).get(resolvedId)) {
        resolvedId = crypto.randomUUID();
      }

      seenIds.add(resolvedId);
      if (resolvedId !== originalId) {
        idMap.set(originalId, resolvedId);
      }
      next.id = resolvedId;
      return next;
    });

    normalized.forEach((message) => {
      if (message.replyToMessageId && idMap.has(message.replyToMessageId)) {
        message.replyToMessageId = idMap.get(message.replyToMessageId);
      }

      if (message.commentTarget?.messageId && idMap.has(message.commentTarget.messageId)) {
        message.commentTarget.messageId = idMap.get(message.commentTarget.messageId);
      }

      if (message.label?.quoteId && idMap.has(message.label.quoteId)) {
        message.label.quoteId = idMap.get(message.label.quoteId);
      }

      if (Array.isArray(message.blocks)) {
        message.blocks = message.blocks.map((block) => {
          if (block?.type !== 'quote' || !block.quote?.targetMessageId || !idMap.has(block.quote.targetMessageId)) {
            return block;
          }
          return {
            ...block,
            quote: {
              ...block.quote,
              targetMessageId: idMap.get(block.quote.targetMessageId),
            },
          };
        });
      }

      if (Array.isArray(message.referencedBy)) {
        message.referencedBy = message.referencedBy.map((reference) => {
          if (!reference?.msgId || !idMap.has(reference.msgId)) return reference;
          return {
            ...reference,
            msgId: idMap.get(reference.msgId),
          };
        });
      }
    });

    return normalized;
  }

  createConversation(chat) {
    const timestamp = now();
    const conversationId = chat?.chatId || chat?.id || `chat_${crypto.randomUUID()}`;
    const metadata = normalizeConversationMetadata(null, {
      avatar: chat?.avatar,
      avatarPreset: chat?.avatarPreset,
      avatarUrl: chat?.avatarUrl,
      lifecycleStatus: chat?.lifecycleStatus,
      isPinned: chat?.isPinned,
      isFolded: chat?.isFolded,
    });

    return this.upsertConversation({
      chatId: conversationId,
      title: chat?.title || '新泡泡流',
      avatar: metadata.avatarPreset,
      avatarPreset: metadata.avatarPreset,
      avatarUrl: metadata.avatarUrl,
      metadataJson: chat?.metadataJson || (chat?.metadata ? safeJsonStringify(chat.metadata) : undefined),
      lifecycleStatus: metadata.lifecycleStatus,
      isPinned: metadata.isPinned,
      isFolded: metadata.isFolded,
      lastMsg: chat?.lastMsg || '点击进入，开始记录',
      lastTime: chat?.lastTime || new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      lastMessageAt: timestamp,
      messages: Array.isArray(chat?.messages) ? chat.messages : [],
    });
  }

  updateConversationMeta(payload) {
    if (!payload?.conversationId) {
      throw new Error('conversationId is required');
    }
    const row = this.db.prepare(`
      SELECT
        id,
        title,
        avatar,
        metadata_json AS metadataJson
      FROM conversations
      WHERE id = ?
    `).get(payload.conversationId);
    if (!row) {
      throw new Error(`Conversation not found: ${payload.conversationId}`);
    }

    const currentMetadata = normalizeConversationMetadata(
      safeJsonParse(row.metadataJson, null),
      { avatar: row.avatar },
    );
    const nextMetadata = normalizeConversationMetadata(
      {
        ...currentMetadata,
        lifecycleStatus: payload.lifecycleStatus ?? currentMetadata.lifecycleStatus,
        isPinned: payload.isPinned ?? currentMetadata.isPinned,
        isFolded: payload.isFolded ?? currentMetadata.isFolded,
        avatarPreset: payload.avatarPreset ?? currentMetadata.avatarPreset,
        activeTopicId: payload.activeTopicId !== undefined
          ? (typeof payload.activeTopicId === 'string' && payload.activeTopicId.trim() ? payload.activeTopicId.trim() : null)
          : (currentMetadata.activeTopicId ?? null),
        activeIdentityId: payload.activeIdentityId !== undefined
          ? (typeof payload.activeIdentityId === 'string' && payload.activeIdentityId.trim() ? payload.activeIdentityId.trim() : null)
          : (currentMetadata.activeIdentityId ?? null),
        avatarUrl: payload.avatarUrl !== undefined
          ? normalizeConversationAvatarUrl(payload.avatarUrl)
          : currentMetadata.avatarUrl,
        uiState: payload.uiState !== undefined
          ? mergeConversationUiState(currentMetadata.uiState, payload.uiState)
          : currentMetadata.uiState,
      },
      { avatar: row.avatar, avatarUrl: currentMetadata.avatarUrl },
    );

    this.db.prepare(`
      UPDATE conversations
      SET title = ?, avatar = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : row.title,
      nextMetadata.avatarPreset,
      safeJsonStringify(nextMetadata),
      now(),
      payload.conversationId,
    );

    return this.getConversation(payload.conversationId);
  }

  getUserProfile() {
    const row = this.db.prepare(`
      SELECT value_json AS valueJson
      FROM app_settings
      WHERE key = ?
      LIMIT 1
    `).get(USER_PROFILE_SETTING_KEY);
    return normalizeUserProfile(safeJsonParse(row?.valueJson, null));
  }

  saveUserProfile(payload) {
    const currentProfile = this.getUserProfile();
    const hasAvatarUrl = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'avatarUrl');
    const nextProfile = normalizeUserProfile({
      avatarUrl: hasAvatarUrl ? payload.avatarUrl : currentProfile.avatarUrl,
    });

    this.db.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(
      USER_PROFILE_SETTING_KEY,
      safeJsonStringify(nextProfile),
      now(),
    );

    return nextProfile;
  }

  clearConversationMessages(conversationId) {
    const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';
    if (!normalizedConversationId) {
      throw new Error('conversationId is required');
    }

    const row = this.db.prepare(`
      SELECT
        id,
        last_message_at AS lastMessageAt,
        updated_at AS updatedAt
      FROM conversations
      WHERE id = ?
      LIMIT 1
    `).get(normalizedConversationId);
    if (!row) {
      throw new Error(`Conversation not found: ${normalizedConversationId}`);
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        DELETE FROM message_relations
        WHERE source_message_id IN (SELECT id FROM messages WHERE conversation_id = ?)
           OR target_message_id IN (SELECT id FROM messages WHERE conversation_id = ?)
      `).run(normalizedConversationId, normalizedConversationId);
      this.db.prepare(`
        DELETE FROM message_blocks
        WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)
      `).run(normalizedConversationId);
      this.db.prepare(`
        DELETE FROM messages
        WHERE conversation_id = ?
      `).run(normalizedConversationId);
      this.db.prepare(`
        UPDATE conversations
        SET last_msg = ?, last_time = ?, last_message_at = NULL, updated_at = ?
        WHERE id = ?
      `).run('', '', row.lastMessageAt || row.updatedAt || now(), normalizedConversationId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return this.getConversation(normalizedConversationId);
  }

  updateTriggerMessageBotStatus(payload) {
    const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
    const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : '';
    if (!conversationId) {
      throw new Error('conversationId is required');
    }
    if (!messageId) {
      throw new Error('messageId is required');
    }

    const row = this.db.prepare(`
      SELECT
        raw_json AS rawJson,
        metadata_json AS metadataJson
      FROM messages
      WHERE conversation_id = ? AND id = ?
      LIMIT 1
    `).get(conversationId, messageId);
    if (!row) {
      return null;
    }

    const rawMessage = safeJsonParse(row.rawJson, null);
    if (!rawMessage || typeof rawMessage !== 'object') {
      return null;
    }

    const currentMetadata = rawMessage.metadata && typeof rawMessage.metadata === 'object'
      ? { ...rawMessage.metadata }
      : (safeJsonParse(row.metadataJson, null) || {});
    const nextMetadata = currentMetadata && typeof currentMetadata === 'object'
      ? { ...currentMetadata }
      : {};
    const items = Array.isArray(payload?.items)
      ? payload.items.filter((item) => item && typeof item === 'object')
      : [];

    if (items.length > 0) {
      nextMetadata.botTriggerStatus = {
        updatedAt: now(),
        items,
      };
    } else {
      delete nextMetadata.botTriggerStatus;
    }

    const normalizedMetadata = Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
    const nextRawMessage = {
      ...rawMessage,
      metadata: normalizedMetadata,
    };

    this.db.prepare(`
      UPDATE messages
      SET raw_json = ?, metadata_json = ?, updated_at = ?
      WHERE conversation_id = ? AND id = ?
    `).run(
      safeJsonStringify(nextRawMessage),
      safeJsonStringify(normalizedMetadata),
      now(),
      conversationId,
      messageId,
    );

    return nextRawMessage;
  }

  getConversationTopic(topicId) {
    const normalizedTopicId = typeof topicId === 'string' ? topicId.trim() : '';
    if (!normalizedTopicId) return null;

    const row = this.db.prepare(`
      SELECT
        id,
        conversation_id AS conversationId,
        title,
        summary,
        start_after_message_id AS startAfterMessageId,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM conversation_topics
      WHERE id = ?
      LIMIT 1
    `).get(normalizedTopicId);
    if (!row) return null;

    const conversation = this.db.prepare(`
      SELECT metadata_json AS metadataJson
      FROM conversations
      WHERE id = ?
      LIMIT 1
    `).get(row.conversationId);
    const conversationMetadata = safeJsonParse(conversation?.metadataJson, null) || {};

    return {
      id: row.id,
      conversationId: row.conversationId,
      title: row.title,
      summary: row.summary || '',
      startAfterMessageId: row.startAfterMessageId || '',
      isActive: conversationMetadata.activeTopicId === row.id,
      metadata: safeJsonParse(row.metadataJson, null),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  listConversationTopics(conversationId) {
    const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';
    if (!normalizedConversationId) return [];

    const conversation = this.db.prepare(`
      SELECT metadata_json AS metadataJson
      FROM conversations
      WHERE id = ?
      LIMIT 1
    `).get(normalizedConversationId);
    const conversationMetadata = safeJsonParse(conversation?.metadataJson, null) || {};

    return this.db.prepare(`
      SELECT
        id,
        conversation_id AS conversationId,
        title,
        summary,
        start_after_message_id AS startAfterMessageId,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM conversation_topics
      WHERE conversation_id = ?
      ORDER BY updated_at DESC, created_at DESC
    `).all(normalizedConversationId).map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      title: row.title,
      summary: row.summary || '',
      startAfterMessageId: row.startAfterMessageId || '',
      isActive: conversationMetadata.activeTopicId === row.id,
      metadata: safeJsonParse(row.metadataJson, null),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  createConversationTopic(payload) {
    const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
    if (!conversationId) {
      throw new Error('conversationId is required');
    }
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const timestamp = now();
    const topicId = typeof payload?.id === 'string' && payload.id.trim() ? payload.id.trim() : crypto.randomUUID();
    const title = typeof payload?.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : `新话题 ${new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    const startAfterMessageId = typeof payload?.startAfterMessageId === 'string' && payload.startAfterMessageId.trim()
      ? payload.startAfterMessageId.trim()
      : null;

    this.db.prepare(`
      INSERT INTO conversation_topics (
        id, conversation_id, title, summary, start_after_message_id, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      topicId,
      conversationId,
      title,
      typeof payload?.summary === 'string' ? payload.summary.trim() : '',
      startAfterMessageId,
      safeJsonStringify(payload?.metadata || null),
      timestamp,
      timestamp,
    );

    this.updateConversationMeta({
      conversationId,
      activeTopicId: topicId,
    });

    return this.getConversationTopic(topicId);
  }

  saveConversationTopic(payload) {
    const topicId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!topicId) {
      throw new Error('topic id is required');
    }
    const row = this.db.prepare(`
      SELECT
        id,
        conversation_id AS conversationId,
        metadata_json AS metadataJson
      FROM conversation_topics
      WHERE id = ?
      LIMIT 1
    `).get(topicId);
    if (!row) {
      throw new Error(`Topic not found: ${topicId}`);
    }

    const currentMetadata = safeJsonParse(row.metadataJson, null) || {};
    const nextMetadata = payload?.metadata && typeof payload.metadata === 'object'
      ? { ...currentMetadata, ...payload.metadata }
      : currentMetadata;

    this.db.prepare(`
      UPDATE conversation_topics
      SET title = ?, summary = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      typeof payload?.title === 'string' && payload.title.trim() ? payload.title.trim() : (this.getConversationTopic(topicId)?.title || '新话题'),
      typeof payload?.summary === 'string' ? payload.summary.trim() : (this.getConversationTopic(topicId)?.summary || ''),
      safeJsonStringify(nextMetadata),
      now(),
      topicId,
    );

    if (payload?.isActive === true) {
      this.updateConversationMeta({
        conversationId: row.conversationId,
        activeTopicId: topicId,
      });
    }

    return this.getConversationTopic(topicId);
  }

  findMessageForReference(messageId, preferredConversationId = null) {
    const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : '';
    if (!normalizedMessageId) return null;

    const candidateConversationIds = [];
    if (typeof preferredConversationId === 'string' && preferredConversationId.trim()) {
      candidateConversationIds.push(preferredConversationId.trim());
    }

    const messageRow = this.db.prepare(`
      SELECT conversation_id AS conversationId
      FROM messages
      WHERE id = ?
      LIMIT 1
    `).get(normalizedMessageId);

    if (typeof messageRow?.conversationId === 'string' && messageRow.conversationId.trim()) {
      candidateConversationIds.push(messageRow.conversationId.trim());
    }

    const uniqueConversationIds = [...new Set(candidateConversationIds.filter(Boolean))];
    for (const conversationId of uniqueConversationIds) {
      const conversation = this.getConversation(conversationId);
      const message = conversation?.messages.find((item) => item.id === normalizedMessageId) || null;
      if (message) return message;
    }

    return null;
  }

  sendMessage(payload) {
    const conversation = this.getConversation(payload.conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${payload.conversationId}`);
    }

    const nextConversation = deepClone(conversation);
    const userProfile = this.getUserProfile();
    let nextMessage = payload.message
      ? normalizeOutgoingMessage(payload.message)
      : createMessageFromDraft(payload.draft);
    if (nextMessage.role === 'me') {
      nextMessage.senderAvatarUrl = userProfile.avatarUrl;
    }

    const replyTarget = payload.replyToMessageId
      ? {
          messageId: payload.replyToMessageId,
          blockId: payload.targetBlockId || undefined,
        }
      : (payload.draft?.replyTarget && typeof payload.draft.replyTarget === 'object'
        ? payload.draft.replyTarget
        : null);
    if (replyTarget?.messageId) {
      nextMessage.replyToMessageId = replyTarget.messageId;
      if (replyTarget.blockId) {
        nextMessage.commentTarget = {
          messageId: replyTarget.messageId,
          blockId: replyTarget.blockId,
        };
      }
    }

    const quoteSource = payload.quoteSource
      || payload.draft?.quoteSource
      || (payload.quote?.msgId
        ? buildQuoteSnapshot(
          nextConversation.messages.find((item) => item.id === payload.quote.msgId),
          {
            blockId: payload.quote.targetBlockId,
            subItemIndex: payload.quote.subItemIndex,
          },
        )
        : null);
    if (quoteSource?.targetMessageId && !payload.draft?.quoteSource) {
      nextMessage = prependSourceBlock(nextMessage, quoteSource, 'quote');
    }

    const forwardSource = payload.forwardSource
      || payload.draft?.forwardSource
      || (payload.forwardOfMessageId
        ? buildQuoteSnapshot(
          this.findMessageForReference(payload.forwardOfMessageId, payload.forwardOfConversationId || payload.conversationId),
          { blockId: payload.targetBlockId },
        )
        : null);
    if (forwardSource?.targetMessageId && !payload.draft?.forwardSource) {
      nextMessage = prependSourceBlock(nextMessage, forwardSource, 'forward');
    }

    nextConversation.messages.push(withLegacyMessageShape(nextMessage));
    return this.upsertConversation(nextConversation);
  }

  updateMessage(payload) {
    const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
    const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : '';
    if (!conversationId) {
      throw new Error('conversationId is required');
    }
    if (!messageId) {
      throw new Error('messageId is required');
    }

    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const nextConversation = deepClone(conversation);
    const messageIndex = nextConversation.messages.findIndex((item) => item.id === messageId);
    if (messageIndex < 0) {
      throw new Error(`Message not found: ${messageId}`);
    }

    const existingMessage = nextConversation.messages[messageIndex];
    const userProfile = this.getUserProfile();
    let nextMessage = payload.message
      ? normalizeOutgoingMessage({
        ...existingMessage,
        ...payload.message,
      })
      : createMessageFromDraft(payload.draft || {});

    nextMessage.id = existingMessage.id;
    nextMessage.time = existingMessage.time;
    nextMessage.role = existingMessage.role || nextMessage.role;
    nextMessage.status = existingMessage.status || nextMessage.status || 'success';
    nextMessage.senderId = existingMessage.senderId || nextMessage.senderId;
    nextMessage.senderName = existingMessage.senderName || nextMessage.senderName;
    nextMessage.senderAvatarPreset = existingMessage.senderAvatarPreset || nextMessage.senderAvatarPreset;
    nextMessage.senderAvatarUrl = nextMessage.role === 'me'
      ? userProfile.avatarUrl
      : (existingMessage.senderAvatarUrl || nextMessage.senderAvatarUrl);
    nextMessage.metadata = existingMessage?.metadata && typeof existingMessage.metadata === 'object'
      ? cloneJson(existingMessage.metadata)
      : nextMessage.metadata;

    const replyTarget = payload.replyToMessageId
      ? {
          messageId: payload.replyToMessageId,
          blockId: payload.targetBlockId || undefined,
        }
      : (payload.draft?.replyTarget && typeof payload.draft.replyTarget === 'object'
        ? payload.draft.replyTarget
        : (existingMessage.replyToMessageId
          ? {
            messageId: existingMessage.replyToMessageId,
            blockId: existingMessage.commentTarget?.blockId,
          }
          : null));

    if (replyTarget?.messageId) {
      nextMessage.replyToMessageId = replyTarget.messageId;
      nextMessage.commentTarget = replyTarget.blockId
        ? {
          messageId: replyTarget.messageId,
          blockId: replyTarget.blockId,
        }
        : null;
    } else {
      delete nextMessage.replyToMessageId;
      delete nextMessage.commentTarget;
    }

    const existingQuoteSource = extractEmbeddedSource(existingMessage, 'quote');
    const existingForwardSource = extractEmbeddedSource(existingMessage, 'forward');
    const quoteSource = payload.quoteSource
      || payload.draft?.quoteSource
      || (!payload.draft
        ? existingQuoteSource
        : null);
    const forwardSource = payload.forwardSource
      || payload.draft?.forwardSource
      || (!payload.draft
        ? existingForwardSource
        : null);

    if (quoteSource?.targetMessageId && !payload.draft?.quoteSource) {
      nextMessage = prependSourceBlock(nextMessage, quoteSource, 'quote');
    }
    if (forwardSource?.targetMessageId && !payload.draft?.forwardSource) {
      nextMessage = prependSourceBlock(nextMessage, forwardSource, 'forward');
    }

    nextConversation.messages[messageIndex] = withLegacyMessageShape(nextMessage);
    return this.upsertConversation(nextConversation);
  }

  quoteMessage(payload) {
    const conversation = this.getConversation(payload.conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${payload.conversationId}`);
    }
    const message = conversation.messages.find((item) => item.id === payload.messageId);
    if (!message) {
      throw new Error(`Message not found: ${payload.messageId}`);
    }
    return buildQuoteSnapshot(message, {
      blockId: payload.blockId,
      subItemIndex: payload.subItemIndex,
    });
  }

  commentMessage(payload) {
    const conversation = this.getConversation(payload.conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${payload.conversationId}`);
    }
    const target = conversation.messages.find((item) => item.id === payload.messageId);
    if (!target) {
      throw new Error(`Message not found: ${payload.messageId}`);
    }
    return this.sendMessage({
      conversationId: payload.conversationId,
      message: payload.message,
      draft: payload.draft || { text: payload.content || '', items: [] },
      replyToMessageId: payload.messageId,
      targetBlockId: payload.targetBlockId || findTargetBlock(target, { subItemIndex: payload.targetSubItemIndex })?.id,
    });
  }

  toggleLike(payload) {
    const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
    const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : '';
    const blockId = typeof payload?.blockId === 'string' && payload.blockId.trim() ? payload.blockId.trim() : null;
    if (!conversationId) {
      throw new Error('conversationId is required');
    }
    if (!messageId) {
      throw new Error('messageId is required');
    }
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    const message = conversation.messages.find((item) => item.id === messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    const existing = this.db.prepare(`
      SELECT id
      FROM message_reactions
      WHERE message_id = ? AND COALESCE(block_id, '') = COALESCE(?, '') AND reaction_kind = 'like' AND actor_key = 'self'
      LIMIT 1
    `).get(messageId, blockId);

    if (existing?.id) {
      this.db.prepare(`
        DELETE FROM message_reactions
        WHERE id = ?
      `).run(existing.id);
    } else {
      this.db.prepare(`
        INSERT INTO message_reactions (
          id, message_id, block_id, reaction_kind, actor_key, created_at
        )
        VALUES (?, ?, ?, 'like', 'self', ?)
      `).run(
        crypto.randomUUID(),
        messageId,
        blockId,
        now(),
      );
    }

    return this.getConversation(conversationId);
  }

  deleteMessage(payload) {
    const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
    const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : '';
    if (!conversationId) {
      throw new Error('conversationId is required');
    }
    if (!messageId) {
      throw new Error('messageId is required');
    }

    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const deletedIds = new Set([messageId]);
    conversation.messages.forEach((message) => {
      const metadata = message?.metadata && typeof message.metadata === 'object' ? message.metadata : null;
      const botReply = metadata?.botReply && typeof metadata.botReply === 'object' ? metadata.botReply : null;
      if (botReply?.triggerMessageId === messageId) {
        deletedIds.add(message.id);
      }
    });
    let changed = true;
    while (changed) {
      changed = false;
      conversation.messages.forEach((message) => {
        if (message.replyToMessageId && deletedIds.has(message.replyToMessageId) && !deletedIds.has(message.id)) {
          deletedIds.add(message.id);
          changed = true;
        }
      });
    }

    const nextConversation = deepClone(conversation);
    nextConversation.messages = nextConversation.messages
      .filter((message) => !deletedIds.has(message.id))
      .map((message) => {
        const nextMessage = { ...message };
        const nextBlocks = getMessageBlocks(nextMessage).filter((block) => {
          if (block.type !== 'quote' || !block.quote?.targetMessageId) return true;
          return !deletedIds.has(block.quote.targetMessageId);
        });
        return withLegacyMessageShape({
          ...nextMessage,
          blocks: nextBlocks,
        });
      });

    const deletedMessageIds = [...deletedIds];
    if (deletedMessageIds.length > 0) {
      this.db.prepare(`
        UPDATE conversation_topics
        SET start_after_message_id = NULL, updated_at = ?
        WHERE conversation_id = ?
          AND start_after_message_id IN (${deletedMessageIds.map(() => '?').join(',')})
      `).run(now(), conversationId, ...deletedMessageIds);
    }

    return this.upsertConversation(nextConversation);
  }

  getInitialSortingSourceSelection() {
    const rows = this.db.prepare(`
      SELECT id, metadata_json AS metadataJson
      FROM conversations
      ORDER BY COALESCE(last_message_at, updated_at) DESC, created_at DESC
    `).all();
    return normalizeStringArray(rows
      .filter((row) => {
        const metadata = normalizeConversationMetadata(safeJsonParse(row.metadataJson, null));
        return metadata.lifecycleStatus === 'flowing';
      })
      .slice(0, 1)
      .map((row) => row.id));
  }

  ensureSortingBox(workspaceId, box, sortOrder) {
    const boxId = toSortingEntityId(workspaceId, box.id);
    const existing = this.db.prepare(`
      SELECT 1
      FROM sorting_boxes
      WHERE id = ?
      LIMIT 1
    `).get(boxId);
    if (existing) return boxId;

    this.db.prepare(`
      INSERT INTO sorting_boxes (
        id, workspace_id, name, tone, description, sort_order, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      boxId,
      workspaceId,
      box.name,
      box.tone,
      box.description,
      sortOrder,
      now(),
      now(),
    );

    return boxId;
  }

  ensureSortingColumn(workspaceId, column, sortOrder) {
    const columnId = toSortingEntityId(workspaceId, column.id);
    const existing = this.db.prepare(`
      SELECT 1
      FROM sorting_layers
      WHERE id = ?
      LIMIT 1
    `).get(columnId);
    if (existing) return columnId;

    this.db.prepare(`
      INSERT INTO sorting_layers (
        id, workspace_id, box_id, name, kind, system_key, sort_order, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      columnId,
      workspaceId,
      column.boxId ? toSortingEntityId(workspaceId, column.boxId) : null,
      column.name,
      'user',
      null,
      sortOrder,
      now(),
      now(),
    );

    return columnId;
  }

  ensureSortingCard(workspaceId, card, sortOrder) {
    const cardId = toSortingEntityId(workspaceId, card.id);
    const existing = this.db.prepare(`
      SELECT 1
      FROM sorting_cards
      WHERE id = ?
      LIMIT 1
    `).get(cardId);
    if (existing) return cardId;

    this.db.prepare(`
      INSERT INTO sorting_cards (
        id, workspace_id, layer_id, type, box_ref_id, source_bubble_id, title, content,
        raw_message_json, source_ids_json, metadata_json, sort_order, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cardId,
      workspaceId,
      toSortingEntityId(workspaceId, card.layerId),
      card.type,
      card.childBoxId ? toSortingEntityId(workspaceId, card.childBoxId) : null,
      null,
      null,
      null,
      null,
      safeJsonStringify([]),
      safeJsonStringify(null),
      sortOrder,
      now(),
      now(),
    );

    return cardId;
  }

  ensureDefaultSortingStructure(workspaceId) {
    const workspaceMetadataRow = this.db.prepare(`
      SELECT metadata_json AS metadataJson
      FROM sorting_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(workspaceId);
    const metadata = normalizeSortingWorkspaceMetadata(
      safeJsonParse(workspaceMetadataRow?.metadataJson, null),
      this.getInitialSortingSourceSelection(),
    );
    const deletedDefaultBoxIds = new Set(metadata.deletedDefaultBoxIds);
    const activeDefaultBoxes = DEFAULT_SORTING_BOXES.filter((box) => !deletedDefaultBoxIds.has(box.id));
    const activeDefaultBoxIds = new Set(activeDefaultBoxes.map((box) => box.id));
    const defaultColumnBoxIds = new Map(
      DEFAULT_SORTING_COLUMNS.map((column) => [column.id, column.boxId]),
    );

    activeDefaultBoxes.forEach((box, index) => {
      this.ensureSortingBox(workspaceId, box, index);
    });
    DEFAULT_SORTING_COLUMNS
      .filter((column) => activeDefaultBoxIds.has(column.boxId))
      .forEach((column, index) => {
        this.ensureSortingColumn(workspaceId, column, index);
      });
    LEGACY_SORTING_COLUMN_NAME_MIGRATIONS.forEach(({ rawId, from, to }) => {
      const columnId = toSortingEntityId(workspaceId, rawId);
      const row = this.db.prepare(`
        SELECT name
        FROM sorting_layers
        WHERE id = ?
        LIMIT 1
      `).get(columnId);
      if (!row || row.name !== from) return;
      this.db.prepare(`
        UPDATE sorting_layers
        SET name = ?, updated_at = ?
        WHERE id = ?
      `).run(to, now(), columnId);
    });
    this.ensureSortingLuggageColumn(workspaceId);
    DEFAULT_SORTING_CARDS
      .filter((card) => {
        const layerBoxId = defaultColumnBoxIds.get(card.layerId);
        return (!layerBoxId || activeDefaultBoxIds.has(layerBoxId))
          && (!card.childBoxId || activeDefaultBoxIds.has(card.childBoxId));
      })
      .forEach((card, index) => {
        this.ensureSortingCard(workspaceId, card, index);
      });

    const workspaceRow = this.db.prepare(`
      SELECT active_box_id AS activeBoxId
      FROM sorting_workspaces
      WHERE id = ?
    `).get(workspaceId);
    const validActiveBoxId = workspaceRow?.activeBoxId
      && this.db.prepare(`SELECT 1 FROM sorting_boxes WHERE id = ? LIMIT 1`).get(workspaceRow.activeBoxId);
    if (!validActiveBoxId) {
      this.db.prepare(`
        UPDATE sorting_workspaces
        SET active_box_id = ?, updated_at = ?
        WHERE id = ?
      `).run(
        toSortingEntityId(workspaceId, 'b_prog'),
        now(),
        workspaceId,
      );
    }
  }

  createSortingBox(workspaceId, payload = {}) {
    const timestamp = now();
    const rawBoxId = `b_${crypto.randomUUID()}`;
    const boxId = toSortingEntityId(workspaceId, rawBoxId);
    const requestedParentBoxId = typeof payload.parentBoxId === 'string' && payload.parentBoxId.trim()
      ? payload.parentBoxId.trim()
      : null;
    const requestedActiveBoxId = typeof payload.activeBoxId === 'string' && payload.activeBoxId.trim()
      ? payload.activeBoxId.trim()
      : null;
    const name = typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : '新箱子';
    const tone = typeof payload.tone === 'string' && payload.tone.trim()
      ? payload.tone.trim()
      : '#5E9B7A';
    const description = typeof payload.description === 'string' && payload.description.trim()
      ? payload.description.trim()
      : '用于组织新的泡泡主题与素材。';
    const defaultLayer = buildDefaultSortingLayer(boxId);
    const boxSortRow = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) AS maxSort
      FROM sorting_boxes
      WHERE workspace_id = ?
    `).get(workspaceId);
    const createdColumnIds = [];

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO sorting_boxes (
          id, workspace_id, name, tone, description, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        boxId,
        workspaceId,
        name,
        tone,
        description,
        (boxSortRow?.maxSort || -1) + 1,
        timestamp,
        timestamp,
      );

      SORTING_BOX_TEMPLATE_COLUMNS.forEach((columnName, index) => {
        const columnId = `l_${crypto.randomUUID()}`;
        this.db.prepare(`
          INSERT INTO sorting_layers (
            id, workspace_id, box_id, name, kind, system_key, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          columnId,
          workspaceId,
          boxId,
          columnName,
          'user',
          null,
          index,
          timestamp,
          timestamp,
        );
        createdColumnIds.push(columnId);
      });

      const validParentBoxId = requestedParentBoxId && this.db.prepare(`
        SELECT 1
        FROM sorting_boxes
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(requestedParentBoxId, workspaceId)
        ? requestedParentBoxId
        : null;
      const fallbackRootLayerId = toSortingEntityId(workspaceId, 'l_root_inbox');
      const targetLayerRow = validParentBoxId
        ? this.db.prepare(`
          SELECT id
          FROM sorting_layers
          WHERE workspace_id = ? AND box_id = ?
          ORDER BY sort_order ASC, created_at ASC
          LIMIT 1
        `).get(workspaceId, validParentBoxId)
        : this.db.prepare(`
          SELECT id
          FROM sorting_layers
          WHERE workspace_id = ? AND id = ?
          LIMIT 1
        `).get(workspaceId, fallbackRootLayerId);
      if (targetLayerRow?.id) {
        const targetSortRow = this.db.prepare(`
          SELECT COALESCE(MAX(sort_order), -1) AS maxSort
          FROM sorting_cards
          WHERE workspace_id = ? AND layer_id = ?
        `).get(workspaceId, targetLayerRow.id);
        this.db.prepare(`
          INSERT INTO sorting_cards (
            id, workspace_id, layer_id, type, box_ref_id, source_bubble_id, title, content,
            raw_message_json, source_ids_json, metadata_json, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `i_${crypto.randomUUID()}`,
          workspaceId,
          targetLayerRow.id,
          'box',
          boxId,
          null,
          null,
          null,
          null,
          safeJsonStringify([]),
          safeJsonStringify(null),
          (targetSortRow?.maxSort || -1) + 1,
          timestamp,
          timestamp,
        );
      }

      const validActiveBoxId = requestedActiveBoxId && this.db.prepare(`
        SELECT 1
        FROM sorting_boxes
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(requestedActiveBoxId, workspaceId)
        ? requestedActiveBoxId
        : boxId;

      this.db.prepare(`
        UPDATE sorting_workspaces
        SET active_box_id = ?, updated_at = ?
        WHERE id = ?
      `).run(validActiveBoxId, timestamp, workspaceId);

      const workspaceRow = this.db.prepare(`
        SELECT metadata_json AS metadataJson
        FROM sorting_workspaces
        WHERE id = ?
        LIMIT 1
      `).get(workspaceId);
      const metadata = normalizeSortingWorkspaceMetadata(
        safeJsonParse(workspaceRow?.metadataJson, null),
        this.getInitialSortingSourceSelection(),
      );
      metadata.boxLayers = {
        ...(metadata.boxLayers || {}),
        [boxId]: [defaultLayer],
      };
      metadata.columnLayerBindings = {
        ...(metadata.columnLayerBindings || {}),
        ...Object.fromEntries(createdColumnIds.map((columnId) => [columnId, [defaultLayer.id]])),
      };
      this.db.prepare(`
        UPDATE sorting_workspaces
        SET metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(safeJsonStringify(metadata), timestamp, workspaceId);

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return boxId;
  }

  createFreshSortingWorkspace(selectedSourceIds = []) {
    const workspaceId = 'sorting_default';
    const timestamp = now();
    const metadata = normalizeSortingWorkspaceMetadata({
      boxLayers: buildInitialSortingBoxLayers(
        DEFAULT_SORTING_BOXES.map((box) => toSortingEntityId(workspaceId, box.id)),
      ),
    }, selectedSourceIds);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO sorting_workspaces (
          id, stream_id, title, active_box_id, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        workspaceId,
        DEFAULT_SORTING_WORKSPACE_STREAM_ID,
        DEFAULT_SORTING_WORKSPACE_TITLE,
        toSortingEntityId(workspaceId, 'b_prog'),
        safeJsonStringify(metadata),
        timestamp,
        timestamp,
      );

      DEFAULT_SORTING_BOXES.forEach((box, index) => {
        this.db.prepare(`
          INSERT INTO sorting_boxes (
            id, workspace_id, name, tone, description, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          toSortingEntityId(workspaceId, box.id),
          workspaceId,
          box.name,
          box.tone,
          box.description,
          index,
          timestamp,
          timestamp,
        );
      });

      DEFAULT_SORTING_COLUMNS.forEach((column, index) => {
        this.db.prepare(`
          INSERT INTO sorting_layers (
            id, workspace_id, box_id, name, kind, system_key, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          toSortingEntityId(workspaceId, column.id),
          workspaceId,
          toSortingEntityId(workspaceId, column.boxId),
          column.name,
          'user',
          null,
          index,
          timestamp,
          timestamp,
        );
      });

      this.db.prepare(`
        INSERT INTO sorting_layers (
          id, workspace_id, box_id, name, kind, system_key, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        toSortingEntityId(workspaceId, 'luggage'),
        workspaceId,
        null,
        '行李箱',
        'system',
        SORTING_LUGGAGE_COLUMN_KEY,
        0,
        timestamp,
        timestamp,
      );

      DEFAULT_SORTING_CARDS.forEach((card, index) => {
        this.db.prepare(`
          INSERT INTO sorting_cards (
            id, workspace_id, layer_id, type, box_ref_id, source_bubble_id, title, content,
            raw_message_json, source_ids_json, metadata_json, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          toSortingEntityId(workspaceId, card.id),
          workspaceId,
          toSortingEntityId(workspaceId, card.layerId),
          card.type,
          card.childBoxId ? toSortingEntityId(workspaceId, card.childBoxId) : null,
          null,
          null,
          null,
          null,
          safeJsonStringify([]),
          safeJsonStringify(null),
          index,
          timestamp,
          timestamp,
        );
      });

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return this.db.prepare(`
      SELECT id, stream_id AS streamId, title, active_box_id AS activeBoxId, metadata_json AS metadataJson
      FROM sorting_workspaces
      WHERE id = ?
    `).get(workspaceId);
  }

  ensureSortingLuggageColumn(workspaceId) {
    let column = this.db.prepare(`
      SELECT id
      FROM sorting_layers
      WHERE workspace_id = ? AND system_key = ?
      LIMIT 1
    `).get(workspaceId, SORTING_LUGGAGE_COLUMN_KEY);

    if (column) return column.id;

    const timestamp = now();
    const columnId = toSortingEntityId(workspaceId, 'luggage');
    this.db.prepare(`
      INSERT INTO sorting_layers (
        id, workspace_id, box_id, name, kind, system_key, sort_order, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      columnId,
      workspaceId,
      null,
      '行李箱',
      'system',
      SORTING_LUGGAGE_COLUMN_KEY,
      0,
      timestamp,
      timestamp,
    );

    return columnId;
  }

  normalizeLegacySortingCardSources(workspaceId, sourceStreamId) {
    if (!sourceStreamId || sourceStreamId === DEFAULT_SORTING_WORKSPACE_STREAM_ID) return;

    const cards = this.db.prepare(`
      SELECT id, source_bubble_id AS sourceBubbleId, source_ids_json AS sourceIdsJson, metadata_json AS metadataJson
      FROM sorting_cards
      WHERE workspace_id = ? AND type = 'card'
    `).all(workspaceId);

    cards.forEach((card) => {
      const metadata = safeJsonParse(card.metadataJson, {}) || {};
      const rawSourceIds = safeJsonParse(card.sourceIdsJson, []);
      const normalizedSourceIds = normalizeStringArray(
        rawSourceIds.length > 0
          ? rawSourceIds.map((item) => (typeof item === 'string' && item.includes(':') ? item : `${sourceStreamId}:${item}`))
          : card.sourceBubbleId
            ? [`${sourceStreamId}:${card.sourceBubbleId}`]
            : [],
      );

      const nextMetadata = {
        ...metadata,
        sourceStreamId: metadata.sourceStreamId || sourceStreamId,
      };

      this.db.prepare(`
        UPDATE sorting_cards
        SET source_ids_json = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        safeJsonStringify(normalizedSourceIds),
        safeJsonStringify(nextMetadata),
        now(),
        card.id,
      );
    });
  }

  migrateSortingWorkspaces() {
    const workspaces = this.db.prepare(`
      SELECT id, stream_id AS streamId, title, active_box_id AS activeBoxId, metadata_json AS metadataJson
      FROM sorting_workspaces
      ORDER BY updated_at DESC, created_at DESC
    `).all();

    if (workspaces.length === 0) {
      return;
    }

    let defaultWorkspace = workspaces.find((workspace) => workspace.streamId === DEFAULT_SORTING_WORKSPACE_STREAM_ID) || null;
    const timestamp = now();

    if (!defaultWorkspace) {
      const baseWorkspace = workspaces[0];
      this.normalizeLegacySortingCardSources(baseWorkspace.id, baseWorkspace.streamId);
      const baseMetadata = normalizeSortingWorkspaceMetadata(
        safeJsonParse(baseWorkspace.metadataJson, null),
        baseWorkspace.streamId ? [baseWorkspace.streamId] : this.getInitialSortingSourceSelection(),
      );
      this.db.prepare(`
        UPDATE sorting_workspaces
        SET stream_id = ?, title = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        DEFAULT_SORTING_WORKSPACE_STREAM_ID,
        DEFAULT_SORTING_WORKSPACE_TITLE,
        safeJsonStringify(baseMetadata),
        timestamp,
        baseWorkspace.id,
      );
      defaultWorkspace = {
        ...baseWorkspace,
        streamId: DEFAULT_SORTING_WORKSPACE_STREAM_ID,
        title: DEFAULT_SORTING_WORKSPACE_TITLE,
        metadataJson: safeJsonStringify(baseMetadata),
      };
    } else {
      const normalizedMetadata = normalizeSortingWorkspaceMetadata(
        safeJsonParse(defaultWorkspace.metadataJson, null),
        this.getInitialSortingSourceSelection(),
      );
      this.db.prepare(`
        UPDATE sorting_workspaces
        SET metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(safeJsonStringify(normalizedMetadata), timestamp, defaultWorkspace.id);
      defaultWorkspace = {
        ...defaultWorkspace,
        metadataJson: safeJsonStringify(normalizedMetadata),
      };
    }

    const luggageColumnId = this.ensureSortingLuggageColumn(defaultWorkspace.id);
    let nextSortOrder = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) AS maxSort
      FROM sorting_cards
      WHERE workspace_id = ? AND layer_id = ?
    `).get(defaultWorkspace.id, luggageColumnId).maxSort + 1;

    workspaces
      .filter((workspace) => workspace.id !== defaultWorkspace.id)
      .forEach((workspace) => {
        this.normalizeLegacySortingCardSources(workspace.id, workspace.streamId);
        const cards = this.db.prepare(`
          SELECT id, type
          FROM sorting_cards
          WHERE workspace_id = ?
          ORDER BY sort_order ASC, created_at ASC
        `).all(workspace.id);

        cards
          .filter((card) => card.type === 'card')
          .forEach((card) => {
            this.db.prepare(`
              UPDATE sorting_cards
              SET workspace_id = ?, layer_id = ?, sort_order = ?, updated_at = ?
              WHERE id = ?
            `).run(defaultWorkspace.id, luggageColumnId, nextSortOrder, now(), card.id);
            nextSortOrder += 1;
          });
      });
  }

  migrateLegacySortingColumnNames() {
    const timestamp = now();
    LEGACY_SORTING_COLUMN_NAME_MIGRATIONS.forEach(({ rawId, from, to }) => {
      this.db.prepare(`
        UPDATE sorting_layers
        SET name = ?, updated_at = ?
        WHERE name = ?
          AND (id = ? OR id LIKE ?)
      `).run(
        to,
        timestamp,
        from,
        rawId,
        `%:${rawId}`,
      );
    });
  }

  synchronizeSortingWorkspaceLayers(workspaceId, metadataInput) {
    const metadata = normalizeSortingWorkspaceMetadata(
      metadataInput,
      this.getInitialSortingSourceSelection(),
    );
    const boxRows = this.db.prepare(`
      SELECT id
      FROM sorting_boxes
      WHERE workspace_id = ?
      ORDER BY sort_order ASC, created_at ASC
    `).all(workspaceId);
    const columnRows = this.db.prepare(`
      SELECT id, box_id AS boxId
      FROM sorting_layers
      WHERE workspace_id = ?
      ORDER BY sort_order ASC, created_at ASC
    `).all(workspaceId);
    const cardRows = this.db.prepare(`
      SELECT id, layer_id AS columnId, metadata_json AS metadataJson
      FROM sorting_cards
      WHERE workspace_id = ?
    `).all(workspaceId);

    const columnsById = new Map(columnRows.map((column) => [column.id, column]));
    const columnsByBoxId = {};
    const boxLayersByBoxId = {};

    boxRows.forEach((box) => {
      boxLayersByBoxId[box.id] = resolveSortingBoxLayers(metadata.boxLayers, box.id);
    });
    columnRows.forEach((column) => {
      if (!column.boxId) return;
      if (!columnsByBoxId[column.boxId]) {
        columnsByBoxId[column.boxId] = [];
      }
      columnsByBoxId[column.boxId].push(column);
    });

    const nextBindings = normalizeSortingColumnLayerBindings(metadata.columnLayerBindings);
    let metadataChanged = false;

    boxRows.forEach((box) => {
      const resolvedBindings = resolveSortingColumnLayerBindings(
        nextBindings,
        columnsByBoxId[box.id] || [],
        boxLayersByBoxId[box.id] || [],
      );
      Object.entries(resolvedBindings).forEach(([columnId, layerIds]) => {
        const currentLayerIds = normalizeStringArray(nextBindings[columnId]);
        if (safeJsonStringify(currentLayerIds) === safeJsonStringify(layerIds)) {
          return;
        }
        nextBindings[columnId] = layerIds;
        metadataChanged = true;
      });
    });

    cardRows.forEach((card) => {
      const column = columnsById.get(card.columnId);
      if (!column?.boxId) return;
      const rawLayerId = extractSortingCardLayerId(safeJsonParse(card.metadataJson, null));
      if (!rawLayerId) return;
      const availableLayerIds = new Set((boxLayersByBoxId[column.boxId] || []).map((layer) => layer.id));
      if (!availableLayerIds.has(rawLayerId)) return;
      const currentLayerIds = normalizeStringArray(nextBindings[column.id]);
      if (currentLayerIds.includes(rawLayerId)) return;
      nextBindings[column.id] = (boxLayersByBoxId[column.boxId] || [])
        .map((layer) => layer.id)
        .filter((layerId) => layerId === rawLayerId || currentLayerIds.includes(layerId));
      metadataChanged = true;
    });

    if (metadataChanged) {
      metadata.columnLayerBindings = nextBindings;
    }

    const resolvedBindingsByColumnId = {};
    boxRows.forEach((box) => {
      Object.assign(
        resolvedBindingsByColumnId,
        resolveSortingColumnLayerBindings(
          metadata.columnLayerBindings,
          columnsByBoxId[box.id] || [],
          boxLayersByBoxId[box.id] || [],
        ),
      );
    });

    let cardMetadataChanged = false;
    cardRows.forEach((card) => {
      const currentMetadata = normalizeSortingCardMetadata(safeJsonParse(card.metadataJson, null));
      const nextCardLayerId = resolveSortingCardLayerId(
        currentMetadata,
        resolvedBindingsByColumnId[card.columnId] || [],
      );
      const nextMetadata = withSortingCardLayerId(currentMetadata, nextCardLayerId);
      const currentMetadataJson = safeJsonStringify(
        Object.keys(currentMetadata).length > 0 ? currentMetadata : null,
      );
      const nextMetadataJson = safeJsonStringify(nextMetadata);
      if (currentMetadataJson === nextMetadataJson) return;
      this.db.prepare(`
        UPDATE sorting_cards
        SET metadata_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `).run(nextMetadataJson, now(), card.id, workspaceId);
      cardMetadataChanged = true;
    });

    return {
      metadata,
      changed: metadataChanged || cardMetadataChanged,
    };
  }

  ensureSortingWorkspace() {
    let workspace = this.db.prepare(`
      SELECT id, stream_id AS streamId, title, active_box_id AS activeBoxId, metadata_json AS metadataJson
      FROM sorting_workspaces
      WHERE stream_id = ?
      LIMIT 1
    `).get(DEFAULT_SORTING_WORKSPACE_STREAM_ID);

    if (!workspace) {
      workspace = this.createFreshSortingWorkspace(this.getInitialSortingSourceSelection());
    }

    const metadata = normalizeSortingWorkspaceMetadata(
      safeJsonParse(workspace.metadataJson, null),
      this.getInitialSortingSourceSelection(),
    );
    const metadataJson = safeJsonStringify(metadata);

    this.db.prepare(`
      UPDATE sorting_workspaces
      SET metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(metadataJson, now(), workspace.id);

    this.ensureDefaultSortingStructure(workspace.id);
    const normalizedWorkspace = this.db.prepare(`
      SELECT id, metadata_json AS metadataJson
      FROM sorting_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(workspace.id);
    const synchronizedLayers = this.synchronizeSortingWorkspaceLayers(
      workspace.id,
      safeJsonParse(normalizedWorkspace?.metadataJson, null),
    );
    if (synchronizedLayers.changed) {
      this.db.prepare(`
        UPDATE sorting_workspaces
        SET metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(safeJsonStringify(synchronizedLayers.metadata), now(), workspace.id);
    }
    const refreshedWorkspace = this.db.prepare(`
      SELECT id, stream_id AS streamId, title, active_box_id AS activeBoxId, metadata_json AS metadataJson
      FROM sorting_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(workspace.id);

    return {
      ...refreshedWorkspace,
      metadataJson: refreshedWorkspace?.metadataJson || metadataJson,
    };
  }

  rewriteCardColumnSortOrder(columnId, itemIds) {
    itemIds.forEach((itemId, index) => {
      this.db.prepare(`
        UPDATE sorting_cards
        SET sort_order = ?, updated_at = ?
        WHERE id = ? AND layer_id = ?
      `).run(index, now(), itemId, columnId);
    });
  }

  rewriteSortingColumnSortOrder(workspaceId, boxId, columnIds) {
    columnIds.forEach((columnId, index) => {
      this.db.prepare(`
        UPDATE sorting_layers
        SET sort_order = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND box_id = ?
      `).run(index, now(), columnId, workspaceId, boxId);
    });
  }

  getSortingWorkspace() {
    const workspace = this.ensureSortingWorkspace();
    const workspaceMetadata = normalizeSortingWorkspaceMetadata(
      safeJsonParse(workspace.metadataJson, null),
      this.getInitialSortingSourceSelection(),
    );
    const activeBoxSourceSelection = resolveSortingBoxSourceSelection(
      workspaceMetadata.boxSourceSelections,
      workspace.activeBoxId,
      {
        selectedSourceIds: workspaceMetadata.selectedSourceIds,
        focusedSourceId: workspaceMetadata.focusedSourceId,
        sourceViewMode: workspaceMetadata.sourceViewMode,
      },
    );
    const boxes = this.db.prepare(`
      SELECT id, name, tone, description
      FROM sorting_boxes
      WHERE workspace_id = ?
      ORDER BY sort_order ASC
    `).all(workspace.id);
    const columnRows = this.db.prepare(`
      SELECT id, box_id AS boxId, name, kind, system_key AS systemKey, sort_order AS sortOrder
      FROM sorting_layers
      WHERE workspace_id = ?
      ORDER BY CASE WHEN system_key = 'luggage' THEN 1 ELSE 0 END ASC, sort_order ASC
    `).all(workspace.id);
    const cards = this.db.prepare(`
      SELECT
        id,
        layer_id AS columnId,
        type,
        box_ref_id AS childBoxId,
        source_bubble_id AS sourceBubbleId,
        title,
        content,
        raw_message_json AS rawMessageJson,
        source_ids_json AS sourceIdsJson,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM sorting_cards
      WHERE workspace_id = ?
      ORDER BY layer_id ASC, sort_order ASC, created_at ASC
    `).all(workspace.id);
    const canvasNodes = this.db.prepare(`
      SELECT
        id,
        box_id AS boxId,
        card_id AS cardId,
        x,
        y,
        width,
        height,
        z_index AS zIndex
      FROM sorting_canvas_nodes
      WHERE workspace_id = ?
      ORDER BY z_index ASC, updated_at ASC
    `).all(workspace.id);
    const columnsByBoxId = {};
    columnRows.forEach((column) => {
      if (!column.boxId) return;
      if (!columnsByBoxId[column.boxId]) {
        columnsByBoxId[column.boxId] = [];
      }
      columnsByBoxId[column.boxId].push(column);
    });

    const boxLayersByBoxId = {};
    const resolvedColumnLayerBindings = {};
    boxes.forEach((box) => {
      const boxLayers = resolveSortingBoxLayers(workspaceMetadata.boxLayers, box.id);
      boxLayersByBoxId[box.id] = boxLayers;
      Object.assign(
        resolvedColumnLayerBindings,
        resolveSortingColumnLayerBindings(
          workspaceMetadata.columnLayerBindings,
          columnsByBoxId[box.id] || [],
          boxLayers,
        ),
      );
    });

    const activeBoxLayerIds = (boxLayersByBoxId[workspace.activeBoxId] || [])
      .map((layer) => layer.id);
    const activeLayerSelection = resolveSortingBoxLayerSelection(
      workspaceMetadata.boxLayerSelections,
      workspace.activeBoxId,
      activeBoxLayerIds,
    );

    const columnItems = {};
    columnRows.forEach((column) => {
      columnItems[column.id] = [];
    });

    const itemMap = {};
    cards.forEach((card) => {
      if (!columnItems[card.columnId]) {
        columnItems[card.columnId] = [];
      }
      columnItems[card.columnId].push(card.id);
      const rawMetadata = this.repairSortingCardMetadataFileTargets(
        normalizeSortingCardMetadata(safeJsonParse(card.metadataJson, null)),
        { referenceTimestamp: card.updatedAt || card.createdAt || null },
      );
      const resolvedLayerId = resolveSortingCardLayerId(
        rawMetadata,
        resolvedColumnLayerBindings[card.columnId] || [],
      );
      const metadata = withSortingCardLayerId(rawMetadata, resolvedLayerId);
      itemMap[card.id] = {
        id: card.id,
        columnId: card.columnId,
        layerId: resolvedLayerId,
        type: card.type,
        childBoxId: card.childBoxId || undefined,
        sourceBubbleId: card.sourceBubbleId || undefined,
        sourceStreamId: metadata?.sourceStreamId || undefined,
        title: card.title || undefined,
        content: card.content || undefined,
        rawMessage: card.rawMessageJson
          ? this.repairMessageFileTargets(
            safeJsonParse(card.rawMessageJson, null),
            { referenceTimestamp: card.updatedAt || card.createdAt || null },
          )
          : undefined,
        sourceIds: safeJsonParse(card.sourceIdsJson, []),
        metadata,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      };
    });

    return {
      workspaceId: workspace.id,
      title: workspace.title,
      activeBoxId: workspace.activeBoxId,
      luggageColumnId: columnRows.find((column) => column.systemKey === SORTING_LUGGAGE_COLUMN_KEY)?.id || null,
      sidebarSectionLayout: workspaceMetadata.sidebarSectionLayout,
      selectedSourceIds: activeBoxSourceSelection.selectedSourceIds,
      focusedSourceId: activeBoxSourceSelection.focusedSourceId,
      sourceViewMode: activeBoxSourceSelection.sourceViewMode,
      boxSourceSelections: normalizeSortingBoxSourceSelectionsMap(workspaceMetadata.boxSourceSelections),
      selectedLayerIds: activeLayerSelection.selectedLayerIds,
      currentLayerId: activeLayerSelection.currentLayerId,
      boxes: boxes.map((box) => ({
        ...box,
        viewMode: normalizeSortingBoxViewMode(workspaceMetadata.boxViewModes?.[box.id]),
        botBindings: workspaceMetadata.boxBotBindings?.[box.id] || {},
      })),
      layers: boxes.flatMap((box) => boxLayersByBoxId[box.id] || []),
      columns: columnRows.map((column) => {
        const layerIds = column.boxId
          ? (resolvedColumnLayerBindings[column.id] || [])
          : [];
        return {
          id: column.id,
          boxId: column.boxId,
          boundLayerIds: layerIds,
          name: column.name,
          kind: column.kind,
          systemKey: column.systemKey,
          sortOrder: column.sortOrder,
        };
      }),
      columnItems,
      itemMap,
      canvasNodes,
      canvasEdges: Object.entries(workspaceMetadata.boxCanvasEdges || {}).flatMap(([boxId, edges]) => (
        normalizeSortingCanvasEdgeList(edges).map((edge) => ({
          ...edge,
          boxId,
        }))
      )),
    };
  }

  saveSortingWorkspace(payload) {
    const workspace = this.ensureSortingWorkspace();
    const currentMetadata = normalizeSortingWorkspaceMetadata(
      safeJsonParse(workspace.metadataJson, null),
      this.getInitialSortingSourceSelection(),
    );
    const nextActiveBoxId = typeof payload.activeBoxId === 'string' && payload.activeBoxId.trim()
      ? payload.activeBoxId.trim()
      : workspace.activeBoxId;
    const fallbackSourceSelection = normalizeSortingSourceSelection(
      {
        selectedSourceIds: currentMetadata.selectedSourceIds,
        focusedSourceId: currentMetadata.focusedSourceId,
        sourceViewMode: currentMetadata.sourceViewMode,
      },
      this.getInitialSortingSourceSelection(),
    );
    const hasSourceSelectionPatch = (
      payload.selectedSourceIds !== undefined
      || payload.focusedSourceId !== undefined
      || payload.sourceViewMode !== undefined
    );
    const sourceSelectionBoxId = typeof payload.sourceSelectionBoxId === 'string' && payload.sourceSelectionBoxId.trim()
      ? payload.sourceSelectionBoxId.trim()
      : nextActiveBoxId;
    let nextBoxSourceSelections = normalizeSortingBoxSourceSelectionsMap(currentMetadata.boxSourceSelections);
    if (hasSourceSelectionPatch && sourceSelectionBoxId) {
      const currentBoxSourceSelection = resolveSortingBoxSourceSelection(
        nextBoxSourceSelections,
        sourceSelectionBoxId,
        fallbackSourceSelection,
      );
      nextBoxSourceSelections = {
        ...nextBoxSourceSelections,
        [sourceSelectionBoxId]: normalizeSortingSourceSelection(
          {
            selectedSourceIds: payload.selectedSourceIds !== undefined
              ? payload.selectedSourceIds
              : currentBoxSourceSelection.selectedSourceIds,
            focusedSourceId: payload.focusedSourceId !== undefined
              ? payload.focusedSourceId
              : currentBoxSourceSelection.focusedSourceId,
            sourceViewMode: payload.sourceViewMode !== undefined
              ? payload.sourceViewMode
              : currentBoxSourceSelection.sourceViewMode,
          },
          currentBoxSourceSelection.selectedSourceIds,
        ),
      };
    }
    const activeBoxSourceSelection = resolveSortingBoxSourceSelection(
      nextBoxSourceSelections,
      nextActiveBoxId,
      fallbackSourceSelection,
    );
    const metadata = normalizeSortingWorkspaceMetadata(
      {
        ...currentMetadata,
        selectedSourceIds: activeBoxSourceSelection.selectedSourceIds,
        focusedSourceId: activeBoxSourceSelection.focusedSourceId,
        sourceViewMode: activeBoxSourceSelection.sourceViewMode,
        boxSourceSelections: nextBoxSourceSelections,
        sidebarSectionLayout: payload.sidebarSectionLayout !== undefined
          ? payload.sidebarSectionLayout
          : currentMetadata.sidebarSectionLayout,
        boxLayerSelections: payload.boxLayerSelections !== undefined ? payload.boxLayerSelections : currentMetadata.boxLayerSelections,
      },
      activeBoxSourceSelection.selectedSourceIds.length > 0
        ? activeBoxSourceSelection.selectedSourceIds
        : this.getInitialSortingSourceSelection(),
    );
    this.db.prepare(`
      UPDATE sorting_workspaces
      SET title = ?, active_box_id = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.title || workspace.title,
      nextActiveBoxId,
      safeJsonStringify(metadata),
      now(),
      workspace.id,
    );
    return this.getSortingWorkspace();
  }

  moveSorting(payload) {
    const workspace = this.ensureSortingWorkspace();

    if (payload.action === 'reorder-columns') {
      const rows = this.db.prepare(`
        SELECT id
        FROM sorting_layers
        WHERE workspace_id = ? AND box_id = ?
        ORDER BY sort_order ASC
      `).all(workspace.id, payload.boxId);
      const fullColumnIds = rows.map((row) => row.id);
      const visibleColumnIds = normalizeStringArray(payload.visibleColumnIds)
        .filter((columnId) => fullColumnIds.includes(columnId));
      const orderedVisibleColumnIds = visibleColumnIds.length > 0 ? visibleColumnIds : fullColumnIds.slice();
      const [moved] = orderedVisibleColumnIds.splice(payload.sourceIndex, 1);
      orderedVisibleColumnIds.splice(payload.destinationIndex, 0, moved);
      const visibleIdSet = new Set(orderedVisibleColumnIds);
      let visibleCursor = 0;
      const nextColumnIds = fullColumnIds.map((columnId) => (
        visibleIdSet.has(columnId)
          ? orderedVisibleColumnIds[visibleCursor++]
          : columnId
      ));
      this.rewriteSortingColumnSortOrder(workspace.id, payload.boxId, nextColumnIds);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'project-bubble') {
      const conversationId = payload.sourceStreamId || payload.streamId;
      const conversation = this.getConversation(conversationId);
      const bubble = conversation?.messages.find((item) => item.id === payload.sourceBubbleId);
      if (!bubble) {
        throw new Error(`Bubble not found: ${payload.sourceBubbleId}`);
      }
      const destinationColumn = this.db.prepare(`
        SELECT id, box_id AS boxId
        FROM sorting_layers
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(payload.columnId, workspace.id);
      if (!destinationColumn) {
        throw new Error(`Sorting column not found: ${payload.columnId}`);
      }
      const destinationIds = this.db.prepare(`
        SELECT id
        FROM sorting_cards
        WHERE workspace_id = ? AND layer_id = ?
        ORDER BY sort_order ASC
      `).all(workspace.id, payload.columnId).map((row) => row.id);
      const cardId = `card_${crypto.randomUUID()}`;
      const sourceRef = conversationId ? `${conversationId}:${bubble.id}` : bubble.id;
      const workspaceMetadata = normalizeSortingWorkspaceMetadata(
        safeJsonParse(workspace.metadataJson, null),
        this.getInitialSortingSourceSelection(),
      );
      const ensuredDestination = ensureSortingColumnBoundToLayer(
        workspaceMetadata,
        destinationColumn,
        payload.layerId,
      );
      const nextWorkspaceMetadata = ensuredDestination.metadata;
      const destinationLayerIds = destinationColumn.boxId
        ? resolveSortingColumnLayerBindings(
          nextWorkspaceMetadata.columnLayerBindings,
          [destinationColumn],
          resolveSortingBoxLayers(nextWorkspaceMetadata.boxLayers, destinationColumn.boxId),
        )[payload.columnId] || []
        : [];
      const cardLayerId = resolveSortingCardLayerId(
        { layerId: payload.layerId },
        destinationLayerIds,
      );
      const projectedCardKind = resolveSortingColumnDropCardKind(
        nextWorkspaceMetadata.columnDropCardKinds,
        payload.columnId,
      );
      const metadata = withSortingTodoDueAt(
        withSortingTodoPriority(
          withSortingTodoStatus(withSortingCardKind(withSortingCardLayerId({
            projectedFrom: bubble.id,
            sourceStreamId: conversationId || null,
            sourceLabel: conversation?.title || null,
          }, cardLayerId), projectedCardKind), null, projectedCardKind),
          null,
          projectedCardKind,
        ),
        null,
        projectedCardKind,
      );
      destinationIds.splice(payload.destinationIndex, 0, cardId);
      this.db.prepare(`
        INSERT INTO sorting_cards (
          id, workspace_id, layer_id, type, box_ref_id, source_bubble_id, title, content,
          raw_message_json, source_ids_json, metadata_json, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cardId,
        workspace.id,
        payload.columnId,
        'card',
        null,
        bubble.id,
        null,
        null,
        safeJsonStringify(bubble),
        safeJsonStringify([sourceRef]),
        safeJsonStringify(metadata),
        payload.destinationIndex,
        now(),
        now(),
      );
      if (ensuredDestination.changed) {
        this.db.prepare(`
          UPDATE sorting_workspaces
          SET metadata_json = ?, updated_at = ?
          WHERE id = ?
        `).run(safeJsonStringify(nextWorkspaceMetadata), now(), workspace.id);
      }
      this.rewriteCardColumnSortOrder(payload.columnId, destinationIds);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'move-card') {
      const sourceColumn = this.db.prepare(`
        SELECT id, box_id AS boxId
        FROM sorting_layers
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(payload.sourceColumnId, workspace.id);
      const destinationColumn = this.db.prepare(`
        SELECT id, box_id AS boxId
        FROM sorting_layers
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(payload.destinationColumnId, workspace.id);
      if (!sourceColumn || !destinationColumn) {
        throw new Error(`Sorting column not found: ${!sourceColumn ? payload.sourceColumnId : payload.destinationColumnId}`);
      }
      const cardRow = this.db.prepare(`
        SELECT metadata_json AS metadataJson
        FROM sorting_cards
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(payload.cardId, workspace.id);
      const workspaceMetadata = normalizeSortingWorkspaceMetadata(
        safeJsonParse(workspace.metadataJson, null),
        this.getInitialSortingSourceSelection(),
      );
      const ensuredDestination = ensureSortingColumnBoundToLayer(
        workspaceMetadata,
        destinationColumn,
        payload.layerId,
      );
      const nextWorkspaceMetadata = ensuredDestination.metadata;
      const sourceLayerIds = sourceColumn.boxId
        ? resolveSortingColumnLayerBindings(
          nextWorkspaceMetadata.columnLayerBindings,
          [sourceColumn],
          resolveSortingBoxLayers(nextWorkspaceMetadata.boxLayers, sourceColumn.boxId),
        )[payload.sourceColumnId] || []
        : [];
      const destinationLayerIds = destinationColumn.boxId
        ? resolveSortingColumnLayerBindings(
          nextWorkspaceMetadata.columnLayerBindings,
          [destinationColumn],
          resolveSortingBoxLayers(nextWorkspaceMetadata.boxLayers, destinationColumn.boxId),
        )[payload.destinationColumnId] || []
        : [];
      const currentCardMetadata = normalizeSortingCardMetadata(safeJsonParse(cardRow?.metadataJson, null));
      const currentCardLayerId = resolveSortingCardLayerId(currentCardMetadata, sourceLayerIds);
      const currentCardKind = extractSortingCardKind(currentCardMetadata);
      const nextCardLayerId = destinationLayerIds.length > 0
        ? resolveSortingCardLayerId(
          { layerId: payload.layerId || currentCardLayerId },
          destinationLayerIds,
        )
        : (typeof payload.layerId === 'string' && payload.layerId.trim()
          ? payload.layerId.trim()
          : currentCardLayerId);
      const nextCardKind = payload.sourceColumnId === payload.destinationColumnId
        ? currentCardKind
        : (
          resolveSortingColumnDropCardKind(
            nextWorkspaceMetadata.columnDropCardKinds,
            payload.destinationColumnId,
          ) || currentCardKind
        );
      const nextCardMetadata = withSortingCardKind(
        withSortingCardLayerId(currentCardMetadata, nextCardLayerId),
        nextCardKind,
      );
      const finalCardMetadata = withSortingTodoStatus(
        nextCardMetadata,
        extractSortingTodoStatus(currentCardMetadata),
        nextCardKind,
      );
      const nextCardMetadataWithPriority = withSortingTodoPriority(
        finalCardMetadata,
        extractSortingTodoPriority(currentCardMetadata),
        nextCardKind,
      );
      const finalCardMetadataWithDueAt = withSortingTodoDueAt(
        nextCardMetadataWithPriority,
        extractSortingTodoDueAt(currentCardMetadata),
        nextCardKind,
      );
      const sourceIds = this.db.prepare(`
        SELECT id
        FROM sorting_cards
        WHERE workspace_id = ? AND layer_id = ?
        ORDER BY sort_order ASC
      `).all(workspace.id, payload.sourceColumnId).map((row) => row.id);
      const destinationIds = payload.sourceColumnId === payload.destinationColumnId
        ? sourceIds
        : this.db.prepare(`
          SELECT id
          FROM sorting_cards
          WHERE workspace_id = ? AND layer_id = ?
          ORDER BY sort_order ASC
        `).all(workspace.id, payload.destinationColumnId).map((row) => row.id);

      const movedIndex = sourceIds.indexOf(payload.cardId);
      if (movedIndex === -1) {
        throw new Error(`Sorting card not found: ${payload.cardId}`);
      }
      sourceIds.splice(movedIndex, 1);
      destinationIds.splice(payload.destinationIndex, 0, payload.cardId);

      if (
        payload.sourceColumnId !== payload.destinationColumnId
        || nextCardLayerId !== currentCardLayerId
        || nextCardKind !== currentCardKind
      ) {
        this.db.prepare(`
          UPDATE sorting_cards
          SET layer_id = ?, metadata_json = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `).run(
          payload.destinationColumnId,
          safeJsonStringify(finalCardMetadataWithDueAt),
          now(),
          payload.cardId,
          workspace.id,
        );
      }
      if (ensuredDestination.changed) {
        this.db.prepare(`
          UPDATE sorting_workspaces
          SET metadata_json = ?, updated_at = ?
          WHERE id = ?
        `).run(safeJsonStringify(nextWorkspaceMetadata), now(), workspace.id);
      }
      if (payload.sourceColumnId !== payload.destinationColumnId) {
        this.rewriteCardColumnSortOrder(payload.sourceColumnId, sourceIds);
      }

      this.rewriteCardColumnSortOrder(payload.destinationColumnId, destinationIds);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'remove-card') {
      this.db.prepare(`
        DELETE FROM sorting_canvas_nodes
        WHERE workspace_id = ? AND card_id = ?
      `).run(workspace.id, payload.cardId);
      this.db.prepare(`
        DELETE FROM sorting_cards
        WHERE id = ? AND workspace_id = ?
      `).run(payload.cardId, workspace.id);
      const remainingIds = this.db.prepare(`
        SELECT id
        FROM sorting_cards
        WHERE workspace_id = ? AND layer_id = ?
        ORDER BY sort_order ASC
      `).all(workspace.id, payload.columnId).map((row) => row.id);
      this.rewriteCardColumnSortOrder(payload.columnId, remainingIds);

      const metadata = normalizeSortingWorkspaceMetadata(
        safeJsonParse(workspace.metadataJson, null),
        this.getInitialSortingSourceSelection(),
      );
      const { nextMap, changed } = removeSortingCanvasEdgesByCardIds(
        metadata.boxCanvasEdges,
        new Set([payload.cardId]),
      );
      if (changed) {
        metadata.boxCanvasEdges = nextMap;
        this.db.prepare(`
          UPDATE sorting_workspaces
          SET metadata_json = ?, updated_at = ?
          WHERE id = ?
        `).run(safeJsonStringify(metadata), now(), workspace.id);
      }
      return this.getSortingWorkspace();
    }

    throw new Error(`Unsupported sorting move action: ${payload.action}`);
  }

  updateSorting(payload) {
    const workspace = this.ensureSortingWorkspace();

    const getWorkspaceMetadata = () => normalizeSortingWorkspaceMetadata(
      safeJsonParse(workspace.metadataJson, null),
      this.getInitialSortingSourceSelection(),
    );

    const updateWorkspaceMetadata = (nextMetadata) => {
      this.db.prepare(`
        UPDATE sorting_workspaces
        SET metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(safeJsonStringify(nextMetadata), now(), workspace.id);
    };

    if (payload.action === 'set-active-box') {
      return this.saveSortingWorkspace({
        activeBoxId: payload.boxId,
      });
    }

    if (payload.action === 'set-source-selection') {
      const metadata = getWorkspaceMetadata();
      const boxId = typeof payload.boxId === 'string' && payload.boxId.trim()
        ? payload.boxId.trim()
        : workspace.activeBoxId;
      const currentSelection = resolveSortingBoxSourceSelection(
        metadata.boxSourceSelections,
        boxId,
        {
          selectedSourceIds: metadata.selectedSourceIds,
          focusedSourceId: metadata.focusedSourceId,
          sourceViewMode: metadata.sourceViewMode,
        },
      );
      const nextSourceIds = normalizeStringArray(payload.sourceIds);
      const nextFocusedSourceId = nextSourceIds.includes(currentSelection.focusedSourceId)
        ? currentSelection.focusedSourceId
        : nextSourceIds[0] || null;
      return this.saveSortingWorkspace({
        selectedSourceIds: nextSourceIds,
        focusedSourceId: nextFocusedSourceId,
        sourceSelectionBoxId: boxId,
      });
    }

    if (payload.action === 'set-focused-source') {
      const metadata = getWorkspaceMetadata();
      const boxId = typeof payload.boxId === 'string' && payload.boxId.trim()
        ? payload.boxId.trim()
        : workspace.activeBoxId;
      const currentSelection = resolveSortingBoxSourceSelection(
        metadata.boxSourceSelections,
        boxId,
        {
          selectedSourceIds: metadata.selectedSourceIds,
          focusedSourceId: metadata.focusedSourceId,
          sourceViewMode: metadata.sourceViewMode,
        },
      );
      const nextSelectedSourceIds = currentSelection.selectedSourceIds.includes(payload.sourceId)
        ? currentSelection.selectedSourceIds
        : normalizeStringArray([...currentSelection.selectedSourceIds, payload.sourceId]);
      return this.saveSortingWorkspace({
        selectedSourceIds: nextSelectedSourceIds,
        focusedSourceId: payload.sourceId || null,
        sourceSelectionBoxId: boxId,
      });
    }

    if (payload.action === 'set-source-view-mode') {
      return this.saveSortingWorkspace({
        sourceViewMode: SORTING_SOURCE_VIEW_MODES.has(payload.viewMode) ? payload.viewMode : 'focused',
        sourceSelectionBoxId: typeof payload.boxId === 'string' && payload.boxId.trim()
          ? payload.boxId.trim()
          : workspace.activeBoxId,
      });
    }

    if (payload.action === 'set-box-view') {
      const metadata = getWorkspaceMetadata();
      metadata.boxViewModes = {
        ...(metadata.boxViewModes || {}),
        [payload.boxId]: normalizeSortingBoxViewMode(payload.viewMode),
      };
      updateWorkspaceMetadata(metadata);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'set-box-bot-binding') {
      const boxId = typeof payload.boxId === 'string' ? payload.boxId.trim() : '';
      const botId = typeof payload.botId === 'string' ? payload.botId.trim() : '';
      if (!boxId || !botId) {
        throw new Error('boxId and botId are required for set-box-bot-binding');
      }

      const metadata = getWorkspaceMetadata();
      const nextBoxBindings = normalizeSortingBoxBotBindingsMap(metadata.boxBotBindings);
      const currentBoxBindings = {
        ...(nextBoxBindings[boxId] || {}),
      };

      if (payload.enabled === false) {
        delete currentBoxBindings[botId];
      } else {
        currentBoxBindings[botId] = normalizeSortingScopedBotBinding({
          enabled: payload.enabled,
          triggerMode: payload.triggerMode,
          outputMode: payload.outputMode,
          alias: payload.alias,
          metadata: payload.metadata,
        });
      }

      if (Object.keys(currentBoxBindings).length > 0) {
        nextBoxBindings[boxId] = currentBoxBindings;
      } else {
        delete nextBoxBindings[boxId];
      }

      metadata.boxBotBindings = nextBoxBindings;
      updateWorkspaceMetadata(metadata);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'set-box-layer-selection') {
      const boxId = typeof payload.boxId === 'string' ? payload.boxId.trim() : '';
      if (!boxId) {
        throw new Error('boxId is required for set-box-layer-selection');
      }

      const metadata = getWorkspaceMetadata();
      const layerIds = resolveSortingBoxLayers(metadata.boxLayers, boxId).map((layer) => layer.id);
      const nextSelections = {
        ...(metadata.boxLayerSelections || {}),
        [boxId]: {
          selectedLayerIds: payload.selectedLayerIds,
          currentLayerId: payload.currentLayerId ?? payload.focusedLayerId,
        },
      };
      const nextSelection = resolveSortingBoxLayerSelection(nextSelections, boxId, layerIds);
      const normalizedSelections = normalizeSortingBoxLayerSelectionsMap(metadata.boxLayerSelections);

      if (isDefaultSortingBoxLayerSelection(nextSelection, layerIds)) {
        delete normalizedSelections[boxId];
      } else if (nextSelection.selectedLayerIds.length > 0) {
        normalizedSelections[boxId] = nextSelection;
      } else {
        delete normalizedSelections[boxId];
      }

      metadata.boxLayerSelections = normalizedSelections;
      updateWorkspaceMetadata(metadata);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'add-layer') {
      const boxId = typeof payload.boxId === 'string' ? payload.boxId.trim() : '';
      if (!boxId) {
        throw new Error('boxId is required for add-layer');
      }

      const metadata = getWorkspaceMetadata();
      const currentLayers = resolveSortingBoxLayers(metadata.boxLayers, boxId);
      const layerId = `sl_${crypto.randomUUID()}`;
      const nextName = typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : `新层${currentLayers.length + 1}`;
      const nextLayers = [
        ...currentLayers,
        {
          id: layerId,
          boxId,
          name: nextName,
          sortOrder: currentLayers.length,
        },
      ];
      metadata.boxLayers = {
        ...(metadata.boxLayers || {}),
        [boxId]: nextLayers,
      };

      const currentSelection = resolveSortingBoxLayerSelection(
        metadata.boxLayerSelections,
        boxId,
        currentLayers.map((layer) => layer.id),
      );
      metadata.boxLayerSelections = {
        ...normalizeSortingBoxLayerSelectionsMap(metadata.boxLayerSelections),
        [boxId]: {
          selectedLayerIds: normalizeStringArray([...currentSelection.selectedLayerIds, layerId]),
          currentLayerId: layerId,
        },
      };
      updateWorkspaceMetadata(metadata);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'rename-layer') {
      const boxId = typeof payload.boxId === 'string' ? payload.boxId.trim() : '';
      const layerId = typeof payload.layerId === 'string' ? payload.layerId.trim() : '';
      const nextName = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!boxId || !layerId || !nextName) {
        throw new Error('boxId, layerId and name are required for rename-layer');
      }

      const metadata = getWorkspaceMetadata();
      const currentLayers = resolveSortingBoxLayers(metadata.boxLayers, boxId);
      if (!currentLayers.some((layer) => layer.id === layerId)) {
        throw new Error(`Sorting layer not found: ${layerId}`);
      }
      const nextLayers = currentLayers.map((layer) => (
        layer.id === layerId
          ? { ...layer, name: nextName }
          : layer
      ));
      metadata.boxLayers = {
        ...(metadata.boxLayers || {}),
        [boxId]: nextLayers,
      };
      updateWorkspaceMetadata(metadata);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'delete-layer') {
      const boxId = typeof payload.boxId === 'string' ? payload.boxId.trim() : '';
      const layerId = typeof payload.layerId === 'string' ? payload.layerId.trim() : '';
      if (!boxId || !layerId) {
        throw new Error('boxId and layerId are required for delete-layer');
      }

      const metadata = getWorkspaceMetadata();
      const currentLayers = resolveSortingBoxLayers(metadata.boxLayers, boxId);
      const boxColumns = this.db.prepare(`
        SELECT id, box_id AS boxId
        FROM sorting_layers
        WHERE workspace_id = ? AND box_id = ?
        ORDER BY sort_order ASC
      `).all(workspace.id, boxId);
      const layerIndex = currentLayers.findIndex((layer) => layer.id === layerId);
      if (layerIndex === -1) {
        throw new Error(`Sorting layer not found: ${layerId}`);
      }
      if (currentLayers.length <= 1) {
        throw new Error('At least one layer must remain.');
      }

      const nextLayers = currentLayers
        .filter((layer) => layer.id !== layerId)
        .map((layer, index) => ({ ...layer, sortOrder: index }));
      const fallbackLayer = nextLayers[Math.max(0, layerIndex - 1)] || nextLayers[0];
      const currentBindings = resolveSortingColumnLayerBindings(
        metadata.columnLayerBindings,
        boxColumns,
        currentLayers,
      );
      const nextBindings = normalizeSortingColumnLayerBindings(metadata.columnLayerBindings);
      Object.keys(nextBindings).forEach((columnId) => {
        const nextLayerIds = normalizeStringArray(
          (nextBindings[columnId] || []).filter((boundLayerId) => boundLayerId !== layerId),
        );
        if (nextLayerIds.length === 0 && fallbackLayer?.id) {
          nextLayerIds.push(fallbackLayer.id);
        }
        nextBindings[columnId] = nextLayerIds;
      });

      const normalizedSelections = normalizeSortingBoxLayerSelectionsMap(metadata.boxLayerSelections);
      const currentSelection = resolveSortingBoxLayerSelection(
        normalizedSelections,
        boxId,
        currentLayers.map((layer) => layer.id),
      );
      const rawNextSelection = {
        selectedLayerIds: currentSelection.selectedLayerIds.filter((selectedId) => selectedId !== layerId),
        currentLayerId: currentSelection.currentLayerId === layerId
          ? fallbackLayer.id
          : currentSelection.currentLayerId,
      };
      const nextSelection = resolveSortingBoxLayerSelection(
        { ...normalizedSelections, [boxId]: rawNextSelection },
        boxId,
        nextLayers.map((layer) => layer.id),
      );

      metadata.boxLayers = {
        ...(metadata.boxLayers || {}),
        [boxId]: nextLayers,
      };
      metadata.columnLayerBindings = nextBindings;
      if (isDefaultSortingBoxLayerSelection(nextSelection, nextLayers.map((layer) => layer.id))) {
        delete normalizedSelections[boxId];
      } else {
        normalizedSelections[boxId] = nextSelection;
      }
      metadata.boxLayerSelections = normalizedSelections;

      const boxColumnIds = boxColumns.map((column) => column.id);
      const relatedCards = boxColumnIds.length > 0
        ? this.db.prepare(`
          SELECT id, layer_id AS columnId, metadata_json AS metadataJson
          FROM sorting_cards
          WHERE workspace_id = ? AND layer_id IN (${boxColumnIds.map(() => '?').join(',')})
        `).all(workspace.id, ...boxColumnIds)
        : [];

      this.db.exec('BEGIN IMMEDIATE');
      try {
        updateWorkspaceMetadata(metadata);
        relatedCards.forEach((card) => {
          const currentCardMetadata = normalizeSortingCardMetadata(safeJsonParse(card.metadataJson, null));
          const currentCardLayerId = resolveSortingCardLayerId(
            currentCardMetadata,
            currentBindings[card.columnId] || [],
          );
          if (currentCardLayerId !== layerId) return;
          const nextCardLayerId = (nextBindings[card.columnId] || [fallbackLayer.id])[0] || fallbackLayer.id;
          this.db.prepare(`
            UPDATE sorting_cards
            SET metadata_json = ?, updated_at = ?
            WHERE id = ? AND workspace_id = ?
          `).run(
            safeJsonStringify(withSortingCardLayerId(currentCardMetadata, nextCardLayerId)),
            now(),
            card.id,
            workspace.id,
          );
        });
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      return this.getSortingWorkspace();
    }

    if (payload.action === 'move-column-layer') {
      const boxId = typeof payload.boxId === 'string' ? payload.boxId.trim() : '';
      const columnId = typeof payload.columnId === 'string' ? payload.columnId.trim() : '';
      const layerId = typeof payload.layerId === 'string' ? payload.layerId.trim() : '';
      if (!boxId || !columnId || !layerId) {
        throw new Error('boxId, columnId and layerId are required for move-column-layer');
      }

      const metadata = getWorkspaceMetadata();
      const boxLayers = resolveSortingBoxLayers(metadata.boxLayers, boxId);
      if (!boxLayers.some((layer) => layer.id === layerId)) {
        throw new Error(`Sorting layer not found: ${layerId}`);
      }
      const columnRow = this.db.prepare(`
        SELECT id
        FROM sorting_layers
        WHERE id = ? AND workspace_id = ? AND box_id = ?
        LIMIT 1
      `).get(columnId, workspace.id, boxId);
      if (!columnRow) {
        throw new Error(`Sorting column not found in box: ${columnId}`);
      }

      const nextBindings = normalizeSortingColumnLayerBindings(metadata.columnLayerBindings);
      nextBindings[columnId] = normalizeStringArray([...(nextBindings[columnId] || []), layerId]);
      metadata.columnLayerBindings = nextBindings;

      const normalizedSelections = normalizeSortingBoxLayerSelectionsMap(metadata.boxLayerSelections);
      const currentSelection = resolveSortingBoxLayerSelection(
        normalizedSelections,
        boxId,
        boxLayers.map((layer) => layer.id),
      );
      normalizedSelections[boxId] = {
        selectedLayerIds: normalizeStringArray([...currentSelection.selectedLayerIds, layerId]),
        currentLayerId: layerId,
      };
      metadata.boxLayerSelections = normalizedSelections;
      updateWorkspaceMetadata(metadata);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'create-box-shortcut') {
      const childBoxId = typeof payload.childBoxId === 'string' ? payload.childBoxId.trim() : '';
      const columnId = typeof payload.columnId === 'string' ? payload.columnId.trim() : '';
      if (!childBoxId || !columnId) {
        throw new Error('childBoxId and columnId are required for create-box-shortcut');
      }

      const destinationColumn = this.db.prepare(`
        SELECT id, box_id AS boxId
        FROM sorting_layers
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(columnId, workspace.id);
      if (!destinationColumn) {
        throw new Error(`Sorting column not found: ${columnId}`);
      }

      const targetBox = this.db.prepare(`
        SELECT id
        FROM sorting_boxes
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(childBoxId, workspace.id);
      if (!targetBox) {
        throw new Error(`Sorting box not found: ${childBoxId}`);
      }
      if (destinationColumn.boxId && destinationColumn.boxId === childBoxId) {
        throw new Error('Cannot create a shortcut to the current box.');
      }

      const destinationIds = this.db.prepare(`
        SELECT id
        FROM sorting_cards
        WHERE workspace_id = ? AND layer_id = ?
        ORDER BY sort_order ASC
      `).all(workspace.id, columnId).map((row) => row.id);
      const destinationIndex = Number.isFinite(payload.destinationIndex)
        ? Math.max(0, Math.min(destinationIds.length, Math.trunc(payload.destinationIndex)))
        : destinationIds.length;
      const workspaceMetadata = getWorkspaceMetadata();
      const ensuredDestination = ensureSortingColumnBoundToLayer(
        workspaceMetadata,
        destinationColumn,
        payload.layerId,
      );
      const nextWorkspaceMetadata = ensuredDestination.metadata;
      const destinationLayerIds = destinationColumn.boxId
        ? resolveSortingColumnLayerBindings(
          nextWorkspaceMetadata.columnLayerBindings,
          [destinationColumn],
          resolveSortingBoxLayers(nextWorkspaceMetadata.boxLayers, destinationColumn.boxId),
        )[columnId] || []
        : [];
      const baseMetadata = normalizeSortingCardMetadata({ boxShortcut: true });
      if (typeof payload.layerId === 'string' && payload.layerId.trim()) {
        baseMetadata.layerId = payload.layerId.trim();
      }
      const cardLayerId = destinationLayerIds.length > 0
        ? resolveSortingCardLayerId(baseMetadata, destinationLayerIds)
        : resolveSortingCardLayerId(baseMetadata, []);
      const cardMetadata = withSortingCardLayerId(baseMetadata, cardLayerId);
      const cardId = `i_${crypto.randomUUID()}`;
      const timestamp = now();

      destinationIds.splice(destinationIndex, 0, cardId);
      this.db.prepare(`
        INSERT INTO sorting_cards (
          id, workspace_id, layer_id, type, box_ref_id, source_bubble_id, title, content,
          raw_message_json, source_ids_json, metadata_json, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cardId,
        workspace.id,
        columnId,
        'box',
        childBoxId,
        null,
        null,
        null,
        null,
        safeJsonStringify([]),
        safeJsonStringify(cardMetadata),
        destinationIndex,
        timestamp,
        timestamp,
      );
      if (ensuredDestination.changed) {
        updateWorkspaceMetadata(nextWorkspaceMetadata);
      }
      this.rewriteCardColumnSortOrder(columnId, destinationIds);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'create-box') {
      this.createSortingBox(workspace.id, payload);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'rename-box') {
      const nextName = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!nextName) {
        throw new Error('Box name is required');
      }
      this.db.prepare(`
        UPDATE sorting_boxes
        SET name = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `).run(nextName, now(), payload.boxId, workspace.id);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'delete-box') {
      const boxRow = this.db.prepare(`
        SELECT id, name
        FROM sorting_boxes
        WHERE id = ? AND workspace_id = ?
      `).get(payload.boxId, workspace.id);
      if (!boxRow) {
        throw new Error(`Sorting box not found: ${payload.boxId}`);
      }

      const totalBoxes = this.db.prepare(`
        SELECT COUNT(1) AS count
        FROM sorting_boxes
        WHERE workspace_id = ?
      `).get(workspace.id).count || 0;
      if (totalBoxes <= 1) {
        throw new Error('At least one box must remain.');
      }

      const layerRows = this.db.prepare(`
        SELECT id
        FROM sorting_layers
        WHERE workspace_id = ? AND box_id = ?
      `).all(workspace.id, payload.boxId);
      const parentReference = this.db.prepare(`
        SELECT sorting_layers.box_id AS parentBoxId
        FROM sorting_cards
        INNER JOIN sorting_layers
          ON sorting_layers.id = sorting_cards.layer_id
          AND sorting_layers.workspace_id = sorting_cards.workspace_id
        WHERE sorting_cards.workspace_id = ? AND sorting_cards.box_ref_id = ?
        ORDER BY sorting_layers.sort_order ASC, sorting_cards.sort_order ASC, sorting_cards.created_at ASC
        LIMIT 1
      `).get(workspace.id, payload.boxId);
      const layerIds = layerRows.map((row) => row.id);
      const cardIds = layerIds.length > 0
        ? this.db.prepare(`
          SELECT id
          FROM sorting_cards
          WHERE workspace_id = ? AND layer_id IN (${layerIds.map(() => '?').join(',')})
        `).all(workspace.id, ...layerIds).map((row) => row.id)
        : [];

      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (cardIds.length > 0) {
          this.db.prepare(`
            DELETE FROM sorting_canvas_nodes
            WHERE workspace_id = ? AND card_id IN (${cardIds.map(() => '?').join(',')})
          `).run(workspace.id, ...cardIds);
        }

        if (layerIds.length > 0) {
          this.db.prepare(`
            DELETE FROM sorting_cards
            WHERE workspace_id = ? AND layer_id IN (${layerIds.map(() => '?').join(',')})
          `).run(workspace.id, ...layerIds);
          this.db.prepare(`
            DELETE FROM sorting_layers
            WHERE workspace_id = ? AND id IN (${layerIds.map(() => '?').join(',')})
          `).run(workspace.id, ...layerIds);
        }

        this.db.prepare(`
          DELETE FROM sorting_cards
          WHERE workspace_id = ? AND box_ref_id = ?
        `).run(workspace.id, payload.boxId);

        this.db.prepare(`
          DELETE FROM sorting_canvas_nodes
          WHERE workspace_id = ? AND box_id = ?
        `).run(workspace.id, payload.boxId);

        this.db.prepare(`
          DELETE FROM sorting_boxes
          WHERE id = ? AND workspace_id = ?
        `).run(payload.boxId, workspace.id);

        if (workspace.activeBoxId === payload.boxId) {
          const fallback = parentReference?.parentBoxId
            ? this.db.prepare(`
              SELECT id
              FROM sorting_boxes
              WHERE workspace_id = ? AND id = ?
              LIMIT 1
            `).get(workspace.id, parentReference.parentBoxId)
            : this.db.prepare(`
              SELECT id
              FROM sorting_boxes
              WHERE workspace_id = ?
              ORDER BY sort_order ASC, created_at ASC
              LIMIT 1
            `).get(workspace.id);
          this.db.prepare(`
            UPDATE sorting_workspaces
            SET active_box_id = ?, updated_at = ?
            WHERE id = ?
          `).run(fallback?.id || workspace.activeBoxId, now(), workspace.id);
        }

        const metadata = getWorkspaceMetadata();
        let metadataChanged = false;
        if (metadata.boxViewModes && typeof metadata.boxViewModes === 'object' && metadata.boxViewModes[payload.boxId]) {
          delete metadata.boxViewModes[payload.boxId];
          metadataChanged = true;
        }
        if (metadata.boxSourceSelections && typeof metadata.boxSourceSelections === 'object' && metadata.boxSourceSelections[payload.boxId]) {
          delete metadata.boxSourceSelections[payload.boxId];
          metadataChanged = true;
        }
        if (metadata.boxCanvasEdges && typeof metadata.boxCanvasEdges === 'object' && metadata.boxCanvasEdges[payload.boxId]) {
          delete metadata.boxCanvasEdges[payload.boxId];
          metadataChanged = true;
        }
        if (metadata.boxLayerSelections && typeof metadata.boxLayerSelections === 'object' && metadata.boxLayerSelections[payload.boxId]) {
          delete metadata.boxLayerSelections[payload.boxId];
          metadataChanged = true;
        }
        if (metadata.boxBotBindings && typeof metadata.boxBotBindings === 'object' && metadata.boxBotBindings[payload.boxId]) {
          delete metadata.boxBotBindings[payload.boxId];
          metadataChanged = true;
        }
        if (metadata.boxLayers && typeof metadata.boxLayers === 'object' && metadata.boxLayers[payload.boxId]) {
          delete metadata.boxLayers[payload.boxId];
          metadataChanged = true;
        }
        if (metadata.columnLayerBindings && typeof metadata.columnLayerBindings === 'object') {
          let removedBinding = false;
          layerIds.forEach((columnId) => {
            if (metadata.columnLayerBindings[columnId]) {
              delete metadata.columnLayerBindings[columnId];
              removedBinding = true;
            }
          });
          if (removedBinding) {
            metadataChanged = true;
          }
        }
        if (metadata.columnDropCardKinds && typeof metadata.columnDropCardKinds === 'object') {
          let removedDropKind = false;
          layerIds.forEach((columnId) => {
            if (metadata.columnDropCardKinds[columnId]) {
              delete metadata.columnDropCardKinds[columnId];
              removedDropKind = true;
            }
          });
          if (removedDropKind) {
            metadataChanged = true;
          }
        }
        const deletedDefaultBoxId = DEFAULT_SORTING_BOXES.find(
          (box) => toSortingEntityId(workspace.id, box.id) === payload.boxId,
        )?.id || null;
        if (deletedDefaultBoxId) {
          const nextDeletedDefaultBoxIds = normalizeDeletedDefaultSortingBoxIds([
            ...(metadata.deletedDefaultBoxIds || []),
            deletedDefaultBoxId,
          ]);
          if (safeJsonStringify(nextDeletedDefaultBoxIds) !== safeJsonStringify(metadata.deletedDefaultBoxIds || [])) {
            metadata.deletedDefaultBoxIds = nextDeletedDefaultBoxIds;
            metadataChanged = true;
          }
        }
        if (metadataChanged) {
          updateWorkspaceMetadata(metadata);
        }

        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }

      return this.getSortingWorkspace();
    }

    if (payload.action === 'add-column') {
      const metadata = getWorkspaceMetadata();
      const boxLayers = resolveSortingBoxLayers(metadata.boxLayers, payload.boxId);
      const targetLayerId = typeof payload.layerId === 'string' && payload.layerId.trim()
        ? payload.layerId.trim()
        : boxLayers[0]?.id || null;
      const existingColumnIds = this.db.prepare(`
        SELECT id
        FROM sorting_layers
        WHERE workspace_id = ? AND box_id = ?
        ORDER BY sort_order ASC
      `).all(workspace.id, payload.boxId).map((row) => row.id);
      const columnId = `l_${crypto.randomUUID()}`;
      const sortOrderRow = this.db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) AS maxSort
        FROM sorting_layers
        WHERE workspace_id = ? AND box_id = ?
      `).get(workspace.id, payload.boxId);
      this.db.prepare(`
        INSERT INTO sorting_layers (
          id, workspace_id, box_id, name, kind, system_key, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        columnId,
        workspace.id,
        payload.boxId,
        payload.name,
        'user',
        null,
        (sortOrderRow?.maxSort || -1) + 1,
        now(),
        now(),
      );
      const nextBindings = normalizeSortingColumnLayerBindings(metadata.columnLayerBindings);
      nextBindings[columnId] = targetLayerId ? [targetLayerId] : [];
      metadata.columnLayerBindings = nextBindings;
      updateWorkspaceMetadata(metadata);
      if (Number.isInteger(payload.insertAtIndex)) {
        const nextColumnIds = [...existingColumnIds];
        const insertAtIndex = Math.max(0, Math.min(nextColumnIds.length, Number(payload.insertAtIndex)));
        nextColumnIds.splice(insertAtIndex, 0, columnId);
        this.rewriteSortingColumnSortOrder(workspace.id, payload.boxId, nextColumnIds);
      }
      return this.getSortingWorkspace();
    }

    if (payload.action === 'rename-column') {
      const columnId = typeof payload.columnId === 'string' && payload.columnId.trim()
        ? payload.columnId.trim()
        : payload.layerId;
      this.db.prepare(`
        UPDATE sorting_layers
        SET name = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `).run(payload.name, now(), columnId, workspace.id);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'set-column-drop-card-kind') {
      return this.getSortingWorkspace();
    }

    if (payload.action === 'set-todo-status') {
      return this.getSortingWorkspace();
    }

    if (payload.action === 'set-todo-properties') {
      return this.getSortingWorkspace();
    }

    if (payload.action === 'delete-column') {
      const columnId = typeof payload.columnId === 'string' && payload.columnId.trim()
        ? payload.columnId.trim()
        : payload.layerId;
      const cardIds = this.db.prepare(`
        SELECT id
        FROM sorting_cards
        WHERE layer_id = ? AND workspace_id = ?
      `).all(columnId, workspace.id).map((row) => row.id);
      cardIds.forEach((cardId) => {
        this.db.prepare(`
          DELETE FROM sorting_canvas_nodes
          WHERE workspace_id = ? AND card_id = ?
        `).run(workspace.id, cardId);
      });
      this.db.prepare(`
        DELETE FROM sorting_cards
        WHERE layer_id = ? AND workspace_id = ?
      `).run(columnId, workspace.id);
      this.db.prepare(`
        DELETE FROM sorting_layers
        WHERE id = ? AND workspace_id = ?
      `).run(columnId, workspace.id);

      const metadata = getWorkspaceMetadata();
      let metadataChanged = false;
      if (cardIds.length > 0) {
        const { nextMap, changed } = removeSortingCanvasEdgesByCardIds(
          metadata.boxCanvasEdges,
          new Set(cardIds),
        );
        if (changed) {
          metadata.boxCanvasEdges = nextMap;
          metadataChanged = true;
        }
      }
      if (metadata.columnLayerBindings?.[columnId]) {
        delete metadata.columnLayerBindings[columnId];
        metadataChanged = true;
      }
      if (metadata.columnDropCardKinds?.[columnId]) {
        delete metadata.columnDropCardKinds[columnId];
        metadataChanged = true;
      }
      if (metadataChanged) {
        updateWorkspaceMetadata(metadata);
      }
      return this.getSortingWorkspace();
    }

    if (payload.action === 'add-blank-card' || payload.action === 'add-blank-bubble') {
      const columnId = typeof payload.columnId === 'string' && payload.columnId.trim()
        ? payload.columnId.trim()
        : payload.layerId;
      const destinationColumn = this.db.prepare(`
        SELECT id, box_id AS boxId
        FROM sorting_layers
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(columnId, workspace.id);
      if (!destinationColumn) {
        throw new Error(`Sorting column not found: ${columnId}`);
      }
      const sortOrderRow = this.db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) AS maxSort
        FROM sorting_cards
        WHERE workspace_id = ? AND layer_id = ?
      `).get(workspace.id, columnId);
      const workspaceMetadata = normalizeSortingWorkspaceMetadata(
        safeJsonParse(workspace.metadataJson, null),
        this.getInitialSortingSourceSelection(),
      );
      const ensuredDestination = ensureSortingColumnBoundToLayer(
        workspaceMetadata,
        destinationColumn,
        payload.layerId,
      );
      const nextWorkspaceMetadata = ensuredDestination.metadata;
      const destinationLayerIds = destinationColumn.boxId
        ? resolveSortingColumnLayerBindings(
          nextWorkspaceMetadata.columnLayerBindings,
          [destinationColumn],
          resolveSortingBoxLayers(nextWorkspaceMetadata.boxLayers, destinationColumn.boxId),
        )[columnId] || []
        : [];
      const baseMetadata = normalizeSortingCardMetadata(payload.metadata);
      if (typeof payload.layerId === 'string' && payload.layerId.trim()) {
        baseMetadata.layerId = payload.layerId.trim();
      }
      const cardLayerId = destinationLayerIds.length > 0
        ? resolveSortingCardLayerId(baseMetadata, destinationLayerIds)
        : resolveSortingCardLayerId(baseMetadata, []);
      const nextCardKind = resolveSortingColumnDropCardKind(
        nextWorkspaceMetadata.columnDropCardKinds,
        columnId,
      ) || extractSortingCardKind(baseMetadata);
      const nextCardMetadata = withSortingCardKind(
        withSortingCardLayerId(baseMetadata, cardLayerId),
        nextCardKind,
      );
      const finalCardMetadata = withSortingTodoStatus(
        nextCardMetadata,
        payload.todoStatus,
        nextCardKind,
      );
      const finalCardMetadataWithPriority = withSortingTodoPriority(
        finalCardMetadata,
        payload.todoPriority ?? extractSortingTodoPriority(baseMetadata),
        nextCardKind,
      );
      const finalCardMetadataWithDueAt = withSortingTodoDueAt(
        finalCardMetadataWithPriority,
        payload.todoDueAt ?? extractSortingTodoDueAt(baseMetadata),
        nextCardKind,
      );
      const cardId = `card_${crypto.randomUUID()}`;
      this.db.prepare(`
        INSERT INTO sorting_cards (
          id, workspace_id, layer_id, type, box_ref_id, source_bubble_id, title, content,
          raw_message_json, source_ids_json, metadata_json, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cardId,
        workspace.id,
        columnId,
        'card',
        null,
        null,
        payload.title || null,
        payload.content || '',
        null,
        safeJsonStringify([]),
        safeJsonStringify(finalCardMetadataWithDueAt),
        (sortOrderRow?.maxSort || -1) + 1,
        now(),
        now(),
      );
      if (ensuredDestination.changed) {
        this.db.prepare(`
          UPDATE sorting_workspaces
          SET metadata_json = ?, updated_at = ?
          WHERE id = ?
        `).run(safeJsonStringify(nextWorkspaceMetadata), now(), workspace.id);
      }
      if (payload.canvasNode && payload.boxId) {
        this.db.prepare(`
          INSERT INTO sorting_canvas_nodes (
            id, workspace_id, box_id, card_id, x, y, width, height, z_index, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, box_id, card_id) DO UPDATE SET
            x = excluded.x,
            y = excluded.y,
            width = excluded.width,
            height = excluded.height,
            z_index = excluded.z_index,
            updated_at = excluded.updated_at
        `).run(
          `${payload.boxId}:${cardId}`,
          workspace.id,
          payload.boxId,
          cardId,
          Number(payload.canvasNode.x) || 0,
          Number(payload.canvasNode.y) || 0,
          Number(payload.canvasNode.width) || 280,
          Number(payload.canvasNode.height) || 176,
          Number(payload.canvasNode.zIndex) || 0,
          now(),
          now(),
        );
      }
      return this.getSortingWorkspace();
    }

    if (payload.action === 'update-card' || payload.action === 'update-bubble') {
      const row = this.db.prepare(`
        SELECT metadata_json AS metadataJson
        FROM sorting_cards
        WHERE id = ? AND workspace_id = ?
      `).get(payload.cardId, workspace.id);
      const currentMetadata = safeJsonParse(row?.metadataJson, {}) || {};
      const nextMetadata = payload.metadata === undefined
        ? currentMetadata
        : { ...currentMetadata, ...(payload.metadata || {}) };
      this.db.prepare(`
        UPDATE sorting_cards
        SET title = ?, content = ?, metadata_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `).run(
        payload.title || null,
        payload.content || null,
        safeJsonStringify(nextMetadata),
        now(),
        payload.cardId,
        workspace.id,
      );
      return this.getSortingWorkspace();
    }

    if (payload.action === 'delete-card' || payload.action === 'delete-bubble') {
      const columnId = typeof payload.columnId === 'string' && payload.columnId.trim()
        ? payload.columnId.trim()
        : payload.layerId;
      return this.moveSorting({
        action: 'remove-card',
        cardId: payload.cardId,
        columnId,
      });
    }

    if (payload.action === 'delete-cards') {
      const cardIds = normalizeStringArray(payload.cardIds);
      if (cardIds.length === 0) return this.getSortingWorkspace();

      const rows = this.db.prepare(`
        SELECT id, layer_id AS layerId
        FROM sorting_cards
        WHERE workspace_id = ? AND id IN (${cardIds.map(() => '?').join(',')})
      `).all(workspace.id, ...cardIds);
      if (rows.length === 0) return this.getSortingWorkspace();

      const existingCardIds = rows.map((row) => row.id);
      const affectedLayerIds = [...new Set(rows.map((row) => row.layerId))];

      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare(`
          DELETE FROM sorting_canvas_nodes
          WHERE workspace_id = ? AND card_id IN (${existingCardIds.map(() => '?').join(',')})
        `).run(workspace.id, ...existingCardIds);

        this.db.prepare(`
          DELETE FROM sorting_cards
          WHERE workspace_id = ? AND id IN (${existingCardIds.map(() => '?').join(',')})
        `).run(workspace.id, ...existingCardIds);

        affectedLayerIds.forEach((layerId) => {
          const remainingIds = this.db.prepare(`
            SELECT id
            FROM sorting_cards
            WHERE workspace_id = ? AND layer_id = ?
            ORDER BY sort_order ASC, created_at ASC
          `).all(workspace.id, layerId).map((row) => row.id);
          this.rewriteCardColumnSortOrder(layerId, remainingIds);
        });

        const metadata = getWorkspaceMetadata();
        const { nextMap, changed } = removeSortingCanvasEdgesByCardIds(
          metadata.boxCanvasEdges,
          new Set(existingCardIds),
        );
        if (changed) {
          metadata.boxCanvasEdges = nextMap;
          updateWorkspaceMetadata(metadata);
        }

        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }

      return this.getSortingWorkspace();
    }

    if (payload.action === 'canvas-set-edges') {
      const boxId = typeof payload.boxId === 'string' ? payload.boxId.trim() : '';
      if (!boxId) {
        throw new Error('boxId is required for canvas-set-edges');
      }
      const metadata = getWorkspaceMetadata();
      const nextMap = {
        ...(metadata.boxCanvasEdges || {}),
        [boxId]: normalizeSortingCanvasEdgeList(payload.edges),
      };
      if (!nextMap[boxId] || nextMap[boxId].length === 0) {
        delete nextMap[boxId];
      }
      metadata.boxCanvasEdges = nextMap;
      updateWorkspaceMetadata(metadata);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'canvas-upsert-node') {
      this.db.prepare(`
        INSERT INTO sorting_canvas_nodes (
          id, workspace_id, box_id, card_id, x, y, width, height, z_index, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, box_id, card_id) DO UPDATE SET
          x = excluded.x,
          y = excluded.y,
          width = excluded.width,
          height = excluded.height,
          z_index = excluded.z_index,
          updated_at = excluded.updated_at
      `).run(
        `${payload.boxId}:${payload.cardId}`,
        workspace.id,
        payload.boxId,
        payload.cardId,
        Number(payload.x) || 0,
        Number(payload.y) || 0,
        Number(payload.width) || 280,
        Number(payload.height) || 176,
        Number(payload.zIndex) || 0,
        now(),
        now(),
      );
      return this.getSortingWorkspace();
    }

    if (payload.action === 'canvas-reset-layout') {
      this.db.prepare(`
        DELETE FROM sorting_canvas_nodes
        WHERE workspace_id = ? AND box_id = ?
      `).run(workspace.id, payload.boxId);
      return this.getSortingWorkspace();
    }

    if (payload.action === 'link-output-message') {
      const row = this.db.prepare(`
        SELECT metadata_json AS metadataJson
        FROM sorting_cards
        WHERE id = ? AND workspace_id = ?
      `).get(payload.cardId, workspace.id);
      const metadata = safeJsonParse(row?.metadataJson, {});
      metadata.outputMessageId = payload.outputMessageId;
      metadata.outputConversationId = payload.outputConversationId;
      metadata.sourceIds = payload.sourceIds || metadata.sourceIds || [];
      this.db.prepare(`
        UPDATE sorting_cards
        SET metadata_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `).run(safeJsonStringify(metadata), now(), payload.cardId, workspace.id);
      return this.getSortingWorkspace();
    }

    throw new Error(`Unsupported sorting update action: ${payload.action}`);
  }

  createAiRun(payload) {
    const id = crypto.randomUUID();
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO ai_runs (
        id, provider_id, kind, status, model, conversation_id, trigger_message_id, input_ref_ids_json,
        prompt_text, metadata_json, created_at, updated_at, started_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      payload.providerId || null,
      payload.kind,
      payload.status || 'queued',
      payload.model,
      payload.conversationId || null,
      payload.triggerMessageId || null,
      safeJsonStringify(payload.inputRefIds || []),
      payload.promptText || null,
      safeJsonStringify(payload.metadata || null),
      timestamp,
      timestamp,
      payload.startedAt || timestamp,
    );
    return id;
  }

  updateAiRun(runId, payload = {}) {
    const row = this.db.prepare(`
      SELECT
        status,
        output_message_id AS outputMessageId,
        output_artifact_id AS outputArtifactId,
        response_text AS responseText,
        error_message AS errorMessage,
        usage_json AS usageJson,
        metadata_json AS metadataJson,
        started_at AS startedAt,
        finished_at AS finishedAt
      FROM ai_runs
      WHERE id = ?
      LIMIT 1
    `).get(runId);
    if (!row) {
      throw new Error(`AI run not found: ${runId}`);
    }

    const currentMetadata = safeJsonParse(row.metadataJson, null);
    const nextMetadata = payload.metadata && typeof payload.metadata === 'object'
      ? {
          ...(currentMetadata && typeof currentMetadata === 'object' ? currentMetadata : {}),
          ...payload.metadata,
        }
      : currentMetadata;

    const nextUsage = Object.prototype.hasOwnProperty.call(payload, 'usage')
      ? payload.usage
      : safeJsonParse(row.usageJson, null);

    this.db.prepare(`
      UPDATE ai_runs
      SET
        status = ?,
        output_message_id = ?,
        output_artifact_id = ?,
        response_text = ?,
        error_message = ?,
        usage_json = ?,
        metadata_json = ?,
        started_at = ?,
        finished_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      typeof payload.status === 'string' && payload.status.trim() ? payload.status.trim() : row.status,
      Object.prototype.hasOwnProperty.call(payload, 'outputMessageId') ? (payload.outputMessageId || null) : row.outputMessageId,
      Object.prototype.hasOwnProperty.call(payload, 'outputArtifactId') ? (payload.outputArtifactId || null) : row.outputArtifactId,
      Object.prototype.hasOwnProperty.call(payload, 'responseText') ? (payload.responseText || null) : row.responseText,
      Object.prototype.hasOwnProperty.call(payload, 'errorMessage') ? (payload.errorMessage || null) : row.errorMessage,
      safeJsonStringify(nextUsage || null),
      safeJsonStringify(nextMetadata || null),
      Object.prototype.hasOwnProperty.call(payload, 'startedAt') ? (payload.startedAt || null) : row.startedAt,
      Object.prototype.hasOwnProperty.call(payload, 'finishedAt') ? (payload.finishedAt || null) : row.finishedAt,
      now(),
      runId,
    );
  }

  completeAiRun(runId, payload) {
    this.db.prepare(`
      UPDATE ai_runs
      SET status = ?, response_text = ?, error_message = ?, usage_json = ?, output_message_id = COALESCE(?, output_message_id), finished_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.status,
      payload.responseText || null,
      payload.errorMessage || null,
      safeJsonStringify(payload.usage || null),
      payload.outputMessageId || null,
      payload.finishedAt || now(),
      now(),
      runId,
    );
  }

  seedBuiltInAiProviders() {
    const timestamp = now();
    BUILTIN_AI_PROVIDERS.forEach((provider, index) => {
      const existing = this.db.prepare(`
        SELECT id
        FROM ai_providers
        WHERE id = ?
      `).get(provider.id);
      if (existing) return;

      this.db.prepare(`
        INSERT INTO ai_providers (
          id, name, kind, base_url, default_model, api_key_ref, enabled, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        provider.id,
        provider.name,
        provider.kind,
        provider.baseUrl || null,
        provider.defaultModel,
        provider.apiKeyRef || '',
        provider.enabled ? 1 : 0,
        safeJsonStringify(provider.metadata || null),
        timestamp + index,
        timestamp + index,
      );
    });
  }

  seedBuiltInBots() {
    const timestamp = now();
    BUILTIN_BOTS.forEach((bot, index) => {
      const existing = this.db.prepare(`
        SELECT id
        FROM bots
        WHERE id = ?
      `).get(bot.id);
      if (existing) return;

      this.db.prepare(`
        INSERT INTO bots (
          id, name, slug, introduction, avatar_url, avatar_preset, provider_id, model,
          runtime_type, runtime_config_json, system_prompt, enabled, sort_order, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        bot.id,
        bot.name,
        bot.slug || null,
        bot.introduction || null,
        bot.avatarUrl || null,
        bot.avatarPreset || null,
        bot.providerId || null,
        bot.model || null,
        normalizeBotRuntimeType(bot.runtimeType),
        safeJsonStringify(normalizeBotRuntimeConfig(bot.runtimeConfig)),
        bot.systemPrompt,
        bot.enabled ? 1 : 0,
        typeof bot.sortOrder === 'number' ? bot.sortOrder : index * 10,
        safeJsonStringify(bot.metadata || null),
        timestamp + index,
        timestamp + index,
      );
    });
  }

  seedBuiltInIdentities() {
    const timestamp = now();
    BUILTIN_IDENTITIES.forEach((identity, index) => {
      const existing = this.db.prepare(`
        SELECT id
        FROM identities
        WHERE id = ?
        LIMIT 1
      `).get(identity.id);
      if (existing) return;

      this.db.prepare(`
        INSERT INTO identities (
          id, name, description, avatar_url, avatar_preset, enabled, sort_order, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identity.id,
        identity.name,
        identity.description || null,
        identity.avatarUrl || null,
        identity.avatarPreset || DEFAULT_IDENTITY_AVATAR_PRESET,
        identity.enabled === false ? 0 : 1,
        typeof identity.sortOrder === 'number' ? identity.sortOrder : index * 10,
        safeJsonStringify(identity.metadata || null),
        timestamp + index,
        timestamp + index,
      );
    });
  }

  migrateBuiltInBotModelPresets() {
    const timestamp = now();
    const legacyProviderDefaults = new Map([
      ['builtin-provider-kimi', ['moonshot-v1-8k', 'kimi-latest']],
      ['builtin-provider-deepseek', []],
    ]);
    const legacyBotDefaults = new Map([
      ['builtin-bot-atri', ['moonshot-v1-8k', 'kimi-latest']],
      ['builtin-bot-lin-daiyu', []],
    ]);

    BUILTIN_AI_PROVIDERS.forEach((provider, index) => {
      const row = this.db.prepare(`
        SELECT default_model AS defaultModel, metadata_json AS metadataJson
        FROM ai_providers
        WHERE id = ?
      `).get(provider.id);
      if (!row) return;

      const currentMetadata = safeJsonParse(row.metadataJson, null) || {};
      const nextMetadata = {
        ...currentMetadata,
        ...(provider.metadata || {}),
      };
      const currentDefaultModel = typeof row.defaultModel === 'string' ? row.defaultModel : '';
      const shouldMigrateDefaultModel = !currentDefaultModel
        || (legacyProviderDefaults.get(provider.id) || []).includes(currentDefaultModel);
      const nextDefaultModel = shouldMigrateDefaultModel ? provider.defaultModel : currentDefaultModel;

      if (nextDefaultModel !== currentDefaultModel || JSON.stringify(nextMetadata) !== JSON.stringify(currentMetadata)) {
        this.db.prepare(`
          UPDATE ai_providers
          SET default_model = ?, metadata_json = ?, updated_at = ?
          WHERE id = ?
        `).run(
          nextDefaultModel,
          safeJsonStringify(nextMetadata),
          timestamp + index,
          provider.id,
        );
      }
    });

    BUILTIN_BOTS.forEach((bot, index) => {
      const row = this.db.prepare(`
        SELECT
          model,
          runtime_type AS runtimeType,
          runtime_config_json AS runtimeConfigJson,
          metadata_json AS metadataJson
        FROM bots
        WHERE id = ?
      `).get(bot.id);
      if (!row) return;

      const currentMetadata = safeJsonParse(row.metadataJson, null) || {};
      const nextMetadata = {
        ...currentMetadata,
        ...(bot.metadata || {}),
      };
      const currentModel = typeof row.model === 'string' ? row.model : '';
      const shouldMigrateModel = !currentModel
        || (legacyBotDefaults.get(bot.id) || []).includes(currentModel);
      const nextModel = shouldMigrateModel ? bot.model : currentModel;
      const nextRuntimeType = normalizeBotRuntimeType(bot.runtimeType);
      const nextRuntimeConfig = normalizeBotRuntimeConfig(bot.runtimeConfig);
      const currentRuntimeType = normalizeBotRuntimeType(row.runtimeType);
      const currentRuntimeConfig = normalizeBotRuntimeConfig(
        safeJsonParse(row.runtimeConfigJson, null),
      );

      if (
        nextModel !== currentModel
        || nextRuntimeType !== currentRuntimeType
        || JSON.stringify(nextRuntimeConfig) !== JSON.stringify(currentRuntimeConfig)
        || JSON.stringify(nextMetadata) !== JSON.stringify(currentMetadata)
      ) {
        this.db.prepare(`
          UPDATE bots
          SET model = ?, runtime_type = ?, runtime_config_json = ?, metadata_json = ?, updated_at = ?
          WHERE id = ?
        `).run(
          nextModel,
          nextRuntimeType,
          safeJsonStringify(nextRuntimeConfig),
          safeJsonStringify(nextMetadata),
          timestamp + BUILTIN_AI_PROVIDERS.length + index,
          bot.id,
        );
      }
    });
  }

  migrateAiProviderSecrets() {
    if (!this.secretStore) return;

    const rows = this.db.prepare(`
      SELECT id, api_key_ref AS apiKeyRef
      FROM ai_providers
      WHERE api_key_ref IS NOT NULL
        AND TRIM(api_key_ref) != ''
    `).all();

    rows.forEach((row) => {
      if (!row.apiKeyRef || isSecretRef(row.apiKeyRef)) return;
      const secretId = buildProviderApiSecretId(row.id);
      this.secretStore.set(secretId, row.apiKeyRef);
      this.db.prepare(`
        UPDATE ai_providers
        SET api_key_ref = ?, updated_at = ?
        WHERE id = ?
      `).run(
        buildProviderApiSecretRef(row.id),
        now(),
        row.id,
      );
    });
  }

  resolveApiKeyRef(apiKeyRef) {
    if (typeof apiKeyRef !== 'string' || !apiKeyRef.trim()) return '';
    const normalized = apiKeyRef.trim();
    if (!isSecretRef(normalized)) return normalized;
    const secretId = parseSecretRef(normalized);
    if (!secretId || !this.secretStore) return '';
    return this.secretStore.get(secretId);
  }

  getApiKeyStorageInfo() {
    if (!this.secretStore) {
      return {
        kind: 'unknown',
        encrypted: false,
        label: 'Unavailable',
      };
    }
    return this.secretStore.getStorageInfo();
  }

  saveAiProvider(provider) {
    const timestamp = now();
    const id = provider.id || crypto.randomUUID();
    const existing = this.db.prepare(`
      SELECT api_key_ref AS apiKeyRef, metadata_json AS metadataJson
      FROM ai_providers
      WHERE id = ?
    `).get(id);
    const secretRef = buildProviderApiSecretRef(id);
    let apiKeyRef = existing?.apiKeyRef || '';

    if (provider.clearApiKey) {
      this.secretStore?.delete(buildProviderApiSecretId(id));
      apiKeyRef = '';
    } else if (typeof provider.apiKey === 'string') {
      const trimmedApiKey = provider.apiKey.trim();
      if (trimmedApiKey) {
        this.secretStore?.set(buildProviderApiSecretId(id), trimmedApiKey);
        apiKeyRef = secretRef;
      }
    }

    const metadata = provider.metadata && typeof provider.metadata === 'object'
      ? provider.metadata
      : safeJsonParse(existing?.metadataJson, null);

    this.db.prepare(`
      INSERT INTO ai_providers (
        id, name, kind, base_url, default_model, api_key_ref, enabled, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        base_url = excluded.base_url,
        default_model = excluded.default_model,
        api_key_ref = excluded.api_key_ref,
        enabled = excluded.enabled,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      provider.name,
      provider.kind,
      provider.baseUrl || null,
      provider.defaultModel,
      apiKeyRef,
      provider.enabled ? 1 : 0,
      safeJsonStringify(metadata),
      timestamp,
      timestamp,
    );
    return id;
  }

  listAiProviders() {
    const storageInfo = this.getApiKeyStorageInfo();

    return this.db.prepare(`
      SELECT
        id,
        name,
        kind,
        base_url AS baseUrl,
        default_model AS defaultModel,
        api_key_ref AS apiKeyRef,
        enabled,
        metadata_json AS metadataJson
      FROM ai_providers
      ORDER BY updated_at DESC
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      baseUrl: row.baseUrl || '',
      defaultModel: row.defaultModel,
      apiKeyRef: '',
      hasApiKey: Boolean(this.resolveApiKeyRef(row.apiKeyRef)),
      apiKeyStorage: storageInfo.label,
      apiKeyStorageKind: storageInfo.kind,
      availableModels: Array.isArray(safeJsonParse(row.metadataJson, null)?.knownModels)
        ? safeJsonParse(row.metadataJson, null).knownModels
        : [],
      enabled: Boolean(row.enabled),
    }));
  }

  getAiProvider(providerId) {
    if (!providerId) return null;
    const row = this.db.prepare(`
      SELECT
        id,
        name,
        kind,
        base_url AS baseUrl,
        default_model AS defaultModel,
        api_key_ref AS apiKeyRef,
        enabled,
        metadata_json AS metadataJson
      FROM ai_providers
      WHERE id = ?
    `).get(providerId);

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      baseUrl: row.baseUrl || '',
      defaultModel: row.defaultModel,
      apiKeyRef: row.apiKeyRef,
      hasApiKey: Boolean(this.resolveApiKeyRef(row.apiKeyRef)),
      apiKeyStorage: this.getApiKeyStorageInfo().label,
      enabled: Boolean(row.enabled),
      metadata: safeJsonParse(row.metadataJson, null),
    };
  }

  saveBot(bot) {
    const name = typeof bot?.name === 'string' ? bot.name.trim() : '';
    const systemPrompt = typeof bot?.systemPrompt === 'string' ? bot.systemPrompt.trim() : '';

    if (!name) {
      throw new Error('Bot name is required.');
    }
    if (!systemPrompt) {
      throw new Error('Bot systemPrompt is required.');
    }

    const timestamp = now();
    const id = typeof bot.id === 'string' && bot.id.trim() ? bot.id.trim() : crypto.randomUUID();
    const existing = this.db.prepare(`
      SELECT sort_order AS sortOrder
      FROM bots
      WHERE id = ?
    `).get(id);
    const maxSortRow = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder
      FROM bots
    `).get();
    const sortOrder = typeof bot.sortOrder === 'number'
      ? bot.sortOrder
      : existing?.sortOrder ?? ((maxSortRow?.maxSortOrder || 0) + 10);

    const runtimeType = normalizeBotRuntimeType(bot.runtimeType);
    const runtimeConfig = normalizeBotRuntimeConfig(bot.runtimeConfig);

    this.db.prepare(`
      INSERT INTO bots (
        id, name, slug, introduction, avatar_url, avatar_preset, provider_id, model,
        runtime_type, runtime_config_json, system_prompt, enabled, sort_order, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        slug = excluded.slug,
        introduction = excluded.introduction,
        avatar_url = excluded.avatar_url,
        avatar_preset = excluded.avatar_preset,
        provider_id = excluded.provider_id,
        model = excluded.model,
        runtime_type = excluded.runtime_type,
        runtime_config_json = excluded.runtime_config_json,
        system_prompt = excluded.system_prompt,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      name,
      typeof bot.slug === 'string' && bot.slug.trim() ? bot.slug.trim() : null,
      typeof bot.introduction === 'string' && bot.introduction.trim() ? bot.introduction.trim() : null,
      typeof bot.avatarUrl === 'string' && bot.avatarUrl.trim() ? bot.avatarUrl.trim() : null,
      typeof bot.avatarPreset === 'string' && bot.avatarPreset.trim() ? bot.avatarPreset.trim() : null,
      typeof bot.providerId === 'string' && bot.providerId.trim() ? bot.providerId.trim() : null,
      typeof bot.model === 'string' && bot.model.trim() ? bot.model.trim() : null,
      runtimeType,
      safeJsonStringify(runtimeConfig),
      systemPrompt,
      bot.enabled === false ? 0 : 1,
      sortOrder,
      safeJsonStringify(bot.metadata || null),
      timestamp,
      timestamp,
    );

    this.synchronizeDirectBotConversations({
      id,
      name,
      avatarUrl: typeof bot.avatarUrl === 'string' ? bot.avatarUrl.trim() : '',
      avatarPreset: typeof bot.avatarPreset === 'string' ? bot.avatarPreset.trim() : '',
    });

    return id;
  }

  listIdentities() {
    return this.db.prepare(`
      SELECT
        id,
        name,
        description,
        avatar_url AS avatarUrl,
        avatar_preset AS avatarPreset,
        enabled,
        sort_order AS sortOrder,
        metadata_json AS metadataJson
      FROM identities
      ORDER BY sort_order ASC, created_at ASC
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      avatarUrl: row.avatarUrl || '',
      avatarPreset: row.avatarPreset || DEFAULT_IDENTITY_AVATAR_PRESET,
      enabled: Boolean(row.enabled),
      sortOrder: row.sortOrder || 0,
      metadata: safeJsonParse(row.metadataJson, null),
    }));
  }

  saveIdentity(identity) {
    const name = typeof identity?.name === 'string' ? identity.name.trim() : '';
    if (!name) {
      throw new Error('Identity name is required.');
    }

    const timestamp = now();
    const id = typeof identity?.id === 'string' && identity.id.trim() ? identity.id.trim() : crypto.randomUUID();
    const existing = this.db.prepare(`
      SELECT sort_order AS sortOrder
      FROM identities
      WHERE id = ?
      LIMIT 1
    `).get(id);
    const maxSortRow = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder
      FROM identities
    `).get();
    const sortOrder = typeof identity?.sortOrder === 'number'
      ? identity.sortOrder
      : existing?.sortOrder ?? ((maxSortRow?.maxSortOrder || 0) + 10);

    this.db.prepare(`
      INSERT INTO identities (
        id, name, description, avatar_url, avatar_preset, enabled, sort_order, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        avatar_url = excluded.avatar_url,
        avatar_preset = excluded.avatar_preset,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      name,
      typeof identity?.description === 'string' && identity.description.trim() ? identity.description.trim() : null,
      typeof identity?.avatarUrl === 'string' && identity.avatarUrl.trim() ? identity.avatarUrl.trim() : null,
      typeof identity?.avatarPreset === 'string' && identity.avatarPreset.trim() ? identity.avatarPreset.trim() : DEFAULT_IDENTITY_AVATAR_PRESET,
      identity?.enabled === false ? 0 : 1,
      sortOrder,
      safeJsonStringify(identity?.metadata || null),
      timestamp,
      timestamp,
    );

    return id;
  }

  saveBotIdentityBinding(payload) {
    const botId = typeof payload?.botId === 'string' ? payload.botId.trim() : '';
    const identityId = typeof payload?.identityId === 'string' ? payload.identityId.trim() : '';
    if (!botId) {
      throw new Error('botId is required.');
    }
    if (!identityId) {
      throw new Error('identityId is required.');
    }

    const timestamp = now();
    this.db.prepare(`
      INSERT INTO bot_identities (
        bot_id, identity_id, enabled, relation_prompt, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bot_id, identity_id) DO UPDATE SET
        enabled = excluded.enabled,
        relation_prompt = excluded.relation_prompt,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      botId,
      identityId,
      payload?.enabled === false ? 0 : 1,
      typeof payload?.relationPrompt === 'string' && payload.relationPrompt.trim() ? payload.relationPrompt.trim() : null,
      safeJsonStringify(payload?.metadata || null),
      timestamp,
      timestamp,
    );

    return {
      botId,
      identityId,
      enabled: payload?.enabled !== false,
      relationPrompt: typeof payload?.relationPrompt === 'string' ? payload.relationPrompt.trim() : '',
      metadata: payload?.metadata || null,
    };
  }

  listMemoryEntries(options = {}) {
    const botId = typeof options?.botId === 'string' && options.botId.trim() ? options.botId.trim() : null;
    const identityId = typeof options?.identityId === 'string' && options.identityId.trim() ? options.identityId.trim() : null;
    const topicId = typeof options?.topicId === 'string' && options.topicId.trim() ? options.topicId.trim() : null;
    const scope = typeof options?.scope === 'string' ? options.scope.trim() : '';

    let query = `
      SELECT
        id,
        bot_id AS botId,
        identity_id AS identityId,
        topic_id AS topicId,
        kind,
        title,
        content,
        enabled,
        sort_order AS sortOrder,
        metadata_json AS metadataJson
      FROM memory_entries
      WHERE 1 = 1
    `;
    const params = [];

    if (scope === 'global') {
      query += ' AND bot_id = ? AND identity_id IS NULL AND topic_id IS NULL';
      params.push(botId || '__missing__');
    } else if (scope === 'identity') {
      query += ' AND bot_id = ? AND identity_id = ? AND topic_id IS NULL';
      params.push(botId || '__missing__', identityId || '__missing__');
    } else if (scope === 'topic') {
      query += ' AND bot_id = ? AND topic_id = ?';
      params.push(botId || '__missing__', topicId || '__missing__');
    } else {
      if (botId) {
        query += ' AND bot_id = ?';
        params.push(botId);
      }
      if (identityId) {
        query += ' AND identity_id = ?';
        params.push(identityId);
      }
      if (topicId) {
        query += ' AND topic_id = ?';
        params.push(topicId);
      }
    }

    query += ' ORDER BY sort_order ASC, updated_at DESC, created_at DESC';

    return this.db.prepare(query).all(...params).map((row) => ({
      id: row.id,
      botId: row.botId || '',
      identityId: row.identityId || '',
      topicId: row.topicId || '',
      kind: row.kind || 'fact',
      title: row.title || '',
      content: row.content || '',
      enabled: Boolean(row.enabled),
      sortOrder: row.sortOrder || 0,
      metadata: safeJsonParse(row.metadataJson, null),
    }));
  }

  saveMemoryEntry(entry) {
    const content = typeof entry?.content === 'string' ? entry.content.trim() : '';
    if (!content) {
      throw new Error('Memory content is required.');
    }

    const timestamp = now();
    const id = typeof entry?.id === 'string' && entry.id.trim() ? entry.id.trim() : crypto.randomUUID();
    const existing = this.db.prepare(`
      SELECT sort_order AS sortOrder
      FROM memory_entries
      WHERE id = ?
      LIMIT 1
    `).get(id);
    const maxSortRow = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder
      FROM memory_entries
    `).get();
    const sortOrder = typeof entry?.sortOrder === 'number'
      ? entry.sortOrder
      : existing?.sortOrder ?? ((maxSortRow?.maxSortOrder || 0) + 10);

    this.db.prepare(`
      INSERT INTO memory_entries (
        id, bot_id, identity_id, topic_id, kind, title, content, enabled, sort_order, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        bot_id = excluded.bot_id,
        identity_id = excluded.identity_id,
        topic_id = excluded.topic_id,
        kind = excluded.kind,
        title = excluded.title,
        content = excluded.content,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      typeof entry?.botId === 'string' && entry.botId.trim() ? entry.botId.trim() : null,
      typeof entry?.identityId === 'string' && entry.identityId.trim() ? entry.identityId.trim() : null,
      typeof entry?.topicId === 'string' && entry.topicId.trim() ? entry.topicId.trim() : null,
      typeof entry?.kind === 'string' && entry.kind.trim() ? entry.kind.trim() : 'fact',
      typeof entry?.title === 'string' && entry.title.trim() ? entry.title.trim() : null,
      content,
      entry?.enabled === false ? 0 : 1,
      sortOrder,
      safeJsonStringify(entry?.metadata || null),
      timestamp,
      timestamp,
    );

    return id;
  }

  listBots(options = {}) {
    const conversationId = typeof options?.conversationId === 'string' && options.conversationId.trim()
      ? options.conversationId.trim()
      : '__unbound__';
    const identityId = typeof options?.identityId === 'string' && options.identityId.trim()
      ? options.identityId.trim()
      : '__unbound_identity__';

    return this.db.prepare(`
      SELECT
        bots.id,
        bots.name,
        bots.slug,
        bots.introduction,
        bots.avatar_url AS avatarUrl,
        bots.avatar_preset AS avatarPreset,
        bots.provider_id AS providerId,
        bots.model,
        bots.runtime_type AS runtimeType,
        bots.runtime_config_json AS runtimeConfigJson,
        bots.system_prompt AS systemPrompt,
        bots.enabled,
        bots.sort_order AS sortOrder,
        bots.metadata_json AS metadataJson,
        ai_providers.name AS providerName,
        ai_providers.base_url AS providerBaseUrl,
        ai_providers.default_model AS providerDefaultModel,
        ai_providers.enabled AS providerEnabled,
        ai_providers.api_key_ref AS providerApiKeyRef,
        ai_providers.metadata_json AS providerMetadataJson,
        conversation_bots.conversation_id AS bindingConversationId,
        conversation_bots.enabled AS bindingEnabled,
        conversation_bots.reply_mode AS bindingReplyMode,
        conversation_bots.trigger_mode AS bindingTriggerMode,
        conversation_bots.output_mode AS bindingOutputMode,
        conversation_bots.alias AS bindingAlias,
        conversation_bots.sort_order AS bindingSortOrder,
        conversation_bots.metadata_json AS bindingMetadataJson,
        bot_identities.identity_id AS identityBindingIdentityId,
        bot_identities.enabled AS identityBindingEnabled,
        bot_identities.relation_prompt AS identityBindingRelationPrompt,
        bot_identities.metadata_json AS identityBindingMetadataJson
      FROM bots
      LEFT JOIN ai_providers
        ON ai_providers.id = bots.provider_id
      LEFT JOIN conversation_bots
        ON conversation_bots.bot_id = bots.id
       AND conversation_bots.conversation_id = ?
      LEFT JOIN bot_identities
        ON bot_identities.bot_id = bots.id
       AND bot_identities.identity_id = ?
      ORDER BY bots.sort_order ASC, bots.created_at ASC
    `).all(conversationId, identityId).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug || '',
      introduction: row.introduction || '',
      avatarUrl: row.avatarUrl || '',
      avatarPreset: row.avatarPreset || '',
      providerId: row.providerId || '',
      runtimeType: normalizeBotRuntimeType(row.runtimeType),
      runtimeConfig: normalizeBotRuntimeConfig(safeJsonParse(row.runtimeConfigJson, null)),
      providerName: row.providerName || '',
      providerBaseUrl: row.providerBaseUrl || '',
      providerDefaultModel: row.providerDefaultModel || '',
      providerApiKeyRef: row.providerApiKeyRef || '',
      providerEnabled: row.providerEnabled === null || row.providerEnabled === undefined
        ? null
        : Boolean(row.providerEnabled),
      providerHasApiKey: Boolean(this.resolveApiKeyRef(row.providerApiKeyRef)),
      providerApiKeyStorage: this.getApiKeyStorageInfo().label,
      providerMetadata: safeJsonParse(row.providerMetadataJson, null),
      model: row.model || '',
      systemPrompt: row.systemPrompt,
      enabled: Boolean(row.enabled),
      sortOrder: row.sortOrder || 0,
      metadata: safeJsonParse(row.metadataJson, null),
      binding: row.bindingConversationId ? {
        conversationId: row.bindingConversationId,
        botId: row.id,
        enabled: Boolean(row.bindingEnabled),
        replyMode: row.bindingReplyMode || 'auto',
        triggerMode: normalizeBotTriggerMode(row.bindingTriggerMode || row.bindingReplyMode),
        outputMode: normalizeBotOutputMode(row.bindingOutputMode),
        alias: row.bindingAlias || '',
        sortOrder: row.bindingSortOrder || 0,
        metadata: safeJsonParse(row.bindingMetadataJson, null),
      } : null,
      identityBinding: row.identityBindingIdentityId ? {
        botId: row.id,
        identityId: row.identityBindingIdentityId,
        enabled: Boolean(row.identityBindingEnabled),
        relationPrompt: row.identityBindingRelationPrompt || '',
        metadata: safeJsonParse(row.identityBindingMetadataJson, null),
      } : null,
    }));
  }

  findDirectBotConversationRow(botId, botName = '') {
    if (!botId) return null;

    return this.db.prepare(`
      SELECT
        conversations.id,
        conversations.title,
        conversations.avatar,
        conversations.metadata_json AS metadataJson,
        conversation_bots.bot_id AS bindingBotId,
        conversation_bots.enabled AS bindingEnabled
      FROM conversations
      LEFT JOIN conversation_bots
        ON conversation_bots.conversation_id = conversations.id
       AND conversation_bots.bot_id = ?
      ORDER BY COALESCE(conversations.last_message_at, conversations.updated_at) DESC, conversations.created_at DESC
    `).all(botId).find((row) => {
      const metadata = normalizeConversationMetadata(
        safeJsonParse(row.metadataJson, null),
        { avatar: row.avatar },
      );
      if (metadata.directBotId === botId) return true;
      if (!row.bindingBotId || !row.bindingEnabled) return false;
      if (metadata.conversationMode === 'direct-bot') return true;
      return Boolean(botName) && row.title === botName;
    }) || null;
  }

  syncDirectBotConversationRow(row, bot, options = {}) {
    if (!row?.id || !bot?.id) return null;
    const lifecycleStatus = options.lifecycleStatus || undefined;
    const normalizedBotAvatarUrl = normalizeConversationAvatarUrl(bot.avatarUrl);
    const currentMetadata = normalizeConversationMetadata(
      safeJsonParse(row.metadataJson, null),
      { avatar: row.avatar },
    );
    const nextMetadata = normalizeConversationMetadata(
      {
        ...currentMetadata,
        directBotId: bot.id,
        directBotName: bot.name,
        conversationMode: 'direct-bot',
        lifecycleStatus: lifecycleStatus ?? currentMetadata.lifecycleStatus,
        avatarPreset: bot.avatarPreset || currentMetadata.avatarPreset,
        avatarUrl: normalizedBotAvatarUrl,
      },
      {
        avatar: bot.avatarPreset || row.avatar,
        avatarUrl: normalizedBotAvatarUrl,
        lifecycleStatus: lifecycleStatus ?? currentMetadata.lifecycleStatus,
      },
    );

    this.db.prepare(`
      UPDATE conversations
      SET title = ?, avatar = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      bot.name,
      nextMetadata.avatarPreset,
      safeJsonStringify(nextMetadata),
      now(),
      row.id,
    );

    return this.getConversation(row.id);
  }

  repairLegacyDirectBotConversations() {
    const bots = this.db.prepare(`
      SELECT
        id,
        name,
        avatar_url AS avatarUrl,
        avatar_preset AS avatarPreset
      FROM bots
      ORDER BY created_at ASC
    `).all();

    bots.forEach((bot) => {
      const row = this.findDirectBotConversationRow(bot.id, bot.name);
      if (!row) return;

      const metadata = normalizeConversationMetadata(
        safeJsonParse(row.metadataJson, null),
        { avatar: row.avatar },
      );
      const normalizedBotAvatarUrl = normalizeConversationAvatarUrl(bot.avatarUrl);
      const looksLikeLegacyDirectConversation = !metadata.directBotId
        && Boolean(row.bindingBotId && row.bindingEnabled)
        && row.title === bot.name;
      const needsRefresh = metadata.directBotId === bot.id && (
        metadata.conversationMode !== 'direct-bot'
        || metadata.avatarUrl !== normalizedBotAvatarUrl
        || row.title !== bot.name
        || (bot.avatarPreset && metadata.avatarPreset !== bot.avatarPreset)
      );

      if (!looksLikeLegacyDirectConversation && !needsRefresh) return;
      this.syncDirectBotConversationRow(row, bot);
    });
  }

  listBotConversations(botId) {
    if (!botId) return [];

    return this.db.prepare(`
      SELECT
        conversations.id,
        conversations.title,
        conversations.avatar,
        conversations.last_msg AS lastMsg,
        conversations.last_time AS lastTime,
        conversations.last_message_at AS lastMessageAt,
        (
          SELECT raw_json
          FROM messages
          WHERE conversation_id = conversations.id
          ORDER BY sort_order DESC, COALESCE(time_ms, created_at) DESC
          LIMIT 1
        ) AS lastMessageJson,
        conversations.metadata_json AS metadataJson,
        conversation_bots.bot_id AS bindingBotId,
        conversation_bots.enabled AS bindingEnabled,
        conversation_bots.reply_mode AS bindingReplyMode,
        conversation_bots.trigger_mode AS bindingTriggerMode,
        conversation_bots.output_mode AS bindingOutputMode,
        conversation_bots.alias AS bindingAlias,
        conversation_bots.sort_order AS bindingSortOrder,
        conversation_bots.metadata_json AS bindingMetadataJson
      FROM conversations
      LEFT JOIN conversation_bots
        ON conversation_bots.conversation_id = conversations.id
       AND conversation_bots.bot_id = ?
      ORDER BY COALESCE(conversations.last_message_at, conversations.updated_at) DESC, conversations.created_at DESC
    `).all(botId).map((row) => {
      const metadata = normalizeConversationMetadata(
        safeJsonParse(row.metadataJson, null),
        { avatar: row.avatar },
      );
      const summaryFields = resolveConversationSummaryFields(row);
      return {
        id: row.id,
        title: row.title,
        avatar: metadata.avatarPreset,
        avatarPreset: metadata.avatarPreset,
        avatarUrl: metadata.avatarUrl || '',
        lastMsg: summaryFields.lastMsg,
        lastTime: summaryFields.lastTime,
        lastMessageAt: summaryFields.lastMessageAt,
        lifecycleStatus: metadata.lifecycleStatus,
        isPinned: metadata.isPinned,
        isFolded: metadata.isFolded,
        invited: Boolean(row.bindingBotId && row.bindingEnabled),
        isDirectConversation: metadata.directBotId === botId,
        replyMode: row.bindingReplyMode || 'auto',
        triggerMode: normalizeBotTriggerMode(row.bindingTriggerMode || row.bindingReplyMode),
        outputMode: normalizeBotOutputMode(row.bindingOutputMode),
        alias: row.bindingAlias || '',
        sortOrder: row.bindingSortOrder || 0,
        binding: row.bindingBotId ? {
          conversationId: row.id,
          botId,
          enabled: Boolean(row.bindingEnabled),
          replyMode: row.bindingReplyMode || 'auto',
          triggerMode: normalizeBotTriggerMode(row.bindingTriggerMode || row.bindingReplyMode),
          outputMode: normalizeBotOutputMode(row.bindingOutputMode),
          alias: row.bindingAlias || '',
          sortOrder: row.bindingSortOrder || 0,
          metadata: safeJsonParse(row.bindingMetadataJson, null),
        } : null,
      };
    });
  }

  ensureDirectBotConversation(botId) {
    const normalizedBotId = typeof botId === 'string' ? botId.trim() : '';
    if (!normalizedBotId) {
      throw new Error('botId is required.');
    }

    const bot = this.db.prepare(`
      SELECT
        id,
        name,
        avatar_url AS avatarUrl,
        avatar_preset AS avatarPreset,
        runtime_type AS runtimeType
      FROM bots
      WHERE id = ?
      LIMIT 1
    `).get(normalizedBotId);
    if (!bot) {
      throw new Error(`Bot not found: ${normalizedBotId}`);
    }
    const normalizedBotAvatarUrl = normalizeConversationAvatarUrl(bot.avatarUrl);
    const directConversationRow = this.findDirectBotConversationRow(normalizedBotId, bot.name);

    if (directConversationRow?.id) {
      this.syncDirectBotConversationRow(directConversationRow, bot, { lifecycleStatus: 'flowing' });
      const triggerMode = normalizeBotRuntimeType(bot.runtimeType) === 'external-codex' ? 'manual' : 'auto';
      const outputMode = normalizeBotRuntimeType(bot.runtimeType) === 'external-codex' ? 'thread-comment' : 'stream-reply';
      this.saveConversationBotBinding({
        conversationId: directConversationRow.id,
        botId: normalizedBotId,
        enabled: true,
        triggerMode,
        outputMode,
      });
      return this.getConversation(directConversationRow.id);
    }

    const conversation = this.createConversation({
      title: bot.name,
      avatarPreset: bot.avatarPreset || 'machine',
      avatarUrl: normalizedBotAvatarUrl,
      metadataJson: safeJsonStringify({
        directBotId: normalizedBotId,
        directBotName: bot.name,
        conversationMode: 'direct-bot',
      }),
      lastMsg: `和 ${bot.name} 开始私聊`,
    });
    this.saveConversationBotBinding({
      conversationId: conversation.chatId,
      botId: normalizedBotId,
      enabled: true,
      triggerMode: normalizeBotRuntimeType(bot.runtimeType) === 'external-codex' ? 'manual' : 'auto',
      outputMode: normalizeBotRuntimeType(bot.runtimeType) === 'external-codex' ? 'thread-comment' : 'stream-reply',
    });
    return this.getConversation(conversation.chatId);
  }

  synchronizeDirectBotConversations(bot) {
    if (!bot?.id) return;
    const normalizedBotAvatarUrl = normalizeConversationAvatarUrl(bot.avatarUrl);
    const rows = this.db.prepare(`
      SELECT
        id,
        avatar,
        metadata_json AS metadataJson
      FROM conversations
      ORDER BY updated_at DESC
    `).all();

    rows.forEach((row) => {
      const currentMetadata = normalizeConversationMetadata(
        safeJsonParse(row.metadataJson, null),
        { avatar: row.avatar },
      );
      if (currentMetadata.directBotId !== bot.id) return;
      const nextMetadata = normalizeConversationMetadata(
        {
          ...currentMetadata,
          directBotId: bot.id,
          directBotName: bot.name,
          conversationMode: 'direct-bot',
          avatarPreset: bot.avatarPreset || currentMetadata.avatarPreset,
          avatarUrl: normalizedBotAvatarUrl,
        },
        {
          avatar: bot.avatarPreset || row.avatar,
          avatarUrl: normalizedBotAvatarUrl,
        },
      );
      this.db.prepare(`
        UPDATE conversations
        SET title = ?, avatar = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        bot.name,
        nextMetadata.avatarPreset,
        safeJsonStringify(nextMetadata),
        now(),
        row.id,
      );
    });
  }

  getConversationBotParticipants(conversationId, options = {}) {
    if (!conversationId) return [];
    const identityId = typeof options?.identityId === 'string' && options.identityId.trim()
      ? options.identityId.trim()
      : '__unbound_identity__';

    return this.db.prepare(`
      SELECT
        conversation_bots.conversation_id AS conversationId,
        conversation_bots.enabled AS bindingEnabled,
        conversation_bots.reply_mode AS replyMode,
        conversation_bots.trigger_mode AS triggerMode,
        conversation_bots.output_mode AS outputMode,
        conversation_bots.alias AS alias,
        conversation_bots.sort_order AS bindingSortOrder,
        conversation_bots.metadata_json AS bindingMetadataJson,
        bots.id,
        bots.name,
        bots.slug,
        bots.introduction,
        bots.avatar_url AS avatarUrl,
        bots.avatar_preset AS avatarPreset,
        bots.provider_id AS providerId,
        bots.model,
        bots.runtime_type AS runtimeType,
        bots.runtime_config_json AS runtimeConfigJson,
        bots.system_prompt AS systemPrompt,
        bots.enabled,
        bots.sort_order AS sortOrder,
        bots.metadata_json AS metadataJson,
        ai_providers.name AS providerName,
        ai_providers.kind AS providerKind,
        ai_providers.base_url AS providerBaseUrl,
        ai_providers.default_model AS providerDefaultModel,
        ai_providers.api_key_ref AS providerApiKeyRef,
        ai_providers.enabled AS providerEnabled,
        ai_providers.metadata_json AS providerMetadataJson,
        bot_identities.identity_id AS identityBindingIdentityId,
        bot_identities.enabled AS identityBindingEnabled,
        bot_identities.relation_prompt AS identityBindingRelationPrompt,
        bot_identities.metadata_json AS identityBindingMetadataJson
      FROM conversation_bots
      INNER JOIN bots
        ON bots.id = conversation_bots.bot_id
      LEFT JOIN ai_providers
        ON ai_providers.id = bots.provider_id
      LEFT JOIN bot_identities
        ON bot_identities.bot_id = bots.id
       AND bot_identities.identity_id = ?
      WHERE conversation_bots.conversation_id = ?
        AND conversation_bots.enabled = 1
        AND bots.enabled = 1
      ORDER BY conversation_bots.sort_order ASC, bots.sort_order ASC, bots.created_at ASC
    `).all(identityId, conversationId).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug || '',
      introduction: row.introduction || '',
      avatarUrl: row.avatarUrl || '',
      avatarPreset: row.avatarPreset || '',
      providerId: row.providerId || '',
      runtimeType: normalizeBotRuntimeType(row.runtimeType),
      runtimeConfig: normalizeBotRuntimeConfig(safeJsonParse(row.runtimeConfigJson, null)),
      providerName: row.providerName || '',
      providerKind: row.providerKind || '',
      providerBaseUrl: row.providerBaseUrl || '',
      providerDefaultModel: row.providerDefaultModel || '',
      providerApiKeyRef: row.providerApiKeyRef || '',
      providerHasApiKey: Boolean(this.resolveApiKeyRef(row.providerApiKeyRef)),
      providerEnabled: Boolean(row.providerEnabled),
      providerMetadata: safeJsonParse(row.providerMetadataJson, null),
      model: row.model || '',
      systemPrompt: row.systemPrompt,
      enabled: Boolean(row.enabled),
      sortOrder: row.sortOrder || 0,
      metadata: safeJsonParse(row.metadataJson, null),
      binding: {
        conversationId: row.conversationId,
        botId: row.id,
        enabled: Boolean(row.bindingEnabled),
        replyMode: row.replyMode || 'auto',
        triggerMode: normalizeBotTriggerMode(row.triggerMode || row.replyMode),
        outputMode: normalizeBotOutputMode(row.outputMode),
        alias: row.alias || '',
        sortOrder: row.bindingSortOrder || 0,
        metadata: safeJsonParse(row.bindingMetadataJson, null),
      },
      identityBinding: row.identityBindingIdentityId ? {
        botId: row.id,
        identityId: row.identityBindingIdentityId,
        enabled: Boolean(row.identityBindingEnabled),
        relationPrompt: row.identityBindingRelationPrompt || '',
        metadata: safeJsonParse(row.identityBindingMetadataJson, null),
      } : null,
    }));
  }

  getBotMemoryContext({ botId, identityId, topicId }) {
    const normalizedBotId = typeof botId === 'string' ? botId.trim() : '';
    if (!normalizedBotId) return [];
    const normalizedIdentityId = typeof identityId === 'string' ? identityId.trim() : '';
    const normalizedTopicId = typeof topicId === 'string' ? topicId.trim() : '';

    return this.db.prepare(`
      SELECT
        id,
        bot_id AS botId,
        identity_id AS identityId,
        topic_id AS topicId,
        kind,
        title,
        content,
        enabled,
        sort_order AS sortOrder,
        metadata_json AS metadataJson
      FROM memory_entries
      WHERE enabled = 1
        AND bot_id = ?
        AND (
          (identity_id IS NULL AND topic_id IS NULL)
          OR (? <> '' AND identity_id = ? AND topic_id IS NULL)
          OR (? <> '' AND topic_id = ?)
        )
      ORDER BY sort_order ASC, updated_at DESC, created_at DESC
    `).all(
      normalizedBotId,
      normalizedIdentityId,
      normalizedIdentityId,
      normalizedTopicId,
      normalizedTopicId,
    ).map((row) => ({
      id: row.id,
      botId: row.botId || '',
      identityId: row.identityId || '',
      topicId: row.topicId || '',
      kind: row.kind || 'fact',
      title: row.title || '',
      content: row.content || '',
      enabled: Boolean(row.enabled),
      sortOrder: row.sortOrder || 0,
      metadata: safeJsonParse(row.metadataJson, null),
    }));
  }

  saveConversationBotBinding(payload) {
    const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
    const botId = typeof payload?.botId === 'string' ? payload.botId.trim() : '';
    if (!conversationId) {
      throw new Error('conversationId is required.');
    }
    if (!botId) {
      throw new Error('botId is required.');
    }

    const conversation = this.db.prepare(`
      SELECT id
      FROM conversations
      WHERE id = ?
    `).get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const bot = this.db.prepare(`
      SELECT id, runtime_type AS runtimeType
      FROM bots
      WHERE id = ?
    `).get(botId);
    if (!bot) {
      throw new Error(`Bot not found: ${botId}`);
    }

    if (payload.enabled === false) {
      this.db.prepare(`
        DELETE FROM conversation_bots
        WHERE conversation_id = ? AND bot_id = ?
      `).run(conversationId, botId);
      return;
    }

    const timestamp = now();
    const existing = this.db.prepare(`
      SELECT sort_order AS sortOrder
      FROM conversation_bots
      WHERE conversation_id = ? AND bot_id = ?
    `).get(conversationId, botId);
    const maxSortRow = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder
      FROM conversation_bots
      WHERE conversation_id = ?
    `).get(conversationId);
    const sortOrder = typeof payload.sortOrder === 'number'
      ? payload.sortOrder
      : existing?.sortOrder ?? ((maxSortRow?.maxSortOrder || 0) + 10);
    const defaultTriggerMode = normalizeBotRuntimeType(bot.runtimeType) === 'external-codex' ? 'manual' : 'auto';
    const defaultOutputMode = normalizeBotRuntimeType(bot.runtimeType) === 'external-codex' ? 'thread-comment' : 'stream-reply';
    const triggerMode = normalizeBotTriggerMode(payload.triggerMode || payload.replyMode || defaultTriggerMode);
    const outputMode = normalizeBotOutputMode(payload.outputMode || defaultOutputMode);
    const replyMode = triggerMode === 'mention' ? 'mention' : 'auto';

    this.db.prepare(`
      INSERT INTO conversation_bots (
        conversation_id, bot_id, enabled, reply_mode, trigger_mode, output_mode, alias, sort_order, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, bot_id) DO UPDATE SET
        enabled = excluded.enabled,
        reply_mode = excluded.reply_mode,
        trigger_mode = excluded.trigger_mode,
        output_mode = excluded.output_mode,
        alias = excluded.alias,
        sort_order = excluded.sort_order,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      conversationId,
      botId,
      1,
      replyMode,
      triggerMode,
      outputMode,
      typeof payload.alias === 'string' && payload.alias.trim() ? payload.alias.trim() : null,
      sortOrder,
      safeJsonStringify(payload.metadata || null),
      timestamp,
      timestamp,
    );
  }

  importRendererFile(payload) {
    const imported = this.blobStore.importBuffer({
      buffer: payload.buffer,
      originalName: payload.name,
      mimeType: payload.type,
    });
    const existing = this.db.prepare(`
      SELECT id, original_name AS originalName, size_bytes AS sizeBytes
      FROM assets
      WHERE sha256 = ?
    `).get(imported.sha256);

    let assetId = existing?.id || null;
    if (!assetId) {
      assetId = crypto.randomUUID();
      const timestamp = now();
      this.db.prepare(`
        INSERT INTO assets (
          id, kind, status, mime_type, extension, original_name, sha256, size_bytes, relative_path, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        assetId,
        imported.kind,
        'ready',
        imported.mimeType,
        imported.extension || null,
        imported.originalName,
        imported.sha256,
        imported.sizeBytes,
        imported.relativePath,
        safeJsonStringify({ source: 'renderer-upload' }),
        timestamp,
        timestamp,
      );
    }

    return {
      assetId,
      url: createAssetUrl(assetId),
      originalName: imported.originalName,
      sizeBytes: imported.sizeBytes,
      mimeType: imported.mimeType,
      kind: imported.kind,
    };
  }

  importRendererFiles(payloads) {
    return payloads.map((payload) => this.importRendererFile(payload));
  }

  resolveAssetAbsolutePath(assetId) {
    const row = this.db.prepare(`
      SELECT relative_path AS relativePath
      FROM assets
      WHERE id = ?
    `).get(assetId);
    if (!row) return null;
    return this.blobStore.resolveAbsolutePath(row.relativePath);
  }

  resolveAttachmentAbsolutePath(target) {
    const normalizedTarget = typeof target === 'string' ? target.trim() : '';
    if (!normalizedTarget) return null;

    const directAssetId = parseAssetUrl(normalizedTarget);
    if (directAssetId) {
      return this.resolveAssetAbsolutePath(directAssetId);
    }

    const matchedAssetId = this.findBestAssetIdByOriginalName(normalizedTarget);
    if (!matchedAssetId) return null;
    return this.resolveAssetAbsolutePath(matchedAssetId);
  }

  importLegacyDataIfNeeded() {
    const existing = this.db.prepare(`SELECT COUNT(*) AS count FROM conversations`).get();
    if ((existing?.count || 0) > 0) return false;
    if (!this.legacyDataDir || !fs.existsSync(this.legacyDataDir)) return false;

    const chatFiles = fs.readdirSync(this.legacyDataDir)
      .filter((fileName) => fileName.startsWith('chat_') && fileName.endsWith('.json'))
      .sort();

    chatFiles.forEach((fileName) => {
      const filePath = path.join(this.legacyDataDir, fileName);
      const payload = safeJsonParse(fs.readFileSync(filePath, 'utf8'), null);
      if (!payload || !Array.isArray(payload.messages)) return;

      const migratedMessages = payload.messages.map((message) => this.rewriteLegacyMessageMedia(message));
      this.upsertConversation({
        chatId: payload.chatId || fileName.replace(/^chat_/, '').replace(/\.json$/, ''),
        title: payload.title || '未命名会话',
        avatar: payload.avatar || 'assistant',
        lastMsg: payload.lastMsg || '',
        lastTime: payload.lastTime || '',
        messages: migratedMessages,
      });
    });

    return chatFiles.length > 0;
  }

  rewriteLegacyMessageMedia(message) {
    if (!message || typeof message !== 'object') return message;
    const next = JSON.parse(JSON.stringify(message));

    if (typeof next.content === 'string') {
      next.content = this.rewriteLegacyMediaValue(next.content);
      return next;
    }

    if (Array.isArray(next.content)) {
      next.content = next.content.map((item) => {
        if (!item || typeof item !== 'object' || typeof item.val !== 'string') return item;
        if (item.type === 'img' || item.type === 'video' || item.type === 'audio' || item.type === 'file') {
          return { ...item, val: this.rewriteLegacyMediaValue(item.val) };
        }
        return item;
      });
      return next;
    }

    return next;
  }

  repairBrokenMessageMedia(message, candidates) {
    if (!message || typeof message !== 'object') return message;
    const signature = buildMediaRepairSignature(message);
    if (!signature) return message;

    const matchedCandidate = candidates instanceof Map
      ? candidates.get(signature)
      : (Array.isArray(candidates) ? candidates : []).find((candidate) => {
        if (!candidate || candidate === message) return false;
        return buildMediaRepairSignature(candidate) === signature && hasResolvedMedia(candidate);
      });

    if (!matchedCandidate) return message;

    const next = JSON.parse(JSON.stringify(message));

    if (Array.isArray(next.content) && Array.isArray(matchedCandidate.content)) {
      next.content = next.content.map((item, index) => {
        const candidateItem = matchedCandidate.content[index];
        if (!item || typeof item !== 'object' || !candidateItem || typeof candidateItem !== 'object') return item;
        if (item.type !== candidateItem.type) return item;
        if (!isBrokenBlobValue(item.val) || !isResolvedMediaValue(candidateItem.val)) return item;
        return { ...item, val: candidateItem.val };
      });
      return next;
    }

    if (typeof next.content === 'string' && typeof matchedCandidate.content === 'string') {
      if (isBrokenBlobValue(next.content) && isResolvedMediaValue(matchedCandidate.content)) {
        next.content = matchedCandidate.content;
      }
    }

    return next;
  }

  findBestAssetIdByOriginalName(fileName, referenceTimestamp = null) {
    const normalizedFileName = typeof fileName === 'string' ? fileName.trim() : '';
    if (!normalizedFileName) return null;

    const rows = this.db.prepare(`
      SELECT
        id,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM assets
      WHERE original_name = ?
    `).all(normalizedFileName);
    if (rows.length === 0) return null;

    const hasReferenceTimestamp = typeof referenceTimestamp === 'number' && Number.isFinite(referenceTimestamp);
    const resolveSortTime = (row) => {
      const updatedAt = typeof row?.updatedAt === 'number' ? row.updatedAt : null;
      const createdAt = typeof row?.createdAt === 'number' ? row.createdAt : null;
      return updatedAt ?? createdAt ?? 0;
    };

    rows.sort((left, right) => {
      if (hasReferenceTimestamp) {
        const leftDistance = Math.abs(resolveSortTime(left) - referenceTimestamp);
        const rightDistance = Math.abs(resolveSortTime(right) - referenceTimestamp);
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      }
      return resolveSortTime(right) - resolveSortTime(left);
    });

    return rows[0]?.id || null;
  }

  resolveLegacyFileTarget(value, referenceTimestamp = null) {
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    if (!normalizedValue) return null;
    if (parseAssetUrl(normalizedValue)) return normalizedValue;
    if (/^file:\/\//i.test(normalizedValue)) return normalizedValue;
    if (/^https?:\/\//i.test(normalizedValue)) return normalizedValue;

    const assetId = this.findBestAssetIdByOriginalName(normalizedValue, referenceTimestamp);
    return assetId ? createAssetUrl(assetId) : null;
  }

  repairMessageFileTargets(message, options = {}) {
    if (!message || typeof message !== 'object') return message;

    const fallbackTimestamp = typeof message.time === 'number' && Number.isFinite(message.time)
      ? message.time
      : null;
    const referenceTimestamp = typeof options.referenceTimestamp === 'number' && Number.isFinite(options.referenceTimestamp)
      ? options.referenceTimestamp
      : fallbackTimestamp;
    let changed = false;
    const next = JSON.parse(JSON.stringify(message));
    const isDirectTarget = (value) => {
      if (typeof value !== 'string') return false;
      const normalizedValue = value.trim();
      if (!normalizedValue) return false;
      return Boolean(parseAssetUrl(normalizedValue))
        || /^file:\/\//i.test(normalizedValue)
        || /^https?:\/\//i.test(normalizedValue);
    };

    const repairFileItem = (item) => {
      if (!item || typeof item !== 'object' || item.type !== 'file') {
        return item;
      }

      const currentValue = typeof item.val === 'string' ? item.val.trim() : '';
      const currentFileName = typeof item.fileName === 'string' ? item.fileName.trim() : '';
      const resolvedFileName = currentFileName || (currentValue && !isDirectTarget(currentValue) ? currentValue : '');
      const resolvedTarget = this.resolveLegacyFileTarget(currentValue, referenceTimestamp)
        || this.resolveLegacyFileTarget(resolvedFileName, referenceTimestamp);

      if (!resolvedTarget && resolvedFileName === currentFileName) {
        return item;
      }

      const nextItem = { ...item };
      if (resolvedTarget && resolvedTarget !== currentValue) {
        nextItem.val = resolvedTarget;
        changed = true;
      }
      if (resolvedFileName && resolvedFileName !== currentFileName) {
        nextItem.fileName = resolvedFileName;
        changed = true;
      }
      return nextItem;
    };

    if (next.type === 'file') {
      if (next.content && typeof next.content === 'object') {
        const currentName = typeof next.content.name === 'string' ? next.content.name.trim() : '';
        const currentUrl = typeof next.content.url === 'string' ? next.content.url.trim() : '';
        const resolvedName = currentName || (currentUrl && !isDirectTarget(currentUrl) ? currentUrl : '');
        const resolvedTarget = this.resolveLegacyFileTarget(currentUrl, referenceTimestamp)
          || this.resolveLegacyFileTarget(resolvedName, referenceTimestamp);

        if (resolvedTarget && resolvedTarget !== currentUrl) {
          next.content.url = resolvedTarget;
          changed = true;
        }
        if (resolvedName && resolvedName !== currentName) {
          next.content.name = resolvedName;
          changed = true;
        }
      } else if (typeof next.content === 'string') {
        const currentValue = next.content.trim();
        const resolvedTarget = this.resolveLegacyFileTarget(currentValue, referenceTimestamp);
        if (resolvedTarget) {
          next.content = {
            name: currentValue,
            size: '未知',
            url: resolvedTarget,
          };
          changed = true;
        }
      }
    } else if (Array.isArray(next.content)) {
      next.content = next.content.map((item) => repairFileItem(item));
    }

    return changed ? next : message;
  }

  repairSortingCardMetadataFileTargets(metadata, options = {}) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;
    if (!Array.isArray(metadata.editedBlocks)) return metadata;

    const referenceTimestamp = typeof options.referenceTimestamp === 'number' && Number.isFinite(options.referenceTimestamp)
      ? options.referenceTimestamp
      : null;
    let changed = false;

    const isDirectTarget = (value) => {
      if (typeof value !== 'string') return false;
      const normalizedValue = value.trim();
      if (!normalizedValue) return false;
      return Boolean(parseAssetUrl(normalizedValue))
        || /^file:\/\//i.test(normalizedValue)
        || /^https?:\/\//i.test(normalizedValue);
    };

    const repairEditedBlock = (block) => {
      if (!block || typeof block !== 'object') return block;

      if (block.type === 'quote' && block.quote && Array.isArray(block.quote.snapshotBlocks)) {
        const nextSnapshotBlocks = block.quote.snapshotBlocks.map((item) => repairEditedBlock(item));
        if (nextSnapshotBlocks.some((item, index) => item !== block.quote.snapshotBlocks[index])) {
          changed = true;
          return {
            ...block,
            quote: {
              ...block.quote,
              snapshotBlocks: nextSnapshotBlocks,
            },
          };
        }
        return block;
      }

      if (block.type !== 'file') {
        return block;
      }

      const currentUrl = typeof block.url === 'string'
        ? block.url.trim()
        : (typeof block.val === 'string' ? block.val.trim() : '');
      const currentFileName = typeof block.fileName === 'string' ? block.fileName.trim() : '';
      const resolvedFileName = currentFileName || (currentUrl && !isDirectTarget(currentUrl) ? currentUrl : '');
      const resolvedTarget = this.resolveLegacyFileTarget(currentUrl, referenceTimestamp)
        || this.resolveLegacyFileTarget(resolvedFileName, referenceTimestamp);

      if (!resolvedTarget && resolvedFileName === currentFileName) {
        return block;
      }

      const nextBlock = { ...block };
      if (resolvedTarget && resolvedTarget !== currentUrl) {
        if (typeof nextBlock.url === 'string') {
          nextBlock.url = resolvedTarget;
        } else {
          nextBlock.val = resolvedTarget;
        }
        changed = true;
      }
      if (resolvedFileName && resolvedFileName !== currentFileName) {
        nextBlock.fileName = resolvedFileName;
        changed = true;
      }
      return nextBlock;
    };

    const editedBlocks = metadata.editedBlocks.map((block) => repairEditedBlock(block));

    if (!changed) return metadata;
    return {
      ...metadata,
      editedBlocks,
    };
  }

  rewriteLegacyMediaValue(value) {
    const fileName = extractLegacyUploadFileName(value);
    if (!fileName) return value;

    if (this.legacyUploadCache.has(fileName)) {
      return this.legacyUploadCache.get(fileName);
    }

    const uploadsDir = path.join(this.legacyDataDir, 'uploads');
    const absolutePath = path.join(uploadsDir, fileName);
    if (!fs.existsSync(absolutePath)) return value;

    const imported = this.importRendererFile({
      name: fileName,
      type: guessMimeFromName(fileName),
      buffer: fs.readFileSync(absolutePath),
    });
    this.legacyUploadCache.set(fileName, imported.url);
    return imported.url;
  }
}

module.exports = {
  LocalDataStore,
};
