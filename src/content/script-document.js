import { parseTextScript } from './text-script.js';
import {
  SCRIPT_LIMITS,
  splitGraphemes,
  hasLiteralGrapheme,
  localScriptTitle,
  validateSingleLineText,
  splitScriptLines,
} from './text-boundaries.js';

export const SCRIPT_SCHEMA_VERSION = 1;
export const SCRIPT_INPUT_LIMIT = SCRIPT_LIMITS.inputCodeUnits;
export const SCRIPT_SOURCE_MODES = Object.freeze(['source-only', 'free-examples', 'free-expansion']);
export const SCRIPT_SENTENCE_TYPES = Object.freeze([
  'opening',
  'definition',
  'contrast',
  'steps',
  'fact',
  'example',
  'summary',
]);
export const SCRIPT_RELATION_TYPES = Object.freeze([
  'related',
  'combine',
  'expand',
  'contrast',
  'cause',
  'progress',
  'part',
  'measure',
  'context',
  'condition',
  'effect',
  'limit',
  'mechanism',
  'parameter',
  'direction',
  'return',
  'coordination',
  'method',
  'refine',
]);

const graphemes = splitGraphemes;
const record = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/** JSON authoring document or the existing local plain-text editor format.
 * Structured input is never repaired by inserting keywords into its text.
 */
export function parseScriptInput(input, titleFallback = '我的知识') {
  if (typeof input !== 'string') {
    if (!record(input)) throw new Error('文案需要是一段文字或标准 JSON 对象。');
    checkInputSize(input);
    return normalizeDocument(input, titleFallback);
  }
  if (input.length > SCRIPT_INPUT_LIMIT) throw new Error('文案一次最多 100,000 个字符，请分段导入。');
  let text = input.trim();
  let structured = /^[{[]/u.test(text);
  if (text.startsWith('```')) {
    const fence = text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/iu);
    if (!fence) throw new Error('请只粘贴一个完整的 JSON 文案或一个 json 代码块。');
    text = fence[1].trim();
    structured = true;
  } else if (structured && isExplicitLegacyLine(text) && !hasJsonSignature(text)) {
    // Brackets are also valid literal keywords, e.g. [专注]｜[专注]帮助阅读。
    // Only an explicit, bounded old-format prefix permits this fallback.
    return parseTextScript(input, titleFallback);
  }
  if (!structured) return parseTextScript(input, titleFallback);
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error('JSON 格式有误，请检查引号、逗号和括号，或重新复制完整文案。');
  }
  return normalizeDocument(document, titleFallback);
}

/** Plain JSON object suitable for JSON.stringify/storage/download. Runtime
 * ids, emoji, animation state and the derived topic relation index are omitted.
 */
export function serializeScriptDocument(topic) {
  if (!record(topic) || !Array.isArray(topic.lines)) throw new Error('没有可以保存的文案。');
  if (own(topic, 'schemaVersion') && topic.schemaVersion !== SCRIPT_SCHEMA_VERSION)
    throw new Error('暂时只支持 schemaVersion 为 1 的文案。');
  const document = {
    schemaVersion: SCRIPT_SCHEMA_VERSION,
    title: topic.title,
    sourceMode:
      topic.schemaVersion === SCRIPT_SCHEMA_VERSION ? topic.sourceMode : (topic.sourceMode ?? 'source-only'),
    lines: topic.lines.map((line) => {
      if (!record(line)) throw new Error('每行文案需要包含 text、keyword 和 keywords。');
      const structured = topic.schemaVersion === SCRIPT_SCHEMA_VERSION;
      if (structured && !Array.isArray(line.keywords))
        throw new Error('标准 JSON 每行需要明确的 keywords 和角色。');
      const entries = Array.isArray(line.keywords) ? line.keywords : [{ text: line.keyword }];
      const keywords = entries.map((entry) => {
        const item = typeof entry === 'string' ? { text: entry } : entry;
        if (!record(item)) throw new Error('关键词需要包含文字和角色。');
        return {
          text: item.text,
          role: structured
            ? item.role
            : (item.role ?? (item.text === line.keyword ? 'primary' : 'secondary')),
          ...(own(item, 'relation') ? { relation: item.relation } : {}),
        };
      });
      if (!structured && !keywords.some((entry) => entry.text === line.keyword))
        keywords.unshift({ text: line.keyword, role: 'primary' });
      return {
        text: line.text,
        keyword: line.keyword,
        keywords,
        ...(own(line, 'sentenceType') ? { sentenceType: line.sentenceType } : {}),
        ...(own(line, 'holdBeats') ? { holdBeats: line.holdBeats } : {}),
      };
    }),
  };
  const normalized = normalizeDocument(document);
  const result = {
    schemaVersion: SCRIPT_SCHEMA_VERSION,
    title: normalized.title,
    sourceMode: normalized.sourceMode,
    lines: normalized.lines.map(({ text, keyword, keywords, sentenceType, holdBeats }) => ({
      text,
      keyword,
      keywords: keywords.map(({ text: term, role, relation }) => ({
        text: term,
        role,
        ...(relation ? { relation: { ...relation } } : {}),
      })),
      ...(sentenceType ? { sentenceType } : {}),
      ...(holdBeats !== 8 ? { holdBeats } : {}),
    })),
  };
  checkInputSize(result);
  return result;
}

/** The exact string for files and editors. Pretty whitespace must not make a
 * valid document exceed the shared input/export cap; no trailing newline.
 */
export function stringifyScriptDocument(topic) {
  const document = serializeScriptDocument(topic);
  const readable = JSON.stringify(document, null, 2);
  return readable.length <= SCRIPT_INPUT_LIMIT ? readable : JSON.stringify(document);
}

/** Explicit editor action only. File imports keep their document's own title. */
export function withScriptTitle(topic, title) {
  if (!record(topic) || !Array.isArray(topic.lines)) throw new Error('没有可以修改标题的文案。');
  return { ...topic, title: literalText(title, '标题', SCRIPT_LIMITS.titleGraphemes) };
}

function normalizeDocument(document, titleFallback = '我的知识') {
  if (!record(document)) throw new Error('标准 JSON 文案的最外层需要是一个对象。');
  if (document.schemaVersion !== SCRIPT_SCHEMA_VERSION)
    throw new Error('暂时只支持 schemaVersion 为 1 的文案。');
  if (!SCRIPT_SOURCE_MODES.includes(document.sourceMode))
    throw new Error('sourceMode 请使用 source-only、free-examples 或 free-expansion。');
  const title =
    document.title === undefined ? localScriptTitle(titleFallback) : literalText(document.title, '标题', 50);
  if (!Array.isArray(document.lines) || document.lines.length < 1)
    throw new Error('JSON 文案至少需要一行 lines。');
  if (document.lines.length > 40) throw new Error('实验版一次最多 40 行，请分段体验。');
  const lines = document.lines.map((line, index) => {
    const prefix = `第 ${index + 1} 行`;
    if (!record(line)) throw new Error(`${prefix}需要是一个文案对象。`);
    const text = literalText(line.text, `${prefix}讲解`, 60);
    const keyword = literalText(line.keyword, `${prefix}主关键词`, 12);
    if (!literalMatch(text, keyword)) throw new Error(`${prefix}主关键词必须完整出现在本句讲解中。`);
    if (!Array.isArray(line.keywords) || line.keywords.length < 1 || line.keywords.length > 8)
      throw new Error(`${prefix}的 keywords 需要包含 1～8 个关键词。`);
    const terms = new Set();
    const keywords = line.keywords.map((entry, position) => {
      if (!record(entry)) throw new Error(`${prefix}第 ${position + 1} 个关键词需要包含 text 和 role。`);
      const term = literalText(entry.text, `${prefix}关键词`, 12);
      if (terms.has(term)) throw new Error(`${prefix}关键词“${term}”重复，请只保留一次。`);
      terms.add(term);
      if (!literalMatch(text, term)) throw new Error(`${prefix}关键词“${term}”必须完整出现在本句讲解中。`);
      if (!['primary', 'secondary'].includes(entry.role))
        throw new Error(`${prefix}关键词角色请使用 primary 或 secondary。`);
      return {
        text: term,
        role: entry.role,
        ...(own(entry, 'relation') ? { relation: normalizeRelation(entry.relation, term, prefix) } : {}),
      };
    });
    const primaries = keywords.filter((entry) => entry.role === 'primary');
    if (primaries.length !== 1 || primaries[0].text !== keyword)
      throw new Error(`${prefix}需要恰好一个 primary，且其 text 与 keyword 完全相同。`);
    if (own(line, 'sentenceType') && !SCRIPT_SENTENCE_TYPES.includes(line.sentenceType))
      throw new Error(`${prefix}的 sentenceType 不受支持，请使用规定的句式名称。`);
    const holdBeats = own(line, 'holdBeats') ? line.holdBeats : 8;
    if (!Number.isInteger(holdBeats) || holdBeats < 1 || holdBeats > 32)
      throw new Error(`${prefix}停留拍数 holdBeats 需要是 1～32 的整数。`);
    return {
      id: `custom-${index}`,
      text,
      keyword,
      keywords,
      ...(own(line, 'sentenceType') ? { sentenceType: line.sentenceType } : {}),
      holdBeats,
    };
  });
  const knownTerms = new Set(lines.flatMap((line) => line.keywords.map((entry) => entry.text)));
  const relations = [];
  const seenRelations = new Set();
  lines.forEach((line, index) => {
    for (const entry of line.keywords) {
      if (!entry.relation) continue;
      const relation = entry.relation;
      if (!knownTerms.has(relation.from) || !knownTerms.has(relation.to))
        throw new Error(`第 ${index + 1} 行关系的 from 和 to 需要引用全文中已声明的实际关键词。`);
      const key = JSON.stringify(relation);
      if (!seenRelations.has(key)) {
        seenRelations.add(key);
        relations.push({ ...relation });
      }
    }
  });
  return {
    schemaVersion: SCRIPT_SCHEMA_VERSION,
    sourceMode: document.sourceMode,
    id: 'custom',
    title,
    keyword: lines[0].keyword,
    emoji: '✳',
    relations,
    lines,
  };
}

function normalizeRelation(value, term, prefix) {
  if (!record(value)) throw new Error(`${prefix}关系需要是包含 from、to 的对象。`);
  const from = literalText(value.from, `${prefix}关系起点`, 12);
  const to = literalText(value.to, `${prefix}关系终点`, 12);
  if (to !== term) throw new Error(`${prefix}关系的 to 必须与所在关键词的 text 完全相同。`);
  const type = value.type === undefined ? 'related' : value.type;
  if (!SCRIPT_RELATION_TYPES.includes(type))
    throw new Error(`${prefix}关系 type 不受支持；不确定时请用 related。`);
  const label = value.label === undefined ? '关联' : literalText(value.label, `${prefix}关系说明`, 60);
  return { from, to, type, label };
}

function literalText(value, name, maximum) {
  return validateSingleLineText(value, name, maximum);
}

function literalMatch(text, term) {
  return hasLiteralGrapheme(text, term);
}

function isExplicitLegacyLine(text) {
  const firstLine = splitScriptLines(text).find((line) => line.trim());
  if (!firstLine) return false;
  const separator = firstLine.search(/[|｜]/u);
  if (separator <= 0 || !firstLine.slice(separator + 1).trim()) return false;
  const terms = firstLine
    .slice(0, separator)
    .split(/[、,，]/u)
    .map((term) => term.trim())
    .filter(Boolean);
  return terms.length >= 1 && terms.length <= 8 && terms.every((term) => graphemes(term).length <= 12);
}

function hasJsonSignature(text) {
  // Quoted keys, even damaged/unquoted key syntax, and JSON array values stay
  // on the structured path. A separator inside a JSON string is never a prefix.
  return (
    /^\{\s*(?:["']|[\p{L}_$][\p{L}\p{N}_$]*\s*:)/u.test(text) ||
    /^\[\s*(?:["'{\[\d-]|true\b|false\b|null\b)/u.test(text)
  );
}

function checkInputSize(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new Error('文案需要是可以保存的标准 JSON 对象。');
  }
  if (text.length > SCRIPT_INPUT_LIMIT) throw new Error('文案一次最多 100,000 个字符，请分段导入。');
}
