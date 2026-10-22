import { chooseLocalConcepts } from './concept-graph.js';
import {
  SCRIPT_LIMITS,
  splitGraphemes,
  hasLiteralGrapheme,
  firstLiteralKeyword,
  localScriptTitle,
  validateSingleLineText,
  validateUnicodeText,
  splitScriptLines,
} from './text-boundaries.js';

/** Local editing only. This does not pretend to call an AI model. */
export function parseTextScript(text, title = '我的知识') {
  if (typeof text !== 'string') throw new Error('文案需要是一段文字。');
  if (text.length > SCRIPT_LIMITS.inputCodeUnits)
    throw new Error('文案一次最多 100,000 个字符，请分段导入。');
  validateUnicodeText(text);
  const lines = splitScriptLines(text)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('先放入一段文字。');
  if (lines.length > 40) throw new Error('实验版一次最多 40 行，请分段体验。');
  return {
    id: 'custom',
    title: localScriptTitle(title),
    keyword: '文字',
    emoji: '✳',
    relations: [],
    lines: lines.map((raw, i) => {
      const separator = raw.search(/[|｜]/);
      let keyword,
        body,
        explicit = [];
      if (separator > 0) {
        explicit = raw
          .slice(0, separator)
          .split(/[、,，]/)
          .map((v) => v.trim())
          .filter(Boolean);
        keyword = explicit[0];
        body = raw.slice(separator + 1).trim();
      } else {
        body = raw;
        keyword = firstLiteralKeyword(raw);
      }
      if (!keyword || splitGraphemes(keyword).length > 12) throw new Error('每个关键词用 1～12 个字符。');
      if (explicit.length > 8 || explicit.some((term) => splitGraphemes(term).length > 12))
        throw new Error('每行最多 8 个关键词，每个不超过 12 个字符。');
      for (const term of explicit.length ? explicit : [keyword])
        validateSingleLineText(term, '关键词', SCRIPT_LIMITS.keywordGraphemes);
      if (!body) throw new Error('关键词后面还需要讲解。');
      if (body.includes(keyword) && !hasLiteralGrapheme(body, keyword))
        throw new Error('主关键词需要以完整字符出现在本行讲解里。');
      if (!body.includes(keyword)) body = keyword + '：' + body;
      if (explicit.slice(1).some((term) => !hasLiteralGrapheme(body, term)))
        throw new Error('额外关键词需要出现在本行讲解里。');
      validateSingleLineText(body, '每行讲解', SCRIPT_LIMITS.lineGraphemes);
      return {
        id: 'custom-' + i,
        text: body,
        keyword,
        keywords: chooseLocalConcepts(body, keyword, explicit.length > 1 ? explicit : []),
        holdBeats: 8,
      };
    }),
  };
}
