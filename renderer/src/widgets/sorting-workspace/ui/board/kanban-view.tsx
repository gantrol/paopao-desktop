import type { MouseEvent, RefObject } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import type { SortingBoxView, SortingCardView, SortingColumnView } from '@/entities/sorting';
import { PlusIcon } from '../icons';
import { CommitInput } from '../primitives';
import type { SortingBubbleDraft, SortingBubbleSourceInfo } from '../types';
import { SortingBoardColumn } from './column';

function SortingKanbanView({
  visibleColumns,
  columnItems,
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
  onStartEditBubble,
  onBubbleDraftChange,
  onToggleExpandedBubble,
  onSaveEditingBubble,
  onCancelEditingBubble,
  onAddBlankBubble,
  onToggleAddColumn,
  onAddColumn,
}: {
  visibleColumns: SortingColumnView[];
  columnItems: Record<string, string[]>;
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
  onStartEditBubble: (item: SortingCardView) => void;
  onBubbleDraftChange: (patch: Partial<SortingBubbleDraft>) => void;
  onToggleExpandedBubble: (itemId: string) => void;
  onSaveEditingBubble: () => void;
  onCancelEditingBubble: () => void;
  onAddBlankBubble: (columnId: string) => void;
  onToggleAddColumn: (open: boolean) => void;
  onAddColumn: (value: string) => void | Promise<void>;
}) {
  const addColumnField = addingColumn ? (
    <div className="s-column-add-inline">
      <CommitInput
        inputRef={newColRef}
        defaultValue={newColName}
        className="s-board-column-input"
        placeholder="输入列名..."
        onSubmit={onAddColumn}
        onCancel={() => onToggleAddColumn(false)}
      />
    </div>
  ) : (
    <button type="button" className="s-column-create" onClick={() => onToggleAddColumn(true)}>
      <PlusIcon size={14} />
      <span>新增列</span>
    </button>
  );

  return (
    <div className="s-board-scroll">
      {enableColumnReorder ? (
        <Droppable droppableId="board-columns" direction="horizontal" type="COLUMN">
          {(boardProvided) => (
            <div className="s-board-columns" ref={boardProvided.innerRef} {...boardProvided.droppableProps}>
              {visibleColumns.map((column, columnIndex) => (
                <SortingBoardColumn
                  key={column.instanceId || column.id}
                  column={column}
                  columnIndex={columnIndex}
                  columnIds={columnItems[column.instanceId || column.id] || []}
                  currentLayerId={currentLayerId}
                  itemMap={itemMap}
                  boxes={boxes}
                  sourceInfoMap={sourceInfoMap}
                  expandedBubbleIds={expandedBubbleIds}
                  editingBubbleId={editingBubbleId}
                  editingBubbleDraft={editingBubbleDraft}
                  editingColId={editingColId}
                  editingColName={editingColName}
                  editColRef={editColRef}
                  enableColumnReorder
                  onRenameColumn={onRenameColumn}
                  onCancelRename={onCancelRename}
                  onOpenColumnMenu={onOpenColumnMenu}
                  onOpenNodeMenu={onOpenNodeMenu}
                  onOpenCardCommentPicker={onOpenCardCommentPicker}
                  onOpenBox={onOpenBox}
                  onStartEditBubble={onStartEditBubble}
                  onBubbleDraftChange={onBubbleDraftChange}
                  onToggleExpandedBubble={onToggleExpandedBubble}
                  onSaveEditingBubble={onSaveEditingBubble}
                  onCancelEditingBubble={onCancelEditingBubble}
                  onStartRenameColumn={onStartRenameColumn}
                  onAddBlankBubble={onAddBlankBubble}
                />
              ))}
              {boardProvided.placeholder}
              <div className="s-board-column s-board-column--add">
                {addColumnField}
              </div>
            </div>
          )}
        </Droppable>
      ) : (
        <div className="s-board-columns">
          {visibleColumns.map((column, columnIndex) => (
            <SortingBoardColumn
              key={column.instanceId || column.id}
              column={column}
              columnIndex={columnIndex}
              columnIds={columnItems[column.instanceId || column.id] || []}
              currentLayerId={currentLayerId}
              itemMap={itemMap}
              boxes={boxes}
              sourceInfoMap={sourceInfoMap}
              expandedBubbleIds={expandedBubbleIds}
              editingBubbleId={editingBubbleId}
              editingBubbleDraft={editingBubbleDraft}
              editingColId={editingColId}
              editingColName={editingColName}
              editColRef={editColRef}
              enableColumnReorder={false}
              onRenameColumn={onRenameColumn}
              onCancelRename={onCancelRename}
              onOpenColumnMenu={onOpenColumnMenu}
              onOpenNodeMenu={onOpenNodeMenu}
              onOpenCardCommentPicker={onOpenCardCommentPicker}
              onOpenBox={onOpenBox}
              onStartEditBubble={onStartEditBubble}
              onBubbleDraftChange={onBubbleDraftChange}
              onToggleExpandedBubble={onToggleExpandedBubble}
              onSaveEditingBubble={onSaveEditingBubble}
              onCancelEditingBubble={onCancelEditingBubble}
              onStartRenameColumn={onStartRenameColumn}
              onAddBlankBubble={onAddBlankBubble}
            />
          ))}
          <div className="s-board-column s-board-column--add">
            {addColumnField}
          </div>
        </div>
      )}
    </div>
  );
}


export { SortingKanbanView };
