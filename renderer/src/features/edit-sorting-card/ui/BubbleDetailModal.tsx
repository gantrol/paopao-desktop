import { useEffect, useMemo, useRef, useState } from 'react';
import {
  normalizeBubbleBlocks,
  type BubbleDraftSource,
  type MessageData,
} from '@/entities/message';
import { BubbleComposer } from '@/shared/ui/BubbleComposer';
import { BubbleItem } from '@/shared/ui/BubbleItem';
import { uploadFile } from '@/shared/lib/upload';
import { EditIcon, EyeIcon, XIcon } from '@/shared/icons/SortingIcons';
import type { SortingBubbleDraft } from './types';
import {
  buildBubblePreviewTitle,
  buildDraftBubbleMessage,
  cx,
  formatDateTime,
} from './utils';

function cloneSource(source?: BubbleDraftSource) {
  if (!source?.targetMessageId) return undefined;
  return {
    ...source,
    snapshotBlocks: normalizeBubbleBlocks(source.snapshotBlocks || []),
  };
}

function cloneDraft(draft: SortingBubbleDraft | null): SortingBubbleDraft | null {
  if (!draft) return null;
  return {
    text: typeof draft.text === 'string' ? draft.text : '',
    items: Array.isArray(draft.items) ? draft.items.map((item) => ({ ...item })) : [],
    blocks: Array.isArray(draft.blocks) ? normalizeBubbleBlocks(draft.blocks) : undefined,
    quoteSource: cloneSource(draft.quoteSource),
    forwardSource: cloneSource(draft.forwardSource),
  };
}

export function SortingBubbleDetailModal({
  open,
  mode,
  message,
  kindLabel,
  sourceLabel,
  title,
  editable,
  draft,
  onClose,
  onRequestEdit,
  onError,
  onSave,
}: {
  open: boolean;
  mode: 'view' | 'edit';
  message: MessageData;
  kindLabel?: string | null;
  sourceLabel?: string | null;
  title?: string | null;
  editable: boolean;
  draft: SortingBubbleDraft | null;
  onClose: () => void;
  onRequestEdit?: () => void;
  onError?: (message: string) => void;
  onSave?: (draft: SortingBubbleDraft) => void;
}) {
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [localDraft, setLocalDraft] = useState<SortingBubbleDraft | null>(() => cloneDraft(draft));

  useEffect(() => {
    setLocalDraft(cloneDraft(draft));
  }, [draft, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const previewMessage = useMemo(() => {
    if (mode === 'edit' && localDraft) {
      return buildDraftBubbleMessage(localDraft, {
        id: message.id,
        role: message.role,
        time: message.time ?? Date.now(),
      });
    }
    return message;
  }, [localDraft, message, mode]);

  const heading = (mode === 'edit'
    ? ''
    : (title?.trim() || '')
  ) || buildBubblePreviewTitle(previewMessage.type === 'text'
    ? String(previewMessage.content || '')
    : sourceLabel || '泡泡详情');

  if (!open) return null;

  return (
    <div className="s-overlay" onClick={onClose}>
      <section className="s-detail-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="泡泡详情">
        <div className="s-detail-head">
          <div className="s-detail-head-copy">
            <span className="s-overline">{mode === 'edit' ? '编辑详情' : '查看详情'}</span>
            <h3>{heading}</h3>
            <div className="s-detail-meta">
              <span>{kindLabel || '泡泡'}</span>
              {sourceLabel ? <span>{sourceLabel}</span> : null}
              <span>{formatDateTime(previewMessage.time || Date.now())}</span>
            </div>
          </div>
          <div className="s-detail-head-actions">
            {editable && mode === 'view' && onRequestEdit ? (
              <button type="button" className="s-button--ghost s-button--icon" onClick={onRequestEdit} aria-label="编辑泡泡" title="编辑泡泡">
                <EditIcon size={14} />
              </button>
            ) : null}
            <button
              type="button"
              className="s-button--ghost s-button--icon"
              onClick={onClose}
              aria-label={mode === 'edit' ? '取消编辑' : '关闭详情'}
              title={mode === 'edit' ? '取消编辑' : '关闭详情'}
            >
              {mode === 'edit' ? <EyeIcon size={14} /> : <XIcon size={14} />}
            </button>
          </div>
        </div>

        <div className={cx('s-detail-body', mode === 'edit' && 'is-editing')}>
          {mode === 'edit' && localDraft ? (
            <>
              <div className="s-detail-editor-pane">
                <BubbleComposer
                  draft={localDraft}
                  placeholder="继续编辑泡泡..."
                  onDraftChange={(updater) => {
                    setLocalDraft((current) => {
                      if (!current) return current;
                      return updater(current);
                    });
                  }}
                  onSend={() => undefined}
                  showSendButton={false}
                  submitOnEnter={false}
                  onOpenPhotoPicker={() => mediaInputRef.current?.click()}
                  onOpenFilePicker={() => fileInputRef.current?.click()}
                />
              </div>
              <div className="s-detail-preview-pane">
                <div className="s-detail-preview-shell">
                  <BubbleItem msg={previewMessage} />
                </div>
              </div>
            </>
          ) : (
            <div className="s-detail-preview-pane">
              <div className="s-detail-preview-shell">
                <BubbleItem msg={previewMessage} />
              </div>
            </div>
          )}
        </div>

        {mode === 'edit' && localDraft ? (
          <>
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={async (event) => {
                const files = event.target.files ? Array.from(event.target.files) : [];
                event.target.value = '';
                if (files.length === 0) return;
                try {
                  const nextBlocks = await Promise.all(files.map(async (file) => {
                    const url = await uploadFile(file);
                    if (file.type.startsWith('image/')) {
                      return {
                        id: crypto.randomUUID(),
                        type: 'image' as const,
                        url,
                        fileName: file.name,
                      };
                    }
                    return {
                      id: crypto.randomUUID(),
                      type: 'video' as const,
                      url,
                      fileName: file.name,
                    };
                  }));
                  setLocalDraft((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      blocks: [...normalizeBubbleBlocks(current.blocks || []), ...nextBlocks],
                    };
                  });
                } catch {
                  onError?.('资源上传失败，请重试');
                }
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={async (event) => {
                const files = event.target.files ? Array.from(event.target.files) : [];
                event.target.value = '';
                if (files.length === 0) return;
                try {
                  const nextBlocks = await Promise.all(files.map(async (file) => {
                    const url = await uploadFile(file);
                    if (file.type.startsWith('audio/')) {
                      return {
                        id: crypto.randomUUID(),
                        type: 'audio' as const,
                        url,
                        fileName: file.name,
                      };
                    }
                    return {
                      id: crypto.randomUUID(),
                      type: 'file' as const,
                      url,
                      fileName: file.name,
                    };
                  }));
                  setLocalDraft((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      blocks: [...normalizeBubbleBlocks(current.blocks || []), ...nextBlocks],
                    };
                  });
                } catch {
                  onError?.('资源上传失败，请重试');
                }
              }}
            />
            <div className="s-detail-actions">
              <button type="button" className="s-button--ghost" onClick={onClose}>取消</button>
              <button type="button" className="s-button--primary" onClick={() => onSave?.(localDraft)}>保存</button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
