const INVISIBLE_LINK_CHAR_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
const FIRST_HTTP_URL_RE = /https?:\/\/[^\s<>"'`]+/i;
const TRAILING_URL_PUNCTUATION_RE = /[),.;!?'"’”\]\}>，。！？；：、）》」』】]+$/u;

export function normalizeLinkInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(INVISIBLE_LINK_CHAR_RE, '').trim();
}

function toValidHttpUrl(value: unknown): string {
  let candidate = normalizeLinkInput(value);

  while (candidate) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
      return '';
    } catch {
      const trimmedCandidate = candidate.replace(TRAILING_URL_PUNCTUATION_RE, '');
      if (trimmedCandidate === candidate) return '';
      candidate = trimmedCandidate;
    }
  }

  return '';
}

export function extractFirstHttpUrl(value: unknown): string {
  const normalized = normalizeLinkInput(value);
  if (!normalized) return '';
  const matched = normalized.match(FIRST_HTTP_URL_RE);
  return toValidHttpUrl(matched ? matched[0] : normalized);
}

export function getLinkDisplayLabel(value: unknown): string {
  const normalizedUrl = extractFirstHttpUrl(value);
  if (!normalizedUrl) return normalizeLinkInput(value);

  try {
    return new URL(normalizedUrl).hostname.replace(/^www\./i, '');
  } catch {
    return normalizeLinkInput(value);
  }
}
