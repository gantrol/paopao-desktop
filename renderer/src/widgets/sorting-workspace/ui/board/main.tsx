import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react';
import { CurrentStatusGlyph } from '@/shared/icons/StatusGlyph';
import { InlineSearchControl } from '@/shared/ui/InlineSearchControl';
import type { BotRecord } from '@/entities/bot';
import type {
  SortingBoxView,
  SortingCardView,
  SortingColumnView,
  SortingLayerView,
  SortingScopedBotBindingView,
} from '@/entities/sorting';
import { BoxIcon, CopyIcon } from '../icons';
import type { SortingBubbleDraft, SortingBubbleSourceInfo } from '../types';
import { SortingKanbanView } from './kanban-view';

export function SortingBoard({
  activeBox,
  bots,
  boxBotBindings,
  homeBoxId,
  parentBox,
  selectedLayers,
  visibleColumns,
  boxItemIds,
  columnItems,
  currentLayerId,
  itemMap,
  boxes,
  sourceInfoMap,
  bubbleCount,
  currentLayerName,
  localSearchQuery,
  localSearchOpen,
  localSearchInputRef,
  localSearchPanelOpen,
  localSearchResultsView,
  highlightedBoxId,
  highlightedLayerId,
  highlightedColumnId,
  highlightedItemId,
  expandedBubbleIds,
  editingBubbleId,
  editingBubbleDraft,
  editingColId,
  editingColName,
  editColRef,
  addingColumn,
  newColName,
  newColRef,
  enableColumnReorder,
  onRenameColumn,
  onCancelRename,
  onStartRenameColumn,
  onOpenColumnMenu,
  onOpenNodeMenu,
  onOpenCardCommentPicker,
  onOpenBox,
  onOpenHome,
  onOpenParent,
  onOpenBoxSettings,
  onCopySelectedLayers,
  onToggleLocalSearch,
  onLocalSearchQueryChange,
  onLocalSearchFocus,
  onLocalSearchKeyDown,
  onClearLocalSearch,
  onStartEditBubble,
  onBubbleDraftChange,
  onToggleExpandedBubble,
  onSaveEditingBubble,
  onCancelEditingBubble,
  onAddBlankBubble,
  onToggleAddColumn,
  onAddColumn,
  copySelectedLayersDisabled,
}: {
  activeBox: SortingBoxView;
  bots: BotRecord[];
  boxBotBindings: Record<string, SortingScopedBotBindingView>;
  homeBoxId: string | null;
  parentBox: SortingBoxView | null;
  selectedLayers: SortingLayerView[];
  visibleColumns: SortingColumnView[];
  boxItemIds: string[];
  columnItems: Record<string, string[]>;
  currentLayerId: string | null;
  itemMap: Record<string, SortingCardView>;
  boxes: SortingBoxView[];
  sourceInfoMap: Record<string, SortingBubbleSourceInfo>;
  bubbleCount: number;
  currentLayerName: string | null;
  localSearchQuery: string;
  localSearchOpen: boolean;
  localSearchInputRef: RefObject<HTMLInputElement | null>;
  localSearchPanelOpen: boolean;
  localSearchResultsView?: ReactNode;
  highlightedBoxId?: string | null;
  highlightedLayerId?: string | null;
  highlightedColumnId?: string | null;
  highlightedItemId?: string | null;
  expandedBubbleIds: Set<string>;
  editingBubbleId: string | null;
  editingBubbleDraft: SortingBubbleDraft | null;
  editingColId: string | null;
  editingColName: string;
  editColRef: RefObject<HTMLInputElement | null>;
  addingColumn: boolean;
  newColName: string;
  newColRef: RefObject<HTMLInputElement | null>;
  enableColumnReorder: boolean;
  onRenameColumn: (value: string, input?: HTMLInputElement | null) => void | Promise<void>;
  onCancelRename: () => void;
  onStartRenameColumn: (column: SortingColumnView) => void;
  onOpenColumnMenu: (event: MouseEvent<HTMLDivElement>, columnId: string) => void;
  onOpenNodeMenu: (event: MouseEvent<HTMLDivElement>, item: SortingCardView) => void;
  onOpenCardCommentPicker: (item: SortingCardView) => void;
  onOpenBox: (boxId: string) => void;
  onOpenHome: () => void;
  onOpenParent: () => void;
  onOpenBoxSettings: (botId?: string) => void;
  onCopySelectedLayers: () => void;
  onToggleLocalSearch: () => void;
  onLocalSearchQueryChange: (value: string) => void;
  onLocalSearchFocus: () => void;
  onLocalSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onClearLocalSearch: () => void;
  onStartEditBubble: (item: SortingCardView) => void;
  onBubbleDraftChange: (patch: Partial<SortingBubbleDraft>) => void;
  onToggleExpandedBubble: (itemId: string) => void;
  onSaveEditingBubble: () => void;
  onCancelEditingBubble: () => void;
  onAddBlankBubble: (columnId: string) => void;
  onToggleAddColumn: (open: boolean) => void;
  onAddColumn: (value: string) => void | Promise<void>;
  copySelectedLayersDisabled: boolean;
}) {
  const boxItems = boxItemIds.map((itemId) => itemMap[itemId]).filter(Boolean);
  const highlightedBots = bots.filter((bot) => boxBotBindings[bot.id]?.enabled);

  return (
    <section className="s-board-panel" style={{ '--box-tone': activeBox.tone } as CSSProperties}>
      <div className="s-panel-toolbar">
        <div className="s-panel-toolbar-title">
          <div className="s-panel-toolbar-mark">
            <BoxIcon size={18} />
          </div>
          <div className="s-board-toolbar-copy">
            <div className="s-board-toolbar-mainline">
              <h2
                data-sorting-active-box-id={activeBox.id}
                className={highlightedBoxId === activeBox.id ? 'is-highlighted' : ''}
              >
                {activeBox.name}
              </h2>
              {currentLayerName && selectedLayers.length > 1 ? (
                <span
                  className={`s-board-focus-note ${highlightedLayerId && selectedLayers.some((layer) => layer.id === highlightedLayerId) ? 'is-highlighted' : ''}`}
                  title={`当前层：${currentLayerName}`}
                  aria-label={`当前层：${currentLayerName}`}
                >
                  <CurrentStatusGlyph size={12} />
                  <span>{currentLayerName}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="s-panel-stats">
          <span>{selectedLayers.length} 层</span>
          <span>{visibleColumns.length} 列</span>
          <span>{bubbleCount} 个泡泡</span>
          <span>{boxItems.length} 个条目</span>
        </div>
        <div className="s-panel-toolbar-actions">
          <InlineSearchControl
            open={localSearchOpen}
            panelOpen={localSearchPanelOpen}
            query={localSearchQuery}
            placeholder="搜当前分箱页"
            buttonLabel="搜索当前分箱页"
            className="inline-search--board"
            inputRef={localSearchInputRef}
            resultsView={localSearchResultsView}
            onToggle={onToggleLocalSearch}
            onQueryChange={onLocalSearchQueryChange}
            onInputFocus={onLocalSearchFocus}
            onInputKeyDown={onLocalSearchKeyDown}
            onClear={onClearLocalSearch}
          />
          <button
            type="button"
            className="s-toolbar-action inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onCopySelectedLayers}
            disabled={copySelectedLayersDisabled}
            title={copySelectedLayersDisabled ? '已选层没有可复制的卡片' : '复制已选层'}
          >
            <CopyIcon size={14} />
            <span>复制已选层</span>
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {highlightedBots.slice(0, 4).map((bot) => (
              <button
                key={bot.id}
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-[16px] border border-[var(--accent)]/25 bg-white shadow-sm"
                onClick={() => onOpenBoxSettings(bot.id)}
                title={`${bot.name} 的箱子局域配置`}
                aria-label={`${bot.name} 的箱子局域配置`}
              >
                {bot.avatarUrl ? (
                  <img src={bot.avatarUrl} alt={bot.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs font-semibold text-[var(--accent)]">{bot.name.slice(0, 1)}</span>
                )}
              </button>
            ))}
            <button type="button" className="s-toolbar-action" onClick={() => onOpenBoxSettings()}>
              {highlightedBots.length > 0 ? '箱子设置' : '局域机器'}
            </button>
          </div>
          {parentBox && parentBox.id !== homeBoxId ? (
            <button type="button" className="s-toolbar-action" onClick={onOpenParent}>
              上一级
            </button>
          ) : null}
          {homeBoxId && activeBox.id !== homeBoxId ? (
            <button type="button" className="s-toolbar-action" onClick={onOpenHome}>
              主页
            </button>
          ) : null}
        </div>
      </div>

      <SortingKanbanView
        visibleColumns={visibleColumns}
        columnItems={columnItems}
        currentLayerId={currentLayerId}
        itemMap={itemMap}
        boxes={boxes}
        sourceInfoMap={sourceInfoMap}
        expandedBubbleIds={expandedBubbleIds}
        editingBubbleId={editingBubbleId}
        editingBubbleDraft={editingBubbleDraft}
        highlightedColumnId={highlightedColumnId}
        highlightedItemId={highlightedItemId}
        editingColId={editingColId}
        editingColName={editingColName}
        editColRef={editColRef}
        addingColumn={addingColumn}
        newColName={newColName}
        newColRef={newColRef}
        enableColumnReorder={enableColumnReorder}
        onRenameColumn={onRenameColumn}
        onCancelRename={onCancelRename}
        onStartRenameColumn={onStartRenameColumn}
        onOpenColumnMenu={onOpenColumnMenu}
        onOpenNodeMenu={onOpenNodeMenu}
        onOpenCardCommentPicker={onOpenCardCommentPicker}
        onOpenBox={onOpenBox}
        onStartEditBubble={onStartEditBubble}
        onBubbleDraftChange={onBubbleDraftChange}
        onToggleExpandedBubble={onToggleExpandedBubble}
        onSaveEditingBubble={onSaveEditingBubble}
        onCancelEditingBubble={onCancelEditingBubble}
        onAddBlankBubble={onAddBlankBubble}
        onToggleAddColumn={onToggleAddColumn}
        onAddColumn={onAddColumn}
      />
    </section>
  );
}
