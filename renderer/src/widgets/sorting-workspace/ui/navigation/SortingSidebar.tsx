import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { CurrentStatusGlyph, SelectedStatusGlyph } from '@/shared/icons/StatusGlyph';
import { CompactListSearch } from '@/shared/ui/CompactListSearch';
import { InitialAvatar } from '@/shared/ui/StreamAvatar';
import type { SortingBoxView, SortingLayerView, SortingStream } from '@/entities/sorting';
import { BoxIcon, ChevronLeftIcon, ChevronRightIcon, PanelLeftIcon } from '../icons';
import { CommitInput, DragPortal } from '../primitives';
import { cx, toSidebarBoxDraggableId } from '../utils';

type SidebarSectionLayout = {
  boxes: number;
  layers: number;
  sources: number;
};

type SidebarSectionKey = keyof SidebarSectionLayout;
type SidebarResizeHandle = 'boxes-layers' | 'layers-sources';

const DEFAULT_SECTION_LAYOUT: SidebarSectionLayout = {
  boxes: 1 / 3,
  layers: 1 / 3,
  sources: 1 / 3,
};
const MIN_SECTION_RATIO = 0.18;
const SIDEBAR_SWITCH_BOXES_DROPPABLE_ID = 'sorting-sidebar-switch-boxes';

function normalizeSectionLayout(layout: Partial<SidebarSectionLayout> | null | undefined): SidebarSectionLayout {
  const candidate = layout && typeof layout === 'object' ? layout : {};
  const next = {
    boxes: typeof candidate.boxes === 'number' && Number.isFinite(candidate.boxes) && candidate.boxes > 0
      ? candidate.boxes
      : DEFAULT_SECTION_LAYOUT.boxes,
    layers: typeof candidate.layers === 'number' && Number.isFinite(candidate.layers) && candidate.layers > 0
      ? candidate.layers
      : DEFAULT_SECTION_LAYOUT.layers,
    sources: typeof candidate.sources === 'number' && Number.isFinite(candidate.sources) && candidate.sources > 0
      ? candidate.sources
      : DEFAULT_SECTION_LAYOUT.sources,
  };
  const total = next.boxes + next.layers + next.sources;
  if (!(total > 0)) {
    return { ...DEFAULT_SECTION_LAYOUT };
  }
  return {
    boxes: next.boxes / total,
    layers: next.layers / total,
    sources: next.sources / total,
  };
}

function areLayoutsEqual(left: SidebarSectionLayout, right: SidebarSectionLayout) {
  return Math.abs(left.boxes - right.boxes) < 0.0001
    && Math.abs(left.layers - right.layers) < 0.0001
    && Math.abs(left.sources - right.sources) < 0.0001;
}

function renderStatusMeta(isCurrent: boolean, selected: boolean, fallback: ReactNode) {
  if (isCurrent) {
    return (
      <em className="is-current" title="当前" aria-label="当前">
        <CurrentStatusGlyph size={13} />
      </em>
    );
  }
  if (selected) {
    return (
      <em className="is-selected" title="已选" aria-label="已选">
        <SelectedStatusGlyph size={13} />
      </em>
    );
  }
  return <em>{fallback}</em>;
}

function renderCollapsedStatus(isCurrent: boolean, selected: boolean) {
  if (!isCurrent && !selected) return null;
  return (
    <span
      className={cx('s-sidebar-item-status-dot', isCurrent ? 'is-current' : 'is-selected')}
      title={isCurrent ? '当前' : '已选'}
      aria-label={isCurrent ? '当前' : '已选'}
    >
      {isCurrent ? <CurrentStatusGlyph size={9} /> : <SelectedStatusGlyph size={9} />}
    </span>
  );
}

function clampSectionPair(
  layout: SidebarSectionLayout,
  leadKey: SidebarSectionKey,
  trailKey: SidebarSectionKey,
  nextLeadValue: number,
) {
  const total = layout[leadKey] + layout[trailKey];
  if (!(total > 0)) return layout;
  const clampedLeadValue = Math.min(total - MIN_SECTION_RATIO, Math.max(MIN_SECTION_RATIO, nextLeadValue));
  return normalizeSectionLayout({
    ...layout,
    [leadKey]: clampedLeadValue,
    [trailKey]: total - clampedLeadValue,
  });
}

export function SortingSidebar({
  switchBoxes,
  currentLayers,
  showSourcesSection = true,
  streams,
  boxSearchQuery,
  activeBoxId,
  currentBox,
  breadcrumbBoxes,
  homeBoxId,
  selectedLayerIds,
  currentLayerId,
  selectedSourceIds,
  focusedSourceId,
  editingBoxId,
  editingBoxName,
  editingLayerId,
  editingLayerName,
  addingLayer,
  newLayerName,
  editBoxRef,
  editLayerRef,
  newLayerRef,
  isCollapsed,
  isLayersCollapsed,
  isSourcesCollapsed,
  sectionLayout,
  getBoxCount,
  getLayerColumnCount,
  onSelectBox,
  onSelectRootBox,
  onSelectBreadcrumbBox,
  onCreateBox,
  onStartCreateLayer,
  onSaveNewLayer,
  onCancelCreateLayer,
  onStartRenameBox,
  onStartRenameLayer,
  onSaveRenameBox,
  onSaveRenameLayer,
  onCancelRenameBox,
  onCancelRenameLayer,
  onOpenBoxMenu,
  onOpenLayerMenu,
  onBoxSearchQueryChange,
  onFocusLayer,
  onToggleLayer,
  onToggleSource,
  onBack,
  onToggleCollapse,
  onToggleLayersCollapse,
  onToggleSourcesCollapse,
  onSectionLayoutChange,
  highlightedBoxId,
  highlightedLayerId,
}: {
  switchBoxes: SortingBoxView[];
  currentLayers: SortingLayerView[];
  showSourcesSection?: boolean;
  streams: SortingStream[];
  boxSearchQuery: string;
  activeBoxId: string;
  currentBox: SortingBoxView | null | undefined;
  breadcrumbBoxes: SortingBoxView[];
  homeBoxId: string | null;
  selectedLayerIds: string[];
  currentLayerId: string | null;
  selectedSourceIds: string[];
  focusedSourceId: string | null;
  editingBoxId: string | null;
  editingBoxName: string;
  editingLayerId: string | null;
  editingLayerName: string;
  addingLayer: boolean;
  newLayerName: string;
  editBoxRef: RefObject<HTMLInputElement | null>;
  editLayerRef: RefObject<HTMLInputElement | null>;
  newLayerRef: RefObject<HTMLInputElement | null>;
  isCollapsed: boolean;
  isLayersCollapsed: boolean;
  isSourcesCollapsed: boolean;
  sectionLayout: SidebarSectionLayout;
  getBoxCount: (boxId: string) => number;
  getLayerColumnCount: (layerId: string) => number;
  onSelectBox: (boxId: string) => void;
  onSelectRootBox: () => void;
  onSelectBreadcrumbBox: (boxId: string) => void;
  onCreateBox: () => void;
  onStartCreateLayer: () => void;
  onSaveNewLayer: (value: string) => void | Promise<void>;
  onCancelCreateLayer: () => void;
  onStartRenameBox: (box: SortingBoxView) => void;
  onStartRenameLayer: (layer: SortingLayerView) => void;
  onSaveRenameBox: (value: string, input?: HTMLInputElement | null) => void | Promise<void>;
  onSaveRenameLayer: (value: string, input?: HTMLInputElement | null) => void | Promise<void>;
  onCancelRenameBox: () => void;
  onCancelRenameLayer: () => void;
  onOpenBoxMenu: (event: MouseEvent<HTMLElement>, boxId: string) => void;
  onOpenLayerMenu: (event: MouseEvent<HTMLElement>, layer: SortingLayerView) => void;
  onBoxSearchQueryChange: (value: string) => void;
  onFocusLayer: (layerId: string) => void;
  onToggleLayer: (layerId: string) => void;
  onToggleSource: (streamId: string) => void;
  onBack: () => void;
  onToggleCollapse: () => void;
  onToggleLayersCollapse: () => void;
  onToggleSourcesCollapse: () => void;
  onSectionLayoutChange: (layout: SidebarSectionLayout) => void;
  highlightedBoxId?: string | null;
  highlightedLayerId?: string | null;
}) {
  const activeLayerCount = selectedLayerIds.length;
  const activeStreamCount = selectedSourceIds.length;
  const sidebarToggleLabel = isCollapsed ? '展开分箱侧栏' : '折叠分箱侧栏';
  const switchBoxCountLabel = '切换箱子';
  const sectionsRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    handle: SidebarResizeHandle;
    startY: number;
    startLayout: SidebarSectionLayout;
    containerHeight: number;
  } | null>(null);
  const [draftSectionLayout, setDraftSectionLayout] = useState<SidebarSectionLayout>(() => normalizeSectionLayout(sectionLayout));
  const draftSectionLayoutRef = useRef(draftSectionLayout);

  useEffect(() => {
    draftSectionLayoutRef.current = draftSectionLayout;
  }, [draftSectionLayout]);

  useEffect(() => {
    if (dragStateRef.current) return;
    const normalizedLayout = normalizeSectionLayout(sectionLayout);
    setDraftSectionLayout((currentLayout) => (
      areLayoutsEqual(currentLayout, normalizedLayout) ? currentLayout : normalizedLayout
    ));
  }, [sectionLayout]);

  const expandedSectionLayout = useMemo(() => {
    const expandedKeys: SidebarSectionKey[] = ['boxes'];
    if (!isLayersCollapsed) expandedKeys.push('layers');
    if (showSourcesSection && !isSourcesCollapsed) expandedKeys.push('sources');
    const total = expandedKeys.reduce((sum, key) => sum + draftSectionLayout[key], 0) || 1;
    return {
      boxes: expandedKeys.includes('boxes') ? draftSectionLayout.boxes / total : 0,
      layers: expandedKeys.includes('layers') ? draftSectionLayout.layers / total : 0,
      sources: expandedKeys.includes('sources') ? draftSectionLayout.sources / total : 0,
    };
  }, [draftSectionLayout, isLayersCollapsed, isSourcesCollapsed, showSourcesSection]);

  const visibleStreams = useMemo(() => {
    if (!isCollapsed) return streams;
    const prioritized = streams.filter((stream) => selectedSourceIds.includes(stream.id));
    if (prioritized.length > 0) return prioritized.slice(0, 6);
    return streams.slice(0, 4);
  }, [isCollapsed, selectedSourceIds, streams]);
  const hiddenCollapsedStreamCount = isCollapsed ? Math.max(0, streams.length - visibleStreams.length) : 0;

  const getSectionStyle = useCallback((key: SidebarSectionKey, isSectionCollapsed: boolean): CSSProperties => {
    if (isSectionCollapsed) {
      return { flex: '0 0 auto' };
    }
    return {
      flexBasis: 0,
      flexGrow: expandedSectionLayout[key],
      minHeight: 0,
    };
  }, [expandedSectionLayout]);

  const handleResizeMove = useCallback((event: globalThis.MouseEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.containerHeight <= 0) return;
    const ratioDelta = (event.clientY - dragState.startY) / dragState.containerHeight;
    const nextLayout = dragState.handle === 'boxes-layers'
      ? clampSectionPair(dragState.startLayout, 'boxes', 'layers', dragState.startLayout.boxes + ratioDelta)
      : clampSectionPair(dragState.startLayout, 'layers', 'sources', dragState.startLayout.layers + ratioDelta);
    setDraftSectionLayout(nextLayout);
  }, []);

  const handleResizeEnd = useCallback(() => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    dragStateRef.current = null;
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeEnd);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const nextLayout = draftSectionLayoutRef.current;
    if (!areLayoutsEqual(dragState.startLayout, nextLayout)) {
      onSectionLayoutChange(nextLayout);
    }
  }, [handleResizeMove, onSectionLayoutChange]);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [handleResizeEnd, handleResizeMove]);

  const handleResizeStart = useCallback((handle: SidebarResizeHandle, event: MouseEvent<HTMLButtonElement>) => {
    const containerHeight = sectionsRef.current?.getBoundingClientRect().height || 0;
    if (!(containerHeight > 0)) return;
    event.preventDefault();
    dragStateRef.current = {
      handle,
      startY: event.clientY,
      startLayout: draftSectionLayoutRef.current,
      containerHeight,
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
  }, [handleResizeEnd, handleResizeMove]);

  const renderBoxItem = useCallback((box: SortingBoxView, index: number) => {
    const isEditing = !isCollapsed && editingBoxId === box.id;
    return (
      <Draggable
        key={box.id}
        draggableId={toSidebarBoxDraggableId(box.id)}
        index={index}
        isDragDisabled={isEditing}
        disableInteractiveElementBlocking
      >
        {(dragProvided, dragSnapshot) => {
          const boxNode = (
            <div
              ref={dragProvided.innerRef}
              {...dragProvided.draggableProps}
              style={dragProvided.draggableProps.style}
              data-sorting-box-id={isEditing ? box.id : undefined}
            >
              {isEditing ? (
                <div className={cx('s-sidebar-item', 'active')} style={{ '--box-tone': box.tone } as CSSProperties}>
                  <span className="s-sidebar-item-icon-shell">
                    <InitialAvatar label={box.name} seed={box.id} tone={box.tone} className="h-full w-full rounded-[14px]" textClassName="text-sm font-semibold text-white" />
                  </span>
                  <span className="s-sidebar-item-main">
                    <CommitInput
                      inputRef={editBoxRef}
                      defaultValue={editingBoxName}
                      className="w-full rounded-[10px] border border-black/12 bg-white px-2 py-1 text-sm font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      onSubmit={onSaveRenameBox}
                      onCancel={onCancelRenameBox}
                    />
                    <em>{getBoxCount(box.id)}</em>
                  </span>
                </div>
              ) : (
                <div
                  className={cx('s-sidebar-item', activeBoxId === box.id && 'active', dragSnapshot.isDragging && 'is-dragging', highlightedBoxId === box.id && 'is-search-highlight')}
                  role="button"
                  onClick={() => onSelectBox(box.id)}
                  onDoubleClick={() => onStartRenameBox(box)}
                  onContextMenu={(event) => onOpenBoxMenu(event, box.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectBox(box.id);
                    }
                  }}
                  tabIndex={0}
                  title={box.name}
                  style={{ '--box-tone': box.tone } as CSSProperties}
                  data-sorting-box-id={box.id}
                  {...dragProvided.dragHandleProps}
                >
                  <span className="s-sidebar-item-icon-shell">
                    <InitialAvatar label={box.name} seed={box.id} tone={box.tone} className="h-full w-full rounded-[14px]" textClassName="text-sm font-semibold text-white" />
                  </span>
                  {!isCollapsed && (
                    <span className="s-sidebar-item-main">
                      <strong>{box.name}</strong>
                      <em>{getBoxCount(box.id)}</em>
                    </span>
                  )}
                </div>
              )}
            </div>
          );

          return <DragPortal isDragging={dragSnapshot.isDragging}>{boxNode}</DragPortal>;
        }}
      </Draggable>
    );
  }, [
    activeBoxId,
    editBoxRef,
    editingBoxId,
    editingBoxName,
    getBoxCount,
    isCollapsed,
    onCancelRenameBox,
    onOpenBoxMenu,
    onSaveRenameBox,
    onSelectBox,
    onStartRenameBox,
  ]);

  return (
    <aside className={cx('s-sidebar', isCollapsed && 'is-collapsed')}>
      {isCollapsed ? (
        <button type="button" className="s-sidebar-head s-collapsed-head-trigger" onClick={onToggleCollapse} aria-label={sidebarToggleLabel} title="展开分箱侧栏">
          <span className="s-sidebar-brand">
            <BoxIcon size={18} className="s-sidebar-brand-icon" />
          </span>
        </button>
      ) : (
        <div className="s-sidebar-head">
          <div className="flex items-center gap-2">
            <button type="button" className="s-sidebar-back" onClick={onBack} aria-label="返回聊天">
              <ChevronLeftIcon size={16} />
            </button>
            <button type="button" className="s-sidebar-brand" title="返回主页" onClick={onSelectRootBox} disabled={!homeBoxId}>
              <BoxIcon size={18} className="s-sidebar-brand-icon" />
              <span>主页</span>
            </button>
          </div>
          <button type="button" className="s-sidebar-toggle" onClick={onToggleCollapse} aria-label={sidebarToggleLabel}>
            <PanelLeftIcon size={16} />
          </button>
        </div>
      )}
      <div ref={sectionsRef} className="s-sidebar-sections">
        <div className="s-sidebar-section s-sidebar-section--boxes" style={getSectionStyle('boxes', false)}>
          {!isCollapsed && (
            <div className="s-sidebar-label">
              <span>{switchBoxCountLabel}</span>
              <div className="flex items-center gap-2">
                <strong>{switchBoxes.length}</strong>
                <CompactListSearch
                  value={boxSearchQuery}
                  placeholder="搜箱子名"
                  buttonLabel="筛选箱子"
                  className="list-search-control--sidebar"
                  onChange={onBoxSearchQueryChange}
                />
              </div>
            </div>
          )}
          {!isCollapsed && currentBox && breadcrumbBoxes.length > 0 && (
            <div className="s-sidebar-breadcrumb" aria-label="当前箱子路径">
              {breadcrumbBoxes.map((box, index) => {
                const isCurrent = index === breadcrumbBoxes.length - 1;
                const isEditing = editingBoxId === box.id;
                return (
                  <Fragment key={box.id}>
                    {index > 0 && (
                      <span className="s-sidebar-breadcrumb-separator" aria-hidden="true">
                        <ChevronRightIcon size={12} />
                      </span>
                    )}
                    {isEditing ? (
                      <CommitInput
                        inputRef={editBoxRef}
                        defaultValue={editingBoxName}
                        className="s-sidebar-breadcrumb-input"
                        onSubmit={onSaveRenameBox}
                        onCancel={onCancelRenameBox}
                      />
                    ) : (
                      <button
                        type="button"
                        className={cx('s-sidebar-breadcrumb-item', isCurrent && 'is-current', highlightedBoxId === box.id && 'is-search-highlight')}
                        onClick={() => onSelectBreadcrumbBox(box.id)}
                        onDoubleClick={() => onStartRenameBox(box)}
                        onContextMenu={(event) => onOpenBoxMenu(event, box.id)}
                        title={box.name}
                        data-sorting-box-id={box.id}
                      >
                        {box.name}
                      </button>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
          {!isCollapsed && (
            <div className="s-sidebar-action-wrap">
              <button type="button" className="s-sidebar-action" onClick={onCreateBox}>
                + 新建子箱
              </button>
            </div>
          )}
          <Droppable droppableId={SIDEBAR_SWITCH_BOXES_DROPPABLE_ID} type="ITEM" isDropDisabled>
            {(provided) => (
              <div className="s-sidebar-list" ref={provided.innerRef} {...provided.droppableProps}>
                {switchBoxes.map((box, index) => renderBoxItem(box, index))}
                {provided.placeholder}
                {!isCollapsed && switchBoxes.length === 0 ? (
                  <div className="s-sidebar-empty">
                    <strong>{boxSearchQuery.trim() ? '没有匹配的箱子' : '这里还没有可切换的箱子'}</strong>
                    <span>{boxSearchQuery.trim() ? '换个词试试，或清空搜索。' : '先回主页，或在当前箱子下新建一个子箱。'}</span>
                  </div>
                ) : null}
              </div>
            )}
          </Droppable>
        </div>

        {!isCollapsed && !isLayersCollapsed && (
          <button
            type="button"
            className="s-sidebar-section-resize"
            aria-label="调整箱子与层的排布"
            title="拖动调整箱子与层的高度"
            onMouseDown={(event) => handleResizeStart('boxes-layers', event)}
          >
            <span className="s-sidebar-section-resize__track" />
          </button>
        )}

        <div
          className="s-sidebar-section s-sidebar-section--layers"
          style={getSectionStyle('layers', isLayersCollapsed)}
        >
          {!isCollapsed && (
            <>
              <button
                type="button"
                className="s-sidebar-label s-sidebar-label--toggle"
                onClick={onToggleLayersCollapse}
                aria-expanded={!isLayersCollapsed}
                aria-label={isLayersCollapsed ? '展开层列表' : '折叠层列表'}
              >
                <span className="s-sidebar-label-copy">
                  <span>层</span>
                  <strong>{activeLayerCount}/{currentLayers.length}</strong>
                </span>
                <span className={cx('s-sidebar-label-caret', isLayersCollapsed && 'is-collapsed')} aria-hidden="true">
                  <ChevronLeftIcon size={14} />
                </span>
              </button>
              <div className="s-sidebar-action-wrap">
                {addingLayer ? (
                  <CommitInput
                    inputRef={newLayerRef}
                    defaultValue={newLayerName}
                    className="s-sidebar-inline-input"
                    placeholder="输入层名称"
                    onSubmit={onSaveNewLayer}
                    onCancel={onCancelCreateLayer}
                  />
                ) : (
                  <button type="button" className="s-sidebar-action" onClick={onStartCreateLayer}>
                    + 新建层
                  </button>
                )}
              </div>
            </>
          )}
          <div className={cx('s-sidebar-list', 's-sidebar-list--layers', isLayersCollapsed && 'is-collapsed')}>
            {currentLayers.map((layer) => {
              const selected = selectedLayerIds.includes(layer.id);
              const isCurrent = currentLayerId === layer.id;
              const isEditing = !isCollapsed && editingLayerId === layer.id;
              if (isEditing) {
                return (
                <div
                  key={layer.id}
                  className={cx('s-sidebar-item', 's-sidebar-item--layer', selected && 'active', isCurrent && 'is-focused', highlightedLayerId === layer.id && 'is-search-highlight')}
                  data-sorting-layer-id={layer.id}
                >
                    <span className="s-source-check">
                      <span className={cx('s-source-check-dot', selected && 'is-selected')} />
                    </span>
                    <span className={cx('s-sidebar-item-icon-shell', 's-sidebar-item-icon-shell--layer', selected && 'is-selected')}>
                      <InitialAvatar label={layer.name} seed={layer.id} className="h-full w-full rounded-[14px]" textClassName="text-sm font-semibold text-white" />
                    </span>
                    <span className="s-sidebar-item-main">
                      <CommitInput
                        inputRef={editLayerRef}
                        defaultValue={editingLayerName}
                        className="w-full rounded-[10px] border border-black/12 bg-white px-2 py-1 text-sm font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                        onSubmit={onSaveRenameLayer}
                        onCancel={onCancelRenameLayer}
                      />
                      {renderStatusMeta(isCurrent, selected, `${getLayerColumnCount(layer.id)} 列`)}
                    </span>
                  </div>
                );
              }
              if (isCollapsed) {
                return (
                  <button
                    key={layer.id}
                    type="button"
                    className={cx('s-sidebar-item', 's-sidebar-item--layer', selected && 'active', isCurrent && 'is-focused', highlightedLayerId === layer.id && 'is-search-highlight')}
                    onClick={() => onFocusLayer(layer.id)}
                    onDoubleClick={() => onStartRenameLayer(layer)}
                    onContextMenu={(event) => onOpenLayerMenu(event, layer)}
                    title={`${layer.name}${isCurrent ? ' · 当前层' : selected ? ' · 已选中' : ''}`}
                    aria-label={isCurrent ? `当前层 ${layer.name}` : `聚焦层 ${layer.name}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    data-sorting-layer-id={layer.id}
                  >
                    <span className={cx('s-sidebar-item-icon-shell', 's-sidebar-item-icon-shell--layer', selected && 'is-selected')}>
                      <InitialAvatar label={layer.name} seed={layer.id} className="h-full w-full rounded-[14px]" textClassName="text-sm font-semibold text-white" />
                      {renderCollapsedStatus(isCurrent, selected)}
                    </span>
                  </button>
                );
              }
              return (
                <div
                  key={layer.id}
                  className={cx('s-sidebar-item', 's-sidebar-item--layer', selected && 'active', isCurrent && 'is-focused', highlightedLayerId === layer.id && 'is-search-highlight')}
                  onContextMenu={(event) => onOpenLayerMenu(event, layer)}
                  data-sorting-layer-id={layer.id}
                >
                  <button
                    type="button"
                    className="s-sidebar-item-check-trigger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleLayer(layer.id);
                    }}
                    title={selected ? `取消选择层 ${layer.name}` : `选择层 ${layer.name}`}
                    aria-label={selected ? `取消选择层 ${layer.name}` : `选择层 ${layer.name}`}
                    aria-pressed={selected}
                  >
                    <span className="s-source-check">
                      <span className={cx('s-source-check-dot', selected && 'is-selected')} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="s-sidebar-item-focus-trigger"
                    onClick={() => onFocusLayer(layer.id)}
                    onDoubleClick={() => onStartRenameLayer(layer)}
                    title={layer.name}
                    aria-label={isCurrent ? `当前层 ${layer.name}` : `聚焦层 ${layer.name}`}
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    <span className={cx('s-sidebar-item-icon-shell', 's-sidebar-item-icon-shell--layer', selected && 'is-selected')}>
                      <InitialAvatar label={layer.name} seed={layer.id} className="h-full w-full rounded-[14px]" textClassName="text-sm font-semibold text-white" />
                    </span>
                    <span className="s-sidebar-item-main">
                      <strong>{layer.name}</strong>
                      {renderStatusMeta(isCurrent, selected, `${getLayerColumnCount(layer.id)} 列`)}
                    </span>
                  </button>
                </div>
              );
            })}
            {!isCollapsed && currentLayers.length === 0 ? (
              <div className="s-sidebar-empty">
                <strong>{currentBox ? `${currentBox.name} 还没有层` : '当前箱子还没有层'}</strong>
                <span>点上方按钮新增一个层。</span>
              </div>
            ) : null}
          </div>
        </div>

        {showSourcesSection && !isCollapsed && !isLayersCollapsed && !isSourcesCollapsed && (
          <button
            type="button"
            className="s-sidebar-section-resize"
            aria-label="调整层与泡泡流的排布"
            title="拖动调整层与泡泡流的高度"
            onMouseDown={(event) => handleResizeStart('layers-sources', event)}
          >
            <span className="s-sidebar-section-resize__track" />
          </button>
        )}

        {showSourcesSection && (
          <div
            className="s-sidebar-section s-sidebar-section--sources"
            style={getSectionStyle('sources', isSourcesCollapsed)}
          >
            {!isCollapsed && (
              <button
                type="button"
                className="s-sidebar-label s-sidebar-label--toggle"
                onClick={onToggleSourcesCollapse}
                aria-expanded={!isSourcesCollapsed}
                aria-label={isSourcesCollapsed ? '展开泡泡流列表' : '折叠泡泡流列表'}
              >
                <span className="s-sidebar-label-copy">
                  <span>泡泡流</span>
                  <strong>{activeStreamCount}/{streams.length}</strong>
                </span>
                <span className={cx('s-sidebar-label-caret', isSourcesCollapsed && 'is-collapsed')} aria-hidden="true">
                  <ChevronLeftIcon size={14} />
                </span>
              </button>
            )}
            <div className={cx('s-sidebar-list', 's-sidebar-list--sources', isSourcesCollapsed && 'is-collapsed')}>
              {visibleStreams.map((stream) => {
                const selected = selectedSourceIds.includes(stream.id);
                const focused = focusedSourceId === stream.id;
                const collapsedTitle = focused
                  ? `${stream.title} · 当前泡泡流`
                  : selected
                    ? `${stream.title} · 已选中`
                    : stream.title;
                return (
                  <button
                    key={stream.id}
                    type="button"
                    className={cx('s-sidebar-item', 's-sidebar-item--source', selected && 'active')}
                    onClick={() => onToggleSource(stream.id)}
                    title={isCollapsed ? collapsedTitle : stream.title}
                    aria-label={selected ? `调整已选泡泡流 ${stream.title}` : `选择泡泡流 ${stream.title}`}
                    aria-pressed={selected}
                  >
                    {!isCollapsed && (
                      <span className="s-source-check">
                        <span className={cx('s-source-check-dot', selected && 'is-selected')} />
                      </span>
                    )}
                    <span className={cx('s-sidebar-item-icon-shell', 's-sidebar-item-icon-shell--source', selected && 'is-selected')}>
                      <InitialAvatar label={stream.title} seed={stream.id} className="h-full w-full rounded-[14px]" textClassName="text-sm font-semibold text-white" />
                      {isCollapsed && renderCollapsedStatus(focused, selected)}
                    </span>
                    {!isCollapsed && (
                      <span className="s-sidebar-item-main">
                        <strong>{stream.title}</strong>
                        {renderStatusMeta(focused, selected, stream.messages.length)}
                      </span>
                    )}
                  </button>
                );
              })}
              {isCollapsed && hiddenCollapsedStreamCount > 0 ? (
                <div className="s-sidebar-collapsed-more" title={`还有 ${hiddenCollapsedStreamCount} 个泡泡流`}>
                  <strong>+{hiddenCollapsedStreamCount}</strong>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
