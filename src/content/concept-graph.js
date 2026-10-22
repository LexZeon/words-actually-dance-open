const segmenter =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
const stopWords = new Set([
  '一个',
  '这个',
  '那个',
  '当前',
  '其中',
  '可以',
  '需要',
  '通过',
  '为什么',
  '多少',
  '每个',
  '如果',
  '因为',
  '所以',
  '就是',
  '不是',
  '不等于',
  '表示',
  '描述',
  '同时',
  '安排',
  '往往',
  '反复',
  '出现',
  '时候',
  '一样',
  '不同',
  '相同',
  '可能',
  '已经',
  '没有',
  '以后',
  '现在',
  '我们',
  '你们',
  '他们',
  '以及',
  '例如',
  '地方',
  '全部',
  '好的',
  '还是',
  '还有',
  '用来',
  '来说',
  '变成',
  '从而',
]);
import { splitGraphemes, literalGraphemeIndex, hasLiteralGrapheme } from './text-boundaries.js';
const count = (text) => splitGraphemes(text).length;

/** Local selection heuristic only; it never invents explanations or causal claims. */
export function chooseLocalConcepts(text, primary, explicit = []) {
  const terms = [...new Set([primary, ...explicit].filter(Boolean))];
  if (explicit.length === 0 && segmenter) {
    const candidates = [...segmenter.segment(text)].filter(
      (entry) =>
        entry.isWordLike &&
        count(entry.segment) >= 2 &&
        count(entry.segment) <= 8 &&
        !stopWords.has(entry.segment),
    );
    for (const { segment } of candidates) {
      if (terms.length >= 4) break;
      if (!terms.some((term) => term.includes(segment) || segment.includes(term))) terms.push(segment);
    }
  }
  return terms
    .filter((term) => hasLiteralGrapheme(text, term))
    .sort((a, b) => literalGraphemeIndex(text, a) - literalGraphemeIndex(text, b))
    .map((term, index, all) => ({
      text: term,
      ...(index ? { relation: { from: all[index - 1], to: term, type: 'related', label: '同句关联' } } : {}),
    }));
}

/** Curated links have explicit meanings and occur at literal positions in the source. */
export function annotateConcepts(line, terms) {
  let previous = line.keyword;
  const keywords = [{ text: line.keyword }];
  for (const [text, type = 'related', label = '同句关联'] of terms) {
    if (!line.text.includes(text)) throw new Error(`Missing concept ${text} in ${line.id}`);
    keywords.push({ text, relation: { from: previous, to: text, type, label } });
    previous = text;
  }
  return { ...line, keywords };
}
