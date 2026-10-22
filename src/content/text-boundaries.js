const segmenter =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export const SCRIPT_LIMITS = Object.freeze({
  inputCodeUnits: 100_000,
  lines: 40,
  titleGraphemes: 50,
  lineGraphemes: 60,
  keywordGraphemes: 12,
  keywordsPerLine: 8,
  graphemeCodeUnits: 64,
});

export function splitGraphemes(text) {
  return segmenter ? [...segmenter.segment(text)].map(({ segment }) => segment) : Array.from(text);
}

export function truncateGraphemes(text, maximum) {
  const parts = segmenter ? segmenter.segment(text) : Array.from(text).map((segment) => ({ segment }));
  const result = [];
  for (const { segment } of parts) {
    if (result.length >= maximum) break;
    result.push(segment);
  }
  return result.join('');
}

/** A substring inside a ZWJ emoji or combining cluster is not a displayed word. */
export function literalGraphemeIndex(text, term) {
  if (!term || !text.includes(term)) return -1;
  const body = splitGraphemes(text),
    target = splitGraphemes(term);
  for (let start = 0; start <= body.length - target.length; start++) {
    if (target.every((glyph, index) => body[start + index] === glyph)) return start;
  }
  return -1;
}
export const hasLiteralGrapheme = (text, term) => literalGraphemeIndex(text, term) >= 0;
export const splitScriptLines = (text) => text.split(/\r\n|[\r\n\u2028\u2029]/u);

/** User input boundary: preserve valid Unicode exactly; never replace lost glyphs. */
export function validateUnicodeText(text, name = '文案') {
  const wellFormed =
    typeof text.isWellFormed === 'function'
      ? text.isWellFormed()
      : !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
  if (!wellFormed) throw new Error(`${name}包含不完整的 Unicode 字符，请重新复制完整文字。`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text))
    throw new Error(`${name}包含无法显示的控制字符，请使用普通文字。`);
}

export function validateSingleLineText(value, name, maximum) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}需要是非空文字。`);
  if (/[\r\n\u2028\u2029]/u.test(value)) throw new Error(`${name}请写成单行文字。`);
  validateUnicodeText(value, name);
  const parts = splitGraphemes(value);
  if (parts.length > maximum) throw new Error(`${name}最多 ${maximum} 个可见字符，请拆短一些。`);
  if (parts.some((part) => part.length > SCRIPT_LIMITS.graphemeCodeUnits))
    throw new Error(`${name}的单个字符组合过长，请拆分组合或重新复制文字。`);
  return value;
}

export function localScriptTitle(value) {
  const title = typeof value === 'string' && value.trim() ? value : '我的知识';
  const clipped = truncateGraphemes(title, SCRIPT_LIMITS.titleGraphemes);
  return validateSingleLineText(clipped, '标题', SCRIPT_LIMITS.titleGraphemes);
}

/** Select a real contiguous prefix, rather than joining words across punctuation. */
export function firstLiteralKeyword(text) {
  // Keep the existing three-glyph suggestion when it really occurs in source.
  // Only its old cross-whitespace/punctuation invention needs a new fallback.
  const traditional = truncateGraphemes(text.replace(/[\s，。！？、:：]/gu, ''), 3);
  if (hasLiteralGrapheme(text, traditional)) return traditional;
  const parts = splitGraphemes(text);
  const separator = (part) => /^[\p{P}\p{Z}\p{C}]+$/u.test(part);
  const start = parts.findIndex((part) => !separator(part));
  if (start < 0) return '';
  let end = start;
  while (end < parts.length && end - start < 3 && !separator(parts[end])) end++;
  return parts.slice(start, end).join('');
}
