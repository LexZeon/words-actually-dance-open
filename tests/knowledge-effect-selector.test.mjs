import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS } from '../src/visuals/effect-catalog.js';
import { directKnowledgeScene } from '../src/visuals/knowledge-director.js';
import { AUTOMATIC_EFFECT_ORDER, selectKnowledgeEffect } from '../src/visuals/knowledge-effect-selector.js';

const shortLine = { text: '连接文字与节拍。', keyword: '连接' };
const sequence = (line, length, sceneFor = (index) => directKnowledgeScene({ line, index })) => {
  const result = [];
  for (let index = 0; index < length; index++) {
    result.push(
      selectKnowledgeEffect({
        scene: sceneFor(index),
        line,
        index,
        lineCount: length,
        previousEffect: result.at(-1),
      }),
    );
  }
  return result;
};

test('ordinary automatic playback covers every implemented mode including both planar effects', () => {
  const ids = EFFECTS.filter(({ implemented }) => implemented)
    .map(({ id }) => id)
    .sort();
  assert.equal(ids.length, 22);
  assert.equal(AUTOMATIC_EFFECT_ORDER.length, ids.length);
  assert.deepEqual([...AUTOMATIC_EFFECT_ORDER].sort(), ids);
  const result = sequence(shortLine, 44);
  assert.deepEqual([...new Set(result)].sort(), ids);
  assert.deepEqual([...new Set(result.slice(1, 23))].sort(), ids);
  assert.ok(result.includes('waterfall-flow'));
  assert.ok(result.includes('quarter-turn'));
  assert.ok(result.every((id, index) => index === 0 || id !== result[index - 1]));
});

test('each complete short-text rotation covers the catalog while later rotations change the order', () => {
  const result = sequence(shortLine, 67);
  const expected = [...AUTOMATIC_EFFECT_ORDER].sort();
  for (const start of [1, 23, 45]) assert.deepEqual([...result.slice(start, start + 22)].sort(), expected);
  assert.notDeepEqual(result.slice(1, 23), result.slice(23, 45));
});

test('first sentence retains the scene opening, and first rotation begins with the new flow mode', () => {
  for (const scene of [
    { layout: 'ink', effect: 'tunnel' },
    { layout: 'definition', effect: 'marker' },
    { layout: 'contrast', effect: 'slide' },
  ])
    assert.equal(selectKnowledgeEffect({ scene, line: shortLine, index: 0 }), scene.effect);
  assert.equal(
    selectKnowledgeEffect({ line: shortLine, index: 1, previousEffect: 'tunnel' }),
    'waterfall-flow',
  );
});

test('identical inputs give identical choices without rewriting content or depending on lineCount', () => {
  const line = { ...shortLine, keywords: [{ text: '连接', role: 'primary' }] };
  const scene = directKnowledgeScene({ line, index: 7 });
  const before = JSON.stringify({ line, scene });
  const input = { line, scene, index: 7, lineCount: 10, previousEffect: 'marker' };
  const chosen = selectKnowledgeEffect(input);
  for (let trial = 0; trial < 20; trial++) assert.equal(selectKnowledgeEffect(input), chosen);
  assert.equal(selectKnowledgeEffect({ ...input, lineCount: 30 }), chosen);
  assert.equal(JSON.stringify({ line, scene }), before);
});

test('a supplied previous mode cannot be chosen again, including at the first sentence', () => {
  for (let index = 0; index < 44; index++) {
    const scene = directKnowledgeScene({ line: shortLine, index });
    const id = selectKnowledgeEffect({ scene, line: shortLine, index });
    const next = selectKnowledgeEffect({ scene, line: shortLine, index, previousEffect: id });
    assert.notEqual(next, id);
    assert.ok(AUTOMATIC_EFFECT_ORDER.includes(next));
  }
});

test('very long reading never chooses pop, flash or barrage and still varies', () => {
  const line = { text: '理解连续呈现的知识内容需要清楚的阅读节奏。'.repeat(5), keyword: '阅读节奏' };
  const result = sequence(line, 60);
  assert.ok(result.every((id) => !['pop', 'flash', 'barrage'].includes(id)));
  assert.ok(new Set(result).size >= 10);
  assert.ok(result.every((id, index) => index === 0 || id !== result[index - 1]));
});

test('explicit sentence structure keeps its primary effect and uses compatible alternatives to avoid repeats', () => {
  for (const sentenceType of ['opening', 'definition', 'contrast', 'steps', 'fact', 'example', 'summary']) {
    const line = { ...shortLine, sentenceType };
    const scene = directKnowledgeScene({ line, index: 8 });
    assert.equal(selectKnowledgeEffect({ scene, line, index: 8 }), scene.effect);
    const alternate = selectKnowledgeEffect({ scene, line, index: 8, previousEffect: scene.effect });
    assert.notEqual(alternate, scene.effect);
    assert.ok(!['waterfall-flow', 'quarter-turn', 'barrage'].includes(alternate));
  }
});

test('grapheme length handles combined emoji correctly and malformed optional metadata stays deterministic', () => {
  const emojiLine = { text: '👩‍💻'.repeat(10) };
  const popIndex = AUTOMATIC_EFFECT_ORDER.indexOf('pop') + 1;
  assert.equal(selectKnowledgeEffect({ line: emojiLine, index: popIndex }), 'pop');
  const nullInput = { scene: null, line: null, index: Number.NaN, previousEffect: 'tunnel' };
  assert.equal(selectKnowledgeEffect(nullInput), selectKnowledgeEffect(nullInput));
  assert.ok(AUTOMATIC_EFFECT_ORDER.includes(selectKnowledgeEffect(nullInput)));
});
