import { getAttachmentOpenTarget, isRenderableMediaSrc, MediaUnavailable, useInteractiveAssetActions } from '@/shared/ui/media-helpers';

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function UploadedItemPreview({
  type,
  src,
  fileName,
  onFsOpen,
  onAttachmentOpen,
}: {
  type: 'img' | 'video' | 'audio' | 'file';
  src: string;
  fileName?: string;
  onFsOpen?: (src: string, type: 'img' | 'video') => void;
  onAttachmentOpen?: (src: string) => void;
}) {
  const { openAttachment, openMediaPreview, previewOverlay } = useInteractiveAssetActions({ onFsOpen, onAttachmentOpen });
  const fileUrl = type === 'file'
    ? getAttachmentOpenTarget(src, fileName)
    : (src.startsWith('paopao-asset://') || src.startsWith('file://') || src.startsWith('http://') || src.startsWith('https://') ? src : null);
  const fileLabel = fileName || src || '文件';

  if (type === 'img') {
    return (
      <>
        {isRenderableMediaSrc(src)
          ? (
            <div className="inline-compound-media">
              <img
                src={src}
                alt={fileName || 'image'}
                className="cursor-zoom-in"
                onClick={() => openMediaPreview(src, 'img')}
              />
            </div>
          )
          : <MediaUnavailable label="图片不可用" />}
        {previewOverlay}
      </>
    );
  }

  if (type === 'video') {
    return (
      <>
        {isRenderableMediaSrc(src)
          ? (
            <div className="inline-compound-media">
              <video src={src} controls preload="metadata" onDoubleClick={() => openMediaPreview(src, 'video')} />
            </div>
          )
          : <MediaUnavailable label="视频不可用" />}
        {previewOverlay}
      </>
    );
  }

  if (type === 'audio') {
    return isRenderableMediaSrc(src)
      ? (
        <div className="inline-compound-media">
          <audio src={src} controls />
        </div>
      )
      : <MediaUnavailable label="音频不可用" />;
  }

  return (
    <button
      type="button"
      className={cn(
        'inline-compound-file flex w-full items-center gap-2 border-0 text-left',
        fileUrl && 'cursor-pointer hover:bg-black/[0.06] hover:text-[var(--text-primary)]',
      )}
      onClick={(event) => {
        event.stopPropagation();
        openAttachment(fileUrl);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openAttachment(fileUrl);
      }}
      disabled={!fileUrl}
      title={fileUrl ? '单击或双击用系统默认应用打开' : '当前附件不可打开'}
    >
      <span>📎</span>
      <span className="truncate">{fileLabel}</span>
    </button>
  );
}
