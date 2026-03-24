import type { LinkPreviewMeta } from '@/shared/model';
import { assertDesktopBridge } from '@/shared/lib/desktop-bridge';
import { extractFirstHttpUrl, getLinkDisplayLabel, normalizeLinkInput } from '@/shared/lib/link';

function buildFallbackLinkPreview(url: string): LinkPreviewMeta {
  const normalizedUrl = extractFirstHttpUrl(url);

  try {
    const parsed = new URL(normalizedUrl || url);
    const title = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname);
    return {
      title,
      description: '',
      image: '',
      siteName: parsed.hostname.replace(/^www\./i, ''),
      url: parsed.toString(),
    };
  } catch {
    return {
      title: normalizeLinkInput(url),
      description: '',
      image: '',
      siteName: getLinkDisplayLabel(url),
      url: normalizedUrl || normalizeLinkInput(url),
    };
  }
}

export async function getLinkPreview(url: string): Promise<LinkPreviewMeta> {
  const normalizedUrl = extractFirstHttpUrl(url);

  try {
    return await assertDesktopBridge().linkPreview.get(normalizedUrl || url);
  } catch {
    return buildFallbackLinkPreview(url);
  }
}
