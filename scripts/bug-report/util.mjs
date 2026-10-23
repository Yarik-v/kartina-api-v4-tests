// Helpers shared by the bug-report scripts.

/** @param {unknown} s */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The little Markdown the catalog cells use: `code`, **bold**, [links](…) and **[A1]** report tags. */
export const md = (/** @type {string} */ s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*\[([A-Z]\d)\]\*\*/g, '<a href="#$1">[$1]</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

/**
 * The path of a stream URL, to compare answers from different streamer hosts. Copes
 * with the API's non-WHATWG schemes (`http/ts://`).
 * @param {unknown} url
 */
export const streamFile = (url) => {
  if (typeof url !== 'string') return '';
  return URL.canParse(url) ? new URL(url).pathname : url.replace(/^[^:]+:\/\/[^/]*/, '').split('?')[0];
};
