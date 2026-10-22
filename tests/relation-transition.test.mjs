import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRelationTransition,
  retargetRelationTransition,
  sampleRelationTransition,
  RELATION_SYMBOLS,
} from '../src/visuals/relation-transition.js';
import { createMotionCommand, sampleMotion, constrainMotion } from '../src/visuals/dance-motion.js';

const layout = (word, size = 100) =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)].map((entry, index, all) => ({
    char: entry.segment,
    x: (index - (all.length - 1) / 2) * 0.1,
    y: 0,
    size,
  }));
const build = (type, from = '条件', to = '结果') =>
  buildRelationTransition(layout(from), layout(to), { from, to, type, label: '关系说明' });

test('shared characters remain continuously visible while new characters join an expansion', () => {
  const transition = build('expand', '增长', '增长率');
  const shared = transition.records.filter((entry) => entry.shared);
  assert.equal(shared.length, 2);
  for (let step = 0; step <= 50; step++) {
    const sample = sampleRelationTransition(transition, step / 50);
    for (const char of ['增', '长']) {
      const glyph = sample.glyphs.find((entry) => entry.char === char && entry.role === 'shared');
      assert.equal(glyph.alpha, 1);
      assert.ok(Number.isFinite(glyph.x) && Number.isFinite(glyph.y));
    }
  }
  const start = sampleRelationTransition(transition, 0).glyphs.filter((glyph) => glyph.alpha > 0.99);
  const end = sampleRelationTransition(transition, 1).glyphs.filter((glyph) => glyph.alpha > 0.99);
  assert.equal(start.map((glyph) => glyph.char).join(''), '增长');
  assert.equal(end.map((glyph) => glyph.char).join(''), '增长率');
  for (const [index, glyph] of end.entries()) assert.equal(glyph.x, transition.targets[index].x);
});

test('replacement letters use separate moving old/new hand-off paths instead of stationary crossfade', () => {
  const transition = build('cause');
  const middle = sampleRelationTransition(transition, 0.43);
  const oldGlyph = middle.glyphs.find((glyph) => glyph.role === 'old');
  const newGlyph = middle.glyphs.find(
    (glyph) => glyph.role === 'new' && glyph.recordIndex === oldGlyph.recordIndex,
  );
  assert.ok(oldGlyph.alpha > 0.2 && newGlyph.alpha > 0.2);
  const source = transition.records[oldGlyph.recordIndex].source;
  assert.ok(Math.abs(oldGlyph.x - source.x) + Math.abs(oldGlyph.y - source.y) > 0.015);
  assert.ok(Math.abs(oldGlyph.x - newGlyph.x) + Math.abs(oldGlyph.y - newGlyph.y) > 0.01);
  assert.equal(
    sampleRelationTransition(transition, 0)
      .glyphs.filter((glyph) => glyph.alpha > 0.99)
      .map((glyph) => glyph.char)
      .join(''),
    '条件',
  );
  assert.equal(
    sampleRelationTransition(transition, 1)
      .glyphs.filter((glyph) => glyph.alpha > 0.99)
      .map((glyph) => glyph.char)
      .join(''),
    '结果',
  );
});

test('five semantic relations have distinct geometry and retained semantic metadata', () => {
  const kinds = ['expand', 'combine', 'cause', 'contrast', 'progress'];
  const signatures = kinds.map((kind) => {
    const transition = build(kind);
    assert.equal(transition.kind, kind);
    assert.equal(transition.from, '条件');
    assert.equal(transition.to, '结果');
    assert.equal(transition.label, '关系说明');
    assert.equal(transition.symbol, RELATION_SYMBOLS[kind]);
    return JSON.stringify(sampleRelationTransition(transition, 0.42).glyphs.map(({ x, y }) => ({ x, y })));
  });
  assert.equal(new Set(signatures).size, kinds.length);
  assert.equal(new Set(kinds.map((kind) => RELATION_SYMBOLS[kind])).size, kinds.length);
});

test('contrast takes opposing spatial lanes while combine converges on a shared hub', () => {
  const contrasted = sampleRelationTransition(build('contrast'), 0.43).glyphs;
  assert.ok(contrasted.filter((glyph) => glyph.role === 'old').every((glyph) => glyph.y < 0));
  assert.ok(contrasted.filter((glyph) => glyph.role === 'new').every((glyph) => glyph.y > 0));
  const combined = build('combine');
  for (const record of combined.records) assert.deepEqual(record.oldHub, record.newHub);
  const gathered = sampleRelationTransition(combined, 0.65).glyphs.filter((glyph) => glyph.role === 'old');
  assert.ok(gathered.every((glyph) => Math.abs(glyph.x) < 1e-12));
});

test('handoff geometry and opacity remain continuous, and reduced motion removes deep arcs', () => {
  for (const kind of ['expand', 'combine', 'cause', 'contrast', 'progress']) {
    const transition = build(kind);
    for (let step = 1; step < 99; step++) {
      const phase = step / 100;
      const a = sampleRelationTransition(transition, phase).glyphs;
      const b = sampleRelationTransition(transition, phase + 0.0001).glyphs;
      a.forEach((glyph, index) => {
        assert.ok(Math.abs(glyph.x - b[index].x) < 0.001);
        assert.ok(Math.abs(glyph.y - b[index].y) < 0.001);
        assert.ok(Math.abs(glyph.alpha - b[index].alpha) < 0.001);
      });
    }
    const reduced = sampleRelationTransition(transition, 0.43, { reducedMotion: true }).glyphs;
    assert.ok(reduced.every((glyph) => glyph.y === 0 && glyph.rotation === 0));
  }
});

test('multiword handoff remains bounded alongside exaggerated music choreography', () => {
  const width = 1100,
    height = 380;
  const command = createMotionCommand(
    { energy: 1, amplitude: 0.3, attack: 1, strength: 1, frequencyHz: 8000, brightness: 0.9, noisiness: 0.8 },
    1,
    { primary: 'spiral', secondary: 'scatter', trend: 0 },
  );
  for (const kind of ['expand', 'combine', 'cause', 'contrast', 'progress']) {
    const transition = build(kind, '共同字符', '字符之间的联系');
    for (let step = 0; step <= 30; step++) {
      const glyphs = sampleRelationTransition(transition, step / 30).glyphs;
      const boxes = glyphs.map((glyph) => ({
        x: glyph.x * width,
        y: glyph.y * height,
        width: glyph.size,
        height: glyph.size * 1.5,
        visible: glyph.alpha > 0.01,
      }));
      const motion = sampleMotion(command, 0.35, {
        glyphCount: glyphs.length,
        glyphOrders: glyphs.map((glyph) => glyph.order),
        intensity: 2.5,
      });
      const fitted = constrainMotion(motion, boxes, { width, height });
      assert.ok(fitted.bounds.left >= 0 && fitted.bounds.right <= width);
      assert.ok(fitted.bounds.top >= 0 && fitted.bounds.bottom <= height * 0.88 + 1e-8);
    }
  }
});

test('refitting target metrics retains shared characters, retiring glyphs and the original deadline', () => {
  for (const kind of ['expand', 'combine', 'cause', 'contrast', 'progress']) {
    const original = buildRelationTransition(
      layout('旧连接'),
      layout('连接理解'),
      { from: '旧连接', to: '连接理解', type: kind },
      { started: 7, duration: 0.425 },
    );
    const originalSnapshot = structuredClone(original);
    const targets = layout('连接理解', 48).map((glyph) => ({ ...glyph, x: glyph.x * 0.8 }));
    const refitted = retargetRelationTransition(original, targets);
    assert.equal(refitted.started, original.started);
    assert.equal(refitted.duration, original.duration);
    assert.equal(refitted.from, original.from);
    assert.equal(refitted.to, original.to);
    const halfway = sampleRelationTransition(refitted, 0.45);
    for (const char of ['连', '接']) {
      const shared = halfway.glyphs.find((glyph) => glyph.char === char && glyph.role === 'shared');
      assert.equal(shared.alpha, 1);
    }
    const end = sampleRelationTransition(refitted, 1).glyphs.filter((glyph) => glyph.alpha === 1);
    assert.equal(end.map(({ char }) => char).join(''), '连接理解');
    assert.deepEqual(
      end.map(({ x, y, size }) => ({ x, y, size })),
      targets.map(({ x, y, size }) => ({ x, y, size })),
    );
    assert.ok(!end.some(({ char }) => char === '旧'));
    assert.deepEqual(original, originalSnapshot, 'Refitting cannot mutate the source choreography');
  }
});
