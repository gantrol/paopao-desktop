import type { MouseEvent } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import type { SortingBoxView, SortingCardView } from '@/entities/sorting';
import { SortingBubbleNode } from './bubble';
import { ChevronRightIcon, SuitcaseIcon } from './icons';
import { DragPortal } from './primitives';
import type { SortingBubbleDraft, SortingBubbleSourceInfo } from './types';
import { cx } from './utils';

export function SortingLuggagePanel({
  isCollapsed,
  itemIds,
  itemMap,
  boxes,
  sourceInfoMap,
  expandedBubbleIds,
  editingBubbleId,
  editingBubbleDraft,
  onToggleCollapse,
  onOpenBox,
  onStartEditBubble,
  onBubbleDraftChange,
  onToggleExpandedBubble,
  onSaveEditingBubble,
  onCancelEditingBubble,
  onOpenNodeMenu,
  onOpenCardCommentPicker,
  luggageColumnId,
}: {
  isCollapsed: boolean;
  itemIds: string[];
  itemMap: Record<string, SortingCardView>;
  boxes: SortingBoxView[];
  sourceInfoMap: Record<string, SortingBubbleSourceInfo>;
  expandedBubbleIds: Set<string>;
  editingBubbleId: string | null;
  editingBubbleDraft: SortingBubbleDraft | null;
  onToggleCollapse: () => void;
  onOpenBox: (boxId: string) => void;
  onStartEditBubble: (item: SortingCardView) => void;
  onBubbleDraftChange: (patch: Partial<SortingBubbleDraft>) => void;
  onToggleExpandedBubble: (itemId: string) => void;
  onSaveEditingBubble: () => void;
  onCancelEditingBubble: () => void;
  onOpenNodeMenu: (event: MouseEvent<HTMLDivElement>, item: SortingCardView) => void;
  onOpenCardCommentPicker: (item: SortingCardView) => void;
  luggageColumnId: string;
}) {
  const luggageToggleLabel = isCollapsed ? '展开行李箱' : '折叠行李箱';

  return (
    <aside className={cx('s-luggage-panel', isCollapsed && 'is-collapsed')}>
      {isCollapsed ? (
        <button type="button" className="s-luggage-head s-collapsed-head-trigger" onClick={onToggleCollapse} aria-label={luggageToggleLabel} title="展开行李箱">
          <span className="s-luggage-title">
            <SuitcaseIcon size={16} />
          </span>
        </button>
      ) : (
        <div className="s-luggage-head">
          <div className="s-luggage-title">
            <SuitcaseIcon size={16} />
            <span>行李箱</span>
          </div>
          <div className="s-luggage-head-meta">
            <strong>{itemIds.length}</strong>
            <button type="button" className="s-luggage-toggle" onClick={onToggleCollapse} aria-label={luggageToggleLabel}>
              <ChevronRightIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {isCollapsed && (
        <div className="s-panel-rail s-panel-rail--luggage" aria-hidden="true">
          <div className="s-rail-stat" title={`行李箱内 ${itemIds.length} 项`}>
            <span>件</span>
            <strong>{itemIds.length}</strong>
          </div>
        </div>
      )}

      {!isCollapsed && (
        <Droppable droppableId={luggageColumnId} type="ITEM">
          {(provided, snapshot) => (
            <div className={cx('s-luggage-body', snapshot.isDraggingOver && 'is-over')} ref={provided.innerRef} {...provided.droppableProps}>
              {itemIds.map((itemId, index) => {
                const item = itemMap[itemId];
                if (!item) return null;
                return (
                  <Draggable key={item.id} draggableId={item.id} index={index}>
                    {(dragProvided, dragSnapshot) => {
                      const itemNode = (
                        <div className="s-draggable-item" ref={dragProvided.innerRef} {...dragProvided.draggableProps} {...dragProvided.dragHandleProps}>
                          <SortingBubbleNode
                            item={item}
                            boxes={boxes}
                            sourceInfo={sourceInfoMap[item.id] || null}
                            isDragging={dragSnapshot.isDragging}
                            useInitialBoxAvatar
                            enableOverflowCollapse
                            isOverflowExpanded={expandedBubbleIds.has(item.id)}
                            isEditing={editingBubbleId === item.id}
                            editingDraft={editingBubbleId === item.id ? editingBubbleDraft : null}
                            onDraftChange={onBubbleDraftChange}
                            onToggleOverflowExpanded={() => onToggleExpandedBubble(item.id)}
                            onSaveEdit={onSaveEditingBubble}
                            onCancelEdit={onCancelEditingBubble}
                            onOpenCommentPicker={() => onOpenCardCommentPicker(item)}
                            onDoubleClick={() => {
                              if (item.type === 'box') {
                                if (item.childBoxId) onOpenBox(item.childBoxId);
                                return;
                              }
                              onStartEditBubble(item);
                            }}
                            onContextMenu={(event) => onOpenNodeMenu(event, item)}
                          />
                        </div>
                      );

                      return <DragPortal isDragging={dragSnapshot.isDragging}>{itemNode}</DragPortal>;
                    }}
                  </Draggable>
                );
              })}
              {provided.placeholder}
              {itemIds.length === 0 && (
                <div className="s-column-empty">
                  <p>暂无内容</p>
                  <span>可拖拽泡泡到这里暂存</span>
                </div>
              )}
            </div>
          )}
        </Droppable>
      )}
    </aside>
  );
}
