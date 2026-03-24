const { extractFirstHttpUrl, getLinkHostname, normalizeLinkInput } = require('./linkUrl');

function normalizeMetaText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function decodeUrlSegment(value) {
  if (!value) return '';

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

class LinkPreviewService {
  buildFallbackPreview(input) {
    const normalizedInput = normalizeLinkInput(input);
    const url = extractFirstHttpUrl(normalizedInput);

    if (!url) {
      return {
        title: normalizedInput,
        description: '',
        image: '',
        siteName: normalizedInput,
        url: normalizedInput,
      };
    }

    try {
      const parsed = new URL(url);
      const pathnameSegment = parsed.pathname.split('/').filter(Boolean).pop();
      return {
        title: decodeUrlSegment(pathnameSegment) || parsed.hostname,
        description: '',
        image: '',
        siteName: getLinkHostname(url),
        url,
      };
    } catch {
      return {
        title: url,
        description: '',
        image: '',
        siteName: getLinkHostname(url),
        url,
      };
    }
  }

  async get(input) {
    const fallback = this.buildFallbackPreview(input);
    const url = extractFirstHttpUrl(input);
    if (!url) {
      return fallback;
    }

    let fetchUrl = url;
    if (/^https?:\/\/(www\.)?(twitter|x)\.com/i.test(url)) {
      fetchUrl = url.replace(/^(https?:\/\/(www\.)?)(twitter|x)\.com/i, '$1fxtwitter.com');
    }

    try {
      const response = await fetch(fetchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaoPaoDesktop/1.0)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return fallback;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
        return fallback;
      }

      const html = await response.text();
      if (!html.trim()) {
        return fallback;
      }

      const findMeta = (prop) => {
        const patterns = [
          new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i'),
          new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'),
        ];

        for (const pattern of patterns) {
          const matched = html.match(pattern);
          if (matched?.[1]) return normalizeMetaText(matched[1]);
        }

        return '';
      };

      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);

      return {
        title: findMeta('og:title') || findMeta('twitter:title') || normalizeMetaText(titleMatch?.[1]) || fallback.title,
        description: findMeta('og:description') || findMeta('twitter:description') || findMeta('description') || '',
        image: findMeta('og:image') || findMeta('twitter:image') || '',
        siteName: findMeta('og:site_name') || fallback.siteName,
        url,
      };
    } catch {
      return fallback;
    }
  }
}

module.exports = {
  LinkPreviewService,
};
