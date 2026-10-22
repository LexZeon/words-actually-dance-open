import { splitGraphemes as chars } from '../content/text-boundaries.js';

/** Sentence-level choreography only. Never writes, summarizes, or changes text. */
export const KNOWLEDGE_SCENES = Object.freeze(
  [
    { id: 'opening', label: '开场近景', effect: 'tunnel', entrance: 'zoom', exit: 'flip' },
    { id: 'definition', label: '定义与重点', effect: 'marker', entrance: 'lift', exit: 'slide' },
    { id: 'contrast', label: '对比双栏', effect: 'slide', entrance: 'split', exit: 'flip' },
    { id: 'steps', label: '递进阶梯', effect: 'wave', entrance: 'lift', exit: 'slide' },
    { id: 'spotlight', label: '词组近景', effect: 'karaoke', entrance: 'zoom', exit: 'fold' },
    { id: 'diagonal', label: '斜向错落', effect: 'scatter', entrance: 'diagonal', exit: 'slide' },
    { id: 'flip', label: '翻牌过渡', effect: 'flip', entrance: 'flip', exit: 'fold' },
    { id: 'ink', label: '墨字叠层', effect: 'tunnel', entrance: 'zoom', exit: 'fold' },
  ].map(Object.freeze),
);

const CONTRAST = /(?:但|却|而非|不是|不等于|相反|相比|不同|不代表|未必|不保证)/u;
const STEPS = /(?:先|再|然后|最后|下一|逐步|第一|第二|第三|→)/u;
const DEFINITION = /(?:是|指|表示|称为|定义|描述|意味着)/u;
export const SENTENCE_LAYOUTS = Object.freeze({
  opening: 'opening',
  definition: 'definition',
  contrast: 'contrast',
  steps: 'steps',
  fact: 'diagonal',
  example: 'spotlight',
  summary: 'flip',
});

/** Deterministic: one line yields one complete scene, independent of reveal ticks. */
export function directKnowledgeScene({ line = {}, index = 0, lineCount = 1, relation = {} } = {}) {
  const text = typeof line.text === 'string' ? line.text : '';
  const keyword = typeof line.keyword === 'string' ? line.keyword : '';
  const glyphs = chars(text);
  const length = glyphs.length;
  let layout;
  const sentenceType = Object.hasOwn(SENTENCE_LAYOUTS, line.sentenceType) ? line.sentenceType : null;
  const inkKeyword = /^[\p{Script=Han}]+$/u.test(keyword) && chars(keyword).length <= 6;
  if (sentenceType) layout = SENTENCE_LAYOUTS[sentenceType];
  else if (
    inkKeyword &&
    (index === 0 || (index % 5 === 4 && length <= 35 && !CONTRAST.test(text) && !STEPS.test(text)))
  )
    layout = 'ink';
  else if (index === 0) layout = 'opening';
  else if (CONTRAST.test(text) || ['contrast', 'limit'].includes(relation.type)) layout = 'contrast';
  else if (
    STEPS.test(text) ||
    ['progress', 'mechanism', 'effect', 'direction', 'coordination'].includes(relation.type)
  )
    layout = 'steps';
  else if (DEFINITION.test(text)) layout = 'definition';
  else if (length <= 18 || /[0-9×=²]|[A-Za-z]{2,}/u.test(text)) layout = 'spotlight';
  else layout = index % 2 === 0 ? 'diagonal' : 'flip';

  const selected = KNOWLEDGE_SCENES.find(({ id }) => id === layout);
  let fontPx =
    layout === 'ink'
      ? 27
      : length > 38
        ? 27
        : length > 24
          ? 36
          : layout === 'opening'
            ? length <= 8
              ? 72
              : length <= 14
                ? 56
                : 42
            : layout === 'spotlight'
              ? 44
              : layout === 'definition'
                ? 40
                : 38;
  const contrastMatch = text.match(CONTRAST);
  const codeUnitSplit = contrastMatch?.index > 0 ? contrastMatch.index : -1;
  let splitAt = codeUnitSplit > 0 ? chars(text.slice(0, codeUnitSplit)).length : 0;
  // A balanced, punctuation-based fallback keeps both sides readable.
  if (layout === 'contrast' && !splitAt) {
    const punctuation = text.search(/[，；;：:]/u);
    splitAt = punctuation > 0 ? chars(text.slice(0, punctuation + 1)).length : Math.floor(length / 2);
  }
  // A relation or comparison at the very end should not create a one-glyph column.
  if (layout === 'contrast' && (splitAt < 3 || length - splitAt < 3)) splitAt = 0;
  if (layout === 'contrast' && splitAt > 0) {
    const markers = findKnowledgeMarkers(line);
    const safeBoundary = (position) => !markers.some(({ start, end }) => start < position && position < end);
    if (!safeBoundary(splitAt)) {
      // Columns may divide a sentence, but must never cut a literal concept in half.
      const candidates = Array.from({ length: Math.max(0, length - 5) }, (_, position) => position + 3)
        .filter(safeBoundary)
        .sort((left, right) => Math.abs(left - splitAt) - Math.abs(right - splitAt) || left - right);
      splitAt = candidates[0] || 0;
    }
  }
  if (layout === 'contrast' && splitAt > 0) {
    const longestHalf = Math.max(splitAt, length - splitAt);
    if (longestHalf > 30 || Math.min(splitAt, length - splitAt) / length < 0.25) splitAt = 0;
    else if (longestHalf > 20) fontPx = Math.min(fontPx, 27);
  }

  return Object.freeze({
    layout,
    sentenceType,
    directionSource: sentenceType ? 'explicit' : 'inferred',
    effect: selected.effect,
    entrance: selected.entrance,
    exit: selected.exit,
    typography: Object.freeze({
      fontPx,
      lineHeight: length > 38 ? 1.4 : 1.3,
      weight: layout === 'opening' ? 550 : 400,
    }),
    emphasis: Object.freeze({
      keyword,
      kind: layout === 'definition' ? 'ring' : layout === 'contrast' ? 'invert' : 'scale',
    }),
    splitAt,
    length,
    index,
    lineCount,
    holdScale: 1,
  });
}

export default directKnowledgeScene;

/** Exact grapheme ranges; duplicate entries do not cause duplicate callbacks. */
export function findKnowledgeMarkers(line = {}) {
  const text = typeof line.text === 'string' ? line.text : '';
  const glyphs = chars(text);
  const entries = Array.isArray(line.keywords) ? [...line.keywords] : [];
  if (
    typeof line.keyword === 'string' &&
    !entries.some((entry) => (typeof entry === 'string' ? entry : entry?.text) === line.keyword)
  )
    entries.push({ text: line.keyword });
  const markers = [];
  const seen = new Set();
  for (const entry of entries) {
    const word = typeof entry === 'string' ? entry : entry?.text;
    if (typeof word !== 'string' || !word) continue;
    const target = chars(word);
    for (let start = 0; start <= glyphs.length - target.length; start++) {
      if (!target.every((glyph, position) => glyphs[start + position] === glyph)) continue;
      const end = start + target.length;
      const key = `${start}:${end}:${word}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push(
        Object.freeze({
          text: word,
          start,
          end,
          key,
          role: entry?.role === 'primary' || entry?.role === 'secondary' ? entry.role : null,
          relation: typeof entry?.relation === 'object' && entry.relation ? { ...entry.relation } : null,
        }),
      );
    }
  }
  return Object.freeze(markers.sort((left, right) => left.end - right.end || right.start - left.start));
}
