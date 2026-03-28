import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { getDraftMessageBlocks } from '@/features/send-message/model/bubbleDraft';
import type { BotRecord } from '@/entities/bot';
import { SortingBoxSettingsModal } from '@/features/manage-box-settings/ui/SortingBoxSettingsModal';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { useBoundedPaneSize } from '@/shared/hooks/useBoundedPaneSize';
import { getDesktopBridge } from '@/shared/lib/desktop-bridge';
import { resolveBubbleLinkBlocksForSubmit } from '@/shared/lib/bubble-link';
import { getLinkDisplayLabel } from '@/shared/lib/link';
import { uploadFile } from '@/shared/lib/upload';
import {
  compareSearchResults,
  normalizeSearchQuery,
  paginateSearchResults,
  scoreSearchText,
  type SearchRequest,
  type SearchResponse,
  type SearchResult,
  type SearchResultTarget,
  type SortingSearchLocator,
  type SortingSearchLocatorPayload,
  type SortingSearchProvider,
} from '@/shared/lib/search';
import { SearchResultPanel } from '@/shared/ui/SearchResultPanel';
import type { MessageData } from '@/entities/message';
import type {
  SortingBoxView,
  SortingCardView,
  SortingColumnView,
  SortingLayerView,
  SortingStream,
  SortingWorkspaceView,
} from '@/entities/sorting';
import {
  SIDEBAR_PANE_MIN,
  SIDEBAR_PANE_MAX,
  SIDEBAR_COLLAPSED_WIDTH,
  SOURCE_PANE_MIN,
  SOURCE_PANE_MAX,
  SOURCE_COLLAPSED_WIDTH,
  LUGGAGE_PANE_MIN,
  LUGGAGE_PANE_MAX,
  LUGGAGE_COLLAPSED_WIDTH,
  arrayEquals,
  buildSourceBubbleKey,
  isSortingBoxShortcut,
  parseSourceBubbleDraggableId,
  parseSidebarBoxDraggableId,
  extractText,
  isProjectedBubble,
  isBlankBubbleDraft,
  getBoxBubbleCount,
  buildBubbleDraft,
  buildBubbleMessagePayload,
  buildBubbleContentSummary,
  buildMessagePreviewText,
  buildSortingBubbleMessage,
  formatDateTime,
  getMessageBlocks,
  sanitizeBubbleBlocks,
  getBubbleSourceInfo,
  getSortingCardTypeLabel,
  normalizeSortingColumnName,
  BoxIcon,
  HashIcon,
  TrashIcon,
  CopyIcon,
  EditIcon,
  EyeIcon,
  MessageCircleIcon,
  UploadIcon,
  SortingContextMenu,
  SortingMenuDivider,
  SortingSourcePanel,
  SortingSidebar,
  SortingBoard,
  SortingLuggagePanel,
  SortingBubbleDetailModal,
} from './SortingWorkbench.parts';
import type {
  SortingBubbleDraft,
  SortingComposerItem,
  SortingSourceBubble,
} from './SortingWorkbench.parts';

type ThreadTarget = {
  conversationId: string;
  messageId: string;
  blockId?: string;
};

export interface SortingPaneProps {
  streams: SortingStream[];
  selectedStreamId: string;
  bots?: BotRecord[];
  defaultWorkspacePath?: string;
  onBack: () => void;
  onSaveAsBubble?: (payload: {
    message: MessageData;
    sourceIds: string[];
    cardId?: string;
    conversationId?: string;
  }) => Promise<ThreadTarget | null>;
  onSendToStream?: (payload: {
    conversationId: string;
    draft: {
      text: string;
      items: Array<Pick<SortingComposerItem, 'type' | 'val' | 'fileName'>>;
    };
  }) => void | Promise<void>;
  onOpenSourceThread?: (payload: ThreadTarget) => void;
  onRegisterSourceLocator?: (locator: ((payload: ThreadTarget) => void | Promise<void>) | null) => void;
  onRegisterSearchProvider?: (provider: SortingSearchProvider | null) => void;
  onRegisterSearchLocator?: (locator: SortingSearchLocator | null) => void;
  onRevealSearchTarget?: (target: SearchResultTarget) => void;
  onOpenGlobalBotSettings?: () => void;
}

interface BubbleMenuState {
  show: boolean;
  x: number;
  y: number;
  bubbleKey: string | null;
}

interface NodeMenuState {
  show: boolean;
  x: number;
  y: number;
  item: SortingCardView | null;
}

interface ColumnMenuState {
  show: boolean;
  x: number;
  y: number;
  columnId: string | null;
}

interface LayerMenuState {
  show: boolean;
  x: number;
  y: number;
  layer: SortingLayerView | null;
}

interface BoxMenuState {
  show: boolean;
  x: number;
  y: number;
  boxId: string | null;
}

type SortingSourceViewMode = NonNullable<SortingWorkspaceView['sourceViewMode']>;
type SortingSidebarSectionLayout = NonNullable<SortingWorkspaceView['sidebarSectionLayout']>;

const DEFAULT_SIDEBAR_SECTION_LAYOUT: SortingSidebarSectionLayout = {
  boxes: 1 / 3,
  layers: 1 / 3,
  sources: 1 / 3,
};

interface SourceSelectionState {
  selectedSourceIds: string[];
  focusedSourceId: string | null;
  sourceViewMode: SortingSourceViewMode;
}

const EMPTY_SOURCE_SELECTION: SourceSelectionState = {
  selectedSourceIds: [],
  focusedSourceId: null,
  sourceViewMode: 'focused',
};

interface PendingSourceSelectionState {
  boxId: string | null;
  selection: SourceSelectionState;
}

interface LayerSelectionState {
  selectedLayerIds: string[];
  currentLayerId: string | null;
}

interface SortingSourceDraftState {
  text: string;
  items: SortingComposerItem[];
}

interface HoveredBubbleTarget {
  kind: 'card' | 'source';
  key: string;
}

interface BubbleDetailState {
  kind: 'card' | 'source';
  key: string;
  mode: 'view' | 'edit';
}

interface CardCommentPickerState {
  cardId: string;
}

const EMPTY_SOURCE_DRAFT: SortingSourceDraftState = {
  text: '',
  items: [],
};

interface PersistedSortingUiState {
  isSidebarCollapsed: boolean;
  isSidebarLayersCollapsed: boolean;
  isSidebarSourcesCollapsed: boolean;
  isSourceCollapsed: boolean;
  isLuggageCollapsed: boolean;
  foldedBubbleKeys: string[];
}

const DEFAULT_PERSISTED_SORTING_UI_STATE: PersistedSortingUiState = {
  isSidebarCollapsed: false,
  isSidebarLayersCollapsed: false,
  isSidebarSourcesCollapsed: false,
  isSourceCollapsed: false,
  isLuggageCollapsed: false,
  foldedBubbleKeys: [],
};

function formatCommentSourcePreview(message: MessageData) {
  const text = extractText(message.content).replace(/\s+/g, ' ').trim();
  if (text) return text;
  if (message.type === 'img') return '[图片]';
  if (message.type === 'video') return '[视频]';
  if (message.type === 'audio') return '[音频]';
  if (message.type === 'file') return '[文件]';
  if (message.type === 'link') return '[链接]';
  if (message.type === 'location') return '[位置]';
  if (message.type === 'compound') return '[泡泡]';
  return '[泡泡]';
}

const SORTING_UI_STATE_STORAGE_PREFIX = 'paopao:sorting-ui';
const SORTING_CARD_INSTANCE_DRAG_PREFIX = 'sorting-card::';

function parseSortingCardInstanceDraggableId(draggableId: string) {
  if (!draggableId.startsWith(SORTING_CARD_INSTANCE_DRAG_PREFIX)) {
    return { cardId: draggableId, instanceId: null };
  }
  const payload = draggableId.slice(SORTING_CARD_INSTANCE_DRAG_PREFIX.length);
  const separatorIndex = payload.indexOf('::');
  if (separatorIndex === -1) {
    return { cardId: payload, instanceId: null };
  }
  return {
    cardId: payload.slice(0, separatorIndex),
    instanceId: payload.slice(separatorIndex + 2) || null,
  };
}

function createEmptySourceDraft(): SortingSourceDraftState {
  return {
    text: '',
    items: [],
  };
}

function getPrimaryListMatchScore(query: string, title: string, preview = '') {
  return Math.max(
    scoreSearchText(query, title, 'title'),
    scoreSearchText(query, preview, 'content'),
  );
}

function normalizePersistedSortingUiState(value: unknown): PersistedSortingUiState {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    isSidebarCollapsed: candidate.isSidebarCollapsed === true,
    isSidebarLayersCollapsed: candidate.isSidebarLayersCollapsed === true,
    isSidebarSourcesCollapsed: candidate.isSidebarSourcesCollapsed === true,
    isSourceCollapsed: candidate.isSourceCollapsed === true,
    isLuggageCollapsed: candidate.isLuggageCollapsed === true,
    foldedBubbleKeys: Array.isArray(candidate.foldedBubbleKeys)
      ? [...new Set(candidate.foldedBubbleKeys.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))]
      : [],
  };
}

function getSortingUiStateStorageKey(workspaceId: string) {
  return `${SORTING_UI_STATE_STORAGE_PREFIX}:${workspaceId}`;
}

function readPersistedSortingUiState(workspaceId: string): PersistedSortingUiState {
  if (!workspaceId) return { ...DEFAULT_PERSISTED_SORTING_UI_STATE };
  try {
    const rawValue = window.localStorage.getItem(getSortingUiStateStorageKey(workspaceId));
    if (!rawValue) return { ...DEFAULT_PERSISTED_SORTING_UI_STATE };
    return normalizePersistedSortingUiState(JSON.parse(rawValue));
  } catch {
    return { ...DEFAULT_PERSISTED_SORTING_UI_STATE };
  }
}

function writePersistedSortingUiState(workspaceId: string, value: PersistedSortingUiState) {
  if (!workspaceId) return;
  try {
    window.localStorage.setItem(
      getSortingUiStateStorageKey(workspaceId),
      JSON.stringify(normalizePersistedSortingUiState(value)),
    );
  } catch {
    // Ignore storage failures and keep the current in-memory UI state usable.
  }
}

function classifyComposerFile(file: File, url: string): SortingComposerItem {
  if (file.type.startsWith('image/')) return { id: crypto.randomUUID(), type: 'img', val: url, fileName: file.name };
  if (file.type.startsWith('video/')) return { id: crypto.randomUUID(), type: 'video', val: url, fileName: file.name };
  if (file.type.startsWith('audio/')) return { id: crypto.randomUUID(), type: 'audio', val: url, fileName: file.name };
  return { id: crypto.randomUUID(), type: 'file', val: url, fileName: file.name };
}

function sanitizeComposerItems(items: SortingComposerItem[]) {
  return items
    .map((item) => {
      const val = typeof item.val === 'string' ? item.val.trim() : '';
      if (item.type === 'text' || item.type === 'link' || item.type === 'file') {
        return { ...item, val };
      }
      return item.val ? item : { ...item, val };
    })
    .filter((item) => {
      if (item.type === 'text' || item.type === 'link' || item.type === 'file') {
        return Boolean(item.val.trim());
      }
      return Boolean(item.val);
    });
}

function resolveVisibleDropToAbsoluteIndex(
  fullIds: string[],
  visibleIds: string[],
  visibleIndex: number,
) {
  if (visibleIds.length === 0) {
    return fullIds.length;
  }
  if (visibleIndex <= 0) {
    const firstVisibleId = visibleIds[0];
    const absoluteIndex = fullIds.indexOf(firstVisibleId);
    return absoluteIndex >= 0 ? absoluteIndex : 0;
  }
  if (visibleIndex >= visibleIds.length) {
    const lastVisibleId = visibleIds[visibleIds.length - 1];
    const absoluteIndex = fullIds.indexOf(lastVisibleId);
    return absoluteIndex >= 0 ? absoluteIndex + 1 : fullIds.length;
  }
  const nextVisibleId = visibleIds[visibleIndex];
  const absoluteIndex = fullIds.indexOf(nextVisibleId);
  return absoluteIndex >= 0 ? absoluteIndex : fullIds.length;
}

export function SortingWorkbench({
  streams,
  selectedStreamId,
  bots = [],
  defaultWorkspacePath = '',
  onBack,
  onSaveAsBubble,
  onSendToStream,
  onOpenSourceThread,
  onRegisterSourceLocator,
  onRegisterSearchProvider,
  onRegisterSearchLocator,
  onRevealSearchTarget,
  onOpenGlobalBotSettings,
}: SortingPaneProps) {
  const bridge = getDesktopBridge();
  const [workspace, setWorkspace] = useState<SortingWorkspaceView | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(selectedStreamId ? [selectedStreamId] : []);
  const [focusedSourceId, setFocusedSourceId] = useState<string | null>(selectedStreamId || null);
  const [sourceViewMode, setSourceViewMode] = useState<SortingSourceViewMode>('focused');
  const [isSourceListView, setIsSourceListView] = useState(!selectedStreamId);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [currentLayerId, setCurrentLayerId] = useState<string | null>(null);
  const [activeBoxId, setActiveBoxId] = useState<string>('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarDrawerAnimating, setIsSidebarDrawerAnimating] = useState(false);
  const [isSidebarLayersCollapsed, setIsSidebarLayersCollapsed] = useState(false);
  const [isSidebarSourcesCollapsed, setIsSidebarSourcesCollapsed] = useState(false);
  const [isSourceCollapsed, setIsSourceCollapsed] = useState(false);
  const [isLuggageCollapsed, setIsLuggageCollapsed] = useState(false);
  const [boxListSearchQuery, setBoxListSearchQuery] = useState('');
  const [sourceListSearchQuery, setSourceListSearchQuery] = useState('');
  const [sourceDetailSearchQuery, setSourceDetailSearchQuery] = useState('');
  const [isLocalSearchOpen, setIsLocalSearchOpen] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [localSearchResults, setLocalSearchResults] = useState<SearchResult[]>([]);
  const [localSearchTotal, setLocalSearchTotal] = useState(0);
  const [localSearchHasMore, setLocalSearchHasMore] = useState(false);
  const [localSearchSelectedIndex, setLocalSearchSelectedIndex] = useState(0);
  const [isDetailSearchOpen, setIsDetailSearchOpen] = useState(false);
  const [detailSearchQuery, setDetailSearchQuery] = useState('');
  const [detailSearchResults, setDetailSearchResults] = useState<SearchResult[]>([]);
  const [detailSearchTotal, setDetailSearchTotal] = useState(0);
  const [detailSearchHasMore, setDetailSearchHasMore] = useState(false);
  const [detailSearchSelectedIndex, setDetailSearchSelectedIndex] = useState(0);
  const [pendingSearchLocateTarget, setPendingSearchLocateTarget] = useState<SortingSearchLocatorPayload | null>(null);
  const [toast, setToast] = useState('');
  const [editingBubbleId, setEditingBubbleId] = useState<string | null>(null);
  const [editingBubbleDraft, setEditingBubbleDraft] = useState<SortingBubbleDraft | null>(null);
  const [expandedBubbleIds, setExpandedBubbleIds] = useState<Set<string>>(new Set());
  const [bubbleMenu, setBubbleMenu] = useState<BubbleMenuState>({ show: false, x: 0, y: 0, bubbleKey: null });
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState>({ show: false, x: 0, y: 0, item: null });
  const [columnMenu, setColumnMenu] = useState<ColumnMenuState>({ show: false, x: 0, y: 0, columnId: null });
  const [layerMenu, setLayerMenu] = useState<LayerMenuState>({ show: false, x: 0, y: 0, layer: null });
  const [boxMenu, setBoxMenu] = useState<BoxMenuState>({ show: false, x: 0, y: 0, boxId: null });
  const [foldedBubbles, setFoldedBubbles] = useState<Set<string>>(new Set());
  const [highlightedSourceBubbleKey, setHighlightedSourceBubbleKey] = useState<string | null>(null);
  const [highlightedSearchBoxId, setHighlightedSearchBoxId] = useState<string | null>(null);
  const [highlightedSearchLayerId, setHighlightedSearchLayerId] = useState<string | null>(null);
  const [highlightedSearchColumnId, setHighlightedSearchColumnId] = useState<string | null>(null);
  const [highlightedSearchItemId, setHighlightedSearchItemId] = useState<string | null>(null);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingColName, setEditingColName] = useState('');
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const [editingBoxName, setEditingBoxName] = useState('');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingLayerName, setEditingLayerName] = useState('');
  const [addingLayer, setAddingLayer] = useState(false);
  const [newLayerName, setNewLayerName] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [hoveredBubbleTarget, setHoveredBubbleTarget] = useState<HoveredBubbleTarget | null>(null);
  const [bubbleDetail, setBubbleDetail] = useState<BubbleDetailState | null>(null);
  const [cardCommentPicker, setCardCommentPicker] = useState<CardCommentPickerState | null>(null);
  const [boxSettingsOpen, setBoxSettingsOpen] = useState(false);
  const [boxSettingsInitialBotId, setBoxSettingsInitialBotId] = useState<string | null>(null);
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, SortingSourceDraftState>>({});
  const [isSendingSourceMessage, setIsSendingSourceMessage] = useState(false);
  const [isPreparingSourceDraft, setIsPreparingSourceDraft] = useState(false);
  const [hydratedSortingUiWorkspaceId, setHydratedSortingUiWorkspaceId] = useState<string | null>(null);

  const sidebarPane = useBoundedPaneSize({ initial: 252, min: SIDEBAR_PANE_MIN, max: SIDEBAR_PANE_MAX });
  const sourcePane = useBoundedPaneSize({ initial: 368, min: SOURCE_PANE_MIN, max: SOURCE_PANE_MAX });
  const luggagePane = useBoundedPaneSize({ initial: 248, min: LUGGAGE_PANE_MIN, max: LUGGAGE_PANE_MAX });
  const editColRef = useRef<HTMLInputElement>(null);
  const editBoxRef = useRef<HTMLInputElement>(null);
  const editLayerRef = useRef<HTMLInputElement>(null);
  const newLayerRef = useRef<HTMLInputElement>(null);
  const newColRef = useRef<HTMLInputElement>(null);
  const localSearchInputRef = useRef<HTMLInputElement>(null);
  const detailSearchInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const sidebarDrawerTimerRef = useRef<number | null>(null);
  const sourceHighlightTimerRef = useRef<number | null>(null);
  const searchHighlightTimerRef = useRef<number | null>(null);
  const hoveredBubbleTargetRef = useRef<HoveredBubbleTarget | null>(null);
  const workspaceRef = useRef<SortingWorkspaceView | null>(null);
  const workspaceRequestSeqRef = useRef(0);
  const hasHydratedSourceSelectionRef = useRef(false);
  const workspaceId = workspace?.workspaceId || null;
  const sourceSelectionRef = useRef<SourceSelectionState>({
    selectedSourceIds,
    focusedSourceId,
    sourceViewMode,
  });
  const boxSourceSelectionCacheRef = useRef<Map<string, SourceSelectionState>>(new Map());
  const selectedStreamIdRef = useRef<string>(selectedStreamId);
  const isPersistingSourceSelectionRef = useRef(false);
  const pendingSourceSelectionsRef = useRef<Map<string, PendingSourceSelectionState>>(new Map());

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2200);
  }, []);

  const highlightSearchTarget = useCallback((
    kind: 'box' | 'layer' | 'column' | 'item',
    id: string,
  ) => {
    if (searchHighlightTimerRef.current) {
      window.clearTimeout(searchHighlightTimerRef.current);
    }
    setHighlightedSearchBoxId(kind === 'box' ? id : null);
    setHighlightedSearchLayerId(kind === 'layer' ? id : null);
    setHighlightedSearchColumnId(kind === 'column' ? id : null);
    setHighlightedSearchItemId(kind === 'item' ? id : null);
    searchHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedSearchBoxId(null);
      setHighlightedSearchLayerId(null);
      setHighlightedSearchColumnId(null);
      setHighlightedSearchItemId(null);
      searchHighlightTimerRef.current = null;
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (sidebarDrawerTimerRef.current) {
        window.clearTimeout(sidebarDrawerTimerRef.current);
      }
      if (sourceHighlightTimerRef.current) {
        window.clearTimeout(sourceHighlightTimerRef.current);
      }
      if (searchHighlightTimerRef.current) {
        window.clearTimeout(searchHighlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    sourceSelectionRef.current = {
      selectedSourceIds,
      focusedSourceId,
      sourceViewMode,
    };
  }, [focusedSourceId, selectedSourceIds, sourceViewMode]);

  useEffect(() => {
    hoveredBubbleTargetRef.current = hoveredBubbleTarget;
  }, [hoveredBubbleTarget]);

  useEffect(() => {
    selectedStreamIdRef.current = selectedStreamId;
  }, [selectedStreamId]);

  useEffect(() => {
    if (!workspaceId) {
      setHydratedSortingUiWorkspaceId(null);
      return;
    }
    const persistedUiState = readPersistedSortingUiState(workspaceId);
    setIsSidebarCollapsed(persistedUiState.isSidebarCollapsed);
    setIsSidebarLayersCollapsed(persistedUiState.isSidebarLayersCollapsed);
    setIsSidebarSourcesCollapsed(persistedUiState.isSidebarSourcesCollapsed);
    setIsSourceCollapsed(persistedUiState.isSourceCollapsed);
    setIsLuggageCollapsed(persistedUiState.isLuggageCollapsed);
    setFoldedBubbles(new Set(persistedUiState.foldedBubbleKeys));
    setHydratedSortingUiWorkspaceId(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || hydratedSortingUiWorkspaceId !== workspaceId) return;
    writePersistedSortingUiState(workspaceId, {
      isSidebarCollapsed,
      isSidebarLayersCollapsed,
      isSidebarSourcesCollapsed,
      isSourceCollapsed,
      isLuggageCollapsed,
      foldedBubbleKeys: Array.from(foldedBubbles),
    });
  }, [
    foldedBubbles,
    hydratedSortingUiWorkspaceId,
    isLuggageCollapsed,
    isSidebarCollapsed,
    isSidebarLayersCollapsed,
    isSidebarSourcesCollapsed,
    isSourceCollapsed,
    workspaceId,
  ]);

  const sanitizeSourceIds = useCallback((candidateIds: string[]) => {
    const normalizedIds = [...new Set(
      candidateIds
        .filter((id) => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean),
    )];
    if (streams.length === 0) {
      return normalizedIds;
    }
    const available = new Set(streams.map((stream) => stream.id));
    return normalizedIds.filter((id) => available.has(id));
  }, [streams]);

  const sanitizeSourceSelection = useCallback((candidate: Partial<SourceSelectionState>): SourceSelectionState => {
    const requestedIds = Array.isArray(candidate.selectedSourceIds) ? candidate.selectedSourceIds : [];
    const normalizedSourceIds = sanitizeSourceIds(requestedIds);
    const requestedFocusedSourceId = typeof candidate.focusedSourceId === 'string' ? candidate.focusedSourceId : null;
    const requestedViewMode: SortingSourceViewMode = candidate.sourceViewMode === 'all-selected' ? 'all-selected' : 'focused';
    const nextFocusedSourceId = requestedFocusedSourceId && normalizedSourceIds.includes(requestedFocusedSourceId)
      ? requestedFocusedSourceId
      : normalizedSourceIds[0] || null;

    return {
      selectedSourceIds: normalizedSourceIds,
      focusedSourceId: nextFocusedSourceId,
      sourceViewMode: normalizedSourceIds.length > 1 && requestedViewMode === 'all-selected' ? 'all-selected' : 'focused',
    };
  }, [sanitizeSourceIds]);

  const applyLocalSourceSelection = useCallback((selection: SourceSelectionState) => {
    hasHydratedSourceSelectionRef.current = true;
    sourceSelectionRef.current = selection;
    setSelectedSourceIds(selection.selectedSourceIds);
    setFocusedSourceId(selection.focusedSourceId);
    setSourceViewMode(selection.sourceViewMode);
  }, []);

  const persistSourceSelection = useCallback(async (candidate: Partial<SourceSelectionState>) => {
    const normalizedSelection = sanitizeSourceSelection({
      ...sourceSelectionRef.current,
      ...candidate,
    });
    const targetBoxId = activeBoxId || workspaceRef.current?.activeBoxId || null;
    const pendingKey = targetBoxId || '__default__';

    if (targetBoxId) {
      boxSourceSelectionCacheRef.current.set(targetBoxId, normalizedSelection);
    }

    applyLocalSourceSelection(normalizedSelection);

    pendingSourceSelectionsRef.current.set(pendingKey, {
      boxId: targetBoxId,
      selection: normalizedSelection,
    });

    if (!bridge) return normalizedSelection;
    if (isPersistingSourceSelectionRef.current) return normalizedSelection;

    isPersistingSourceSelectionRef.current = true;
    try {
      while (pendingSourceSelectionsRef.current.size > 0) {
        const pendingEntries = Array.from(pendingSourceSelectionsRef.current.values());
        pendingSourceSelectionsRef.current.clear();
        for (const entry of pendingEntries) {
          await bridge.sorting.save({
            selectedSourceIds: entry.selection.selectedSourceIds,
            focusedSourceId: entry.selection.focusedSourceId,
            sourceViewMode: entry.selection.sourceViewMode,
            sourceSelectionBoxId: entry.boxId,
          });
        }
      }
    } catch {
      pendingSourceSelectionsRef.current.clear();
      showToast('泡泡流选择保存失败，请重试');
    } finally {
      isPersistingSourceSelectionRef.current = false;
    }

    return normalizedSelection;
  }, [activeBoxId, applyLocalSourceSelection, bridge, sanitizeSourceSelection, showToast]);

  const applyWorkspace = useCallback((nextWorkspace: SortingWorkspaceView) => {
    const previousActiveBoxId = workspaceRef.current?.activeBoxId || null;

    const normalizedColumns = Array.isArray(nextWorkspace.columns)
      ? nextWorkspace.columns.map((column) => {
        const legacyColumn = column as SortingColumnView & {
          layerId?: string | null;
          layerIds?: string[];
          displayLayerId?: string | null;
          displayLayerName?: string | null;
        };
        const boundLayerIds = Array.isArray(column.boundLayerIds)
          ? column.boundLayerIds
          : (
            Array.isArray(legacyColumn.layerIds)
              ? legacyColumn.layerIds
              : (typeof legacyColumn.layerId === 'string' && legacyColumn.layerId.trim()
                ? [legacyColumn.layerId.trim()]
                : [])
          );
        return {
          ...column,
          name: normalizeSortingColumnName(column.id, column.name),
          boundLayerIds,
          instanceLayerId: column.instanceLayerId ?? legacyColumn.displayLayerId ?? null,
          instanceLayerName: column.instanceLayerName ?? legacyColumn.displayLayerName ?? null,
        };
      })
      : [];

    const normalizedItemMap = Object.fromEntries(
      Object.entries(nextWorkspace.itemMap || {}).map(([itemId, item]) => {
        const legacyItem = item as SortingCardView & { boxRefId?: string };
        return [itemId, {
          ...item,
          childBoxId: item.childBoxId ?? legacyItem.boxRefId,
        }];
      }),
    );

    const sourceStateFromWorkspace = sanitizeSourceSelection({
      selectedSourceIds: Array.isArray(nextWorkspace.selectedSourceIds) && nextWorkspace.selectedSourceIds.length > 0
        ? nextWorkspace.selectedSourceIds
        : (selectedStreamIdRef.current ? [selectedStreamIdRef.current] : []),
      focusedSourceId: nextWorkspace.focusedSourceId,
      sourceViewMode: nextWorkspace.sourceViewMode,
    });

    const sourceStateFromLocalState = sanitizeSourceSelection(sourceSelectionRef.current);
    const shouldUseWorkspaceSourceState = !hasHydratedSourceSelectionRef.current
      || previousActiveBoxId !== nextWorkspace.activeBoxId;

    const normalizedSourceState = shouldUseWorkspaceSourceState
      ? sourceStateFromWorkspace
      : sourceStateFromLocalState;

    if (!hasHydratedSourceSelectionRef.current) {
      hasHydratedSourceSelectionRef.current = true;
    }

    const normalizedWorkspace = {
      ...nextWorkspace,
      currentLayerId: (
        typeof nextWorkspace.currentLayerId === 'string' && nextWorkspace.currentLayerId.trim()
          ? nextWorkspace.currentLayerId.trim()
          : ((nextWorkspace as SortingWorkspaceView & { focusedLayerId?: string | null }).focusedLayerId || null)
      ),
      columns: normalizedColumns,
      itemMap: normalizedItemMap,
      selectedSourceIds: normalizedSourceState.selectedSourceIds,
      focusedSourceId: normalizedSourceState.focusedSourceId,
      sourceViewMode: normalizedSourceState.sourceViewMode,
      canvasNodes: Array.isArray(nextWorkspace.canvasNodes) ? nextWorkspace.canvasNodes : [],
      canvasEdges: Array.isArray(nextWorkspace.canvasEdges) ? nextWorkspace.canvasEdges : [],
    };

    const nextActiveBoxId = normalizedWorkspace.activeBoxId || normalizedWorkspace.boxes[0]?.id || '';
    const nextBoxSourceSelectionCache = new Map(boxSourceSelectionCacheRef.current);

    if (nextWorkspace.boxSourceSelections && typeof nextWorkspace.boxSourceSelections === 'object') {
      Object.entries(nextWorkspace.boxSourceSelections).forEach(([boxId, selection]) => {
        if (!boxId) return;
        nextBoxSourceSelectionCache.set(boxId, sanitizeSourceSelection(selection || {}));
      });
    }

    if (nextActiveBoxId) {
      nextBoxSourceSelectionCache.set(nextActiveBoxId, normalizedSourceState);
    }

    boxSourceSelectionCacheRef.current = nextBoxSourceSelectionCache;

    workspaceRef.current = normalizedWorkspace;
    setWorkspace(normalizedWorkspace);
    applyLocalSourceSelection(normalizedSourceState);
    setSelectedLayerIds(Array.isArray(normalizedWorkspace.selectedLayerIds) ? normalizedWorkspace.selectedLayerIds : []);
    setCurrentLayerId(typeof normalizedWorkspace.currentLayerId === 'string' ? normalizedWorkspace.currentLayerId : null);
    setActiveBoxId(nextActiveBoxId);

    return normalizedWorkspace;
  }, [applyLocalSourceSelection, sanitizeSourceSelection]);

  const patchWorkspaceItem = useCallback((
    itemId: string,
    updater: (item: SortingCardView) => SortingCardView,
  ) => {
    setWorkspace((current) => {
      if (!current) return current;
      const target = current.itemMap?.[itemId];
      if (!target) return current;
      const nextItem = updater(target);
      const nextWorkspace = {
        ...current,
        itemMap: {
          ...current.itemMap,
          [itemId]: nextItem,
        },
      };
      workspaceRef.current = nextWorkspace;
      return nextWorkspace;
    });
  }, []);

  const requestWorkspace = useCallback(async (
    request: () => Promise<SortingWorkspaceView>,
  ) => {
    if (!bridge) return null;
    const requestSeq = ++workspaceRequestSeqRef.current;
    const nextWorkspace = await request();
    if (requestSeq !== workspaceRequestSeqRef.current) {
      return workspaceRef.current;
    }
    return applyWorkspace(nextWorkspace);
  }, [applyWorkspace, bridge]);

  const loadWorkspace = useCallback(async () => {
    await requestWorkspace(() => bridge!.sorting.get());
  }, [bridge, requestWorkspace]);

  const saveWorkspace = useCallback(async (payload: Record<string, unknown>) => {
    if (!bridge) return null;
    return requestWorkspace(() => bridge.sorting.save(payload));
  }, [bridge, requestWorkspace]);

  const updateWorkspace = useCallback(async (payload: Record<string, unknown>) => {
    if (!bridge) return null;
    return requestWorkspace(() => bridge.sorting.update(payload));
  }, [bridge, requestWorkspace]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const closeMenus = () => {
      setBubbleMenu((menu) => (menu.show ? { ...menu, show: false } : menu));
      setNodeMenu((menu) => (menu.show ? { ...menu, show: false } : menu));
      setColumnMenu((menu) => (menu.show ? { ...menu, show: false } : menu));
      setLayerMenu((menu) => (menu.show ? { ...menu, show: false } : menu));
      setBoxMenu((menu) => (menu.show ? { ...menu, show: false } : menu));
    };
    document.addEventListener('click', closeMenus);
    return () => document.removeEventListener('click', closeMenus);
  }, []);

  useEffect(() => {
    if (editingColId && editColRef.current) editColRef.current.focus();
  }, [editingColId]);

  useEffect(() => {
    if (editingBoxId && editBoxRef.current) editBoxRef.current.focus();
  }, [editingBoxId]);

  useEffect(() => {
    if (editingLayerId && editLayerRef.current) editLayerRef.current.focus();
  }, [editingLayerId]);

  useEffect(() => {
    if (addingLayer && newLayerRef.current) newLayerRef.current.focus();
  }, [addingLayer]);

  useEffect(() => {
    if (addingColumn && newColRef.current) newColRef.current.focus();
  }, [addingColumn]);

  useEffect(() => {
    if (!workspace) return;
    const normalized = sanitizeSourceSelection(sourceSelectionRef.current);
    if (
      arrayEquals(normalized.selectedSourceIds, selectedSourceIds)
      && normalized.focusedSourceId === focusedSourceId
      && normalized.sourceViewMode === sourceViewMode
    ) {
      return;
    }
    void persistSourceSelection(normalized);
  }, [focusedSourceId, persistSourceSelection, selectedSourceIds, sourceViewMode, sanitizeSourceSelection, workspace]);

  const boxes = workspace?.boxes || [];
  const layers = workspace?.layers || [];
  const columns = workspace?.columns || [];
  const columnItems = workspace?.columnItems || {};
  const itemMap = workspace?.itemMap || {};
  const luggageColumnId = workspace?.luggageColumnId || '__luggage__';
  const sidebarSectionLayout: SortingSidebarSectionLayout = workspace?.sidebarSectionLayout || DEFAULT_SIDEBAR_SECTION_LAYOUT;

  useEffect(() => {
    if (!editingBoxId) return;
    const boxExists = boxes.some((box) => box.id === editingBoxId);
    if (boxExists) return;
    setEditingBoxId(null);
    setEditingBoxName('');
  }, [boxes, editingBoxId]);

  useEffect(() => {
    if (!editingLayerId) return;
    const layerExists = layers.some((layer) => layer.boxId === activeBoxId && layer.id === editingLayerId);
    if (layerExists) return;
    setEditingLayerId(null);
    setEditingLayerName('');
  }, [activeBoxId, editingLayerId, layers]);

  useEffect(() => {
    setAddingLayer(false);
    setNewLayerName('');
    setEditingLayerId(null);
    setEditingLayerName('');
  }, [activeBoxId]);

  const streamsById = useMemo(() => new Map(streams.map((stream) => [stream.id, stream])), [streams]);
  const allStreamBubbleMap = useMemo(() => new Map(
    streams.flatMap((stream) => stream.messages.map((bubble) => [buildSourceBubbleKey(stream.id, bubble.id), {
      key: buildSourceBubbleKey(stream.id, bubble.id),
      streamId: stream.id,
      streamTitle: stream.title,
      bubble,
    } satisfies SortingSourceBubble])),
  ), [streams]);
  const selectedStreams = useMemo(
    () => streams.filter((stream) => selectedSourceIds.includes(stream.id)),
    [selectedSourceIds, streams],
  );
  const boxById = useMemo(
    () => new Map(boxes.map((box) => [box.id, box])),
    [boxes],
  );
  const layerById = useMemo(
    () => new Map(layers.map((layer) => [layer.id, layer])),
    [layers],
  );
  const columnById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );
  const effectiveFocusedSourceId = useMemo(() => {
    if (selectedStreams.length === 0) return null;
    if (focusedSourceId && selectedSourceIds.includes(focusedSourceId)) return focusedSourceId;
    return selectedStreams[0]?.id || null;
  }, [focusedSourceId, selectedSourceIds, selectedStreams]);
  const currentSourceId = effectiveFocusedSourceId;
  const currentSourceDraft = currentSourceId ? (sourceDrafts[currentSourceId] || EMPTY_SOURCE_DRAFT) : EMPTY_SOURCE_DRAFT;
  const currentSourceDraftItems = useMemo(
    () => sanitizeComposerItems(currentSourceDraft.items),
    [currentSourceDraft.items],
  );
  const focusedStream = useMemo(
    () => (effectiveFocusedSourceId ? streamsById.get(effectiveFocusedSourceId) || null : null),
    [effectiveFocusedSourceId, streamsById],
  );
  useEffect(() => {
    if (!currentSourceId) {
      setIsSourceListView(true);
    }
  }, [currentSourceId]);
  const visibleSourceStreams = useMemo(
    () => {
      if (sourceViewMode === 'all-selected') return selectedStreams;
      return focusedStream ? [focusedStream] : [];
    },
    [focusedStream, selectedStreams, sourceViewMode],
  );
  const visibleBubbles = useMemo(
    () => visibleSourceStreams
      .flatMap((stream) => stream.messages.map((bubble) => ({
        key: buildSourceBubbleKey(stream.id, bubble.id),
        streamId: stream.id,
        streamTitle: stream.title,
        bubble,
      })))
      .sort((left, right) => (right.bubble.time || 0) - (left.bubble.time || 0)),
    [visibleSourceStreams],
  );
  const visibleSourceListStreamIds = useMemo(() => {
    const query = sourceListSearchQuery.trim();
    if (!query) return streams.map((stream) => stream.id);
    return streams
      .filter((stream) => {
        const lastMessage = stream.messages[stream.messages.length - 1] || null;
        const preview = lastMessage ? buildMessagePreviewText(lastMessage) || '' : '';
        return getPrimaryListMatchScore(query, stream.title, preview) > 0;
      })
      .map((stream) => stream.id);
  }, [sourceListSearchQuery, streams]);
  const sourceComposerPlaceholder = useMemo(() => {
    if (!currentSourceId) return '先选择一个泡泡流...';
    return '发送泡泡...';
  }, [currentSourceId]);
  const bubbleMap = useMemo(
    () => new Map(visibleBubbles.map((entry) => [entry.key, entry])),
    [visibleBubbles],
  );
  const sourceInfoMap = useMemo(() => Object.fromEntries(
    Object.values(itemMap).map((item) => [item.id, getBubbleSourceInfo(item, streamsById)]),
  ), [itemMap, streamsById]);
  const cardCommentOptions = useMemo(() => {
    if (!cardCommentPicker) return [];
    const item = itemMap[cardCommentPicker.cardId];
    if (!item || item.type !== 'card') return [];
    const sourceKeys = sourceInfoMap[item.id]?.keys || [];
    return sourceKeys
      .map((key) => {
        const sourceBubble = allStreamBubbleMap.get(key);
        if (!sourceBubble) return null;
        return {
          key,
          streamId: sourceBubble.streamId,
          streamTitle: sourceBubble.streamTitle,
          bubbleId: sourceBubble.bubble.id,
          preview: formatCommentSourcePreview(sourceBubble.bubble),
          timeLabel: sourceBubble.bubble.time ? formatDateTime(sourceBubble.bubble.time) : '刚刚',
        };
      })
      .filter((option): option is NonNullable<typeof option> => Boolean(option));
  }, [allStreamBubbleMap, cardCommentPicker, itemMap, sourceInfoMap]);
  const highlightSourceBubble = useCallback((bubbleKey: string) => {
    if (sourceHighlightTimerRef.current) {
      window.clearTimeout(sourceHighlightTimerRef.current);
    }
    setHighlightedSourceBubbleKey(bubbleKey);
    sourceHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedSourceBubbleKey(null);
      sourceHighlightTimerRef.current = null;
    }, 1500);
  }, []);
  const locateSourceBubble = useCallback(async ({
    conversationId,
    messageId,
  }: {
    conversationId: string;
    messageId: string;
    blockId?: string;
  }) => {
    const stream = streamsById.get(conversationId);
    if (!stream || !stream.messages.some((message) => message.id === messageId)) {
      showToast('原泡泡暂时不可定位');
      return;
    }
    const bubbleKey = buildSourceBubbleKey(conversationId, messageId);
    const currentSelection = sourceSelectionRef.current;
    const isVisible = currentSelection.sourceViewMode === 'all-selected'
      ? currentSelection.selectedSourceIds.includes(conversationId)
      : currentSelection.focusedSourceId === conversationId;

    setIsSourceCollapsed(false);
    setIsSourceListView(false);
    setSourceDetailSearchQuery('');
    setFoldedBubbles((prev) => {
      if (!prev.has(bubbleKey)) return prev;
      const next = new Set(prev);
      next.delete(bubbleKey);
      return next;
    });

    if (!isVisible) {
      const nextSelectedSourceIds = currentSelection.selectedSourceIds.includes(conversationId)
        ? currentSelection.selectedSourceIds
        : [...currentSelection.selectedSourceIds, conversationId];
      await persistSourceSelection({
        selectedSourceIds: nextSelectedSourceIds,
        focusedSourceId: conversationId,
        sourceViewMode: currentSelection.sourceViewMode === 'all-selected' && nextSelectedSourceIds.length > 1
          ? 'all-selected'
          : 'focused',
      });
    }

    highlightSourceBubble(bubbleKey);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(`[data-sorting-source-key="${bubbleKey}"]`);
        if (!element) return;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }, [highlightSourceBubble, persistSourceSelection, showToast, streamsById]);

  useEffect(() => {
    if (!onRegisterSourceLocator) return undefined;
    onRegisterSourceLocator(locateSourceBubble);
    return () => onRegisterSourceLocator(null);
  }, [locateSourceBubble, onRegisterSourceLocator]);
  const {
    homeBoxId,
    parentBox,
    breadcrumbBoxes,
    switchBoxes,
  } = useMemo(() => {
    const parentBoxIdById = new Map<string, string | null>();
    const childBoxIdsByParent = new Map<string, string[]>();
    const columnBoxIdById = new Map(columns.map((column) => [column.id, column.boxId]));

    boxes.forEach((box) => {
      parentBoxIdById.set(box.id, null);
    });

    Object.values(itemMap).forEach((item) => {
      if (
        item.type !== 'box'
        || isSortingBoxShortcut(item)
        || !item.childBoxId
        || !boxById.has(item.childBoxId)
      ) return;
      const parentBoxId = columnBoxIdById.get(item.columnId) || null;
      if (!parentBoxId || !boxById.has(parentBoxId) || parentBoxId === item.childBoxId) return;
      if (parentBoxIdById.get(item.childBoxId) !== null) return;
      parentBoxIdById.set(item.childBoxId, parentBoxId);
    });

    boxes.forEach((box) => {
      const parentBoxId = parentBoxIdById.get(box.id);
      if (!parentBoxId) return;
      const siblings = childBoxIdsByParent.get(parentBoxId) || [];
      siblings.push(box.id);
      childBoxIdsByParent.set(parentBoxId, siblings);
    });

    const safeActiveBox = boxById.get(activeBoxId) || boxes[0] || null;
    const nextBreadcrumbBoxes: SortingBoxView[] = [];
    const visited = new Set<string>();
    let cursorId = safeActiveBox?.id || null;
    while (cursorId && !visited.has(cursorId)) {
      visited.add(cursorId);
      const box = boxById.get(cursorId);
      if (!box) break;
      nextBreadcrumbBoxes.unshift(box);
      cursorId = parentBoxIdById.get(cursorId) || null;
    }

    const inferredHomeBox = boxes.find((box) => !parentBoxIdById.get(box.id) && childBoxIdsByParent.has(box.id))
      || boxes.find((box) => !parentBoxIdById.get(box.id))
      || nextBreadcrumbBoxes[0]
      || null;
    const activeParentBoxId = safeActiveBox ? (parentBoxIdById.get(safeActiveBox.id) || null) : null;
    const siblingBoxIds = activeParentBoxId
      ? (childBoxIdsByParent.get(activeParentBoxId) || [])
      : [];
    const childBoxIds = safeActiveBox
      ? (childBoxIdsByParent.get(safeActiveBox.id) || [])
      : [];
    const nextSwitchBoxIds = siblingBoxIds.length > 0
      ? siblingBoxIds
      : (childBoxIds.length > 0
        ? childBoxIds
        : (safeActiveBox ? [safeActiveBox.id] : []));
    const nextSwitchBoxes = nextSwitchBoxIds
      .map((boxId) => boxById.get(boxId))
      .filter((box): box is SortingBoxView => Boolean(box));
    return {
      homeBoxId: inferredHomeBox?.id || null,
      parentBox: activeParentBoxId ? boxById.get(activeParentBoxId) || null : null,
      breadcrumbBoxes: nextBreadcrumbBoxes,
      switchBoxes: nextSwitchBoxes,
    };
  }, [activeBoxId, boxById, boxes, columns, itemMap]);
  const visibleSwitchBoxes = useMemo(() => {
    const query = boxListSearchQuery.trim();
    if (!query) return switchBoxes;
    return boxes.filter((box) => scoreSearchText(query, box.name, 'title') > 0);
  }, [boxListSearchQuery, boxes, switchBoxes]);
  const activeBox = useMemo(
    () => boxById.get(activeBoxId) || boxes[0],
    [activeBoxId, boxById, boxes],
  );
  const boxLayers = useMemo(
    () => layers.filter((layer) => layer.boxId === activeBoxId),
    [activeBoxId, layers],
  );
  const boxColumns = useMemo(
    () => columns.filter((column) => column.boxId === activeBoxId && !column.systemKey),
    [activeBoxId, columns],
  );
  const getColumnBoundLayerIds = useCallback((column: SortingColumnView) => {
    const legacyColumn = column as SortingColumnView & { layerId?: string | null; layerIds?: string[] };
    const explicitLayerIds = Array.isArray(column.boundLayerIds)
      ? column.boundLayerIds
        .filter((layerId): layerId is string => typeof layerId === 'string' && Boolean(layerId.trim()))
        .map((layerId) => layerId.trim())
      : (Array.isArray(legacyColumn.layerIds)
        ? legacyColumn.layerIds
          .filter((layerId): layerId is string => typeof layerId === 'string' && Boolean(layerId.trim()))
          .map((layerId) => layerId.trim())
        : (typeof legacyColumn.layerId === 'string' && legacyColumn.layerId.trim()
          ? [legacyColumn.layerId.trim()]
          : []))
    ;
    return explicitLayerIds;
  }, []);
  const columnHasBoundLayer = useCallback((column: SortingColumnView, layerId: string | null) => {
    if (!layerId) return false;
    return getColumnBoundLayerIds(column).includes(layerId);
  }, [getColumnBoundLayerIds]);
  const resolveCardLayerForColumn = useCallback((columnId: string, preferredLayerId?: string | null) => {
    const column = columnById.get(columnId);
    if (column) {
      if (preferredLayerId && columnHasBoundLayer(column, preferredLayerId)) {
        return preferredLayerId;
      }
      const columnLayerIds = getColumnBoundLayerIds(column);
      if (columnLayerIds.length === 1) {
        return columnLayerIds[0];
      }
    }
    return preferredLayerId || null;
  }, [columnById, columnHasBoundLayer, getColumnBoundLayerIds]);
  const selectedBoxLayers = useMemo(() => {
    const activeSelection = new Set(
      selectedLayerIds.filter((layerId) => boxLayers.some((layer) => layer.id === layerId)),
    );
    return activeSelection.size > 0
      ? boxLayers.filter((layer) => activeSelection.has(layer.id))
      : boxLayers;
  }, [boxLayers, selectedLayerIds]);
  const effectiveCurrentLayerId = useMemo(() => {
    if (!currentLayerId) return null;
    return selectedBoxLayers.some((layer) => layer.id === currentLayerId)
      ? currentLayerId
      : null;
  }, [currentLayerId, selectedBoxLayers]);
  const visibleColumns = useMemo(() => {
    if (selectedBoxLayers.length === 0) return boxColumns;
    const selectedLayerIdSet = new Set(selectedBoxLayers.map((layer) => layer.id));
    return boxColumns
      .filter((column) => getColumnBoundLayerIds(column).some((layerId) => selectedLayerIdSet.has(layerId)))
      .map((column) => ({
        ...column,
        instanceId: column.id,
        instanceLayerId: null,
        instanceLayerName: null,
      }));
  }, [boxColumns, getColumnBoundLayerIds, selectedBoxLayers]);
  const columnInstanceById = useMemo(
    () => new Map(visibleColumns.map((column) => [column.instanceId || column.id, column])),
    [visibleColumns],
  );
  const visibleColumnItems = useMemo(() => {
    const selectedLayerIdSet = new Set(selectedBoxLayers.map((layer) => layer.id));
    return Object.fromEntries(visibleColumns.map((column) => [
      column.instanceId || column.id,
      (() => {
        const columnLayerIds = getColumnBoundLayerIds(column);
        return (columnItems[column.id] || []).filter((itemId) => {
          const item = itemMap[itemId];
          if (!item) return false;
          const itemLayerId = item.layerId || (columnLayerIds.length === 1 ? columnLayerIds[0] : null);
          if (!itemLayerId) return false;
          if (!selectedLayerIdSet.has(itemLayerId)) return false;
          return true;
        });
      })(),
    ]));
  }, [columnItems, getColumnBoundLayerIds, itemMap, selectedBoxLayers, visibleColumns]);
  const boxItemIds = useMemo(
    () => [...new Set(visibleColumns.flatMap((column) => visibleColumnItems[column.instanceId || column.id] || []))],
    [visibleColumnItems, visibleColumns],
  );
  const currentBoxItemIds = useMemo(
    () => [...new Set(boxColumns.flatMap((column) => columnItems[column.id] || []))],
    [boxColumns, columnItems],
  );
  const resolveAbsoluteDestinationIndex = useCallback((
    destinationDroppableId: string,
    visibleIndex: number,
    movingCardId?: string | null,
  ) => {
    const destinationColumn = columnInstanceById.get(destinationDroppableId);
    const baseDestinationColumnId = destinationColumn?.id || destinationDroppableId;
    const fullDestinationIds = (columnItems[baseDestinationColumnId] || [])
      .filter((itemId) => itemId !== movingCardId);
    const visibleDestinationIds = (visibleColumnItems[destinationDroppableId] || columnItems[baseDestinationColumnId] || [])
      .filter((itemId) => itemId !== movingCardId);
    return resolveVisibleDropToAbsoluteIndex(fullDestinationIds, visibleDestinationIds, visibleIndex);
  }, [columnInstanceById, columnItems, visibleColumnItems]);
  const bubbleCount = useMemo(
    () => boxItemIds.map((itemId) => itemMap[itemId]).filter((item) => item?.type === 'card').length,
    [boxItemIds, itemMap],
  );
  const getSearchMatchFromMessage = useCallback((query: string, message: MessageData) => {
    const blocks = getMessageBlocks(message);
    let bestScore = 0;
    let bestBlockId: string | undefined;

    blocks.forEach((block) => {
      if (block.type === 'quote') return;
      let rawText = '';
      let mode: 'content' | 'meta' = 'content';
      if (block.type === 'text') rawText = block.text || '';
      if (block.type === 'link') {
        rawText = getLinkDisplayLabel(block.url || '');
        mode = 'meta';
      }
      if (block.type === 'file') {
        rawText = block.fileName || block.url || '';
        mode = 'meta';
      }
      if (block.type === 'location') rawText = block.location?.label || block.location?.address || '';
      const score = scoreSearchText(query, rawText, mode);
      if (score > bestScore) {
        bestScore = score;
        bestBlockId = block.id;
      }
    });

    return {
      score: bestScore,
      blockId: bestBlockId,
    };
  }, []);
  const filteredDetailBubbles = useMemo(() => {
    const query = sourceDetailSearchQuery.trim();
    if (!query) return visibleBubbles;
    const shouldMatchStreamTitle = visibleSourceStreams.length > 1;
    return visibleBubbles.filter((entry) => {
      const messageScore = getSearchMatchFromMessage(query, entry.bubble).score;
      const streamScore = shouldMatchStreamTitle ? scoreSearchText(query, entry.streamTitle, 'title') : 0;
      return Math.max(messageScore, streamScore) > 0;
    });
  }, [getSearchMatchFromMessage, sourceDetailSearchQuery, visibleBubbles, visibleSourceStreams.length]);
  const buildSortingMeta = useCallback((boxId?: string | null, layerId?: string | null, columnId?: string | null, time?: number | null) => {
    const parts = [
      boxId ? boxById.get(boxId)?.name || null : null,
      layerId ? layerById.get(layerId)?.name || null : null,
      columnId ? columnById.get(columnId)?.name || null : null,
    ].filter((value): value is string => Boolean(value));
    const path = parts.join(' / ');
    const timeLabel = time ? formatDateTime(time) : '';
    return [path, timeLabel].filter(Boolean).join(' · ');
  }, [boxById, columnById, layerById]);
  const buildSourceActionTarget = useCallback((entry: SortingSourceBubble): SearchResultTarget => {
    if (entry.bubble.replyToMessageId) {
      return {
        type: 'thread-reply',
        conversationId: entry.streamId,
        messageId: entry.bubble.replyToMessageId,
        blockId: entry.bubble.commentTarget?.blockId,
        replyMessageId: entry.bubble.id,
      };
    }
    return {
      type: 'stream-message',
      conversationId: entry.streamId,
      messageId: entry.bubble.id,
    };
  }, []);
  const buildCardSearchAuxiliaryAction = useCallback((item: SortingCardView) => {
    const sourceKey = sourceInfoMap[item.id]?.keys?.[0];
    if (!sourceKey) return undefined;
    const sourceBubble = allStreamBubbleMap.get(sourceKey);
    if (!sourceBubble) return undefined;
    return {
      label: '看原泡泡',
      target: buildSourceActionTarget(sourceBubble),
    };
  }, [allStreamBubbleMap, buildSourceActionTarget, sourceInfoMap]);
  const performSortingSearch = useCallback((request: SearchRequest): SearchResponse => {
    const query = normalizeSearchQuery(request.query);
    if (!query) {
      return { items: [], total: 0, hasMore: false };
    }

    const results: SearchResult[] = [];
    const includeSorting = request.scope === 'all' || request.scope === 'sorting';
    const includeLocalSources = request.mode === 'local-sorting' && request.scope === 'all';

    const pushBoxResult = (box: SortingBoxView, sectionLabel: string) => {
      const score = scoreSearchText(query, box.name, 'title');
      if (score <= 0) return;
      results.push({
        id: `${sectionLabel}:box:${box.id}`,
        type: 'sorting-box',
        domain: 'sorting',
        sectionLabel,
        title: box.name,
        preview: box.description || '打开这个箱子',
        meta: buildSortingMeta(box.id, null, null),
        time: 0,
        score,
        contextScore: score,
        target: {
          type: 'sorting-result',
          sorting: {
            type: 'sorting-box',
            boxId: box.id,
          },
        },
      });
    };

    const pushLayerResult = (layer: SortingLayerView, sectionLabel: string) => {
      const score = scoreSearchText(query, layer.name, 'title');
      if (score <= 0) return;
      results.push({
        id: `${sectionLabel}:layer:${layer.id}`,
        type: 'sorting-layer',
        domain: 'sorting',
        sectionLabel,
        title: layer.name,
        preview: boxById.get(layer.boxId)?.name || '层',
        meta: buildSortingMeta(layer.boxId, layer.id, null),
        time: 0,
        score,
        contextScore: score,
        target: {
          type: 'sorting-result',
          sorting: {
            type: 'sorting-layer',
            boxId: layer.boxId,
            layerId: layer.id,
          },
        },
      });
    };

    const pushColumnResult = (column: SortingColumnView, sectionLabel: string) => {
      const score = scoreSearchText(query, column.name, 'title');
      if (score <= 0) return;
      const firstLayerId = Array.isArray(column.boundLayerIds) ? column.boundLayerIds[0] || null : null;
      results.push({
        id: `${sectionLabel}:column:${column.id}`,
        type: 'sorting-column',
        domain: 'sorting',
        sectionLabel,
        title: column.name,
        preview: boxById.get(column.boxId || '')?.name || '列',
        meta: buildSortingMeta(column.boxId, firstLayerId, column.id),
        time: 0,
        score,
        contextScore: score,
        target: {
          type: 'sorting-result',
          sorting: {
            type: 'sorting-column',
            boxId: column.boxId || undefined,
            layerId: firstLayerId || undefined,
            columnId: column.id,
          },
        },
      });
    };

    const pushCardResult = (item: SortingCardView, sectionLabel: string) => {
      if (item.type !== 'card') return;
      const message = buildSortingBubbleMessage(item);
      const match = getSearchMatchFromMessage(query, message);
      if (match.score <= 0) return;
      results.push({
        id: `${sectionLabel}:card:${item.id}`,
        type: 'sorting-card',
        domain: 'sorting',
        sectionLabel,
        title: buildMessagePreviewText(message) || item.title || '泡泡卡片',
        preview: sourceInfoMap[item.id]?.originText || item.content || '',
        meta: buildSortingMeta(
          columnById.get(item.columnId)?.boxId || null,
          item.layerId,
          item.columnId,
          item.updatedAt || item.createdAt || null,
        ),
        time: item.updatedAt || item.createdAt || 0,
        score: match.score,
        contextScore: match.score,
        target: {
          type: 'sorting-result',
          sorting: {
            type: 'sorting-card',
            boxId: columnById.get(item.columnId)?.boxId || undefined,
            layerId: item.layerId || undefined,
            columnId: item.columnId,
            itemId: item.id,
          },
        },
        auxiliaryAction: buildCardSearchAuxiliaryAction(item),
      });
    };

    if (includeSorting) {
      if (request.mode === 'global') {
        boxes.forEach((box) => pushBoxResult(box, '泡泡箱'));
        layers.forEach((layer) => pushLayerResult(layer, '泡泡箱'));
        columns.filter((column) => !column.systemKey).forEach((column) => pushColumnResult(column, '泡泡箱'));
        Object.values(itemMap).forEach((item) => pushCardResult(item, '泡泡箱'));
      } else {
        if (activeBox) {
          pushBoxResult(activeBox, '泡泡箱');
        }
        boxLayers.forEach((layer) => pushLayerResult(layer, '泡泡箱'));
        boxColumns.forEach((column) => pushColumnResult(column, '泡泡箱'));
        currentBoxItemIds.forEach((itemId) => {
          const item = itemMap[itemId];
          if (item) pushCardResult(item, '泡泡箱');
        });
      }
    }

    if (includeLocalSources) {
      visibleBubbles.forEach((entry) => {
        const match = getSearchMatchFromMessage(query, entry.bubble);
        if (match.score <= 0) return;
        const parentBubble = entry.bubble.replyToMessageId
          ? streamsById.get(entry.streamId)?.messages.find((message) => message.id === entry.bubble.replyToMessageId) || null
          : null;
        const parentScore = parentBubble ? getSearchMatchFromMessage(query, parentBubble).score : 0;
        results.push({
          id: `source:${entry.key}`,
          type: 'sorting-source',
          domain: 'sorting',
          sectionLabel: '来源流',
          title: buildMessagePreviewText(entry.bubble) || '来源泡泡',
          preview: entry.bubble.replyToMessageId
            ? `评论 · ${parentBubble ? buildMessagePreviewText(parentBubble) || '原泡泡' : '原泡泡'}`
            : entry.streamTitle,
          meta: `${entry.streamTitle}${entry.bubble.time ? ` · ${formatDateTime(entry.bubble.time)}` : ''}`,
          time: entry.bubble.time || 0,
          score: match.score,
          contextScore: match.score + parentScore,
          target: {
            type: 'sorting-source',
            sorting: {
              type: 'sorting-source',
              sourceBubbleKey: entry.key,
              sourceStreamId: entry.streamId,
              sourceMessageId: entry.bubble.id,
            },
          },
          auxiliaryAction: {
            label: '看原泡泡',
            target: buildSourceActionTarget(entry),
          },
        });
      });
    }

    results.sort(compareSearchResults);
    return paginateSearchResults(results, request.offset, request.limit);
  }, [
    activeBox,
    activeBoxId,
    allStreamBubbleMap,
    boxById,
    boxColumns,
    boxLayers,
    boxes,
    buildCardSearchAuxiliaryAction,
    buildSortingMeta,
    buildSourceActionTarget,
    columnById,
    columns,
    currentBoxItemIds,
    getSearchMatchFromMessage,
    itemMap,
    layers,
    sourceInfoMap,
    streamsById,
    visibleBubbles,
  ]);
  useEffect(() => {
    if (!onRegisterSearchProvider) return undefined;
    onRegisterSearchProvider(performSortingSearch);
    return () => onRegisterSearchProvider(null);
  }, [onRegisterSearchProvider, performSortingSearch]);

  useEffect(() => {
    setBoxListSearchQuery('');
    setSourceListSearchQuery('');
    setSourceDetailSearchQuery('');
  }, [workspaceId]);

  useEffect(() => {
    setSourceDetailSearchQuery('');
  }, [currentSourceId, isSourceListView, selectedSourceIds, sourceViewMode]);

  useEffect(() => {
    setLocalSearchSelectedIndex((current) => (
      localSearchResults.length === 0
        ? 0
        : Math.min(current, localSearchResults.length - 1)
    ));
  }, [localSearchResults]);

  useEffect(() => {
    if (!isLocalSearchOpen || !localSearchQuery.trim()) {
      setLocalSearchResults([]);
      setLocalSearchTotal(0);
      setLocalSearchHasMore(false);
      setLocalSearchSelectedIndex(0);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const nextPage = performSortingSearch({
        query: localSearchQuery,
        scope: 'all',
        mode: 'local-sorting',
        offset: 0,
        limit: 20,
      });
      setLocalSearchResults(nextPage.items);
      setLocalSearchTotal(nextPage.total);
      setLocalSearchHasMore(nextPage.hasMore);
      setLocalSearchSelectedIndex(0);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [isLocalSearchOpen, localSearchQuery, performSortingSearch]);

  useEffect(() => {
    setIsLocalSearchOpen(false);
    setLocalSearchQuery('');
    setLocalSearchResults([]);
    setLocalSearchTotal(0);
    setLocalSearchHasMore(false);
    setLocalSearchSelectedIndex(0);
  }, [activeBoxId, currentSourceId, sourceViewMode]);

  useEffect(() => {
    setDetailSearchSelectedIndex((current) => (
      detailSearchResults.length === 0
        ? 0
        : Math.min(current, detailSearchResults.length - 1)
    ));
  }, [detailSearchResults]);

  useEffect(() => {
    if (!isDetailSearchOpen || !detailSearchQuery.trim()) {
      setDetailSearchResults([]);
      setDetailSearchTotal(0);
      setDetailSearchHasMore(false);
      setDetailSearchSelectedIndex(0);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const nextPage = performSortingSearch({
        query: detailSearchQuery,
        scope: 'all',
        mode: 'local-sorting',
        offset: 0,
        limit: 20,
      });
      setDetailSearchResults(nextPage.items);
      setDetailSearchTotal(nextPage.total);
      setDetailSearchHasMore(nextPage.hasMore);
      setDetailSearchSelectedIndex(0);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [detailSearchQuery, isDetailSearchOpen, performSortingSearch]);

  useEffect(() => {
    setIsDetailSearchOpen(false);
    setDetailSearchQuery('');
    setDetailSearchResults([]);
    setDetailSearchTotal(0);
    setDetailSearchHasMore(false);
    setDetailSearchSelectedIndex(0);
  }, [activeBoxId, bubbleDetail, currentSourceId, sourceViewMode]);
  const activeDetailCard = useMemo(() => (
    bubbleDetail?.kind === 'card'
      ? itemMap[bubbleDetail.key] || null
      : null
  ), [bubbleDetail, itemMap]);
  const activeDetailSource = useMemo(() => (
    bubbleDetail?.kind === 'source'
      ? bubbleMap.get(bubbleDetail.key) || null
      : null
  ), [bubbleDetail, bubbleMap]);
  const cardCommentPickerItem = useMemo(() => (
    cardCommentPicker ? itemMap[cardCommentPicker.cardId] || null : null
  ), [cardCommentPicker, itemMap]);
  const activeDetailMessage = useMemo(() => {
    if (activeDetailCard) return buildSortingBubbleMessage(activeDetailCard);
    if (activeDetailSource) return activeDetailSource.bubble;
    return null;
  }, [activeDetailCard, activeDetailSource]);
  const activeDetailTitle = useMemo(() => {
    if (bubbleDetail?.kind === 'card') {
      if (activeDetailCard) {
        const cardBlocks = getMessageBlocks(buildSortingBubbleMessage(activeDetailCard));
        return cardBlocks.length > 0 ? buildBubbleContentSummary(cardBlocks) : null;
      }
      return null;
    }
    return activeDetailSource?.streamTitle || null;
  }, [activeDetailCard, activeDetailSource, bubbleDetail]);
  const activeDetailSourceLabel = useMemo(() => {
    if (bubbleDetail?.kind === 'card' && activeDetailCard) {
      return sourceInfoMap[activeDetailCard.id]?.originText || null;
    }
    return activeDetailSource?.streamTitle || null;
  }, [activeDetailCard, activeDetailSource, bubbleDetail, sourceInfoMap]);
  const activeDetailKindLabel = useMemo(() => {
    if (bubbleDetail?.kind === 'card' && activeDetailCard) {
      return getSortingCardTypeLabel(activeDetailCard);
    }
    return activeDetailSource
      ? '泡泡'
      : null;
  }, [activeDetailCard, activeDetailSource, bubbleDetail]);
  const cardCommentPickerTitle = useMemo(() => {
    if (!cardCommentPickerItem || cardCommentPickerItem.type !== 'card') return '选择源泡泡评论';
    const blocks = getMessageBlocks(buildSortingBubbleMessage(cardCommentPickerItem));
    const summary = blocks.length > 0 ? buildBubbleContentSummary(blocks) : '';
    return summary || '选择源泡泡评论';
  }, [cardCommentPickerItem]);

  const openCardDetail = useCallback((item: SortingCardView, mode: 'view' | 'edit') => {
    if (item.type !== 'card') return;
    if (mode === 'edit') {
      setEditingBubbleId(item.id);
      setEditingBubbleDraft(buildBubbleDraft(item));
    }
    setBubbleDetail({ kind: 'card', key: item.id, mode });
  }, []);

  const openSourceDetail = useCallback((bubbleKey: string) => {
    if (!bubbleMap.has(bubbleKey)) return;
    setBubbleDetail({ kind: 'source', key: bubbleKey, mode: 'view' });
  }, [bubbleMap]);

  useEffect(() => {
    if (!editingBubbleId) return;
    const target = itemMap[editingBubbleId];
    if (!target || target.type !== 'card') {
      setEditingBubbleId(null);
      setEditingBubbleDraft(null);
    }
  }, [editingBubbleId, itemMap]);

  useEffect(() => {
    if (!bubbleDetail) return;
    if (bubbleDetail.kind === 'card' && !itemMap[bubbleDetail.key]) {
      setBubbleDetail(null);
    }
    if (bubbleDetail.kind === 'source' && !bubbleMap.has(bubbleDetail.key)) {
      setBubbleDetail(null);
    }
  }, [bubbleDetail, bubbleMap, itemMap]);

  useEffect(() => {
    if (!cardCommentPicker) return;
    const item = itemMap[cardCommentPicker.cardId];
    if (!item || item.type !== 'card') {
      setCardCommentPicker(null);
      return;
    }
    const sourceKeys = sourceInfoMap[item.id]?.keys || [];
    if (sourceKeys.length === 0) {
      setCardCommentPicker(null);
    }
  }, [cardCommentPicker, itemMap, sourceInfoMap]);

  const closeBubbleDetail = useCallback(() => {
    setIsDetailSearchOpen(false);
    setDetailSearchQuery('');
    if (bubbleDetail?.kind === 'card' && bubbleDetail.mode === 'edit') {
      void (async () => {
        if (!editingBubbleId) {
          setBubbleDetail(null);
          return;
        }
        const item = itemMap[editingBubbleId];
        const shouldDelete = item
          && item.type === 'card'
          && !isProjectedBubble(item)
          && isBlankBubbleDraft(editingBubbleDraft);

        setEditingBubbleId(null);
        setEditingBubbleDraft(null);
        setBubbleDetail(null);

        if (shouldDelete) {
          await updateWorkspace({ action: 'delete-bubble', cardId: item.id, columnId: item.columnId });
          showToast('未保存泡泡已取消');
        }
      })();
      return;
    }
    setBubbleDetail(null);
  }, [bubbleDetail, editingBubbleDraft, editingBubbleId, itemMap, showToast, updateWorkspace]);

  const persistLayerSelection = useCallback(async (nextSelection: LayerSelectionState) => {
    const nextCurrentLayerId = (
      nextSelection.currentLayerId
      && nextSelection.selectedLayerIds.includes(nextSelection.currentLayerId)
    )
      ? nextSelection.currentLayerId
      : nextSelection.selectedLayerIds[0] || null;
    setSelectedLayerIds(nextSelection.selectedLayerIds);
    setCurrentLayerId(nextCurrentLayerId);
    try {
      await updateWorkspace({
        action: 'set-box-layer-selection',
        boxId: activeBoxId,
        selectedLayerIds: nextSelection.selectedLayerIds,
        currentLayerId: nextCurrentLayerId,
      });
    } catch {
      showToast('层选择保存失败，请重试');
      void loadWorkspace();
    }
  }, [activeBoxId, loadWorkspace, showToast, updateWorkspace]);

  const ensureColumnBoundToCurrentLayer = useCallback(async (column: SortingColumnView) => {
    if (!column.boxId || !effectiveCurrentLayerId || columnHasBoundLayer(column, effectiveCurrentLayerId)) {
      return { layerId: effectiveCurrentLayerId, attachedLayer: false };
    }
    await updateWorkspace({
      action: 'move-column-layer',
      boxId: activeBoxId,
      columnId: column.id,
      layerId: effectiveCurrentLayerId,
    });
    return {
      layerId: effectiveCurrentLayerId,
      attachedLayer: true,
    };
  }, [activeBoxId, columnHasBoundLayer, effectiveCurrentLayerId, updateWorkspace]);

  const moveWorkspace = useCallback(async (payload: Record<string, unknown>) => {
    if (!bridge) return null;
    return requestWorkspace(() => bridge.sorting.move(payload));
  }, [bridge, requestWorkspace]);

  const startEditingBubble = useCallback((item: SortingCardView) => {
    openCardDetail(item, 'edit');
  }, [openCardDetail]);

  const cancelEditingBubble = useCallback(async () => {
    closeBubbleDetail();
  }, [closeBubbleDetail]);

  const saveEditingBubble = useCallback(async (draft?: SortingBubbleDraft | null) => {
    const effectiveDraft = draft || editingBubbleDraft;
    if (!editingBubbleId || !effectiveDraft) return;
    const item = itemMap[editingBubbleId];
    if (!item || item.type !== 'card') return;
    const blocks = sanitizeBubbleBlocks(await resolveBubbleLinkBlocksForSubmit(getDraftMessageBlocks(effectiveDraft)));
    await updateWorkspace({
      action: 'update-bubble',
      cardId: item.id,
      content: buildBubbleContentSummary(blocks),
      metadata: {
        contentEdited: true,
        editedBlocks: blocks,
      },
    });
    setEditingBubbleId(null);
    setEditingBubbleDraft(null);
    setBubbleDetail(null);
    showToast('泡泡已更新');
  }, [editingBubbleDraft, editingBubbleId, itemMap, showToast, updateWorkspace]);

  const copyBubbleContent = useCallback(async (bubbleKey: string) => {
    const bubble = bubbleMap.get(bubbleKey)?.bubble;
    if (!bubble) return;
    try {
      await navigator.clipboard.writeText(extractText(bubble.content));
      showToast('已复制泡泡内容');
    } catch {
      showToast('当前环境不支持复制');
    }
  }, [bubbleMap, showToast]);

  const resolveProjectionDestination = useCallback(async (destinationColumnId: string) => {
    if (destinationColumnId === luggageColumnId) {
      return {
        columnId: destinationColumnId,
        layerId: effectiveCurrentLayerId || null,
        attachedLayer: false,
      };
    }
    const destinationColumnInstance = columnInstanceById.get(destinationColumnId);
    const destinationColumn = columnById.get(destinationColumnInstance?.id || destinationColumnId);
    if (!destinationColumn || !destinationColumn.boxId) {
      return {
        columnId: destinationColumn?.id || destinationColumnId,
        layerId: effectiveCurrentLayerId || null,
        attachedLayer: false,
      };
    }
    if (effectiveCurrentLayerId) {
      const ensured = await ensureColumnBoundToCurrentLayer(destinationColumn);
      return {
        columnId: destinationColumn.id,
        layerId: ensured.layerId,
        attachedLayer: ensured.attachedLayer,
      };
    }

    return {
      columnId: destinationColumn.id,
      layerId: resolveCardLayerForColumn(destinationColumn.id, null),
      attachedLayer: false,
    };
  }, [
    columnById,
    columnInstanceById,
    effectiveCurrentLayerId,
    ensureColumnBoundToCurrentLayer,
    resolveCardLayerForColumn,
    luggageColumnId,
  ]);

  const sendBubbleBack = useCallback(async (item: SortingCardView) => {
    if (!onSaveAsBubble || item.type !== 'card') return;
    if (!currentSourceId) {
      showToast('请先打开一个泡泡流作为回写目标');
      return;
    }

    const sourceInfo = sourceInfoMap[item.id] || {
      keys: [],
      labels: [],
      originText: '',
      referenceCount: 0,
    };

    const created = await onSaveAsBubble({
      message: buildBubbleMessagePayload(item),
      sourceIds: sourceInfo.keys,
      cardId: item.id,
      conversationId: currentSourceId,
    });

    if (created) {
      patchWorkspaceItem(item.id, (current) => ({
        ...current,
        metadata: {
          ...(current.metadata || {}),
          outputConversationId: created.conversationId,
          outputMessageId: created.messageId,
          sourceIds: sourceInfo.keys,
        },
      }));
    }

    showToast('已回写到如流');
  }, [currentSourceId, onSaveAsBubble, patchWorkspaceItem, showToast, sourceInfoMap]);

  const addBlankBubble = useCallback(async (columnId: string, extra?: {
    boxId?: string;
    canvasNode?: { x: number; y: number; width: number; height: number; zIndex: number };
  }) => {
    const targetColumn = columnInstanceById.get(columnId);
    const baseColumnId = targetColumn?.id || columnId;
    const baseColumn = columnById.get(baseColumnId);
    const previousIds = new Set(Object.keys(itemMap));
    let targetLayerId = effectiveCurrentLayerId
      || resolveCardLayerForColumn(baseColumnId, null);
    if (baseColumn && effectiveCurrentLayerId) {
      const ensured = await ensureColumnBoundToCurrentLayer(baseColumn);
      targetLayerId = ensured.layerId || targetLayerId;
    }
    const nextWorkspace = await updateWorkspace({
      action: 'add-blank-bubble',
      columnId: baseColumnId,
      layerId: targetLayerId,
      boxId: extra?.boxId,
      canvasNode: extra?.canvasNode,
      content: '',
    });
    if (!nextWorkspace) return;
    const nextBubble = Object.values(nextWorkspace.itemMap).find((item) => (
      !previousIds.has(item.id)
      && item.columnId === baseColumnId
      && item.layerId === targetLayerId
    ));
    if (nextBubble) {
      startEditingBubble(nextBubble);
    }
  }, [columnById, columnInstanceById, effectiveCurrentLayerId, ensureColumnBoundToCurrentLayer, itemMap, resolveCardLayerForColumn, startEditingBubble, updateWorkspace]);

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId, type } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    if (type === 'COLUMN') {
      await moveWorkspace({
        action: 'reorder-columns',
        boxId: activeBoxId,
        visibleColumnIds: visibleColumns.map((column) => column.id),
        sourceIndex: source.index,
        destinationIndex: destination.index,
      });
      return;
    }

    if (draggableId.startsWith('bubble::')) {
      const bubbleRef = parseSourceBubbleDraggableId(draggableId);
      if (!bubbleRef) return;
      if (destination.droppableId === 'bubble-source') return;
      const projectionTarget = await resolveProjectionDestination(destination.droppableId);
      const destinationIndex = resolveAbsoluteDestinationIndex(destination.droppableId, destination.index);
      await moveWorkspace({
        action: 'project-bubble',
        sourceStreamId: bubbleRef.streamId,
        sourceBubbleId: bubbleRef.bubbleId,
        columnId: projectionTarget.columnId,
        layerId: projectionTarget.layerId,
        destinationIndex,
      });
      if (projectionTarget.attachedLayer) {
        showToast('已在当前层挂载同一列，并把泡泡放入当前层');
        return;
      }
      showToast(destination.droppableId === luggageColumnId ? '已加入行李箱' : '已加入当前箱子');
      return;
    }

    const sidebarBoxRef = parseSidebarBoxDraggableId(draggableId);
    if (sidebarBoxRef) {
      if (destination.droppableId === 'bubble-source') {
        showToast('箱子快捷方式只能拖到看板或行李箱');
        return;
      }
      const projectionTarget = await resolveProjectionDestination(destination.droppableId);
      const destinationIndex = resolveAbsoluteDestinationIndex(destination.droppableId, destination.index);
      const destinationColumn = columnById.get(projectionTarget.columnId);
      const destinationBoxId = destinationColumn?.boxId || null;
      if (destinationBoxId === sidebarBoxRef.boxId) {
        showToast('不能给箱子添加自己的快捷方式');
        return;
      }
      await updateWorkspace({
        action: 'create-box-shortcut',
        childBoxId: sidebarBoxRef.boxId,
        columnId: projectionTarget.columnId,
        layerId: projectionTarget.layerId,
        destinationIndex,
      });
      showToast(projectionTarget.attachedLayer ? '已在当前层挂载同一列，并新建箱子快捷方式' : '已新建箱子快捷方式');
      return;
    }

    const { cardId } = parseSortingCardInstanceDraggableId(draggableId);

    if (destination.droppableId === 'bubble-source') {
      const draggedItem = itemMap[cardId] || null;
      await moveWorkspace({
        action: 'remove-card',
        cardId,
        columnId: draggedItem?.columnId || source.droppableId,
      });
      showToast('泡泡已移回泡泡流');
      return;
    }

    const draggedItem = itemMap[cardId] || null;
    const destinationColumn = columnInstanceById.get(destination.droppableId);
    const baseDestinationColumnId = destinationColumn?.id || destination.droppableId;
    const baseDestinationColumn = columnById.get(baseDestinationColumnId);
    const destinationIndex = resolveAbsoluteDestinationIndex(destination.droppableId, destination.index, cardId);
    const destinationBoxId = baseDestinationColumn?.boxId || null;

    if (draggedItem?.type === 'box' && draggedItem.childBoxId && destinationBoxId === draggedItem.childBoxId) {
      showToast('不能把箱子放进它自己里面');
      return;
    }

    let nextLayerId = effectiveCurrentLayerId
      || draggedItem?.layerId
      || resolveCardLayerForColumn(baseDestinationColumnId, null);
    if (baseDestinationColumn && effectiveCurrentLayerId) {
      const ensured = await ensureColumnBoundToCurrentLayer(baseDestinationColumn);
      nextLayerId = ensured.layerId || nextLayerId;
    }
    await moveWorkspace({
      action: 'move-card',
      cardId,
      sourceColumnId: draggedItem?.columnId || source.droppableId,
      destinationColumnId: baseDestinationColumnId,
      layerId: nextLayerId,
      sourceIndex: source.index,
      destinationIndex,
    });
  };

  const handleAddColumn = useCallback(async (rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      setAddingColumn(false);
      setNewColName('');
      return;
    }
    await updateWorkspace({
      action: 'add-column',
      boxId: activeBoxId,
      layerId: effectiveCurrentLayerId || selectedBoxLayers[0]?.id || boxLayers[0]?.id || null,
      name,
    });
    setAddingColumn(false);
    setNewColName('');
    showToast(`已新增列：${name}`);
  }, [activeBoxId, boxLayers, effectiveCurrentLayerId, selectedBoxLayers, showToast, updateWorkspace]);

  const handleDeleteColumn = useCallback(async (columnId: string) => {
    const column = columns.find((item) => item.id === columnId);
    if (!column) return;
    const bubbleIds = columnItems[columnId] || [];
    if (bubbleIds.length > 0 && !window.confirm(`列「${column.name}」内有 ${bubbleIds.length} 个泡泡，确定删除吗？`)) return;
    await updateWorkspace({ action: 'delete-column', columnId });
    showToast(`已删除列：${column.name}`);
  }, [columnItems, columns, showToast, updateWorkspace]);

  const handleRenameColumn = useCallback(async (rawName: string, input?: HTMLInputElement | null) => {
    if (!editingColId) return;
    const targetColumn = columns.find((item) => item.id === editingColId);
    const name = rawName.trim();
    if (!targetColumn) {
      setEditingColId(null);
      setEditingColName('');
      return;
    }
    if (!name) {
      const fallback = targetColumn.name || '';
      setEditingColName(fallback);
      if (input) {
        input.value = fallback;
        input.focus();
        input.select();
      }
      return;
    }
    if (name === targetColumn.name) {
      setEditingColId(null);
      setEditingColName('');
      return;
    }
    await updateWorkspace({ action: 'rename-column', columnId: editingColId, name });
    setEditingColId(null);
    setEditingColName('');
  }, [columns, editingColId, showToast, updateWorkspace]);

  const handleDeleteNode = useCallback(async (item: SortingCardView) => {
    const targetLabel = item.type === 'box' ? '箱子入口' : '泡泡';
    if (!window.confirm(`确认删除该${targetLabel}吗？`)) return;
    await updateWorkspace({ action: 'delete-bubble', cardId: item.id, columnId: item.columnId });
    if (item.type === 'box') {
      showToast('箱子入口已删除');
      return;
    }
    showToast(item.columnId === luggageColumnId ? '已从行李箱删除' : '泡泡已删除');
  }, [luggageColumnId, showToast, updateWorkspace]);

  const handleToggleSourceSelection = useCallback((streamId: string) => {
    const currentSelection = sourceSelectionRef.current;
    const alreadySelected = currentSelection.selectedSourceIds.includes(streamId);
    const isFocused = currentSelection.focusedSourceId === streamId;
    const selectedIndex = currentSelection.selectedSourceIds.indexOf(streamId);
    const nextSelectedSourceIds = alreadySelected
      ? currentSelection.selectedSourceIds.filter((id) => id !== streamId)
      : [...currentSelection.selectedSourceIds, streamId];
    const nextFocusedSourceId = alreadySelected
      ? (isFocused
        ? currentSelection.selectedSourceIds[selectedIndex - 1]
          || currentSelection.selectedSourceIds[selectedIndex + 1]
          || null
        : currentSelection.focusedSourceId)
      : (currentSelection.focusedSourceId || streamId);
    if (nextSelectedSourceIds.length === 0) {
      setIsSourceListView(true);
    }
    void persistSourceSelection({
      selectedSourceIds: nextSelectedSourceIds,
      focusedSourceId: nextFocusedSourceId,
      sourceViewMode: nextSelectedSourceIds.length > 1 ? 'all-selected' : 'focused',
    });
  }, [persistSourceSelection]);

  const handleFocusSource = useCallback((streamId: string) => {
    const currentSelection = sourceSelectionRef.current;
    const alreadySelected = currentSelection.selectedSourceIds.includes(streamId);
    const isFocused = currentSelection.focusedSourceId === streamId;

    if (!alreadySelected) {
      void persistSourceSelection({
        selectedSourceIds: [...currentSelection.selectedSourceIds, streamId],
        focusedSourceId: streamId,
        sourceViewMode: 'focused',
      });
      return;
    }

    if (isFocused) {
      const selectedIndex = currentSelection.selectedSourceIds.indexOf(streamId);
      const nextSelectedSourceIds = currentSelection.selectedSourceIds.filter((id) => id !== streamId);
      const nextFocusedSourceId = currentSelection.selectedSourceIds[selectedIndex - 1]
        || currentSelection.selectedSourceIds[selectedIndex + 1]
        || null;
      if (nextSelectedSourceIds.length === 0) {
        setIsSourceListView(true);
      }
      void persistSourceSelection({
        selectedSourceIds: nextSelectedSourceIds,
        focusedSourceId: nextFocusedSourceId,
        sourceViewMode: nextSelectedSourceIds.length > 1 ? 'all-selected' : 'focused',
      });
      return;
    }

    void persistSourceSelection({
      selectedSourceIds: currentSelection.selectedSourceIds,
      focusedSourceId: streamId,
      sourceViewMode: currentSelection.sourceViewMode === 'all-selected' && currentSelection.selectedSourceIds.length > 1
        ? 'all-selected'
        : 'focused',
    });
  }, [persistSourceSelection]);

  const handleOpenSource = useCallback((streamId: string) => {
    const currentSelection = sourceSelectionRef.current;
    const nextSelectedSourceIds = currentSelection.selectedSourceIds.includes(streamId)
      ? currentSelection.selectedSourceIds
      : [...currentSelection.selectedSourceIds, streamId];
    setIsSourceListView(false);
    void persistSourceSelection({
      selectedSourceIds: nextSelectedSourceIds,
      focusedSourceId: streamId,
      sourceViewMode: 'focused',
    });
  }, [persistSourceSelection]);

  const handleOpenSelectedSources = useCallback(() => {
    const currentSelection = sourceSelectionRef.current;
    const focusedId = currentSelection.focusedSourceId && currentSelection.selectedSourceIds.includes(currentSelection.focusedSourceId)
      ? currentSelection.focusedSourceId
      : currentSelection.selectedSourceIds[0] || null;
    if (!focusedId) return;
    setIsSourceListView(false);
    void persistSourceSelection({
      selectedSourceIds: currentSelection.selectedSourceIds,
      focusedSourceId: focusedId,
      sourceViewMode: currentSelection.selectedSourceIds.length > 1 ? 'all-selected' : 'focused',
    });
  }, [persistSourceSelection]);

  const handleClearSourceSelection = useCallback(() => {
    setIsSourceListView(true);
    void persistSourceSelection({
      selectedSourceIds: [],
      focusedSourceId: null,
      sourceViewMode: 'focused',
    });
  }, [persistSourceSelection]);

  const updateCurrentSourceDraft = useCallback((updater: (draft: SortingSourceDraftState) => SortingSourceDraftState) => {
    if (!currentSourceId) return;
    setSourceDrafts((prev) => {
      const currentDraft = prev[currentSourceId] || createEmptySourceDraft();
      return {
        ...prev,
        [currentSourceId]: updater(currentDraft),
      };
    });
  }, [currentSourceId]);

  const appendSourceComposerItems = useCallback((items: SortingComposerItem[]) => {
    if (items.length === 0) return;
    updateCurrentSourceDraft((draft) => ({
      ...draft,
      items: [...draft.items, ...items],
    }));
  }, [updateCurrentSourceDraft]);

  const handleSourceFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    try {
      setIsPreparingSourceDraft(true);
      const nextItems = await Promise.all(files.map(async (file) => classifyComposerFile(file, await uploadFile(file))));
      appendSourceComposerItems(nextItems);
    } catch {
      showToast('资源上传失败，请重试');
    } finally {
      setIsPreparingSourceDraft(false);
    }
  }, [appendSourceComposerItems, showToast]);

  const handleSourceSelectFiles = useCallback((fileList: FileList | null) => {
    if (!fileList?.length) return;
    void handleSourceFiles(Array.from(fileList));
  }, [handleSourceFiles]);

  const handleSourceDraftPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
      void handleSourceFiles(Array.from(event.clipboardData.files));
      return;
    }
    const pastedText = event.clipboardData.getData('text');
    if (
      pastedText
      && pastedText.startsWith('http')
      && !pastedText.match(/\s/)
      && currentSourceDraft.text.trim() === ''
      && currentSourceDraft.items.length === 0
    ) {
      event.preventDefault();
      appendSourceComposerItems([{ id: crypto.randomUUID(), type: 'link', val: pastedText }]);
    }
  }, [appendSourceComposerItems, currentSourceDraft.items.length, currentSourceDraft.text, handleSourceFiles]);

  const handleSourceDraftDrop = useCallback((event: DragEvent<HTMLTextAreaElement>) => {
    const files = event.dataTransfer.files;
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void handleSourceFiles(Array.from(files));
  }, [handleSourceFiles]);

  const handleSourceDraftItemChange = useCallback((itemId: string, value: string) => {
    updateCurrentSourceDraft((draft) => ({
      ...draft,
      items: draft.items.map((item) => (item.id === itemId ? { ...item, val: value } : item)),
    }));
  }, [updateCurrentSourceDraft]);

  const handleSourceDraftItemRemove = useCallback((itemId: string) => {
    updateCurrentSourceDraft((draft) => ({
      ...draft,
      items: draft.items.filter((item) => item.id !== itemId),
    }));
  }, [updateCurrentSourceDraft]);

  const handleSourceDraftClearItems = useCallback(() => {
    updateCurrentSourceDraft((draft) => ({ ...draft, items: [] }));
  }, [updateCurrentSourceDraft]);

  const handleSendSourceMessage = useCallback(async () => {
    const text = currentSourceDraft.text.trim();
    const items = currentSourceDraftItems;
    if (!currentSourceId || (!text && items.length === 0)) return;
    if (!onSendToStream) {
      showToast('当前环境未接入发送能力');
      return;
    }

    try {
      setIsSendingSourceMessage(true);
      await onSendToStream({
        conversationId: currentSourceId,
        draft: {
          text,
          items: items.map((item) => ({
            type: item.type,
            val: item.val,
            fileName: item.fileName,
          })),
        },
      });
      setSourceDrafts((prev) => ({
        ...prev,
        [currentSourceId]: createEmptySourceDraft(),
      }));
      showToast('消息已发回泡泡流');
    } catch {
      showToast('消息发送失败，请重试');
    } finally {
      setIsSendingSourceMessage(false);
    }
  }, [currentSourceDraft.text, currentSourceDraftItems, currentSourceId, onSendToStream, showToast]);

  const handleCreateBox = useCallback(async () => {
    const existingNames = new Set(
      boxes
        .map((item) => item.name.trim())
        .filter(Boolean),
    );
    const baseName = '新箱子';
    let nextName = baseName;
    let suffix = 2;
    while (existingNames.has(nextName)) {
      nextName = `${baseName}${suffix}`;
      suffix += 1;
    }
    try {
      const existingBoxIds = new Set(boxes.map((box) => box.id));
      const nextWorkspace = await updateWorkspace({
        action: 'create-box',
        name: nextName,
        parentBoxId: activeBox?.id || null,
        activeBoxId: activeBox?.id || null,
      });
      if (!nextWorkspace) return;
      const createdBox = nextWorkspace.boxes.find((box) => !existingBoxIds.has(box.id))
        || nextWorkspace.boxes[nextWorkspace.boxes.length - 1]
        || null;
      const nextBoxId = activeBox?.id || nextWorkspace.activeBoxId || createdBox?.id || '';
      setActiveBoxId(nextBoxId);
      setEditingBoxId(createdBox?.id || null);
      setEditingBoxName(createdBox?.name || nextName);
      showToast(activeBox ? `已在「${activeBox.name}」中新建箱子，请命名` : '已新增箱子，请命名');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Unsupported sorting update action: create-box')) {
        showToast('当前主进程未加载新建箱子能力，请重启桌面进程后重试');
        return;
      }
      showToast('新建箱子失败，请重试');
    }
  }, [activeBox, boxes, showToast, updateWorkspace]);

  const handleSelectBox = useCallback((boxId: string) => {
    const nextSelection = sanitizeSourceSelection(
      boxSourceSelectionCacheRef.current.get(boxId) || EMPTY_SOURCE_SELECTION,
    );

    setActiveBoxId(boxId);
    setSelectedLayerIds([]);
    setCurrentLayerId(null);
    applyLocalSourceSelection(nextSelection);

    void saveWorkspace({
      activeBoxId: boxId,
      selectedSourceIds: nextSelection.selectedSourceIds,
      focusedSourceId: nextSelection.focusedSourceId,
      sourceViewMode: nextSelection.sourceViewMode,
      sourceSelectionBoxId: boxId,
    });
  }, [applyLocalSourceSelection, sanitizeSourceSelection, saveWorkspace]);

  const handleOpenRootBox = useCallback(() => {
    if (!homeBoxId) return;
    handleSelectBox(homeBoxId);
  }, [handleSelectBox, homeBoxId]);

  const handleOpenBreadcrumbBox = useCallback((boxId: string) => {
    handleSelectBox(boxId);
  }, [handleSelectBox]);

  const handleStartRenameBox = useCallback((box: SortingBoxView) => {
    setEditingBoxId(box.id);
    setEditingBoxName(box.name || '');
  }, []);

  const handleCancelRenameBox = useCallback(() => {
    setEditingBoxId(null);
    setEditingBoxName('');
  }, []);

  const handleSaveRenameBox = useCallback(async (rawName: string, input?: HTMLInputElement | null) => {
    if (!editingBoxId) return;
    const targetBox = boxes.find((box) => box.id === editingBoxId);
    const nextName = rawName.trim();
    if (!targetBox) {
      setEditingBoxId(null);
      setEditingBoxName('');
      return;
    }
    if (!nextName) {
      const fallback = targetBox.name || '';
      setEditingBoxName(fallback);
      if (input) {
        input.value = fallback;
        input.focus();
        input.select();
      }
      return;
    }
    if (nextName === targetBox.name) {
      setEditingBoxId(null);
      setEditingBoxName('');
      return;
    }
    try {
      await updateWorkspace({ action: 'rename-box', boxId: editingBoxId, name: nextName });
      showToast(`已重命名箱子：${nextName}`);
      setEditingBoxId(null);
      setEditingBoxName('');
    } catch {
      showToast('箱子重命名失败，请重试');
    }
  }, [boxes, editingBoxId, showToast, updateWorkspace]);

  const handleDeleteBox = useCallback(async (boxId: string) => {
    const targetBox = boxes.find((box) => box.id === boxId);
    if (!targetBox) return;
    if (boxes.length <= 1) {
      showToast('至少保留 1 个箱子');
      return;
    }
    const relatedColumnIds = columns.filter((column) => column.boxId === boxId).map((column) => column.id);
    const relatedItemCount = relatedColumnIds.reduce((total, columnId) => total + (columnItems[columnId]?.length || 0), 0);
    const confirmText = relatedItemCount > 0
      ? `箱子「${targetBox.name}」下有 ${relatedItemCount} 条内容，确认删除吗？`
      : `确认删除箱子「${targetBox.name}」吗？`;
    if (!window.confirm(confirmText)) return;

    try {
      const nextWorkspace = await updateWorkspace({ action: 'delete-box', boxId });
      const deleted = !nextWorkspace || !nextWorkspace.boxes.some((box) => box.id === boxId);
      if (!deleted) {
        await loadWorkspace();
        showToast(`删除箱子失败：${targetBox.name} 仍然存在`);
        return;
      }
      boxSourceSelectionCacheRef.current.delete(boxId);
      setBoxMenu({ show: false, x: 0, y: 0, boxId: null });
      if (editingBoxId === boxId) {
        setEditingBoxId(null);
        setEditingBoxName('');
      }
      showToast(`已删除箱子：${targetBox.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`删除箱子失败：${message || '请重试'}`);
    }
  }, [boxes, columnItems, columns, editingBoxId, loadWorkspace, showToast, updateWorkspace]);

  const buildSuggestedLayerName = useCallback(() => {
    const existingNames = new Set(
      boxLayers
        .map((layer) => layer.name.trim())
        .filter(Boolean),
    );
    let index = 1;
    let nextName = `新层${index}`;
    while (existingNames.has(nextName)) {
      index += 1;
      nextName = `新层${index}`;
    }
    return nextName;
  }, [boxLayers]);

  const handleStartCreateLayer = useCallback(() => {
    setAddingLayer(true);
    setNewLayerName(buildSuggestedLayerName());
  }, [buildSuggestedLayerName]);

  const handleCancelCreateLayer = useCallback(() => {
    setAddingLayer(false);
    setNewLayerName('');
  }, []);

  const handleCreateLayer = useCallback(async (rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      handleCancelCreateLayer();
      return;
    }
    try {
      await updateWorkspace({ action: 'add-layer', boxId: activeBoxId, name });
      handleCancelCreateLayer();
      showToast(`已新增层：${name}`);
    } catch {
      showToast('新增层失败，请重试');
    }
  }, [activeBoxId, handleCancelCreateLayer, showToast, updateWorkspace]);

  const handleStartRenameLayer = useCallback((layer: SortingLayerView) => {
    setIsSidebarCollapsed(false);
    setIsSidebarLayersCollapsed(false);
    setEditingLayerId(layer.id);
    setEditingLayerName(layer.name || '');
  }, []);

  const handleCancelRenameLayer = useCallback(() => {
    setEditingLayerId(null);
    setEditingLayerName('');
  }, []);

  const handleSaveRenameLayer = useCallback(async (rawName: string, input?: HTMLInputElement | null) => {
    if (!editingLayerId) return;
    const targetLayer = boxLayers.find((layer) => layer.id === editingLayerId);
    const nextName = rawName.trim();
    if (!targetLayer) {
      setEditingLayerId(null);
      setEditingLayerName('');
      return;
    }
    if (!nextName) {
      const fallback = targetLayer.name || '';
      setEditingLayerName(fallback);
      if (input) {
        input.value = fallback;
        input.focus();
        input.select();
      }
      return;
    }
    if (nextName === targetLayer.name) {
      setEditingLayerId(null);
      setEditingLayerName('');
      return;
    }
    try {
      await updateWorkspace({ action: 'rename-layer', boxId: targetLayer.boxId, layerId: targetLayer.id, name: nextName });
      showToast(`已重命名层：${nextName}`);
      setEditingLayerId(null);
      setEditingLayerName('');
    } catch {
      showToast('层重命名失败，请重试');
    }
  }, [boxLayers, editingLayerId, showToast, updateWorkspace]);

  const handleDeleteLayer = useCallback(async (layerId: string) => {
    const layer = boxLayers.find((item) => item.id === layerId);
    if (!layer) return;
    if (boxLayers.length <= 1) {
      showToast('至少保留 1 个层');
      return;
    }
    const relatedColumnCount = columns.filter((column) => columnHasBoundLayer(column, layerId)).length;
    const confirmText = relatedColumnCount > 0
      ? `层「${layer.name}」下有 ${relatedColumnCount} 列，删除后会并入其他层，确认继续吗？`
      : `确认删除层「${layer.name}」吗？`;
    if (!window.confirm(confirmText)) return;

    try {
      await updateWorkspace({ action: 'delete-layer', boxId: layer.boxId, layerId: layer.id });
      showToast(`已删除层：${layer.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`删除层失败：${message || '请重试'}`);
    }
  }, [boxLayers, columnHasBoundLayer, columns, showToast, updateWorkspace]);

  const handleMoveColumnToLayer = useCallback(async (columnId: string, layerId: string) => {
    const column = columns.find((item) => item.id === columnId);
    const layer = boxLayers.find((item) => item.id === layerId);
    if (!column || !layer || columnHasBoundLayer(column, layerId)) return;
    try {
      await updateWorkspace({ action: 'move-column-layer', boxId: activeBoxId, columnId, layerId });
      showToast(`已将列「${column.name}」加入层「${layer.name}」`);
    } catch {
      showToast('移动列失败，请重试');
    }
  }, [activeBoxId, boxLayers, columnHasBoundLayer, columns, showToast, updateWorkspace]);

  const handleFocusLayer = useCallback((layerId: string) => {
    const orderedLayerIds = boxLayers.map((layer) => layer.id);
    if (!orderedLayerIds.includes(layerId)) return;

    const currentSelectedLayerIds = orderedLayerIds.filter((id) => selectedLayerIds.includes(id));
    const nextSelectedLayerIds = currentSelectedLayerIds.includes(layerId)
      ? currentSelectedLayerIds
      : orderedLayerIds.filter((id) => currentSelectedLayerIds.includes(id) || id === layerId);

    if (
      effectiveCurrentLayerId === layerId
      && nextSelectedLayerIds.length === currentSelectedLayerIds.length
    ) {
      return;
    }

    void persistLayerSelection({
      selectedLayerIds: nextSelectedLayerIds,
      currentLayerId: layerId,
    });
  }, [boxLayers, effectiveCurrentLayerId, persistLayerSelection, selectedLayerIds]);

  const handleToggleLayer = useCallback((layerId: string) => {
    const orderedLayerIds = boxLayers.map((layer) => layer.id);
    if (!orderedLayerIds.includes(layerId)) return;

    const currentSelectedLayerIds = orderedLayerIds.filter((id) => selectedLayerIds.includes(id));
    const isSelected = currentSelectedLayerIds.includes(layerId);

    if (isSelected) {
      if (currentSelectedLayerIds.length <= 1) return;
      const nextSelectedLayerIds = currentSelectedLayerIds.filter((id) => id !== layerId);
      const nextCurrentLayerId = effectiveCurrentLayerId === layerId
        ? nextSelectedLayerIds[nextSelectedLayerIds.length - 1] || null
        : effectiveCurrentLayerId;
      void persistLayerSelection({
        selectedLayerIds: nextSelectedLayerIds,
        currentLayerId: nextCurrentLayerId,
      });
      return;
    }

    const nextSelectedLayerIds = orderedLayerIds
      .filter((id) => currentSelectedLayerIds.includes(id) || id === layerId);
    void persistLayerSelection({
      selectedLayerIds: nextSelectedLayerIds,
      currentLayerId: (
        effectiveCurrentLayerId
        && nextSelectedLayerIds.includes(effectiveCurrentLayerId)
      )
        ? effectiveCurrentLayerId
        : nextSelectedLayerIds[0] || layerId,
    });
  }, [boxLayers, effectiveCurrentLayerId, persistLayerSelection, selectedLayerIds]);

  const handleSidebarSectionLayoutChange = useCallback(async (nextLayout: SortingSidebarSectionLayout) => {
    try {
      await saveWorkspace({ sidebarSectionLayout: nextLayout });
    } catch {
      showToast('侧栏排布保存失败，请重试');
    }
  }, [saveWorkspace, showToast]);

  const handleToggleSidebarCollapse = useCallback(() => {
    setIsSidebarDrawerAnimating(true);
    if (sidebarDrawerTimerRef.current) {
      window.clearTimeout(sidebarDrawerTimerRef.current);
    }
    sidebarDrawerTimerRef.current = window.setTimeout(() => {
      setIsSidebarDrawerAnimating(false);
      sidebarDrawerTimerRef.current = null;
    }, 320);
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  const resizeSidebarPane = useCallback((delta: number) => {
    if (isSidebarCollapsed) {
      if (delta > 0) {
        setIsSidebarCollapsed(false);
        sidebarPane.setSize(Math.min(SIDEBAR_PANE_MAX, Math.max(SIDEBAR_PANE_MIN, SIDEBAR_COLLAPSED_WIDTH + delta)));
      }
      return;
    }

    if (sidebarPane.getSize() + delta <= SIDEBAR_PANE_MIN) {
      setIsSidebarCollapsed(true);
      return;
    }

    sidebarPane.resizeBy(delta);
  }, [isSidebarCollapsed, sidebarPane]);

  const resizeSourcePane = useCallback((delta: number) => {
    if (isSourceCollapsed) {
      if (delta > 0) {
        setIsSourceCollapsed(false);
        sourcePane.setSize(Math.min(SOURCE_PANE_MAX, Math.max(SOURCE_PANE_MIN, SOURCE_COLLAPSED_WIDTH + delta)));
      }
      return;
    }

    if (sourcePane.getSize() + delta <= SOURCE_PANE_MIN) {
      setIsSourceCollapsed(true);
      return;
    }

    sourcePane.resizeBy(delta);
  }, [isSourceCollapsed, sourcePane]);

  const resizeLuggagePane = useCallback((delta: number) => {
    if (isLuggageCollapsed) {
      if (delta < 0) {
        setIsLuggageCollapsed(false);
        luggagePane.setSize(Math.min(LUGGAGE_PANE_MAX, Math.max(LUGGAGE_PANE_MIN, LUGGAGE_COLLAPSED_WIDTH - delta)));
      }
      return;
    }

    if (luggagePane.getSize() - delta <= LUGGAGE_PANE_MIN) {
      setIsLuggageCollapsed(true);
      return;
    }

    luggagePane.resizeBy(-delta);
  }, [isLuggageCollapsed, luggagePane]);

  const scrollToSearchSelector = useCallback((selector: string) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }, []);

  const locateSortingSearchTarget = useCallback((payload: SortingSearchLocatorPayload) => {
    setPendingSearchLocateTarget(payload);
  }, []);

  useEffect(() => {
    if (!onRegisterSearchLocator) return undefined;
    onRegisterSearchLocator(locateSortingSearchTarget);
    return () => onRegisterSearchLocator(null);
  }, [locateSortingSearchTarget, onRegisterSearchLocator]);

  useEffect(() => {
    const target = pendingSearchLocateTarget;
    if (!target) return;

    if (target.type === 'sorting-source' && target.sourceStreamId && target.sourceMessageId) {
      void locateSourceBubble({
        conversationId: target.sourceStreamId,
        messageId: target.sourceMessageId,
      });
      setPendingSearchLocateTarget(null);
      return;
    }

    if (target.boxId && activeBoxId !== target.boxId) {
      setIsSidebarCollapsed(false);
      setIsSidebarLayersCollapsed(false);
      handleSelectBox(target.boxId);
      return;
    }

    if (target.layerId && effectiveCurrentLayerId !== target.layerId) {
      setIsSidebarCollapsed(false);
      setIsSidebarLayersCollapsed(false);
      handleFocusLayer(target.layerId);
      return;
    }

    if (target.type === 'sorting-box' && target.boxId) {
      highlightSearchTarget('box', target.boxId);
      scrollToSearchSelector(`[data-sorting-box-id="${target.boxId}"], [data-sorting-active-box-id="${target.boxId}"]`);
      setPendingSearchLocateTarget(null);
      return;
    }

    if (target.type === 'sorting-layer' && target.layerId) {
      highlightSearchTarget('layer', target.layerId);
      scrollToSearchSelector(`[data-sorting-layer-id="${target.layerId}"]`);
      setPendingSearchLocateTarget(null);
      return;
    }

    if (target.type === 'sorting-column' && target.columnId) {
      highlightSearchTarget('column', target.columnId);
      scrollToSearchSelector(`[data-sorting-column-id="${target.columnId}"]`);
      setPendingSearchLocateTarget(null);
      return;
    }

    if (target.type === 'sorting-card' && target.itemId) {
      highlightSearchTarget('item', target.itemId);
      scrollToSearchSelector(`[data-sorting-bubble-id="${target.itemId}"]`);
      setPendingSearchLocateTarget(null);
    }
  }, [
    activeBoxId,
    effectiveCurrentLayerId,
    handleFocusLayer,
    handleSelectBox,
    highlightSearchTarget,
    locateSourceBubble,
    pendingSearchLocateTarget,
    scrollToSearchSelector,
  ]);

  const toggleLocalSearch = useCallback(() => {
    setIsLocalSearchOpen((current) => {
      const next = !current;
      if (!next) {
        setLocalSearchQuery('');
      } else {
        window.setTimeout(() => localSearchInputRef.current?.focus(), 30);
      }
      return next;
    });
  }, []);

  const handleSelectLocalSearchResult = useCallback((result: SearchResult) => {
    const sortingTarget = result.target.sorting;
    if (!sortingTarget) return;
    locateSortingSearchTarget(sortingTarget);
    setIsLocalSearchOpen(false);
    setLocalSearchQuery('');
  }, [locateSortingSearchTarget]);

  const handleRunLocalSearchAuxiliaryAction = useCallback((result: SearchResult) => {
    if (!result.auxiliaryAction || !onRevealSearchTarget) return;
    onRevealSearchTarget(result.auxiliaryAction.target);
    setIsLocalSearchOpen(false);
    setLocalSearchQuery('');
  }, [onRevealSearchTarget]);

  const handleLoadMoreLocalSearch = useCallback(() => {
    const nextPage = performSortingSearch({
      query: localSearchQuery,
      scope: 'all',
      mode: 'local-sorting',
      offset: localSearchResults.length,
      limit: 20,
    });
    setLocalSearchResults((current) => [...current, ...nextPage.items]);
    setLocalSearchTotal(nextPage.total);
    setLocalSearchHasMore(nextPage.hasMore);
  }, [localSearchQuery, localSearchResults.length, performSortingSearch]);

  const handleLocalSearchInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setLocalSearchSelectedIndex((current) => Math.min(current + 1, Math.max(0, localSearchResults.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setLocalSearchSelectedIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = localSearchResults[localSearchSelectedIndex];
      if (target) {
        handleSelectLocalSearchResult(target);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsLocalSearchOpen(false);
      setLocalSearchQuery('');
    }
  }, [handleSelectLocalSearchResult, localSearchResults, localSearchSelectedIndex]);

  const localSearchResultsView = useMemo(() => (
    <SearchResultPanel
      compact
      results={localSearchResults}
      selectedIndex={localSearchSelectedIndex}
      hasMore={localSearchHasMore}
      total={localSearchTotal}
      emptyText="当前分箱页没有找到结果"
      onSelect={handleSelectLocalSearchResult}
      onSelectIndex={setLocalSearchSelectedIndex}
      onLoadMore={handleLoadMoreLocalSearch}
      onRunAuxiliaryAction={handleRunLocalSearchAuxiliaryAction}
    />
  ), [
    handleLoadMoreLocalSearch,
    handleRunLocalSearchAuxiliaryAction,
    handleSelectLocalSearchResult,
    localSearchHasMore,
    localSearchResults,
    localSearchSelectedIndex,
    localSearchTotal,
  ]);

  const toggleDetailSearch = useCallback(() => {
    setIsDetailSearchOpen((current) => {
      const next = !current;
      if (!next) {
        setDetailSearchQuery('');
      } else {
        window.setTimeout(() => detailSearchInputRef.current?.focus(), 30);
      }
      return next;
    });
  }, []);

  const handleSelectDetailSearchResult = useCallback((result: SearchResult) => {
    const sortingTarget = result.target.sorting;
    if (!sortingTarget) return;
    closeBubbleDetail();
    locateSortingSearchTarget(sortingTarget);
  }, [closeBubbleDetail, locateSortingSearchTarget]);

  const handleRunDetailSearchAuxiliaryAction = useCallback((result: SearchResult) => {
    if (!result.auxiliaryAction || !onRevealSearchTarget) return;
    closeBubbleDetail();
    onRevealSearchTarget(result.auxiliaryAction.target);
  }, [closeBubbleDetail, onRevealSearchTarget]);

  const handleLoadMoreDetailSearch = useCallback(() => {
    const nextPage = performSortingSearch({
      query: detailSearchQuery,
      scope: 'all',
      mode: 'local-sorting',
      offset: detailSearchResults.length,
      limit: 20,
    });
    setDetailSearchResults((current) => [...current, ...nextPage.items]);
    setDetailSearchTotal(nextPage.total);
    setDetailSearchHasMore(nextPage.hasMore);
  }, [detailSearchQuery, detailSearchResults.length, performSortingSearch]);

  const handleDetailSearchInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setDetailSearchSelectedIndex((current) => Math.min(current + 1, Math.max(0, detailSearchResults.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setDetailSearchSelectedIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = detailSearchResults[detailSearchSelectedIndex];
      if (target) {
        handleSelectDetailSearchResult(target);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsDetailSearchOpen(false);
      setDetailSearchQuery('');
    }
  }, [detailSearchResults, detailSearchSelectedIndex, handleSelectDetailSearchResult]);

  const detailSearchResultsView = useMemo(() => (
    <SearchResultPanel
      compact
      results={detailSearchResults}
      selectedIndex={detailSearchSelectedIndex}
      hasMore={detailSearchHasMore}
      total={detailSearchTotal}
      emptyText="当前分箱页没有找到结果"
      onSelect={handleSelectDetailSearchResult}
      onSelectIndex={setDetailSearchSelectedIndex}
      onLoadMore={handleLoadMoreDetailSearch}
      onRunAuxiliaryAction={handleRunDetailSearchAuxiliaryAction}
    />
  ), [
    detailSearchHasMore,
    detailSearchResults,
    detailSearchSelectedIndex,
    detailSearchTotal,
    handleLoadMoreDetailSearch,
    handleRunDetailSearchAuxiliaryAction,
    handleSelectDetailSearchResult,
  ]);

  const handlePanePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const sourceNode = target.closest<HTMLElement>('[data-sorting-source-key]');
    if (sourceNode?.dataset.sortingSourceKey) {
      const nextTarget = { kind: 'source' as const, key: sourceNode.dataset.sortingSourceKey };
      setHoveredBubbleTarget((current) => (
        current?.kind === nextTarget.kind && current.key === nextTarget.key ? current : nextTarget
      ));
      return;
    }
    const cardNode = target.closest<HTMLElement>('[data-sorting-bubble-id]');
    if (cardNode?.dataset.sortingBubbleId) {
      const nextTarget = { kind: 'card' as const, key: cardNode.dataset.sortingBubbleId };
      setHoveredBubbleTarget((current) => (
        current?.kind === nextTarget.kind && current.key === nextTarget.key ? current : nextTarget
      ));
      return;
    }
    setHoveredBubbleTarget(null);
  }, []);

  const clearHoveredBubbleTarget = useCallback(() => {
    setHoveredBubbleTarget(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (bubbleDetail || cardCommentPicker || bubbleMenu.show || nodeMenu.show || columnMenu.show || layerMenu.show || boxMenu.show) return;
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement
        && (
          activeElement.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(activeElement.tagName)
        )
      ) {
        return;
      }

      const hoveredTarget = hoveredBubbleTargetRef.current;
      if (!hoveredTarget) return;
      event.preventDefault();
      if (hoveredTarget.kind === 'source') {
        openSourceDetail(hoveredTarget.key);
        return;
      }
      const targetCard = itemMap[hoveredTarget.key];
      if (targetCard?.type === 'card') {
        openCardDetail(targetCard, 'view');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    boxMenu.show,
    cardCommentPicker,
    bubbleDetail,
    bubbleMenu.show,
    columnMenu.show,
    itemMap,
    layerMenu.show,
    nodeMenu.show,
    openCardDetail,
    openSourceDetail,
  ]);

  const openBubbleMenu = useCallback((event: MouseEvent<HTMLDivElement>, bubble: SortingSourceBubble) => {
    event.preventDefault();
    event.stopPropagation();
    setBubbleMenu({ show: true, x: event.clientX, y: event.clientY, bubbleKey: bubble.key });
    setNodeMenu({ show: false, x: 0, y: 0, item: null });
    setColumnMenu({ show: false, x: 0, y: 0, columnId: null });
    setLayerMenu({ show: false, x: 0, y: 0, layer: null });
    setBoxMenu({ show: false, x: 0, y: 0, boxId: null });
  }, []);

  const openNodeMenu = useCallback((event: MouseEvent<HTMLDivElement>, item: SortingCardView) => {
    event.preventDefault();
    event.stopPropagation();
    setNodeMenu({ show: true, x: event.clientX, y: event.clientY, item });
    setBubbleMenu({ show: false, x: 0, y: 0, bubbleKey: null });
    setColumnMenu({ show: false, x: 0, y: 0, columnId: null });
    setLayerMenu({ show: false, x: 0, y: 0, layer: null });
    setBoxMenu({ show: false, x: 0, y: 0, boxId: null });
  }, []);

  const openColumnMenu = useCallback((event: MouseEvent<HTMLDivElement>, columnId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setColumnMenu({ show: true, x: event.clientX, y: event.clientY, columnId });
    setBubbleMenu({ show: false, x: 0, y: 0, bubbleKey: null });
    setNodeMenu({ show: false, x: 0, y: 0, item: null });
    setLayerMenu({ show: false, x: 0, y: 0, layer: null });
    setBoxMenu({ show: false, x: 0, y: 0, boxId: null });
  }, []);

  const openLayerMenu = useCallback((event: MouseEvent<HTMLElement>, layer: SortingLayerView) => {
    event.preventDefault();
    event.stopPropagation();
    setLayerMenu({ show: true, x: event.clientX, y: event.clientY, layer });
    setBubbleMenu({ show: false, x: 0, y: 0, bubbleKey: null });
    setNodeMenu({ show: false, x: 0, y: 0, item: null });
    setColumnMenu({ show: false, x: 0, y: 0, columnId: null });
    setBoxMenu({ show: false, x: 0, y: 0, boxId: null });
  }, []);

  const openBoxMenu = useCallback((event: MouseEvent<HTMLElement>, boxId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setBoxMenu({ show: true, x: event.clientX, y: event.clientY, boxId });
    setBubbleMenu({ show: false, x: 0, y: 0, bubbleKey: null });
    setNodeMenu({ show: false, x: 0, y: 0, item: null });
    setColumnMenu({ show: false, x: 0, y: 0, columnId: null });
    setLayerMenu({ show: false, x: 0, y: 0, layer: null });
  }, []);

  const luggageItems = columnItems[luggageColumnId] || [];
  const toggleExpandedBubble = useCallback((itemId: string) => {
    setExpandedBubbleIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);
  const getSidebarBoxCount = useCallback((boxId: string) => (
    getBoxBubbleCount(boxId, columns, itemMap)
  ), [columns, itemMap]);
  const getSidebarLayerColumnCount = useCallback((layerId: string) => (
    columns.filter((column) => columnHasBoundLayer(column, layerId)).length
  ), [columnHasBoundLayer, columns]);
  const currentBoardLayerName = useMemo(
    () => selectedBoxLayers.find((layer) => layer.id === effectiveCurrentLayerId)?.name || null,
    [effectiveCurrentLayerId, selectedBoxLayers],
  );
  const handleCreateBoxAction = useCallback(() => { void handleCreateBox(); }, [handleCreateBox]);
  const handleToggleSidebarLayers = useCallback(() => {
    setIsSidebarLayersCollapsed((prev) => !prev);
  }, []);
  const handleToggleSidebarSources = useCallback(() => {
    setIsSidebarSourcesCollapsed((prev) => !prev);
  }, []);
  const commitSidebarSectionLayoutChange = useCallback((nextLayout: SortingSidebarSectionLayout) => {
    void handleSidebarSectionLayoutChange(nextLayout);
  }, [handleSidebarSectionLayoutChange]);
  const handleSourceComposerDraftChange = useCallback((updater: (draft: SortingSourceDraftState) => SortingSourceDraftState) => {
    updateCurrentSourceDraft((draft) => updater({
      text: draft.text,
      items: draft.items,
    }));
  }, [updateCurrentSourceDraft]);
  const handleSourceComposerSend = useCallback(() => { void handleSendSourceMessage(); }, [handleSendSourceMessage]);
  const handleSourceComposerFocus = useCallback(() => undefined, []);
  const handleSourceComposerDragOver = useCallback((event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
  }, []);
  const handleSourceBackToList = useCallback(() => {
    setIsSourceListView(true);
  }, []);
  const handleToggleSourcePaneCollapse = useCallback(() => {
    setIsSourceCollapsed((prev) => !prev);
  }, []);
  const handleUnfoldBubble = useCallback((bubbleKey: string) => {
    setFoldedBubbles((prev) => {
      const next = new Set(prev);
      next.delete(bubbleKey);
      return next;
    });
  }, []);
  const handleOpenSourceBubbleThread = useCallback((bubble: SortingSourceBubble) => {
    if (!onOpenSourceThread) return;
    onOpenSourceThread({
      conversationId: bubble.streamId,
      messageId: bubble.bubble.id,
    });
  }, [onOpenSourceThread]);

  const openThreadTarget = useCallback((target: ThreadTarget) => {
    if (!onOpenSourceThread) return;
    onOpenSourceThread(target);
  }, [onOpenSourceThread]);

  const ensureCardCommentThread = useCallback(async (item: SortingCardView): Promise<ThreadTarget | null> => {
    if (item.type !== 'card') return null;

    const sourceKeys = sourceInfoMap[item.id]?.keys || [];
    const availableSourceKeys = sourceKeys.filter((key) => allStreamBubbleMap.has(key));

    if (availableSourceKeys.length === 1) {
      const sourceBubble = allStreamBubbleMap.get(availableSourceKeys[0]);
      if (!sourceBubble) return null;
      return {
        conversationId: sourceBubble.streamId,
        messageId: sourceBubble.bubble.id,
      };
    }

    if (availableSourceKeys.length > 1) {
      setCardCommentPicker({ cardId: item.id });
      return null;
    }

    const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const outputConversationId =
      typeof metadata.outputConversationId === 'string' ? metadata.outputConversationId.trim() : '';
    const outputMessageId =
      typeof metadata.outputMessageId === 'string' ? metadata.outputMessageId.trim() : '';

    if (outputConversationId && outputMessageId) {
      return {
        conversationId: outputConversationId,
        messageId: outputMessageId,
      };
    }

    if (!onSaveAsBubble) {
      showToast('这张卡片暂时没有可评论的线程');
      return null;
    }

    const created = await onSaveAsBubble({
      message: buildBubbleMessagePayload(item),
      sourceIds: sourceKeys,
      cardId: item.id,
    });

    if (!created) {
      showToast('创建评论线程失败');
      return null;
    }

    patchWorkspaceItem(item.id, (current) => ({
      ...current,
      metadata: {
        ...(current.metadata || {}),
        outputConversationId: created.conversationId,
        outputMessageId: created.messageId,
        sourceIds: sourceKeys,
      },
    }));

    return created;
  }, [
    allStreamBubbleMap,
    onSaveAsBubble,
    patchWorkspaceItem,
    showToast,
    sourceInfoMap,
  ]);

  const handleOpenCardCommentPicker = useCallback(async (item: SortingCardView) => {
    const target = await ensureCardCommentThread(item);
    if (!target) return;
    openThreadTarget(target);
  }, [ensureCardCommentThread, openThreadTarget]);

  const handleSelectCardCommentSource = useCallback((sourceKey: string) => {
    const sourceBubble = allStreamBubbleMap.get(sourceKey);
    if (!sourceBubble) {
      showToast('源泡泡不存在或已不可用');
      return;
    }
    setCardCommentPicker(null);
    handleOpenSourceBubbleThread(sourceBubble);
  }, [allStreamBubbleMap, handleOpenSourceBubbleThread, showToast]);
  const handleCancelRenameColumn = useCallback(() => {
    setEditingColId(null);
    setEditingColName('');
  }, []);
  const handleStartRenameColumn = useCallback((column: SortingColumnView) => {
    setEditingColId(column.id);
    setEditingColName(column.name);
  }, []);
  const handleOpenParentBox = useCallback(() => {
    if (parentBox) handleSelectBox(parentBox.id);
  }, [handleSelectBox, parentBox]);
  const handleOpenBoxSettings = useCallback((botId?: string) => {
    setBoxSettingsInitialBotId(botId || null);
    setBoxSettingsOpen(true);
  }, []);
  const handleBoardBubbleDraftChange = useCallback((patch: Partial<SortingBubbleDraft>) => {
    setEditingBubbleDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);
  const handleSaveEditingBubbleAction = useCallback(() => { void saveEditingBubble(); }, [saveEditingBubble]);
  const handleCancelEditingBubbleAction = useCallback(() => { void cancelEditingBubble(); }, [cancelEditingBubble]);
  const handleBoardAddBlankBubble = useCallback((columnId: string) => { void addBlankBubble(columnId); }, [addBlankBubble]);
  const handleToggleAddColumn = useCallback((open: boolean) => {
    setAddingColumn(open);
    if (!open) setNewColName('');
  }, []);
  const handleToggleLuggageCollapse = useCallback(() => {
    setIsLuggageCollapsed((prev) => !prev);
  }, []);
  const sidebarPaneContent = useMemo(() => {
    if (!workspace || !activeBox || !bridge) return null;
    return (
      <>
        <SortingSidebar
          switchBoxes={visibleSwitchBoxes}
          currentLayers={boxLayers}
          showSourcesSection={false}
          streams={streams}
          boxSearchQuery={boxListSearchQuery}
          activeBoxId={activeBoxId}
          currentBox={activeBox}
          breadcrumbBoxes={breadcrumbBoxes}
          homeBoxId={homeBoxId}
          selectedLayerIds={selectedBoxLayers.map((layer) => layer.id)}
          currentLayerId={effectiveCurrentLayerId}
          selectedSourceIds={selectedSourceIds}
          focusedSourceId={selectedStreams.length > 0 ? currentSourceId : null}
          editingBoxId={editingBoxId}
          editingBoxName={editingBoxName}
          editingLayerId={editingLayerId}
          editingLayerName={editingLayerName}
          editBoxRef={editBoxRef}
          editLayerRef={editLayerRef}
          isCollapsed={isSidebarCollapsed}
          isLayersCollapsed={isSidebarLayersCollapsed}
          isSourcesCollapsed={isSidebarSourcesCollapsed}
          sectionLayout={sidebarSectionLayout}
          getBoxCount={getSidebarBoxCount}
          getLayerColumnCount={getSidebarLayerColumnCount}
          onSelectBox={handleSelectBox}
          onSelectRootBox={handleOpenRootBox}
          onSelectBreadcrumbBox={handleOpenBreadcrumbBox}
          onCreateBox={handleCreateBoxAction}
          addingLayer={addingLayer}
          newLayerName={newLayerName}
          newLayerRef={newLayerRef}
          onStartCreateLayer={handleStartCreateLayer}
          onSaveNewLayer={handleCreateLayer}
          onCancelCreateLayer={handleCancelCreateLayer}
          onStartRenameBox={handleStartRenameBox}
          onStartRenameLayer={handleStartRenameLayer}
          onSaveRenameBox={handleSaveRenameBox}
          onSaveRenameLayer={handleSaveRenameLayer}
          onCancelRenameBox={handleCancelRenameBox}
          onCancelRenameLayer={handleCancelRenameLayer}
          onOpenBoxMenu={openBoxMenu}
          onOpenLayerMenu={openLayerMenu}
          onBoxSearchQueryChange={setBoxListSearchQuery}
          onFocusLayer={handleFocusLayer}
          onToggleLayer={handleToggleLayer}
          onToggleSource={handleToggleSourceSelection}
          onBack={onBack}
          onToggleCollapse={handleToggleSidebarCollapse}
          onToggleLayersCollapse={handleToggleSidebarLayers}
          onToggleSourcesCollapse={handleToggleSidebarSources}
          onSectionLayoutChange={commitSidebarSectionLayoutChange}
          highlightedBoxId={highlightedSearchBoxId}
          highlightedLayerId={highlightedSearchLayerId}
        />
        <ResizeHandle className="pane-resize-handle sorting-pane__handle desktop-only" onDrag={resizeSidebarPane} ariaLabel="调整分箱左侧栏宽度" limit={sidebarPane.limit} />
      </>
    );
  }, [
    activeBox,
    activeBoxId,
    addingLayer,
    boxListSearchQuery,
    boxLayers,
    boxes,
    breadcrumbBoxes,
    bridge,
    commitSidebarSectionLayoutChange,
    currentSourceId,
    editBoxRef,
    editLayerRef,
    editingBoxId,
    editingBoxName,
    editingLayerId,
    editingLayerName,
    effectiveCurrentLayerId,
    getSidebarBoxCount,
    getSidebarLayerColumnCount,
    handleCancelCreateLayer,
    handleCancelRenameBox,
    handleCancelRenameLayer,
    handleCreateBoxAction,
    handleCreateLayer,
    handleFocusLayer,
    handleOpenBreadcrumbBox,
    handleOpenRootBox,
    handleSaveRenameBox,
    handleSaveRenameLayer,
    handleSelectBox,
    handleStartCreateLayer,
    handleStartRenameBox,
    handleStartRenameLayer,
    handleToggleLayer,
    handleToggleSidebarCollapse,
    handleToggleSidebarLayers,
    handleToggleSidebarSources,
    handleToggleSourceSelection,
    highlightedSearchBoxId,
    highlightedSearchLayerId,
    homeBoxId,
    isSidebarCollapsed,
    isSidebarLayersCollapsed,
    isSidebarSourcesCollapsed,
    newLayerName,
    newLayerRef,
    onBack,
    openBoxMenu,
    openLayerMenu,
    resizeSidebarPane,
    selectedBoxLayers,
    selectedSourceIds,
    selectedStreams.length,
    sidebarPane.limit,
    sidebarSectionLayout,
    streams,
    visibleSwitchBoxes,
    workspace,
  ]);
  const boardPaneContent = useMemo(() => {
    if (!workspace || !activeBox || !bridge) return null;
    return (
      <SortingBoard
        activeBox={activeBox}
        bots={bots}
        boxBotBindings={activeBox.botBindings || {}}
        homeBoxId={homeBoxId}
        parentBox={parentBox}
        selectedLayers={selectedBoxLayers}
        visibleColumns={visibleColumns}
        boxItemIds={boxItemIds}
        columnItems={visibleColumnItems}
        currentLayerId={effectiveCurrentLayerId}
        itemMap={itemMap}
        boxes={boxes}
        sourceInfoMap={sourceInfoMap}
        bubbleCount={bubbleCount}
        currentLayerName={currentBoardLayerName}
        localSearchQuery={localSearchQuery}
        localSearchOpen={isLocalSearchOpen}
        localSearchInputRef={localSearchInputRef}
        localSearchPanelOpen={isLocalSearchOpen && Boolean(localSearchQuery.trim())}
        localSearchResultsView={localSearchResultsView}
        highlightedBoxId={highlightedSearchBoxId}
        highlightedLayerId={highlightedSearchLayerId}
        highlightedColumnId={highlightedSearchColumnId}
        highlightedItemId={highlightedSearchItemId}
        expandedBubbleIds={expandedBubbleIds}
        editingBubbleId={editingBubbleId}
        editingBubbleDraft={editingBubbleDraft}
        editingColId={editingColId}
        editingColName={editingColName}
        editColRef={editColRef}
        addingColumn={addingColumn}
        newColName={newColName}
        newColRef={newColRef}
        enableColumnReorder
        onRenameColumn={handleRenameColumn}
        onCancelRename={handleCancelRenameColumn}
        onStartRenameColumn={handleStartRenameColumn}
        onOpenColumnMenu={openColumnMenu}
        onOpenNodeMenu={openNodeMenu}
        onOpenCardCommentPicker={handleOpenCardCommentPicker}
        onOpenBox={handleSelectBox}
        onOpenHome={handleOpenRootBox}
        onOpenParent={handleOpenParentBox}
        onOpenBoxSettings={handleOpenBoxSettings}
        onToggleLocalSearch={toggleLocalSearch}
        onLocalSearchQueryChange={setLocalSearchQuery}
        onLocalSearchFocus={() => undefined}
        onLocalSearchKeyDown={handleLocalSearchInputKeyDown}
        onClearLocalSearch={() => setLocalSearchQuery('')}
        onStartEditBubble={startEditingBubble}
        onBubbleDraftChange={handleBoardBubbleDraftChange}
        onToggleExpandedBubble={toggleExpandedBubble}
        onSaveEditingBubble={handleSaveEditingBubbleAction}
        onCancelEditingBubble={handleCancelEditingBubbleAction}
        onAddBlankBubble={handleBoardAddBlankBubble}
        onToggleAddColumn={handleToggleAddColumn}
        onAddColumn={handleAddColumn}
      />
    );
  }, [
    activeBox,
    addingColumn,
    bots,
    boxItemIds,
    boxes,
    bridge,
    bubbleCount,
    currentBoardLayerName,
    editColRef,
    editingBubbleDraft,
    editingBubbleId,
    editingColId,
    editingColName,
    effectiveCurrentLayerId,
    expandedBubbleIds,
    handleAddColumn,
    handleBoardAddBlankBubble,
    handleBoardBubbleDraftChange,
    handleCancelEditingBubbleAction,
    handleCancelRenameColumn,
    handleOpenParentBox,
    handleOpenRootBox,
    handleOpenCardCommentPicker,
    handleOpenBoxSettings,
    handleRenameColumn,
    handleSaveEditingBubbleAction,
    handleSelectBox,
    handleStartRenameColumn,
    handleToggleAddColumn,
    toggleLocalSearch,
    homeBoxId,
    isLocalSearchOpen,
    itemMap,
    newColName,
    newColRef,
    openColumnMenu,
    openNodeMenu,
    parentBox,
    selectedBoxLayers,
    sourceInfoMap,
    startEditingBubble,
    toggleExpandedBubble,
    localSearchInputRef,
    localSearchQuery,
    localSearchResultsView,
    handleLocalSearchInputKeyDown,
    highlightedSearchBoxId,
    highlightedSearchColumnId,
    highlightedSearchItemId,
    highlightedSearchLayerId,
    visibleColumnItems,
    visibleColumns,
    workspace,
  ]);
  const luggagePaneContent = useMemo(() => {
    if (!workspace || !activeBox || !bridge) return null;
    return (
      <>
        <ResizeHandle className="pane-resize-handle pane-resize-handle--leading sorting-pane__handle desktop-only" onDrag={resizeLuggagePane} ariaLabel="调整行李箱宽度" limit={luggagePane.limit} />
        <SortingLuggagePanel
          isCollapsed={isLuggageCollapsed}
          itemIds={luggageItems}
          itemMap={itemMap}
          boxes={boxes}
          sourceInfoMap={sourceInfoMap}
          editingBubbleId={editingBubbleId}
          editingBubbleDraft={editingBubbleDraft}
          expandedBubbleIds={expandedBubbleIds}
          onToggleCollapse={handleToggleLuggageCollapse}
          onOpenBox={handleSelectBox}
          onStartEditBubble={startEditingBubble}
          onBubbleDraftChange={handleBoardBubbleDraftChange}
          onToggleExpandedBubble={toggleExpandedBubble}
          onSaveEditingBubble={handleSaveEditingBubbleAction}
          onCancelEditingBubble={handleCancelEditingBubbleAction}
          onOpenNodeMenu={openNodeMenu}
          onOpenCardCommentPicker={handleOpenCardCommentPicker}
          luggageColumnId={luggageColumnId}
        />
      </>
    );
  }, [
    activeBox,
    boxes,
    bridge,
    editingBubbleDraft,
    editingBubbleId,
    expandedBubbleIds,
    handleBoardBubbleDraftChange,
    handleCancelEditingBubbleAction,
    handleOpenCardCommentPicker,
    handleSaveEditingBubbleAction,
    handleSelectBox,
    handleToggleLuggageCollapse,
    itemMap,
    luggageColumnId,
    luggageItems,
    luggagePane.limit,
    openNodeMenu,
    sourceInfoMap,
    startEditingBubble,
    toggleExpandedBubble,
    workspace,
    resizeLuggagePane,
    isLuggageCollapsed,
  ]);

  if (!workspace || !activeBox || !bridge) {
    return (
      <div className="pane sorting-pane">
        <div className="sorting-loading">分箱面板加载中...</div>
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={(result) => { void onDragEnd(result); }}>
      <div className="pane sorting-pane">
        <div
          className={`s-pane-shell s-pane-shell--sidebar ${isSidebarCollapsed ? 'is-collapsed' : ''} ${isSidebarDrawerAnimating ? 'is-drawer-animating' : ''}`}
          style={{ width: isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarPane.size }}
        >
          {sidebarPaneContent}
        </div>

        <div
          className={`s-pane-shell ${isSourceCollapsed ? 'is-collapsed' : ''}`}
          style={{ width: isSourceCollapsed ? SOURCE_COLLAPSED_WIDTH : sourcePane.size }}
          onPointerMoveCapture={handlePanePointerMove}
          onPointerLeave={clearHoveredBubbleTarget}
        >
          <SortingSourcePanel
            streams={streams}
            selectedStreamIds={selectedSourceIds}
            currentStream={focusedStream}
            bubbles={filteredDetailBubbles}
            foldedBubbles={foldedBubbles}
            highlightedBubbleKey={highlightedSourceBubbleKey}
            isCollapsed={isSourceCollapsed}
            isListView={isSourceListView}
            sourceViewMode={sourceViewMode}
            visibleStreamIds={visibleSourceListStreamIds}
            streamListSearchQuery={sourceListSearchQuery}
            detailBubbleSearchQuery={sourceDetailSearchQuery}
            composerDraft={currentSourceDraft}
            composerPlaceholder={sourceComposerPlaceholder}
            composerDisabled={!currentSourceId || isSendingSourceMessage || isPreparingSourceDraft}
            onComposerDraftChange={handleSourceComposerDraftChange}
            onComposerSend={handleSourceComposerSend}
            onComposerFocus={handleSourceComposerFocus}
            onComposerPaste={handleSourceDraftPaste}
            onComposerDrop={handleSourceDraftDrop}
            onComposerDragOver={handleSourceComposerDragOver}
            onComposerSelectFiles={handleSourceSelectFiles}
            onOpenBubbleMenu={openBubbleMenu}
            onOpenBubbleThread={handleOpenSourceBubbleThread}
            onToggleStreamSelection={handleToggleSourceSelection}
            onFocusStream={handleFocusSource}
            onOpenStream={handleOpenSource}
            onOpenSelectedStreams={handleOpenSelectedSources}
            onStreamListSearchQueryChange={setSourceListSearchQuery}
            onDetailBubbleSearchQueryChange={setSourceDetailSearchQuery}
            onClearSelection={handleClearSourceSelection}
            onBackToList={handleSourceBackToList}
            onToggleCollapse={handleToggleSourcePaneCollapse}
            onUnfoldBubble={handleUnfoldBubble}
          />
          <ResizeHandle className="pane-resize-handle sorting-pane__handle desktop-only" onDrag={resizeSourcePane} ariaLabel="调整泡泡流面板宽度" limit={sourcePane.limit} />
        </div>

        <div className="s-pane-shell s-pane-shell--board" onPointerMoveCapture={handlePanePointerMove} onPointerLeave={clearHoveredBubbleTarget}>
          {boardPaneContent}
        </div>

        <div
          className={`s-pane-shell s-pane-shell--luggage ${isLuggageCollapsed ? 'is-collapsed' : ''}`}
          style={{ width: isLuggageCollapsed ? LUGGAGE_COLLAPSED_WIDTH : luggagePane.size }}
          onPointerMoveCapture={handlePanePointerMove}
          onPointerLeave={clearHoveredBubbleTarget}
        >
          {luggagePaneContent}
        </div>

        {bubbleMenu.show && (
          <SortingContextMenu x={bubbleMenu.x} y={bubbleMenu.y}>
            <button type="button" className="s-menu-item" onClick={() => {
              const bubble = bubbleMenu.bubbleKey ? bubbleMap.get(bubbleMenu.bubbleKey) || null : null;
              if (bubble) handleOpenSourceBubbleThread(bubble);
              setBubbleMenu({ show: false, x: 0, y: 0, bubbleKey: null });
            }}>
              <MessageCircleIcon size={14} />
              <span>进入评论</span>
            </button>
            <SortingMenuDivider />
            <button type="button" className="s-menu-item" onClick={() => {
              if (bubbleMenu.bubbleKey) openSourceDetail(bubbleMenu.bubbleKey);
              setBubbleMenu({ show: false, x: 0, y: 0, bubbleKey: null });
            }}>
              <EyeIcon size={14} />
              <span>查看详情</span>
            </button>
            <SortingMenuDivider />
            <button type="button" className="s-menu-item" onClick={() => {
              if (bubbleMenu.bubbleKey) void copyBubbleContent(bubbleMenu.bubbleKey);
              setBubbleMenu({ show: false, x: 0, y: 0, bubbleKey: null });
            }}>
              <CopyIcon size={14} />
              <span>复制内容</span>
            </button>
            <SortingMenuDivider />
            <button type="button" className="s-menu-item danger" onClick={() => {
              if (bubbleMenu.bubbleKey) {
                setFoldedBubbles((prev) => new Set(prev).add(bubbleMenu.bubbleKey!));
                showToast('已折叠该泡泡');
              }
              setBubbleMenu({ show: false, x: 0, y: 0, bubbleKey: null });
            }}>
              <TrashIcon size={14} />
              <span>折叠隐藏</span>
            </button>
          </SortingContextMenu>
        )}

        {nodeMenu.show && nodeMenu.item && (
          <SortingContextMenu x={nodeMenu.x} y={nodeMenu.y}>
            {nodeMenu.item.type === 'card' && (
              <>
                <button type="button" className="s-menu-item" onClick={() => {
                  handleOpenCardCommentPicker(nodeMenu.item!);
                  setNodeMenu({ show: false, x: 0, y: 0, item: null });
                }}>
                  <MessageCircleIcon size={14} />
                  <span>进入评论</span>
                </button>
                <SortingMenuDivider />
                <button type="button" className="s-menu-item" onClick={() => {
                  openCardDetail(nodeMenu.item!, 'view');
                  setNodeMenu({ show: false, x: 0, y: 0, item: null });
                }}>
                  <EyeIcon size={14} />
                  <span>查看详情</span>
                </button>
                <button type="button" className="s-menu-item" onClick={() => {
                  startEditingBubble(nodeMenu.item!);
                  setNodeMenu({ show: false, x: 0, y: 0, item: null });
                }}>
                  <EditIcon size={14} />
                  <span>编辑泡泡</span>
                </button>
                {onSaveAsBubble && (
                <button type="button" className="s-menu-item" onClick={() => {
                  void sendBubbleBack(nodeMenu.item!);
                  setNodeMenu({ show: false, x: 0, y: 0, item: null });
                }}>
                  <UploadIcon size={14} />
                  <span>回写如流</span>
                </button>
              )}
                <SortingMenuDivider />
              </>
            )}
            {nodeMenu.item.type === 'box' && nodeMenu.item.childBoxId && (
              <>
                <button type="button" className="s-menu-item" onClick={() => {
                  handleSelectBox(nodeMenu.item!.childBoxId!);
                  setNodeMenu({ show: false, x: 0, y: 0, item: null });
                }}>
                  <BoxIcon size={14} />
                  <span>进入箱子</span>
                </button>
                <SortingMenuDivider />
              </>
            )}
            <button type="button" className="s-menu-item danger" onClick={() => {
              void handleDeleteNode(nodeMenu.item!);
              setNodeMenu({ show: false, x: 0, y: 0, item: null });
            }}>
              <TrashIcon size={14} />
              <span>{nodeMenu.item.type === 'box' ? '删除箱子入口' : '删除泡泡'}</span>
            </button>
          </SortingContextMenu>
        )}

        {columnMenu.show && columnMenu.columnId && (
          <SortingContextMenu x={columnMenu.x} y={columnMenu.y}>
            <button type="button" className="s-menu-item" onClick={() => {
              const column = columns.find((item) => item.id === columnMenu.columnId);
              if (column) {
                setEditingColId(column.id);
                setEditingColName(column.name);
              }
              setColumnMenu({ show: false, x: 0, y: 0, columnId: null });
            }}>
              <EditIcon size={14} />
              <span>重命名列</span>
            </button>
            {(() => {
              const currentColumn = columns.find((item) => item.id === columnMenu.columnId);
              const moveTargets = boxLayers.filter((layer) => currentColumn && !columnHasBoundLayer(currentColumn, layer.id));
              if (!currentColumn || moveTargets.length === 0) return null;
              return (
                <>
                  <SortingMenuDivider />
                  {moveTargets.map((layer) => (
                    <button key={layer.id} type="button" className="s-menu-item" onClick={() => {
                      void handleMoveColumnToLayer(currentColumn.id, layer.id);
                      setColumnMenu({ show: false, x: 0, y: 0, columnId: null });
                    }}>
                      <HashIcon size={14} />
                      <span>{`加入层「${layer.name}」`}</span>
                    </button>
                  ))}
                </>
              );
            })()}
            <SortingMenuDivider />
            <button type="button" className="s-menu-item danger" onClick={() => {
              if (columnMenu.columnId) void handleDeleteColumn(columnMenu.columnId);
              setColumnMenu({ show: false, x: 0, y: 0, columnId: null });
            }}>
              <TrashIcon size={14} />
              <span>删除列</span>
            </button>
          </SortingContextMenu>
        )}

        {layerMenu.show && layerMenu.layer && (
          <SortingContextMenu x={layerMenu.x} y={layerMenu.y}>
            <button type="button" className="s-menu-item" onClick={() => {
              handleStartRenameLayer(layerMenu.layer!);
              setLayerMenu({ show: false, x: 0, y: 0, layer: null });
            }}>
              <EditIcon size={14} />
              <span>重命名层</span>
            </button>
            <SortingMenuDivider />
            <button type="button" className="s-menu-item danger" onClick={() => {
              void handleDeleteLayer(layerMenu.layer!.id);
              setLayerMenu({ show: false, x: 0, y: 0, layer: null });
            }}>
              <TrashIcon size={14} />
              <span>删除层</span>
            </button>
          </SortingContextMenu>
        )}

        {boxMenu.show && boxMenu.boxId && (
          <SortingContextMenu x={boxMenu.x} y={boxMenu.y}>
            <button type="button" className="s-menu-item" onClick={() => {
              const box = boxes.find((item) => item.id === boxMenu.boxId);
              if (box) {
                setEditingBoxId(box.id);
                setEditingBoxName(box.name || '');
              }
              setBoxMenu({ show: false, x: 0, y: 0, boxId: null });
            }}>
              <EditIcon size={14} />
              <span>重命名箱子</span>
            </button>
            <SortingMenuDivider />
            <button type="button" className="s-menu-item danger" onClick={() => {
              if (boxMenu.boxId) void handleDeleteBox(boxMenu.boxId);
            }}>
              <TrashIcon size={14} />
              <span>删除箱子</span>
            </button>
          </SortingContextMenu>
        )}

        {cardCommentPicker && (
          <div className="confirm-dialog-overlay" onClick={() => setCardCommentPicker(null)}>
            <div className="confirm-dialog forward-picker" onClick={(event) => event.stopPropagation()}>
              <div className="confirm-title">选择源泡泡评论</div>
              <div className="confirm-desc">{cardCommentPickerTitle}</div>
              <div className="forward-picker-list">
                {cardCommentOptions.length > 0 ? cardCommentOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className="forward-picker-item"
                    onClick={() => handleSelectCardCommentSource(option.key)}
                  >
                    <div className="forward-picker-item__body">
                      <strong>{option.streamTitle}</strong>
                      <span>{option.preview}</span>
                    </div>
                    <span className="forward-picker-item__badge">{option.timeLabel}</span>
                  </button>
                )) : (
                  <div className="bot-empty-state">当前没有可用的源泡泡评论入口。</div>
                )}
              </div>
              <div className="confirm-actions">
                <button className="btn-secondary" onClick={() => setCardCommentPicker(null)}>取消</button>
              </div>
            </div>
          </div>
        )}

        {bubbleDetail && activeDetailMessage && (
          <SortingBubbleDetailModal
            open
            mode={bubbleDetail.mode}
            message={activeDetailMessage}
            kindLabel={activeDetailKindLabel}
            title={activeDetailTitle}
            sourceLabel={activeDetailSourceLabel}
            editable={bubbleDetail.kind === 'card'}
            draft={bubbleDetail.kind === 'card' && bubbleDetail.mode === 'edit' ? editingBubbleDraft : null}
            searchQuery={detailSearchQuery}
            searchOpen={isDetailSearchOpen}
            searchPanelOpen={isDetailSearchOpen && Boolean(detailSearchQuery.trim())}
            searchInputRef={detailSearchInputRef}
            searchResultsView={detailSearchResultsView}
            onClose={closeBubbleDetail}
            onRequestEdit={bubbleDetail.kind === 'card' && activeDetailCard ? () => startEditingBubble(activeDetailCard) : undefined}
            onToggleSearch={toggleDetailSearch}
            onSearchQueryChange={setDetailSearchQuery}
            onSearchInputFocus={() => undefined}
            onSearchInputKeyDown={handleDetailSearchInputKeyDown}
            onClearSearch={() => setDetailSearchQuery('')}
            onError={showToast}
            onSave={(nextDraft) => { void saveEditingBubble(nextDraft); }}
          />
        )}

        <SortingBoxSettingsModal
          open={boxSettingsOpen}
          box={activeBox}
          bots={bots}
          initialBotId={boxSettingsInitialBotId}
          defaultWorkspacePath={defaultWorkspacePath}
          onClose={() => {
            setBoxSettingsOpen(false);
            setBoxSettingsInitialBotId(null);
          }}
          onOpenGlobalBotSettings={() => {
            setBoxSettingsOpen(false);
            setBoxSettingsInitialBotId(null);
            onOpenGlobalBotSettings?.();
          }}
          onSaveBotBinding={async (botId, payload) => {
            await updateWorkspace({
              action: 'set-box-bot-binding',
              boxId: activeBox.id,
              botId,
              enabled: payload.enabled,
              triggerMode: payload.triggerMode,
              outputMode: payload.outputMode,
              alias: payload.alias,
              metadata: payload.metadata,
            });
          }}
        />

        {toast && (
          <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </DragDropContext>
  );
}
