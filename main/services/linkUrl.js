const INVISIBLE_LINK_CHAR_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
const FIRST_HTTP_URL_RE = /https?:\/\/[^\s<>"'`]+/i;
const TRAILING_URL_PUNCTUATION_RE = /[),.;!?'"’”\]\}>，。！？；：、）》」』】]+$/u;

function normalizeLinkInput(value) {
  if (typeof value !== 'string') return '';
  return value.replace(INVISIBLE_LINK_CHAR_RE, '').trim();
}

function toValidHttpUrl(value) {
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

function extractFirstHttpUrl(value) {
  const normalized = normalizeLinkInput(value);
  if (!normalized) return '';
  const matched = normalized.match(FIRST_HTTP_URL_RE);
  return toValidHttpUrl(matched ? matched[0] : normalized);
}

function getLinkHostname(value) {
  const normalizedUrl = extractFirstHttpUrl(value);
  if (!normalizedUrl) return normalizeLinkInput(value);

  try {
    return new URL(normalizedUrl).hostname.replace(/^www\./i, '');
  } catch {
    return normalizeLinkInput(value);
  }
}

module.exports = {
  extractFirstHttpUrl,
  getLinkHostname,
  normalizeLinkInput,
};
