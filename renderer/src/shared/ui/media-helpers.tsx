import { useEffect, useRef, useState } from 'react';
import { getDesktopBridge } from '@/shared/lib/desktop-bridge';
import type { CompoundItem } from '@/entities/message';

type PreviewableMediaType = 'img' | 'video';

export function isRenderableMediaSrc(src: unknown): src is string {
  if (typeof src !== 'string') return false;
  const normalized = src.trim();
  if (!normalized) return false;
  if (normalized.startsWith('blob:')) return false;
  return true;
}

function isOpenableAttachmentUrl(src: unknown): src is string {
  if (typeof src !== 'string') return false;
  const normalized = src.trim();
  if (!normalized) return false;
  return normalized.startsWith('paopao-asset://')
    || normalized.startsWith('file://')
    || normalized.startsWith('http://')
    || normalized.startsWith('https://');
}

export function getAttachmentOpenTarget(src: unknown, fallback?: unknown) {
  if (typeof src === 'string' && src.trim()) return src.trim();
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  return null;
}

export function getFileMessageDetails(content: unknown) {
  const payload = content && typeof content === 'object' ? content as { name?: string; size?: string; url?: string } : null;
  return {
    name: payload?.name || '文件',
    size: payload?.size || '未知',
    url: getAttachmentOpenTarget(payload?.url, payload?.name),
  };
}

export function getCompoundFileLabel(item: CompoundItem) {
  return item.fileName || item.val || '文件';
}

export function getCompoundFileUrl(item: CompoundItem) {
  return getAttachmentOpenTarget(item.val, item.fileName);
}

export function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="flex min-h-[120px] w-full flex-col items-center justify-center gap-1 rounded-[20px] border border-dashed border-black/10 bg-black/[0.03] px-4 py-5 text-center">
      <strong className="text-sm font-semibold text-[var(--text-primary)]">{label}</strong>
      <span className="text-xs leading-5 text-[var(--text-secondary)]">原始资源地址已失效，当前无法预览</span>
    </div>
  );
}

export function useInteractiveAssetActions({
  onFsOpen,
  onAttachmentOpen,
}: {
  onFsOpen?: (src: string, type: PreviewableMediaType) => void;
  onAttachmentOpen?: (src: string) => void;
}) {
  const bridge = getDesktopBridge();
  const [fallbackPreview, setFallbackPreview] = useState<null | { src: string; type: PreviewableMediaType }>(null);
  const fallbackVideoRef = useRef<HTMLVideoElement | null>(null);

  const openMediaPreview = (src: unknown, type: PreviewableMediaType) => {
    if (!isRenderableMediaSrc(src)) return;
    if (onFsOpen) {
      onFsOpen(src, type);
      return;
    }
    setFallbackPreview({ src, type });
  };

  const openAttachment = (src: unknown) => {
    const target = getAttachmentOpenTarget(src);
    if (!target) return;
    if (onAttachmentOpen) {
      onAttachmentOpen(target);
      return;
    }
    if (!bridge) return;
    void bridge.assets.open(target).catch(() => {});
  };

  const closeFallbackPreview = () => {
    fallbackVideoRef.current?.pause();
    setFallbackPreview(null);
  };

  const previewOverlay = fallbackPreview ? (
    <div className="fullscreen-overlay show" onClick={closeFallbackPreview}>
      <div className="fullscreen-close">×</div>
      {fallbackPreview.type === 'img'
        ? <img src={fallbackPreview.src} className="fullscreen-content" alt="fullscreen" />
        : <video src={fallbackPreview.src} className="fullscreen-content" controls ref={fallbackVideoRef} autoPlay onClick={(event) => event.stopPropagation()} />}
    </div>
  ) : null;

  useEffect(() => () => {
    fallbackVideoRef.current?.pause();
  }, []);

  return {
    openAttachment,
    openMediaPreview,
    previewOverlay,
  };
}
