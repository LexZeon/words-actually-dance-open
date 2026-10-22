import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleLibrary } from '../src/content/sample-library.js';
import { localizeSampleTopic } from '../src/content/sample-translations.js';
import { parseScriptInput, serializeScriptDocument } from '../src/content/script-document.js';
import { literalGraphemeIndex, splitGraphemes } from '../src/content/text-boundaries.js';

test('all 110 local editions retain source IDs, beat budgets and the exact requested easter egg', () => {
  const before = structuredClone(sampleLibrary);
  assert.equal(sampleLibrary.length, 110);
  assert.deepEqual(
    sampleLibrary.slice(0, 9).map((topic) => topic.id),
    [
      'rhythm',
      'resonance',
      'compound',
      'focus',
      'parallel',
      'connection',
      'learning-retrieval',
      'learning-spacing',
      'learning-working-memory',
    ],
    'existing saved sample indices retain their meanings',
  );
  assert.equal(sampleLibrary.at(-1).id, 'easter-egg');
  for (const source of sampleLibrary) {
    const english = localizeSampleTopic(source, 'en');
    assert.notEqual(english, source);
    assert.equal(english.id, source.id);
    assert.notEqual(english.title, source.title);
    assert.equal(english.lines.length, source.lines.length);
    const restored = parseScriptInput(serializeScriptDocument(english));
    assert.equal(restored.title, english.title);
    for (const [index, line] of english.lines.entries()) {
      assert.equal(line.id, source.lines[index].id);
      assert.equal(line.holdBeats, source.lines[index].holdBeats);
      assert.equal(line.sentenceType, source.lines[index].sentenceType);
      assert.equal(restored.lines[index].text, line.text);
      assert.equal(restored.lines[index].keyword, line.keyword);
      assert.equal(line.keywords.length, source.lines[index].keywords.length);
      if (source.id === 'easter-egg') assert.equal(line.text, '你怎么找到这里的');
      else assert.ok(!/\p{Script=Han}/u.test(line.text));
      for (const entry of line.keywords) {
        const start = literalGraphemeIndex(line.text, entry.text);
        assert.ok(start >= 0, `${line.id}: visible concept ${entry.text}`);
        const glyphs = splitGraphemes(line.text);
        assert.equal(glyphs.slice(start, start + splitGraphemes(entry.text).length).join(''), entry.text);
        assert.ok(splitGraphemes(entry.text).length <= 12);
        if (entry.relation) {
          assert.equal(entry.relation.to, entry.text, 'the direction ends at this displayed concept');
          assert.ok(!/\p{Script=Han}/u.test(entry.relation.label));
        }
      }
    }
  }
  assert.deepEqual(sampleLibrary, before, 'English construction does not rewrite Chinese sources');
});

test('English concept and topic edges retain the original directions and meanings', () => {
  for (const source of sampleLibrary) {
    const english = localizeSampleTopic(source, 'en-US');
    const terms = new Map();
    source.lines.forEach((line, index) =>
      line.keywords.forEach((term, position) => {
        terms.set(term.text, english.lines[index].keywords[position].text);
      }),
    );
    for (const [index, line] of source.lines.entries()) {
      line.keywords.forEach((term, position) => {
        if (!term.relation) return;
        const edge = english.lines[index].keywords[position].relation;
        assert.equal(edge.type, term.relation.type);
        assert.equal(edge.from, terms.get(term.relation.from));
        assert.equal(edge.to, terms.get(term.relation.to));
      });
    }
    assert.equal(english.relations.length, source.relations.length);
    source.relations.forEach((edge, index) => {
      const translated = english.relations[index];
      assert.equal(translated.type, edge.type);
      assert.equal(translated.from, terms.get(edge.from));
      assert.equal(translated.to, terms.get(edge.to));
      assert.ok(translated.from && translated.to && translated.label);
      assert.ok(!/\p{Script=Han}/u.test(translated.label));
    });
  }
});

test('switching a returned English topic back to Chinese restores the untouched source object', () => {
  for (const source of sampleLibrary) {
    const english = localizeSampleTopic(source, 'en');
    assert.equal(localizeSampleTopic(source, 'zh'), source);
    assert.equal(localizeSampleTopic(english, 'zh-CN'), source);
    assert.equal(localizeSampleTopic(english, 'en-GB'), english);
    assert.equal(localizeSampleTopic(source, 'en'), english, 'cache keeps a stable displayed identity');
  }
});

test('custom text and built-in-looking user copies are not silently translated', () => {
  const custom = parseScriptInput('我的词｜我的词 belongs to my own notes.');
  const before = structuredClone(custom);
  const copy = structuredClone(sampleLibrary[0]);
  copy.title = 'My adaptation';
  for (const language of ['en', 'en-US', 'zh', 'zh-CN']) {
    assert.equal(localizeSampleTopic(custom, language), custom);
    assert.equal(localizeSampleTopic(copy, language), copy);
  }
  assert.deepEqual(custom, before);
});
