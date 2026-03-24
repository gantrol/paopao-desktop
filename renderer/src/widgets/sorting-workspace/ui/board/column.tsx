import type { MouseEvent, RefObject } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import type { SortingBoxView, SortingCardView, SortingColumnView } from '@/entities/sorting';
import { SortingBubbleNode } from '../bubble';
import { GripIcon, PlusIcon } from '../icons';
import { CommitInput, DragPortal } from '../primitives';
import type { SortingBubbleDraft, SortingBubbleSourceInfo } from '../types';
import { cx, normalizeSortingColumnName } from '../utils';

function SortingBoardColumn({
  column,
  columnIndex,
  columnIds,
  currentLayerId,
  itemMap,
  boxes,
  sourceInfoMap,
  expandedBubbleIds,
  editingBubbleId,
  editingBubbleDraft,
  editingColId,
  editingColName,
  editColRef,
  enableColumnReorder,
  onRenameColumn,
  onCancelRename,
  onOpenColumnMenu,
  onOpenNodeMenu,
  onOpenCardCommentPicker,
  onOpenBox,
  onStartEditBubble,
  onBubbleDraftChange,
  onToggleExpandedBubble,
  onSaveEditingBubble,
  onCancelEditingBubble,
  onStartRenameColumn,
  onAddBlankBubble,
}: {
  column: SortingColumnView;
  columnIndex: number;
  columnIds: string[];
  currentLayerId: string | null;
  itemMap: Record<string, SortingCardView>;
  boxes: SortingBoxView[];
  sourceInfoMap: Record<string, SortingBubbleSourceInfo>;
  expandedBubbleIds: Set<string>;
  editingBubbleId: string | null;
  editingBubbleDraft: SortingBubbleDraft | null;
  editingColId: string | null;
  editingColName: string;
  editColRef: RefObject<HTMLInputElement | null>;
  enableColumnReorder: boolean;
  onRenameColumn: (value: string, input?: HTMLInputElement | null) => void | Promise<void>;
  onCancelRename: () => void;
  onOpenColumnMenu: (event: MouseEvent<HTMLDivElement>, columnId: string) => void;
  onOpenNodeMenu: (event: MouseEvent<HTMLDivElement>, item: SortingCardView) => void;
  onOpenCardCommentPicker: (item: SortingCardView) => void;
  onOpenBox: (boxId: string) => void;
  onStartEditBubble: (item: SortingCardView) => void;
  onBubbleDraftChange: (patch: Partial<SortingBubbleDraft>) => void;
  onToggleExpandedBubble: (itemId: string) => void;
  onSaveEditingBubble: () => void;
  onCancelEditingBubble: () => void;
  onStartRenameColumn: (column: SortingColumnView) => void;
  onAddBlankBubble: (columnId: string) => void;
}) {
  const columnInstanceId = column.instanceId || column.id;
  const columnLayerIds = Array.isArray(column.boundLayerIds)
    ? column.boundLayerIds.filter((layerId): layerId is string => typeof layerId === 'string' && Boolean(layerId.trim()))
    : [];
  const buildItemDraggableId = (itemId: string) => `sorting-card::${itemId}::${columnInstanceId}`;
  const resolveItemLayerId = (item: SortingCardView) => item.layerId || (columnLayerIds.length === 1 ? columnLayerIds[0] : null);
  const displayColumnName = normalizeSortingColumnName(column.id, column.name);
  const addButtonLabel = '添加泡泡';
  const emptyStateTitle = '拖拽泡泡到这里';
  const emptyStateHint = '或双击空白新增泡泡';
  const columnNameField = editingColId === column.id ? (
    <CommitInput
      inputRef={editColRef}
      defaultValue={editingColName}
      className="s-board-column-input"
      onSubmit={onRenameColumn}
      onCancel={onCancelRename}
    />
  ) : (
    <strong className="s-board-column-name" onDoubleClick={() => onStartRenameColumn(column)}>
      {displayColumnName}
    </strong>
  );

  const columnContent = (
    <>
      <div className="s-board-column-head" onContextMenu={(event) => onOpenColumnMenu(event, column.id)}>
        <div className="s-board-column-title">
          {enableColumnReorder ? <GripIcon size={14} className="s-board-column-grip" /> : null}
          {columnNameField}
        </div>
        <span className="s-board-column-count">{columnIds.length}</span>
      </div>

      <Droppable droppableId={columnInstanceId} type="ITEM">
        {(columnDropProvided, columnDropSnapshot) => (
          <div
            className={cx('s-board-column-body', columnDropSnapshot.isDraggingOver && 'is-over')}
            ref={columnDropProvided.innerRef}
            {...columnDropProvided.droppableProps}
            onDoubleClick={(event) => {
              if (event.target !== event.currentTarget) return;
              onAddBlankBubble(columnInstanceId);
            }}
          >
            {columnIds.map((itemId, index) => {
              const item = itemMap[itemId];
              if (!item) return null;
              const itemLayerId = resolveItemLayerId(item);
              return (
                <Draggable key={`${columnInstanceId}:${item.id}`} draggableId={buildItemDraggableId(item.id)} index={index}>
                  {(itemProvided, itemSnapshot) => {
                    const itemNode = (
                      <div className="s-draggable-item" ref={itemProvided.innerRef} {...itemProvided.draggableProps} {...itemProvided.dragHandleProps}>
                        <SortingBubbleNode
                          item={item}
                          boxes={boxes}
                          sourceInfo={sourceInfoMap[item.id] || null}
                          isDragging={itemSnapshot.isDragging}
                          isDimmed={Boolean(currentLayerId && itemLayerId && currentLayerId !== itemLayerId)}
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

                    return <DragPortal isDragging={itemSnapshot.isDragging}>{itemNode}</DragPortal>;
                  }}
                </Draggable>
              );
            })}
            {columnDropProvided.placeholder}
            {columnIds.length === 0 && (
              <div className="s-column-empty">
                <p>{emptyStateTitle}</p>
                <span>{emptyStateHint}</span>
              </div>
            )}
          </div>
        )}
      </Droppable>

      <button type="button" className="s-column-action" onClick={() => onAddBlankBubble(columnInstanceId)}>
        <PlusIcon size={14} />
        <span>{addButtonLabel}</span>
      </button>
    </>
  );

  if (!enableColumnReorder) {
    return (
      <div className="s-board-column">
        {columnContent}
      </div>
    );
  }

  return (
    <Draggable draggableId={`col-${columnInstanceId}`} index={columnIndex}>
      {(columnProvided, columnSnapshot) => {
        const columnNode = (
          <div className={cx('s-board-column', columnSnapshot.isDragging && 'is-dragging')} ref={columnProvided.innerRef} {...columnProvided.draggableProps}>
            <div className="s-board-column-head" onContextMenu={(event) => onOpenColumnMenu(event, column.id)}>
              <div className="s-board-column-title" {...columnProvided.dragHandleProps}>
                <GripIcon size={14} className="s-board-column-grip" />
                {columnNameField}
              </div>
              <span className="s-board-column-count">{columnIds.length}</span>
            </div>

            <Droppable droppableId={columnInstanceId} type="ITEM">
              {(columnDropProvided, columnDropSnapshot) => (
                <div
                  className={cx('s-board-column-body', columnDropSnapshot.isDraggingOver && 'is-over')}
                  ref={columnDropProvided.innerRef}
                  {...columnDropProvided.droppableProps}
                  onDoubleClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    onAddBlankBubble(columnInstanceId);
                  }}
                >
                  {columnIds.map((itemId, index) => {
                    const item = itemMap[itemId];
                    if (!item) return null;
                    const itemLayerId = resolveItemLayerId(item);
                    return (
                      <Draggable key={`${columnInstanceId}:${item.id}`} draggableId={buildItemDraggableId(item.id)} index={index}>
                        {(itemProvided, itemSnapshot) => {
                          const itemNode = (
                            <div className="s-draggable-item" ref={itemProvided.innerRef} {...itemProvided.draggableProps} {...itemProvided.dragHandleProps}>
                              <SortingBubbleNode
                                item={item}
                                boxes={boxes}
                                sourceInfo={sourceInfoMap[item.id] || null}
                                isDragging={itemSnapshot.isDragging}
                                isDimmed={Boolean(currentLayerId && itemLayerId && currentLayerId !== itemLayerId)}
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

                          return <DragPortal isDragging={itemSnapshot.isDragging}>{itemNode}</DragPortal>;
                        }}
                      </Draggable>
                    );
                  })}
                  {columnDropProvided.placeholder}
                  {columnIds.length === 0 && (
                    <div className="s-column-empty">
                      <p>{emptyStateTitle}</p>
                      <span>{emptyStateHint}</span>
                    </div>
                  )}
                </div>
              )}
            </Droppable>

            <button type="button" className="s-column-action" onClick={() => onAddBlankBubble(columnInstanceId)}>
              <PlusIcon size={14} />
              <span>{addButtonLabel}</span>
            </button>
          </div>
        );

        return <DragPortal isDragging={columnSnapshot.isDragging}>{columnNode}</DragPortal>;
      }}
    </Draggable>
  );
}


export { SortingBoardColumn };
