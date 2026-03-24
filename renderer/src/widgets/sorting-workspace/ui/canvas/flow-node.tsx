import { createContext, useContext } from 'react';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { SortingCardView } from '@/entities/sorting';
import { FLOW_HANDLE_STYLE } from '../constants';
import { SortingBubbleNode } from '../bubble';
import { GripIcon } from '../icons';
import type { SortingCanvasContextValue, SortingFlowNode } from '../types';
import { cx } from '../utils';

const SortingCanvasContext = createContext<SortingCanvasContextValue | null>(null);

function useSortingCanvasContext() {
  const context = useContext(SortingCanvasContext);
  if (!context) {
    throw new Error('SortingCanvasContext is missing');
  }
  return context;
}

function SortingCanvasFlowNode({ data, dragging, selected }: NodeProps<SortingFlowNode>) {
  const {
    itemMap,
    boxes,
    sourceInfoMap,
    editingBubbleId,
    editingBubbleDraft,
    onStartEditBubble,
    onBubbleDraftChange,
    onSaveEditingBubble,
    onCancelEditingBubble,
    onOpenNodeMenu,
    onOpenCardCommentPicker,
    onOpenBox,
  } = useSortingCanvasContext();
  const item = itemMap[data.itemId];
  if (!item) return null;

  return (
    <div
      className={cx('relative rounded-[24px]', selected && 'ring-2 ring-black/20 ring-offset-2 ring-offset-white')}
      onContextMenu={(event) => onOpenNodeMenu(event, item)}
    >
      {item.type === 'card' && (
        <Handle
          type="target"
          position={Position.Left}
          className="!border-0 !bg-transparent"
          style={FLOW_HANDLE_STYLE}
        />
      )}

      {item.type === 'card' && (
        <Handle
          type="source"
          position={Position.Right}
          className="!border-0 !bg-transparent"
          style={FLOW_HANDLE_STYLE}
        />
      )}

      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
        <div className="s-flow-drag-handle inline-flex cursor-grab items-center gap-1 rounded-full bg-white/92 px-2 py-1 shadow-sm active:cursor-grabbing">
          <GripIcon size={12} />
          <span>拖动</span>
        </div>
        {item.type === 'card' && (
          <span className="nodrag nopan nowheel rounded-full bg-white/92 px-2 py-1 shadow-sm">
            拖点连线
          </span>
        )}
      </div>

      <div className="nodrag nopan nowheel">
        <SortingBubbleNode
          item={item}
          boxes={boxes}
          sourceInfo={sourceInfoMap[item.id] || null}
          isDragging={dragging}
          isEditing={editingBubbleId === item.id}
          editingDraft={editingBubbleId === item.id ? editingBubbleDraft : null}
          onDraftChange={onBubbleDraftChange}
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
    </div>
  );
}

const SORTING_FLOW_NODE_TYPES = {
  sortingBubble: SortingCanvasFlowNode,
};


export { SORTING_FLOW_NODE_TYPES, SortingCanvasContext };
