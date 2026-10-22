import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTextScript } from '../src/content/text-script.js';
import {
  parseScriptInput,
  stringifyScriptDocument,
  withScriptTitle,
} from '../src/content/script-document.js';
import { chooseLocalConcepts } from '../src/content/concept-graph.js';
import { splitGraphemes, hasLiteralGrapheme, SCRIPT_LIMITS } from '../src/content/text-boundaries.js';
import { restoreCustomScript, formatEditableScript } from '../src/core/local-state.js';
import { findKnowledgeMarkers } from '../src/visuals/knowledge-director.js';

test('legacy terms must match entire displayed emoji and combining characters', () => {
  for (const input of ['👩｜👩‍💻解释工作。', '🏽｜🧑🏽‍💻解释工作。', 'e｜é表示一个字符。'])
    assert.throws(() => parseTextScript(input), /完整字符/);
  assert.throws(() => parseTextScript('工作、👩｜工作由👩‍💻表示。'), /额外关键词/);
  const topic = parseTextScript('👩‍💻、é｜👩‍💻解释é字符。');
  for (const entry of topic.lines[0].keywords)
    assert.ok(findKnowledgeMarkers(topic.lines[0]).some(({ text }) => text === entry.text));
  assert.deepEqual(parseScriptInput(stringifyScriptDocument(topic)).lines[0].text, topic.lines[0].text);
});

test('implicit local terms preserve the original sentence and cannot join separated letters', () => {
  for (const text of ['A B 是两个字母。', '，学，习需要拆开解释。', '👩‍💻 工作需要专注。']) {
    const line = parseTextScript(text).lines[0];
    assert.equal(line.text, text);
    assert.ok(hasLiteralGrapheme(line.text, line.keyword));
    assert.ok(findKnowledgeMarkers(line).some(({ text: term }) => term === line.keyword));
  }
  // Preserve the old explicit-prefix convenience; it is separate from automatic selection.
  assert.equal(parseTextScript('关键词｜解释内容。').lines[0].text, '关键词：解释内容。');
  assert.equal(
    parseTextScript('3/4 拍子是一种拍号。').lines[0].keyword,
    '3/4',
    'Existing literal suggestions remain compatible',
  );
});

test('literal concept order uses complete occurrences, not an earlier substring inside an emoji', () => {
  const concepts = chooseLocalConcepts('👨‍👩‍👧‍👦学习，再由👨解释。', '学习', ['学习', '👨']);
  assert.deepEqual(
    concepts.map(({ text }) => text),
    ['学习', '👨'],
  );
  assert.equal(concepts[1].relation.from, '学习');
});

test('plain title clipping and JSON title fallback retain all 50 graphemes', () => {
  const title = 'a'.repeat(49) + '🧠';
  assert.equal(parseTextScript('字｜字在跳。', title + 'x').title, title);
  const document = {
    schemaVersion: 1,
    sourceMode: 'source-only',
    lines: [{ text: '字在跳。', keyword: '字', keywords: [{ text: '字', role: 'primary' }] }],
  };
  assert.equal(parseScriptInput(document, title + 'x').title, title);
  assert.equal(parseScriptInput(document, ' ').title, '我的知识');
});

test('title editor override preserves either representation and never mutates the source topic', () => {
  for (const topic of [
    parseTextScript('词｜词保留解释。', '原名'),
    parseScriptInput({
      schemaVersion: 1,
      sourceMode: 'free-expansion',
      title: '原名',
      lines: [
        {
          text: '词保留解释。',
          keyword: '词',
          keywords: [{ text: '词', role: 'primary' }],
          sentenceType: 'definition',
        },
      ],
    }),
  ]) {
    const changed = withScriptTitle(topic, '新的👩‍💻标题');
    assert.equal(changed.title, '新的👩‍💻标题');
    assert.equal(topic.title, '原名');
    assert.equal(changed.schemaVersion, topic.schemaVersion);
    assert.equal(changed.lines, topic.lines);
    assert.equal(changed.relations, topic.relations);
    assert.equal(changed.sourceMode, topic.sourceMode);
    for (const title of ['', ' \t ', '多\n行', '🧠'.repeat(51), '\ud800', '\u0000'])
      assert.throws(() => withScriptTitle(topic, title), /标题|Unicode/);
  }
});

test('text boundaries reject invalid Unicode, invisible controls and pathological grapheme clusters', () => {
  for (const text of ['\ud800', '\udc00', '词\u0000句', '词\u0008句']) {
    assert.throws(() => parseTextScript(text), /Unicode|控制字符/);
    assert.throws(
      () =>
        parseScriptInput({
          schemaVersion: 1,
          sourceMode: 'source-only',
          lines: [{ text, keyword: text, keywords: [{ text, role: 'primary' }] }],
        }),
      /Unicode|控制字符/,
    );
  }
  const bounded = 'e' + '\u0301'.repeat(SCRIPT_LIMITS.graphemeCodeUnits - 1);
  assert.equal(splitGraphemes(bounded).length, 1);
  assert.equal(parseTextScript(bounded).lines[0].text, bounded);
  assert.throws(() => parseTextScript(bounded + '\u0301'), /字符组合过长/);
  assert.throws(() => parseTextScript('a'.repeat(100_001)), /100,000/);
  for (const value of [null, undefined, {}, 123]) assert.throws(() => parseTextScript(value), /一段文字/);
});

test('plain CR and Unicode line separators preserve complete rows instead of merging notes', () => {
  for (const separator of ['\r', '\r\n', '\n', '\u2028', '\u2029']) {
    const topic = parseScriptInput('[词]｜[词]有解释。' + separator + '目标｜目标有方向。');
    assert.deepEqual(
      topic.lines.map(({ text }) => text),
      ['[词]有解释。', '目标有方向。'],
    );
  }
});

test('long legacy emoji documents restore without confusing UTF-16 length and visible characters', () => {
  const family = '👨‍👩‍👧‍👦';
  const topic = parseTextScript(
    Array.from({ length: 40 }, () => `${family}｜${family.repeat(60)}`).join('\n'),
    '家庭文案',
  );
  assert.ok(formatEditableScript(topic).length > 12_000);
  assert.deepEqual(restoreCustomScript(JSON.parse(JSON.stringify(topic))), topic);
  const corruptTitle = { ...topic, title: 'a'.repeat(49) + '\ud83e' };
  assert.deepEqual(restoreCustomScript(corruptTitle).lines, topic.lines);
  assert.equal(restoreCustomScript(corruptTitle).title, '我的知识');
  for (const separator of ['\u2028', '\u2029']) {
    assert.equal(
      restoreCustomScript({ lines: [{ text: '词' + separator + '下一句', keyword: '词' }] }),
      null,
      'A malformed persisted row must not silently drop its second half',
    );
  }
});
