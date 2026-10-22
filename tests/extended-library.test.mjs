import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extendedLibrary,
  extendedEnglishLibrary,
  extendedCategories,
  easterEggTopic,
  easterEggEnglishTopic,
} from '../src/content/extended-library.js';
import {
  parseScriptInput,
  serializeScriptDocument,
  SCRIPT_SENTENCE_TYPES,
  SCRIPT_RELATION_TYPES,
} from '../src/content/script-document.js';
import { splitGraphemes, literalGraphemeIndex } from '../src/content/text-boundaries.js';

test('the new catalog contains exactly ten categories with ten stable bilingual topics each', () => {
  assert.equal(extendedLibrary.length, 100);
  assert.equal(extendedEnglishLibrary.length, 100);
  assert.equal(extendedCategories.length, 10);
  for (const library of [extendedLibrary, extendedEnglishLibrary]) {
    assert.equal(new Set(library.map((topic) => topic.id)).size, 100);
    assert.equal(new Set(library.map((topic) => topic.title)).size, 100);
    for (const category of extendedCategories)
      assert.equal(library.filter((topic) => topic.categoryId === category.id).length, 10);
    assert.ok(library.every((topic) => /^extended-[a-z]+-\d{2}$/.test(topic.id)));
    assert.ok(library.every((topic) => topic.id !== 'easter-egg'));
  }
  assert.deepEqual(
    extendedEnglishLibrary.map((topic) => topic.id),
    extendedLibrary.map((topic) => topic.id),
  );
});

for (const [language, library] of [
  ['zh', extendedLibrary],
  ['en', extendedEnglishLibrary],
]) {
  test(`all ${language} topics survive real JSON export/import with visible primary and auxiliary concepts`, () => {
    const texts = new Set();
    for (const topic of library) {
      assert.equal(topic.lines.length, 4, topic.id);
      const document = serializeScriptDocument(topic);
      const restored = parseScriptInput(JSON.stringify(document));
      assert.deepEqual(serializeScriptDocument(restored), document, topic.id);
      assert.deepEqual(restored.relations, topic.relations, `${topic.id}: serialized edge order and meaning`);
      const known = new Set(topic.lines.flatMap((line) => line.keywords.map((entry) => entry.text)));
      for (const [index, line] of topic.lines.entries()) {
        const description = `${topic.id}, line ${index + 1}`;
        const length = splitGraphemes(line.text).length;
        assert.ok(length >= 8 && length <= 60, `${description}: ${length} graphemes`);
        assert.ok(SCRIPT_SENTENCE_TYPES.includes(line.sentenceType), description);
        assert.ok(
          Number.isInteger(line.holdBeats) && line.holdBeats >= 8 && line.holdBeats <= 16,
          description,
        );
        assert.equal(line.keywords.filter((entry) => entry.role === 'primary').length, 1, description);
        assert.ok(
          line.keywords.some((entry) => entry.role === 'secondary'),
          description,
        );
        assert.equal(line.keywords.find((entry) => entry.role === 'primary').text, line.keyword, description);
        assert.equal(
          new Set(line.keywords.map((entry) => entry.text)).size,
          line.keywords.length,
          description,
        );
        for (const entry of line.keywords) {
          assert.ok(entry.text && splitGraphemes(entry.text).length <= 12, description);
          assert.ok(literalGraphemeIndex(line.text, entry.text) >= 0, `${description}: ${entry.text}`);
          if (entry.relation) {
            assert.equal(entry.relation.to, entry.text, description);
            assert.ok(known.has(entry.relation.from) && known.has(entry.relation.to), description);
            assert.ok(SCRIPT_RELATION_TYPES.includes(entry.relation.type), description);
            assert.ok(entry.relation.label.trim(), description);
          }
        }
        if (language === 'en') {
          assert.ok(!/\p{Script=Han}/u.test(line.text), description);
          for (const entry of line.keywords)
            assert.ok(!/\p{Script=Han}/u.test(entry.relation?.label ?? ''), description);
        }
        texts.add(line.text);
      }
    }
    assert.ok(texts.size >= 390, 'the 400 sentences must not collapse into repeated boilerplate');
  });
}

test('bilingual concepts retain direction, role, sentence type, line identity and timing', () => {
  extendedLibrary.forEach((source, index) => {
    const english = extendedEnglishLibrary[index];
    assert.notEqual(source.title, english.title, source.id);
    const terms = new Map();
    source.lines.forEach((line, position) => {
      const target = english.lines[position];
      assert.equal(target.id, line.id);
      assert.equal(target.holdBeats, line.holdBeats);
      assert.equal(target.sentenceType, line.sentenceType);
      assert.equal(target.keywords.length, line.keywords.length);
      line.keywords.forEach((entry, termIndex) => {
        const translated = target.keywords[termIndex];
        assert.equal(translated.role, entry.role);
        if (terms.has(entry.text))
          assert.equal(
            translated.text,
            terms.get(entry.text),
            `${source.id}: consistent translation of ${entry.text}`,
          );
        terms.set(entry.text, translated.text);
      });
    });
    assert.equal(english.relations.length, source.relations.length, source.id);
    source.relations.forEach((edge, position) => {
      const translated = english.relations[position];
      assert.equal(translated.from, terms.get(edge.from), source.id);
      assert.equal(translated.to, terms.get(edge.to), source.id);
      assert.equal(translated.type, edge.type, source.id);
    });
  });
});

test('the user-requested Easter egg is separate from the 100 four-line topics and stays literal', () => {
  assert.equal(easterEggTopic.id, 'easter-egg');
  assert.equal(easterEggEnglishTopic.id, easterEggTopic.id);
  assert.equal(easterEggTopic.title, '彩蛋');
  assert.equal(easterEggEnglishTopic.title, 'Easter egg');
  for (const topic of [easterEggTopic, easterEggEnglishTopic]) {
    assert.equal(topic.lines.length, 1);
    assert.equal(topic.lines[0].text, '你怎么找到这里的');
    assert.equal(topic.lines[0].holdBeats, 8);
    assert.equal(topic.lines[0].keywords.length, 1);
    assert.equal(topic.lines[0].keywords[0].role, 'primary');
    assert.equal(parseScriptInput(serializeScriptDocument(topic)).lines[0].text, '你怎么找到这里的');
  }
  assert.notEqual(easterEggEnglishTopic.lines[0], easterEggTopic.lines[0]);
});
