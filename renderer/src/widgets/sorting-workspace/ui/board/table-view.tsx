import type { SortingBoxView, SortingCardView } from '@/entities/sorting';
import type { SortingBubbleDraft, SortingBubbleSourceInfo } from '../types';
import {
  formatDateTime,
  getBubbleDisplayContent,
  getSortingCardTypeLabel,
} from '../utils';

function SortingTableView({
  items,
  boxes,
  sourceInfoMap,
  editingBubbleId,
  editingBubbleDraft,
  onStartEditBubble,
  onBubbleDraftChange,
  onSaveEditingBubble,
  onCancelEditingBubble,
  onOpenBox,
}: {
  items: SortingCardView[];
  boxes: SortingBoxView[];
  sourceInfoMap: Record<string, SortingBubbleSourceInfo>;
  editingBubbleId: string | null;
  editingBubbleDraft: SortingBubbleDraft | null;
  onStartEditBubble: (item: SortingCardView) => void;
  onBubbleDraftChange: (patch: Partial<SortingBubbleDraft>) => void;
  onSaveEditingBubble: () => void;
  onCancelEditingBubble: () => void;
  onOpenBox: (boxId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--text-secondary)]">
        <div className="rounded-[24px] border border-dashed border-black/10 bg-white/80 px-6 py-5 shadow-sm">
          <p className="mb-1 font-semibold text-[var(--text-primary)]">当前箱子为空</p>
          <span>回到看板后可继续拖拽与新增泡泡</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 w-full flex-1 overflow-auto px-4 py-4">
      <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-[24px] border border-black/[0.06] bg-white shadow-sm">
        <thead className="sticky top-0 bg-white/95 backdrop-blur">
          <tr className="text-left text-xs text-[var(--text-secondary)]">
            <th className="border-b border-black/[0.05] px-4 py-3 font-semibold">泡泡内容</th>
            <th className="border-b border-black/[0.05] px-4 py-3 font-semibold">更新时间</th>
            <th className="border-b border-black/[0.05] px-4 py-3 font-semibold">类型</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const typeLabel = getSortingCardTypeLabel(item);

            return (
              <tr
                key={item.id}
                className="align-top text-sm text-[var(--text-primary)] transition-colors hover:bg-black/[0.02]"
                onDoubleClick={() => {
                  if (item.type === 'box') {
                    if (item.childBoxId) onOpenBox(item.childBoxId);
                    return;
                  }
                  onStartEditBubble(item);
                }}
              >
                <td className="border-b border-black/[0.05] px-4 py-4">
                  {item.type === 'box' ? (
                    <div className="space-y-1">
                      <button type="button" className="font-semibold" onClick={() => item.childBoxId && onOpenBox(item.childBoxId)}>
                        {boxes.find((box) => box.id === item.childBoxId)?.name || '未知箱子'}
                      </button>
                      <span className="block text-[var(--text-secondary)]">双击进入该箱子</span>
                    </div>
                  ) : (
                    <div
                      className="max-w-[560px] whitespace-pre-wrap break-words text-[var(--text-secondary)]"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {getBubbleDisplayContent(item) || '写点什么...'}
                    </div>
                  )}
                </td>
                <td className="border-b border-black/[0.05] px-4 py-4 text-[var(--text-secondary)]">{formatDateTime(item.updatedAt || item.createdAt)}</td>
                <td className="border-b border-black/[0.05] px-4 py-4 text-[var(--text-secondary)]">{typeLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


export { SortingTableView };
