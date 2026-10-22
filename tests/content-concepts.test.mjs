import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleLibrary } from '../src/content/sample-library.js';
import { parseTextScript } from '../src/content/text-script.js';
import { chooseLocalConcepts } from '../src/content/concept-graph.js';
import { findKnowledgeMarkers } from '../src/visuals/knowledge-director.js';
import { formatEditableScript, restoreCustomScript } from '../src/core/local-state.js';
import { AppController } from '../src/app/app-controller.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (text) => [...segmenter.segment(text)].map((entry) => entry.segment);

test('every curated line has several literal concepts with exact display ranges', () => {
  let conceptCount = 0;
  for (const topic of sampleLibrary) {
    const knownTerms = new Set();
    for (const line of topic.lines) {
      assert.ok(line.text.includes(line.keyword), line.id);
      assert.ok(line.keywords.length >= 3, `${line.id} needs multiple concepts`);
      const glyphs = graphemes(line.text);
      const markers = findKnowledgeMarkers(line);
      for (const concept of line.keywords) {
        conceptCount++;
        knownTerms.add(concept.text);
        assert.ok(line.text.includes(concept.text), `${line.id}: ${concept.text}`);
        assert.ok(markers.some((marker) => marker.text === concept.text));
      }
      for (const marker of markers) {
        assert.equal(glyphs.slice(marker.start, marker.end).join(''), marker.text);
        assert.ok(marker.start >= 0 && marker.end <= glyphs.length);
      }
    }
    for (const relation of topic.relations) {
      assert.ok(knownTerms.has(relation.from), `${topic.id}: missing source ${relation.from}`);
      assert.ok(knownTerms.has(relation.to), `${topic.id}: missing destination ${relation.to}`);
    }
  }
  assert.ok(conceptCount >= sampleLibrary.flatMap((topic) => topic.lines).length * 3);
});

test('curated within-line relations refer to literal source/destination concepts and carry useful labels', () => {
  for (const topic of sampleLibrary) {
    for (const line of topic.lines) {
      const terms = new Set(line.keywords.map((entry) => entry.text));
      for (const concept of line.keywords) {
        if (!concept.relation) continue;
        const relation = concept.relation;
        assert.equal(relation.to, concept.text);
        assert.ok(terms.has(relation.from), `${line.id}: ${relation.from}`);
        assert.ok(line.text.includes(relation.from) && line.text.includes(relation.to));
        assert.ok(typeof relation.type === 'string' && relation.type.length > 0);
        assert.ok(typeof relation.label === 'string' && relation.label.length > 0);
      }
    }
  }
});

test('explicit multiple concepts survive editing and disk roundtrip with their original text', () => {
  const text = '节拍、速度、感觉｜节拍提供参照，速度影响感觉。\n注意力、目标｜目标给注意力一个落点。';
  const original = parseTextScript(text, '我的多概念笔记');
  assert.deepEqual(
    original.lines[0].keywords.map((entry) => entry.text),
    ['节拍', '速度', '感觉'],
  );
  assert.deepEqual(
    original.lines[1].keywords.map((entry) => entry.text),
    ['目标', '注意力'],
  );
  const edited = parseTextScript(formatEditableScript(original), original.title);
  assert.deepEqual(edited.lines, original.lines);
  const restored = restoreCustomScript(JSON.parse(JSON.stringify(original)));
  assert.equal(restored.title, original.title);
  assert.deepEqual(restored.lines, original.lines);
  assert.equal(restored.lines[0].text, '节拍提供参照，速度影响感觉。');
});

test('missing extra concepts are rejected instead of inventing their explanation', () => {
  assert.throws(() => parseTextScript('节拍、旋律｜节拍提供时间参照。'), /额外关键词/);
  const malformed = {
    title: '坏数据',
    lines: [{ keyword: '节拍', text: '节拍提供时间参照。', keywords: [{ text: '旋律' }] }],
  };
  assert.equal(restoreCustomScript(malformed), null);
});

test('automatic local selection only adds literal text and neutral associations', () => {
  const text = '复利把新增利息计入下一期的基数。';
  const concepts = chooseLocalConcepts(text, '复利');
  assert.ok(concepts.length >= 2);
  concepts.forEach((concept, index) => {
    assert.ok(text.includes(concept.text));
    if (!index) return;
    assert.equal(concept.relation.from, concepts[index - 1].text);
    assert.equal(concept.relation.to, concept.text);
    assert.equal(concept.relation.type, 'related');
  });
});

test('emoji skin tones and ZWJ families remain whole graphemes in concept ranges and roundtrip', () => {
  const family = '👨‍👩‍👧‍👦',
    developer = '🧑🏽‍💻';
  const original = parseTextScript(
    `${family}、${developer}｜${family} 表示家庭，${developer} 表示工作。`,
    'emoji 笔记',
  );
  const line = original.lines[0];
  const markers = findKnowledgeMarkers(line);
  for (const word of [family, developer]) {
    const marker = markers.find((entry) => entry.text === word);
    assert.equal(marker.end - marker.start, 1);
    assert.equal(graphemes(line.text).slice(marker.start, marker.end).join(''), word);
  }
  assert.deepEqual(parseTextScript(formatEditableScript(original), original.title).lines, original.lines);
});

test('keyword length limits count user-visible graphemes rather than emoji code points', () => {
  const family = '👨‍👩‍👧‍👦';
  const twoFamilies = family.repeat(2);
  const script = parseTextScript(`${twoFamilies}｜${twoFamilies} 表示两个家庭。`);
  const marker = findKnowledgeMarkers(script.lines[0]).find((entry) => entry.text === twoFamilies);
  assert.equal(marker.end - marker.start, 2);
  const maximum = family.repeat(12);
  assert.equal(parseTextScript(`${maximum}｜${maximum}`).lines[0].keyword, maximum);
  assert.throws(() => parseTextScript(`${family.repeat(13)}｜${family.repeat(13)}`), /关键词/);
});

function relationHarness(word, relations = []) {
  const calls = [];
  return {
    calls,
    bus: { emit() {} },
    activeTopic: { relations },
    keywordCount: 0,
    ui: { setKeyword() {} },
    dance: {
      word,
      setWord(keyword, relation) {
        calls.push({ keyword, relation });
        this.word = keyword;
      },
    },
  };
}

test('repeated concepts keep the actual displayed old/new relationship instead of stale authored source', () => {
  const app = relationHarness('下一轮');
  AppController.prototype.onKeyword.call(
    app,
    '110',
    { from: '100', to: '110', type: 'progress', label: '增长后的基数' },
    0.55,
  );
  assert.equal(app.calls[0].relation.from, '下一轮');
  assert.equal(app.calls[0].relation.to, '110');
  assert.equal(app.calls[0].relation.type, 'related');
  assert.notEqual(app.calls[0].relation.label, '增长后的基数');
});

test('an actual curated edge is reused when an outdated marker points to another source', () => {
  const edge = { from: '频率', to: '振幅', type: 'effect', label: '接近固有频率时增强' };
  const app = relationHarness('频率', [edge]);
  AppController.prototype.onKeyword.call(
    app,
    '振幅',
    { from: '共振', to: '振幅', type: 'related', label: '旧关联' },
    0.55,
  );
  assert.equal(app.calls[0].relation.from, '频率');
  assert.equal(app.calls[0].relation.to, '振幅');
  assert.equal(app.calls[0].relation.label, edge.label);
  assert.equal(app.calls[0].relation.type, 'cause');
});
