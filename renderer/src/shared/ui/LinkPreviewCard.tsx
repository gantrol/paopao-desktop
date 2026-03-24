import { useEffect, useState, type AnchorHTMLAttributes } from 'react';
import { getLinkPreview } from '@/shared/api/desktop/link-preview';
import { getDesktopBridge } from '@/shared/lib/desktop-bridge';
import { extractFirstHttpUrl, getLinkDisplayLabel } from '@/shared/lib/link';

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function ExternalAnchor(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const bridge = getDesktopBridge();
  const href = typeof props.href === 'string' ? props.href.trim() : '';

  return (
    <a
      {...props}
      href={href || props.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented || !href) return;
        event.preventDefault();
        if (bridge) {
          void bridge.assets.open(href).catch(() => {
            window.open(href, '_blank', 'noopener,noreferrer');
          });
          return;
        }
        window.open(href, '_blank', 'noopener,noreferrer');
      }}
    />
  );
}

const linkPreviewCache = new Map<string, {
  title: string;
  description: string;
  image: string;
  siteName: string;
  url: string;
}>();

function useLinkPreview(url: string) {
  const [meta, setMeta] = useState(linkPreviewCache.get(url) || null);
  const [loading, setLoading] = useState(!linkPreviewCache.has(url));

  useEffect(() => {
    if (!url || linkPreviewCache.has(url)) return;
    let cancelled = false;

    getLinkPreview(url)
      .then((data) => {
        if (cancelled) return;
        linkPreviewCache.set(url, data);
        setMeta(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { meta, loading };
}

export function LinkPreviewCard({ url, compact = false }: { url: string; compact?: boolean }) {
  const { meta, loading } = useLinkPreview(url);
  const fallbackUrl = extractFirstHttpUrl(url);
  const resolvedUrl = meta?.url || fallbackUrl;
  const domain = meta?.siteName || getLinkDisplayLabel(url);

  if (!url) return null;

  if (loading) {
    return (
      <div className="flex items-center overflow-hidden rounded-[22px] border border-black/[0.05] bg-white px-4 py-3 shadow-sm">
        <div className="mr-3 h-10 w-10 animate-pulse rounded-xl bg-black/[0.05]" />
        <div className="min-w-0 flex-1 p-0">
          <span className="mt-0 inline-flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">{domain}</span>
        </div>
      </div>
    );
  }

  const title = meta?.title || url;
  const desc = meta?.description || '';
  const image = meta?.image || '';
  const body = (
    <>
      {image && !compact && (
        <div className="w-[140px] shrink-0 bg-black/[0.04]">
          <img
            className="h-full w-full object-cover"
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(event) => { (event.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div className="min-w-0 flex-1 p-4">
        <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</div>
        {desc && !compact && <div className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{desc}</div>}
        <div className="mt-3 inline-flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" /></svg>
          <span>{domain}</span>
        </div>
      </div>
    </>
  );

  if (!resolvedUrl) {
    return (
      <div
        className={cn(
          'flex overflow-hidden rounded-[22px] border border-black/[0.05] bg-white shadow-sm',
          compact && 'rounded-2xl',
        )}
      >
        {body}
      </div>
    );
  }

  return (
    <ExternalAnchor
      href={resolvedUrl}
      className={cn(
        'flex overflow-hidden rounded-[22px] border border-black/[0.05] bg-white no-underline shadow-sm',
        compact && 'rounded-2xl',
      )}
    >
      {body}
    </ExternalAnchor>
  );
}
