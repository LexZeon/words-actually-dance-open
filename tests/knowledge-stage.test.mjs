import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeStage } from '../src/visuals/knowledge-stage.js';
import { EFFECTS as KNOWLEDGE_EFFECTS } from '../src/visuals/effect-catalog.js';

// Minimal DOM surface for state/event tests; actual typography is verified in Electron.
class Element {
  constructor(document) {
    this.ownerDocument = document;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.content = '';
    this.clientHeight = 200;
    this.clientWidth = 900;
    this.offsetWidth = 900;
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    const tokens = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => {
        const set = tokens();
        names.forEach((name) => set.add(name));
        this.className = [...set].join(' ');
      },
      remove: (...names) => {
        const set = tokens();
        names.forEach((name) => set.delete(name));
        this.className = [...set].join(' ');
      },
      contains: (name) => tokens().has(name),
      toggle: (name, force) => {
        const enabled = force ?? !tokens().has(name);
        this.classList[enabled ? 'add' : 'remove'](name);
        return enabled;
      },
    };
  }
  set textContent(value) {
    this.content = String(value);
    this.replaceChildren();
  }
  get textContent() {
    return this.content + this.children.map((child) => child.textContent).join('');
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      this.children.push(node);
      node.parent = this;
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  querySelectorAll(selector) {
    const names = selector.split(',').map((part) => part.trim().slice(1));
    const result = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (names.some((name) => child.classList.contains(name))) result.push(child);
        walk(child);
      }
    };
    walk(this);
    return result;
  }
}
function host() {
  const document = { createElement: () => new Element(document) };
  return new Element(document);
}
function tick(stage, beat, subdivision = 0, features = { silent: 1 }) {
  stage.onTick(
    {
      kind: subdivision === 0 ? 'beat' : 'subdivision',
      beatIndex: beat,
      subdivisionIndex: subdivision,
      bpm: 108,
      source: 'internal',
    },
    features,
  );
}
function advance(stage, from, to) {
  for (let beat = from; beat < to; beat++)
    for (let subdivision = 0; subdivision < 4; subdivision++) tick(stage, beat, subdivision);
}

function advanceWithFrames(stage, from, to) {
  for (let beat = from; beat < to; beat++)
    for (let subdivision = 0; subdivision < 4; subdivision++) {
      tick(stage, beat, subdivision);
      stage.frame({ beatIndex: beat, phase: subdivision / 4 });
    }
}

function worldPose(node) {
  const { id, width, height, fontPx, centerX, centerY, angleDeg } = node;
  return { id, width, height, fontPx, centerX, centerY, angleDeg };
}

test('default automatic playback changes effects between unmarked short sentences and reaches every implemented mode', () => {
  const entered = [];
  const stage = new KnowledgeStage(host(), {
    onLine(index) {
      entered.push({ index, effect: stage.getState().effect, autoDirection: stage.autoDirection });
    },
  });
  stage.setRate(4);
  stage.setScript({
    lines: Array.from({ length: 30 }, (_, index) => ({
      text: `第${index}句观察变化。`,
      keyword: '观察',
      holdBeats: 1,
    })),
  });
  advanceWithFrames(stage, 0, 250);
  assert.equal(stage.getState().finished, true);
  assert.equal(entered.length, 30);
  assert.ok(entered.every(({ autoDirection }) => autoDirection));
  assert.ok(entered.every(({ effect }, index) => index === 0 || effect !== entered[index - 1].effect));
  assert.deepEqual(
    [...new Set(entered.map(({ effect }) => effect))].sort(),
    KNOWLEDGE_EFFECTS.map(({ id }) => id).sort(),
    'Automatic short-text playback must include both planar effects and all existing knowledge effects',
  );
  assert.equal(stage.current.track.textContent, '第29句观察变化。');
});

test('manual playback retains the selected effect for every sentence while the automatic switch remains disabled', () => {
  const entered = [];
  const stage = new KnowledgeStage(host(), { onLine: () => entered.push(stage.effect) });
  stage.setAutoDirection(false);
  stage.setEffect('echo');
  stage.setRate(4);
  stage.setScript({
    lines: Array.from({ length: 10 }, (_, index) => ({
      text: `手选第${index}句。`,
      keyword: '手选',
      holdBeats: 1,
    })),
  });
  advanceWithFrames(stage, 0, 90);
  assert.equal(stage.getState().finished, true);
  assert.equal(entered.length, 10);
  assert.ok(entered.every((effect) => effect === 'echo'));
  assert.equal(stage.getState().autoDirection, false);
  assert.equal(stage.getState().effect, 'echo');
});

test('consecutive explicit definitions vary their effect while preserving directed roles and stable same-line refreshes', () => {
  const entered = [];
  const seen = [];
  const stage = new KnowledgeStage(host(), {
    onLine() {
      const state = stage.getState();
      entered.push({
        effect: state.effect,
        presentation: state.presentation,
        layout: state.layout,
        emphasis: state.emphasis.map(({ text, role, variant }) => ({ text, role, variant })),
      });
    },
    onKeyword: (keyword) => seen.push(keyword),
  });
  stage.setRate(4);
  stage.setScript({
    lines: [
      {
        text: '连接是信息形成理解的方式。',
        keyword: '连接',
        sentenceType: 'definition',
        keywords: [
          { text: '连接', role: 'primary' },
          { text: '信息', role: 'secondary' },
        ],
        holdBeats: 1,
      },
      {
        text: '记忆是线索逐步进入长期保存的结果。',
        keyword: '记忆',
        sentenceType: 'definition',
        keywords: [
          { text: '记忆', role: 'primary' },
          { text: '线索', role: 'secondary' },
        ],
        holdBeats: 1,
      },
    ],
  });
  advanceWithFrames(stage, 0, 20);
  assert.equal(stage.getState().finished, true);
  assert.equal(entered.length, 2);
  assert.notEqual(entered[0].effect, entered[1].effect);
  assert.ok(entered.every(({ presentation, layout }) => presentation === 'scene' && layout === 'definition'));
  assert.deepEqual(
    entered.map(({ emphasis }) => emphasis),
    [
      [
        { text: '连接', role: 'primary', variant: 'ring' },
        { text: '信息', role: 'secondary', variant: 'underline' },
      ],
      [
        { text: '记忆', role: 'primary', variant: 'ring' },
        { text: '线索', role: 'secondary', variant: 'underline' },
      ],
    ],
  );
  assert.deepEqual(seen, ['连接', '信息', '记忆', '线索']);
  const selected = stage.effect;
  const current = stage.current;
  const glyphs = current.chars.map(({ el }) => el);
  const autoEffectIndex = stage.getState().autoEffectIndex;
  const roles = stage.getState().emphasis.map(({ text, role, variant }) => ({ text, role, variant }));
  for (let count = 0; count < 3; count++)
    stage.applyDirection(stage.lines[stage.lineIndex], { refresh: true });
  assert.equal(
    stage.effect,
    selected,
    'Refreshing the current definition cannot reselect its already-used preceding effect',
  );
  assert.equal(stage.getState().presentation, 'scene');
  assert.equal(stage.getState().layout, 'definition');
  assert.equal(stage.getState().autoEffectIndex, autoEffectIndex);
  assert.equal(stage.current, current);
  assert.deepEqual(
    stage.current.chars.map(({ el }) => el),
    glyphs,
  );
  assert.deepEqual(
    stage.getState().emphasis.map(({ text, role, variant }) => ({ text, role, variant })),
    roles,
  );
  assert.deepEqual(
    seen,
    ['连接', '信息', '记忆', '线索'],
    'Same-line refresh cannot repeat keyword callbacks',
  );
});

test('automatic flow hands its original history nodes back to a legacy effect before the next sentence types', () => {
  const stage = new KnowledgeStage(host());
  stage.setRate(4);
  stage.setScript({
    lines: Array.from({ length: 26 }, (_, index) => ({
      text: `第${index}句文字保持完整。`,
      keyword: '文字',
      holdBeats: 1,
    })),
  });
  let found = false;
  for (let beat = 0; beat < 200 && !found; beat++)
    for (let sub = 0; sub < 4 && !found; sub++) {
      tick(stage, beat, sub);
      stage.frame({ beatIndex: beat, phase: sub / 4 });
      found = stage.effect === 'waterfall-flow' && stage.cursor === stage.current.chars.length;
    }
  assert.equal(found, true, 'The default sequence must actually mount the flow renderer');
  const retired = stage.current.el;
  const originalGlyphs = stage.current.chars.map(({ el }) => el);
  const literalText = stage.current.track.textContent;
  const plane = stage.textFlow.plane;
  const nextBeat = Math.floor(stage.lastTick / 4) + 1;
  tick(stage, nextBeat);
  stage.frame({ beatIndex: nextBeat, phase: 0 });
  assert.equal(stage.autoDirection, true);
  assert.ok(!['waterfall-flow', 'quarter-turn'].includes(stage.effect));
  assert.equal(stage.history[0], retired);
  assert.equal(retired.children[0].textContent, literalText);
  assert.ok(originalGlyphs.every((glyph) => retired.querySelectorAll('.char').includes(glyph)));
  assert.equal(stage.textFlow.plane, null);
  assert.equal(stage.textFlow.entries.size, 0);
  assert.equal(plane.parent, null);
  assert.equal(retired.parent, stage.el);
  assert.equal(retired.dataset.flowId, undefined);
  assert.equal(retired.attributes['aria-hidden'], 'true');
  assert.equal(stage.current.el.parent, stage.el);
  assert.equal(stage.cursor, 1, 'The next ordinary effect must not inherit the flow typing delay');
  assert.equal(stage.revealAfterTick, null);
  assert.notEqual(stage.current.el, retired);
  assert.equal(stage.current.el.attributes['aria-label'], stage.lines[stage.lineIndex].text);
});

test('paused automatic and manual settings apply at the next valid tick without replacing the current text', () => {
  const stage = new KnowledgeStage(host());
  stage.setRate(4);
  stage.setScript({ lines: [{ text: '文字在暂停与恢复时保持完整👩‍💻。', keyword: '文字', holdBeats: 32 }] });
  tick(stage, 0);
  const original = stage.current;
  const glyphs = original.chars.map(({ el }) => el);
  const automaticEffect = stage.effect;
  stage.setPaused(true);
  stage.setAutoDirection(false);
  stage.setEffect('waterfall-flow');
  tick(stage, 0, 1);
  stage.frame({ beatIndex: 100, phase: 0.9 });
  assert.equal(stage.effect, automaticEffect);
  assert.equal(stage.el.dataset.autoDirection, 'true');
  assert.equal(stage.textFlow.plane, null);
  assert.equal(stage.cursor, 1);
  stage.setPaused(false);
  tick(stage, 0, 1);
  assert.equal(stage.effect, 'waterfall-flow');
  assert.equal(stage.autoDirection, false);
  assert.equal(stage.current, original);
  assert.deepEqual(
    stage.current.chars.map(({ el }) => el),
    glyphs,
  );
  const plane = stage.textFlow.plane;
  assert.ok(plane);
  stage.setPaused(true);
  stage.setAutoDirection(true);
  tick(stage, 0, 2);
  assert.equal(stage.autoDirection, false);
  assert.equal(stage.textFlow.plane, plane);
  stage.setPaused(false);
  tick(stage, 0, 2);
  assert.equal(stage.autoDirection, true);
  assert.equal(stage.effect, automaticEffect);
  assert.equal(stage.textFlow.plane, null);
  assert.equal(plane.parent, null);
  assert.equal(stage.current, original);
  assert.deepEqual(
    stage.current.chars.map(({ el }) => el),
    glyphs,
  );
});

test('waterfall flow moves one shared camera while sentences retain their world poses and original glyphs', () => {
  const stage = new KnowledgeStage(host());
  stage.setAutoDirection(false);
  stage.setEffect('waterfall-flow');
  stage.setRate(4);
  stage.setScript({
    lines: [
      { text: '先读这一句。', keyword: '一句', holdBeats: 1 },
      { text: '新句沿着旧句继续。', keyword: '新句', holdBeats: 1 },
    ],
  });
  advanceWithFrames(stage, 0, 2);
  const previous = stage.current.el;
  const originalGlyphs = stage.current.chars.map(({ el }) => el);
  const originalWorld = worldPose(stage.getState().textFlow.nodes[0]);
  const plane = stage.textFlow.plane;
  tick(stage, 2);
  assert.equal(stage.cursor, 0, 'The camera handoff must finish before the next line types');
  assert.equal(stage.history[0], previous);
  assert.equal(previous.children[0].textContent, '先读这一句。');
  assert.ok(originalGlyphs.every((glyph) => previous.querySelectorAll('.char').includes(glyph)));
  assert.equal(stage.current.el.parent, plane);
  assert.equal(previous.parent, plane);
  assert.equal(stage.el.children.length, 1, 'Current and retired text must belong to one camera plane');
  const mounted = stage.getState().textFlow;
  const worlds = mounted.nodes.map(worldPose);
  assert.deepEqual(
    worlds.find(({ id }) => id === originalWorld.id),
    originalWorld,
  );
  const oldLocalTransform = previous.style.transform;
  const cameraAtStart = plane.style.transform;
  stage.frame({ beatIndex: 2, phase: 0.5 });
  assert.equal(
    previous.style.transform,
    oldLocalTransform,
    'Camera movement must not reposition old sentences independently',
  );
  assert.notEqual(plane.style.transform, cameraAtStart);
  assert.deepEqual(stage.getState().textFlow.nodes.map(worldPose), worlds);
  tick(stage, 2, 3);
  assert.equal(stage.cursor, 0);
  stage.frame({ beatIndex: 2, phase: 0.9 });
  const settled = stage.getState().textFlow;
  assert.equal(settled.active, false);
  assert.equal(settled.sharedPlane, true);
  assert.equal(settled.source, 'internal-grid');
  const currentId = stage.textFlow.entries.get(stage.current.el);
  const currentPose = settled.nodes.find(({ id }) => id === currentId);
  const screenAngle = currentPose.angleDeg + settled.camera.angleDeg;
  assert.ok(
    Math.abs(screenAngle - Math.round(screenAngle / 360) * 360) < 1e-6,
    'The arriving sentence must settle horizontally',
  );
  tick(stage, 3);
  assert.equal(stage.cursor, 1);
  assert.equal(stage.current.track.textContent, '新句沿着旧句继续。');
});

test('waterfall flow pause and resize preserve the musical transition phase and resume from that phase', () => {
  const stage = new KnowledgeStage(host());
  stage.setAutoDirection(false);
  stage.setEffect('waterfall-flow');
  stage.setRate(4);
  stage.setScript({
    lines: [
      { text: '甲乙', keyword: '甲', holdBeats: 1 },
      { text: '丙丁', keyword: '丙', holdBeats: 1 },
    ],
  });
  advanceWithFrames(stage, 0, 1);
  tick(stage, 1);
  stage.frame({ beatIndex: 1, phase: 0.4 });
  stage.setPaused(true);
  const before = stage.getState().textFlow;
  const world = before.nodes.map(worldPose);
  const progress = before.progress;
  const angle = before.camera.angleDeg;
  const plane = stage.textFlow.plane;
  const frozenCamera = plane.style.transform;
  stage.frame({ beatIndex: 50, phase: 0.9 });
  tick(stage, 50);
  assert.equal(plane.style.transform, frozenCamera);
  stage.el.clientWidth = 680;
  stage.el.clientHeight = 220;
  stage.layoutCurrent();
  assert.equal(stage.getState().textFlow.active, true);
  assert.equal(stage.getState().textFlow.progress, progress);
  assert.equal(stage.getState().textFlow.camera.angleDeg, angle);
  assert.deepEqual(stage.getState().textFlow.nodes.map(worldPose), world);
  assert.equal(stage.cursor, 0);
  const resizedCamera = plane.style.transform;
  stage.frame({ beatIndex: 80, phase: 0.5 });
  assert.equal(plane.style.transform, resizedCamera);
  stage.setPaused(false);
  stage.frame({ beatIndex: 1, phase: 0.6 });
  assert.ok(stage.getState().textFlow.progress > progress);
  stage.frame({ beatIndex: 1, phase: 0.9 });
  assert.equal(stage.getState().textFlow.active, false);
  tick(stage, 2);
  assert.equal(stage.cursor, 1);
});

test('flow, quarter-turn and existing flip effects share the same text nodes and release the flow plane on exit', () => {
  const seen = [];
  const stage = new KnowledgeStage(host(), { onKeyword: (keyword) => seen.push(keyword) });
  stage.setAutoDirection(false);
  stage.setEffect('waterfall-flow');
  stage.setRate(4);
  const text = '文字👩‍💻沿节拍继续读取，不会因为切换表现而重建。';
  stage.setScript({ lines: [{ text, keyword: '文字', holdBeats: 32 }] });
  advanceWithFrames(stage, 0, 1);
  const original = stage.current;
  const glyphs = original.chars.map(({ el }) => el);
  const groups = original.groups.map(({ el }) => el);
  const plane = stage.textFlow.plane;
  const seenBefore = [...seen];
  stage.setPaused(true);
  stage.setEffect('quarter-turn');
  tick(stage, 1);
  assert.equal(stage.textFlow.plane, plane, 'A queued effect change cannot alter the paused display');
  stage.setPaused(false);
  tick(stage, 1);
  assert.equal(stage.effect, 'quarter-turn');
  assert.equal(stage.current, original);
  assert.deepEqual(
    stage.current.chars.map(({ el }) => el),
    glyphs,
  );
  assert.deepEqual(
    stage.current.groups.map(({ el }) => el),
    groups,
  );
  assert.equal(stage.getState().textFlow, null);
  assert.equal(stage.textFlow.plane, null);
  assert.equal(plane.parent, null);
  assert.equal(stage.current.el.parent, stage.el);
  assert.ok(stage.current.chars.every(({ el }) => el.textContent !== ''));
  stage.setEffect('flip');
  tick(stage, 2);
  assert.equal(stage.getState().quarterTurn, null);
  assert.equal(stage.current.el.dataset.flowId, undefined);
  assert.equal(stage.current.el.dataset.quarterAngle, undefined);
  assert.equal(stage.current.el.style.width, '');
  assert.equal(stage.current.track.textContent, text);
  assert.deepEqual(
    stage.current.chars.map(({ el }) => el),
    glyphs,
  );
  assert.deepEqual(seen, seenBefore, 'Changing text effects must not repeat already-fired keyword callbacks');
  stage.setEffect('waterfall-flow');
  tick(stage, 3);
  assert.notEqual(stage.textFlow.plane, plane);
  assert.equal(stage.current, original);
  assert.deepEqual(
    stage.current.chars.map(({ el }) => el),
    glyphs,
  );
  assert.deepEqual(
    stage.current.groups.map(({ el }) => el),
    groups,
  );
  assert.equal(stage.getState().textFlow.nodes.length, 1);
  assert.equal(stage.el.children.length, 1);
});

test('waterfall flow navigation, script replacement and destroy keep history and camera caches bounded', () => {
  const entered = [];
  const stage = new KnowledgeStage(host(), { onLine: (index) => entered.push(index) });
  stage.setAutoDirection(false);
  stage.setEffect('waterfall-flow');
  stage.setRate(4);
  stage.setScript({
    lines: Array.from({ length: 15 }, (_, index) => ({
      text: `句${index}👩‍💻`,
      keyword: `句${index}`,
      holdBeats: 1,
    })),
  });
  advanceWithFrames(stage, 0, 100);
  assert.equal(stage.getState().finished, true);
  assert.equal(stage.lineIndex, 14);
  assert.equal(stage.history.length, 4);
  assert.equal(stage.textFlow.entries.size, 5);
  assert.equal(stage.getState().textFlow.nodes.length, 5);
  assert.equal(stage.textFlow.plane.children.length, 5);
  assert.ok(stage.history.every((node) => stage.textFlow.entries.has(node)));
  const last = stage.current.el;
  stage.requestStep(-3);
  tick(stage, 100);
  assert.equal(stage.lineIndex, 11);
  assert.equal(stage.cursor, 0);
  assert.equal(stage.history[0], last);
  assert.equal(stage.getState().textFlow.nodes.length, 5);
  assert.equal(stage.textFlow.entries.size, 5);
  stage.frame({ beatIndex: 100, phase: 0.9 });
  tick(stage, 101);
  assert.equal(stage.cursor, 1);
  const oldPlane = stage.textFlow.plane;
  stage.setScript({ lines: [{ text: '新脚本👩‍💻', keyword: '脚本', holdBeats: 1 }] });
  assert.equal(stage.current, null);
  assert.equal(stage.history.length, 0);
  assert.equal(stage.textFlow.entries.size, 0);
  assert.equal(stage.textFlow.plane, null);
  assert.equal(stage.getState().textFlow, null);
  assert.equal(oldPlane.parent, null);
  assert.equal(stage.el.children.length, 0);
  tick(stage, 200);
  assert.notEqual(stage.textFlow.plane, oldPlane);
  assert.equal(stage.getState().textFlow.nodes.length, 1);
  assert.equal(stage.current.track.textContent, '新脚本👩‍💻');
  const current = stage.current;
  const enteredCount = entered.length;
  stage.destroy();
  assert.equal(stage.textFlow.entries.size, 0);
  assert.equal(stage.textFlow.plane, null);
  assert.equal(stage.getState().textFlow, null);
  assert.equal(stage.current.el.parent, stage.el);
  stage.frame({ beatIndex: 201, phase: 0.5 });
  tick(stage, 201);
  assert.equal(stage.current, current);
  assert.equal(stage.cursor, 1);
  assert.equal(entered.length, enteredCount);
});

test('quarter-turn finishes a planar 90 degree handoff before the next sentence starts typing', () => {
  const stage = new KnowledgeStage(host());
  stage.setAutoDirection(false);
  stage.setEffect('quarter-turn');
  stage.setRate(4);
  stage.setScript({
    lines: [
      { text: '先读这一句。', keyword: '这一句', holdBeats: 1 },
      { text: '再读新的句子。', keyword: '句子', holdBeats: 1 },
    ],
  });
  advance(stage, 0, 2);
  tick(stage, 2);
  assert.equal(stage.lineIndex, 1);
  assert.equal(stage.cursor, 0);
  assert.equal(stage.current.track.textContent, '再读新的句子。');
  assert.equal(stage.history[0].children[0].textContent, '先读这一句。');
  const old = stage.history[0];
  stage.frame({ beatIndex: 2, phase: 0.5 });
  const angle = Number(old.dataset.quarterAngle);
  assert.ok(angle > 0 && angle < 90);
  assert.match(old.style.transform, /rotate\(/);
  assert.doesNotMatch(old.style.transform, /rotate[XY]/);
  tick(stage, 2, 3);
  assert.equal(stage.cursor, 0);
  stage.frame({ beatIndex: 2, phase: 0.9 });
  assert.equal(Number(old.dataset.quarterAngle), 90);
  assert.equal(stage.getState().quarterTurn.active, false);
  tick(stage, 3);
  assert.equal(stage.cursor, 1);
});

test('quarter-turn pause freezes typing and pose, and selecting an existing effect releases its styles', () => {
  const stage = new KnowledgeStage(host());
  stage.setAutoDirection(false);
  stage.setEffect('quarter-turn');
  stage.setRate(4);
  stage.setScript({
    lines: [
      { text: '甲乙', keyword: '甲', holdBeats: 1 },
      { text: '丙丁', keyword: '丙', holdBeats: 1 },
    ],
  });
  advance(stage, 0, 1);
  tick(stage, 1);
  stage.frame({ beatIndex: 1, phase: 0.4 });
  const old = stage.history[0],
    transform = old.style.transform;
  stage.setPaused(true);
  stage.frame({ beatIndex: 30, phase: 0.8 });
  tick(stage, 30);
  assert.equal(old.style.transform, transform);
  assert.equal(stage.cursor, 0);
  stage.setEffect('flip');
  assert.equal(old.style.transform, transform);
  stage.setPaused(false);
  tick(stage, 2);
  assert.equal(stage.effect, 'flip');
  assert.equal(stage.getState().quarterTurn, null);
  assert.equal(old.dataset.quarterAngle, undefined);
  assert.equal(old.style.width, '');
  assert.equal(stage.cursor, 1);
});

test('resizing during a paused quarter-turn retains its musical progress and resumes from that phase', () => {
  const stage = new KnowledgeStage(host());
  stage.setAutoDirection(false);
  stage.setEffect('quarter-turn');
  stage.setRate(4);
  stage.setScript({
    lines: [
      { text: '甲乙', keyword: '甲', holdBeats: 1 },
      { text: '丙丁', keyword: '丙', holdBeats: 1 },
    ],
  });
  advance(stage, 0, 1);
  tick(stage, 1);
  stage.frame({ beatIndex: 1, phase: 0.4 });
  stage.setPaused(true);
  const progress = stage.getState().quarterTurn.progress;
  const old = stage.history[0];
  const angle = Number(old.dataset.quarterAngle);
  stage.el.clientWidth = 680;
  stage.el.clientHeight = 220;
  stage.layoutCurrent();
  assert.equal(stage.getState().quarterTurn.active, true);
  assert.equal(stage.getState().quarterTurn.progress, progress);
  assert.equal(Number(old.dataset.quarterAngle), angle);
  assert.equal(stage.cursor, 0);
  stage.frame({ beatIndex: 10, phase: 0.9 });
  assert.equal(Number(old.dataset.quarterAngle), angle);
  stage.setPaused(false);
  stage.frame({ beatIndex: 1, phase: 0.6 });
  assert.ok(Number(old.dataset.quarterAngle) > angle);
  stage.frame({ beatIndex: 1, phase: 0.9 });
  assert.equal(Number(old.dataset.quarterAngle), 90);
  tick(stage, 2);
  assert.equal(stage.cursor, 1);
});

test('changing the system motion preference during paused resize cannot complete a musical quarter-turn', () => {
  const element = host();
  const motionPreference = { matches: false };
  element.ownerDocument.defaultView = {
    matchMedia: () => motionPreference,
    getComputedStyle: () => ({ fontSize: '27px' }),
  };
  const stage = new KnowledgeStage(element);
  stage.setAutoDirection(false);
  stage.setEffect('quarter-turn');
  stage.setRate(4);
  stage.setScript({
    lines: [
      { text: '甲乙', keyword: '甲', holdBeats: 1 },
      { text: '丙丁', keyword: '丙', holdBeats: 1 },
    ],
  });
  advance(stage, 0, 1);
  tick(stage, 1);
  stage.frame({ beatIndex: 1, phase: 0.4 });
  stage.setPaused(true);
  const before = stage.getState().quarterTurn;
  const old = stage.history[0];
  const angle = old.dataset.quarterAngle;
  motionPreference.matches = true;
  stage.el.clientWidth = 680;
  stage.layoutCurrent();
  assert.equal(stage.getState().quarterTurn.active, true);
  assert.equal(stage.getState().quarterTurn.progress, before.progress);
  assert.equal(old.dataset.quarterAngle, angle);
  assert.equal(stage.cursor, 0);
  stage.setPaused(false);
  stage.frame({ beatIndex: 1, phase: 0.5 });
  assert.equal(stage.getState().quarterTurn.active, false);
  assert.equal(Number(old.dataset.quarterAngle), 90);
});

test('continuous clock automatically reads and changes sentences, preserving original text', () => {
  const element = host();
  let completed = 0;
  const entered = [];
  const stage = new KnowledgeStage(element, {
    onLine: (index) => entered.push(index),
    onComplete: () => completed++,
  });
  stage.setScript({
    keyword: '节拍',
    lines: [
      { text: '节拍在走。', keyword: '节拍', holdBeats: 1 },
      { text: '目标，是方向。', keyword: '目标', holdBeats: 1 },
    ],
  });
  advance(stage, 0, 20);
  assert.equal(stage.getState().finished, true);
  assert.deepEqual(entered, [0, 1]);
  assert.equal(completed, 1);
  assert.equal(stage.current.track.textContent, '目标，是方向。');
  assert.equal(
    stage.getState().scene.layout,
    'definition',
    'Effect rotation must preserve the inferred sentence meaning',
  );
  assert.equal(stage.getState().layout, 'automatic-effects');
});

test('every complete keyword range gets one relation callback, including repeated occurrences', () => {
  const seen = [];
  const stage = new KnowledgeStage(host(), { onKeyword: (text, relation) => seen.push({ text, relation }) });
  stage.setScript(
    {
      keyword: '连接',
      lines: [
        {
          text: '👩‍💻连接，再协作；连接形成理解。',
          keyword: '连接',
          holdBeats: 8,
          keywords: [
            { text: '连接', relation: { from: '专注', to: '连接', type: 'combine', label: '连接线索' } },
            { text: '连接' },
            { text: '协作', relation: { from: '连接', to: '协作', type: 'progress', label: '协作完成' } },
            { text: '理解', relation: { from: '协作', to: '理解', type: 'combine', label: '汇合为理解' } },
          ],
        },
      ],
    },
    { initialKeyword: '专注' },
  );
  advance(stage, 0, 14);
  assert.deepEqual(
    seen.map(({ text }) => text),
    ['连接', '协作', '连接', '理解'],
  );
  assert.equal(seen[1].relation.type, 'progress');
  assert.equal(seen[0].relation.from, '专注');
  assert.equal(seen[2].relation.from, '协作');
  assert.equal(seen[3].relation.from, '连接');
  assert.notEqual(
    seen[3].relation.type,
    'combine',
    'A repeated concept must not inherit an edge from an earlier word',
  );
  assert.equal(stage.current.chars[0].el.textContent, '👩‍💻');
  assert.equal(stage.getState().keywordsSeen, 4);
});

test('pause freezes content; manual mode and queued navigation remain compatible', () => {
  const stage = new KnowledgeStage(host());
  stage.setAutoDirection(false);
  stage.setEffect('echo');
  stage.setScript({
    lines: Array.from({ length: 7 }, (_, index) => ({
      text: `概念${index}。`,
      keyword: `概念${index}`,
      holdBeats: 1,
    })),
  });
  tick(stage, 0);
  assert.equal(stage.getState().effect, 'echo');
  assert.equal(stage.getState().layout, 'manual');
  stage.setPaused(true);
  const frozen = stage.getState().cursor;
  advance(stage, 1, 10);
  assert.equal(stage.getState().cursor, frozen);
  stage.setPaused(false);
  advance(stage, 1, 35);
  assert.equal(stage.getState().finished, true);
  assert.equal(stage.getState().historyCount, 4);
  stage.requestStep(-1);
  tick(stage, 35);
  assert.equal(stage.getState().lineIndex, 5);
  assert.equal(stage.getState().finished, false);
});

test('direction mode can change on a tick without losing text or repeating keyword callbacks', () => {
  const element = host();
  const seen = [];
  const stage = new KnowledgeStage(element, { onKeyword: (keyword) => seen.push(keyword) });
  stage.setScript({ lines: [{ text: '文字带来理解。', keyword: '文字', holdBeats: 8 }] });
  advance(stage, 0, 2);
  assert.equal(stage.getState().layout, 'ink');
  assert.equal(stage.current.inkForeground.textContent, '文字');
  stage.setAutoDirection(false);
  stage.setEffect('typewriter');
  tick(stage, 2);
  assert.equal(stage.getState().layout, 'manual');
  assert.equal(stage.current.inkForeground, null);
  stage.setAutoDirection(true);
  tick(stage, 3);
  assert.equal(stage.getState().layout, 'ink');
  assert.equal(stage.current.track.textContent, '文字带来理解。');
  assert.deepEqual(seen, ['文字']);
});

test('keyword activation preserves reserved lanes and the complete neighbouring text', () => {
  const stage = new KnowledgeStage(host());
  stage.setAutoDirection(false);
  stage.setEffect('marker');
  stage.setScript({
    lines: [{ text: '邻字长期记忆形成机制后字👩‍💻。', keyword: '长期记忆形成机制', holdBeats: 32 }],
  });
  tick(stage, 0);
  const group = stage.current.groups.find((entry) => entry.keyword);
  const initialX = group.el.style['--phrase-reserve-x'];
  const initialY = group.el.style['--phrase-reserve-y'];
  advance(stage, 1, 10);
  assert.ok(group.el.classList.contains('active'));
  assert.equal(group.el.style['--phrase-reserve-x'], initialX);
  assert.equal(group.el.style['--phrase-reserve-y'], initialY);
  assert.equal(stage.current.track.textContent, '邻字长期记忆形成机制后字👩‍💻。');
  assert.ok(stage.current.chars.every(({ el }) => el.classList.contains('read')));
  assert.ok(group.el.children[0].classList.contains('phrase-glyphs'));
});

test('resize schedules a new layout and destroy disconnects it', () => {
  const element = host();
  let listener,
    scheduled,
    disconnected = false,
    cancelled = false;
  element.ownerDocument.defaultView = {
    ResizeObserver: class {
      constructor(callback) {
        listener = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
    requestAnimationFrame(callback) {
      scheduled = callback;
      return 1;
    },
    cancelAnimationFrame() {
      cancelled = true;
    },
  };
  const stage = new KnowledgeStage(element);
  let layouts = 0;
  stage.layoutCurrent = () => layouts++;
  listener();
  scheduled();
  assert.equal(layouts, 1);
  listener();
  stage.destroy();
  assert.ok(disconnected && cancelled);
  scheduled();
  listener();
  tick(stage, 0);
  assert.equal(layouts, 1, 'A callback already queued before disconnect must not touch the destroyed stage');
});

test('automatic words retain different roles and only the latest keyword pulses strongly', () => {
  const stage = new KnowledgeStage(host());
  stage.setScript({
    lines: [
      {
        text: '共振连接驱动与能量。',
        keyword: '共振',
        keywords: ['共振', '驱动', '能量'],
        holdBeats: 32,
      },
    ],
  });
  advance(stage, 0, 8);
  const directed = stage.getState().emphasis;
  assert.equal(directed[0].role, 'primary');
  assert.equal(directed[0].variant, 'frame');
  assert.equal(directed[1].role, 'secondary');
  assert.equal(directed[1].variant, 'underline');
  assert.equal(directed.filter((entry) => entry.featured).length, 1);
  assert.equal(directed.find((entry) => entry.featured).text, '能量');
  const old = stage.current.groups.find((group) => group.el.textContent === '共振');
  assert.ok(old.el.classList.contains('emphasis-settled'));
  const stable = directed.map(({ role, variant }) => ({ role, variant }));
  tick(stage, 9);
  assert.deepEqual(
    stage.getState().emphasis.map(({ role, variant }) => ({ role, variant })),
    stable,
  );
  stage.setAutoDirection(false);
  stage.setEffect('marker');
  tick(stage, 10);
  assert.equal(stage.getState().emphasis.length, 0);
  assert.ok(stage.current.keywords.every((marker) => marker.el.classList.contains('active')));
});

test('validated external-AI JSON metadata changes the rendered scene and each keyword emphasis', async () => {
  const { parseScriptInput } = await import('../src/content/script-document.js');
  const source = JSON.stringify({
    schemaVersion: 1,
    sourceMode: 'source-only',
    title: '结构化呈现',
    lines: [
      {
        text: '先理解连接，再把信息变成解释，但关键词并不是自动事实验证。',
        keyword: '连接',
        sentenceType: 'definition',
        holdBeats: 32,
        keywords: [
          { text: '连接', role: 'primary' },
          {
            text: '信息',
            role: 'secondary',
            relation: { from: '连接', to: '信息', type: 'combine', label: '连接信息' },
          },
          { text: '解释', role: 'secondary' },
        ],
      },
    ],
  });
  const topic = parseScriptInput(source);
  const stage = new KnowledgeStage(host());
  stage.setScript(topic);
  stage.setRate(4);
  advance(stage, 0, 15);
  const state = stage.getState();
  assert.equal(
    state.layout,
    'definition',
    'Explicit definition must override first-line ink and contrast wording',
  );
  assert.equal(state.scene.directionSource, 'explicit');
  assert.equal(stage.el.dataset.sentenceType, 'definition');
  assert.deepEqual(
    state.emphasis.map(({ text, role, variant }) => ({ text, role, variant })),
    [
      { text: '连接', role: 'primary', variant: 'ring' },
      { text: '信息', role: 'secondary', variant: 'weight' },
      { text: '解释', role: 'secondary', variant: 'underline' },
    ],
  );
  assert.equal(stage.current.track.textContent, topic.lines[0].text);
  assert.equal(stage.current.firedRanges.size, 3);
  assert.equal(
    stage.current.groups.filter((group) => group.el.classList.contains('emphasis-current')).length,
    1,
  );
  stage.setAutoDirection(false);
  stage.setEffect('karaoke');
  tick(stage, 15);
  assert.equal(stage.el.dataset.directionSource, 'manual');
  assert.equal(stage.getState().emphasis.length, 0);
  stage.setAutoDirection(true);
  tick(stage, 16);
  assert.equal(stage.el.dataset.directionSource, 'explicit');
  assert.equal(stage.getState().emphasis[0].variant, 'ring');
});

test('crossing keyword ranges emphasize precisely their own glyphs without duplicating text', () => {
  const seen = [];
  const stage = new KnowledgeStage(host(), { onKeyword: (text) => seen.push(text) });
  stage.setRate(4);
  stage.setScript({
    lines: [
      {
        text: '邻字机器学习系统后字👩‍💻。',
        keyword: '机器学习',
        sentenceType: 'definition',
        holdBeats: 32,
        keywords: [
          { text: '机器学习', role: 'primary' },
          { text: '学习系统', role: 'secondary', relation: { type: 'combine' } },
        ],
      },
    ],
  });
  tick(stage, 0);
  const markers = stage.current.keywords;
  assert.deepEqual(
    markers.map(({ els }) => els.map((el) => el.textContent).join('')),
    ['机器学习', '学习系统'],
  );
  assert.equal(stage.current.track.textContent, '邻字机器学习系统后字👩‍💻。');
  const lanes = stage.current.groups.map(({ el }) => [
    el.style['--phrase-reserve-x'],
    el.style['--phrase-reserve-y'],
  ]);
  advance(stage, 1, 6);
  assert.deepEqual(seen, ['机器学习', '学习系统']);
  assert.deepEqual(
    stage.getState().emphasis.map(({ text, role, featured }) => ({ text, role, featured })),
    [
      { text: '机器学习', role: 'primary', featured: false },
      { text: '学习系统', role: 'secondary', featured: true },
    ],
  );
  const highlighted = stage.current.groups.filter(({ el }) => el.classList.contains('emphasis-current'));
  assert.equal(highlighted.map(({ el }) => el.textContent).join(''), '学习系统');
  assert.deepEqual(
    stage.current.groups.map(({ el }) => [el.style['--phrase-reserve-x'], el.style['--phrase-reserve-y']]),
    lanes,
  );
  assert.equal(stage.current.track.textContent, '邻字机器学习系统后字👩‍💻。');
});

test('nested and repeated keywords retain separate ranges and whole emoji boundaries', () => {
  const seen = [];
  const stage = new KnowledgeStage(host(), { onKeyword: (text) => seen.push(text) });
  stage.setScript({
    lines: [
      {
        text: '机器学习，再学习👩‍💻。',
        keyword: '机器学习',
        keywords: ['机器学习', '学习', '👩', '👩‍💻'],
        holdBeats: 32,
      },
    ],
  });
  advance(stage, 0, 10);
  assert.deepEqual(seen, ['学习', '机器学习', '学习', '👩‍💻']);
  assert.equal(stage.current.keywords.length, 4);
  for (const marker of stage.current.keywords)
    assert.equal(marker.els.map((el) => el.textContent).join(''), marker.text);
});

test('long unbroken words get safe break opportunities without truncation or invented spaces', () => {
  const text = 'A'.repeat(60);
  const stage = new KnowledgeStage(host());
  stage.setScript({ lines: [{ text, keyword: '' }] });
  tick(stage, 0);
  assert.equal(stage.current.track.textContent, text);
  assert.ok(stage.current.groups.length >= 8);
  assert.ok(stage.current.groups.every(({ end, start }) => end - start <= 8));
  stage.setRate(4);
  advance(stage, 1, 20);
  assert.equal(stage.current.chars.filter(({ el }) => el.classList.contains('read')).length, 60);
});

test('paused direction changes stay visually frozen and automatic direction ignores stored manual effects', () => {
  const stage = new KnowledgeStage(host());
  stage.setScript({ lines: [{ text: '文字也能跳舞。', keyword: '文字', holdBeats: 32 }] });
  advance(stage, 0, 2);
  const initial = {
    layout: stage.el.dataset.layout,
    auto: stage.el.dataset.autoDirection,
    effect: stage.el.dataset.effect,
  };
  stage.setPaused(true);
  stage.setAutoDirection(false);
  stage.setEffect('echo');
  tick(stage, 2);
  assert.deepEqual(
    {
      layout: stage.el.dataset.layout,
      auto: stage.el.dataset.autoDirection,
      effect: stage.el.dataset.effect,
    },
    initial,
  );
  stage.setAutoDirection(true); // Cancel the queued toggle before resuming.
  stage.setPaused(false);
  tick(stage, 2);
  assert.equal(stage.getState().effect, 'tunnel');
  assert.equal(stage.el.dataset.layout, 'ink');
  stage.setAutoDirection(false);
  tick(stage, 3);
  assert.equal(stage.getState().effect, 'echo');
  assert.equal(stage.el.dataset.layout, 'manual');
});

test('invalid, duplicate and old timeline events cannot reveal characters or end a sentence', () => {
  const stage = new KnowledgeStage(host());
  stage.setScript({ lines: [{ text: '有效节拍推进文字。', keyword: '节拍' }] });
  for (const beatIndex of [undefined, NaN, Infinity, -1, 0.5])
    stage.onTick({ kind: 'beat', subdivisionIndex: 0, beatIndex, bpm: 108 });
  assert.equal(stage.getState().cursor, 0);
  tick(stage, 1);
  tick(stage, 1, 2);
  const cursor = stage.getState().cursor;
  tick(stage, 1, 2);
  tick(stage, 0);
  stage.onTick({ kind: 'beat', subdivisionIndex: 2, beatIndex: 2, bpm: 108 });
  assert.equal(stage.getState().cursor, cursor);
});

test('layout reads all phrase widths before reserving lanes and coalesces resize bursts', () => {
  const stage = new KnowledgeStage(host());
  stage.setScript({
    lines: [{ text: '机器学习形成理解。', keyword: '机器学习', sentenceType: 'definition' }],
  });
  tick(stage, 0);
  const operations = [];
  const groups = stage.current.groups;
  groups.forEach((group, index) => {
    Object.defineProperty(group.el, 'offsetWidth', {
      get() {
        operations.push(`read-${index}`);
        return 60;
      },
    });
    const original = group.el.style.setProperty;
    group.el.style.setProperty = function (name, value) {
      operations.push(`write-${index}`);
      original.call(this, name, value);
    };
  });
  stage.layoutCurrent();
  assert.deepEqual(
    operations.slice(0, groups.length),
    groups.map((_, index) => `read-${index}`),
  );
  assert.equal(operations.filter((operation) => operation.startsWith('read')).length, groups.length);

  const element = host();
  let notify,
    callback,
    scheduled = 0;
  element.ownerDocument.defaultView = {
    ResizeObserver: class {
      constructor(listener) {
        notify = listener;
      }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame(listener) {
      scheduled++;
      callback = listener;
      return scheduled;
    },
    cancelAnimationFrame() {},
  };
  const resizeStage = new KnowledgeStage(element);
  let layouts = 0;
  resizeStage.layoutCurrent = () => layouts++;
  notify();
  notify();
  notify();
  assert.equal(scheduled, 1);
  callback();
  assert.equal(layouts, 1);
  resizeStage.destroy();
});

test('repeat remains a beat-queued navigation with one completion per pass and bounded history', () => {
  const entered = [];
  let completed = 0;
  const stage = new KnowledgeStage(host(), {
    onLine: (index) => entered.push(index),
    onComplete: () => {
      completed++;
      stage.requestStep(-2);
    },
  });
  stage.setRate(4);
  stage.setScript({
    lines: [
      { text: '理解👩‍💻。', keyword: '理解', holdBeats: 1 },
      { text: '应用。', keyword: '应用', holdBeats: 1 },
    ],
  });
  advance(stage, 0, 20);
  assert.ok(completed >= 3);
  assert.ok(entered.every((index, position) => index === position % 2));
  assert.equal(stage.history.length, 4);
  assert.equal(stage.el.children.length, 5);
  stage.setPaused(true);
  const frozen = stage.getState();
  advance(stage, 20, 30);
  assert.deepEqual(stage.getState(), frozen);
});

test('observed drum frames change the actual reading element without advancing the shared-tick cursor', () => {
  const stage = new KnowledgeStage(host());
  stage.setAutoDirection(false);
  stage.setEffect('typewriter');
  stage.setScript({
    lines: [{ text: '让知识文字随声音轻轻回应，同时保留舒服的阅读速度。', keyword: '知识', holdBeats: 1 }],
  });
  tick(stage, 0);
  const cursor = stage.getState().cursor;
  stage.setFeatures({
    time: 1,
    sourceGeneration: 1,
    audioSilent: 0,
    drum: { hit: true, sequence: 1, kind: 'thump', weight: 0.9, strength: 0.8, confidence: 0.8 },
  });
  stage.frame({ time: 1.024, beatIndex: 0, phase: 0.5 });
  assert.equal(stage.getState().cursor, cursor);
  assert.ok(Number(stage.current.track.style.scale.split(' ')[1]) < 1);
  assert.ok(stage.getState().drum.active);
  stage.setFeatures({ time: 1.024, sourceGeneration: 1, drum: { hit: false, sequence: 1 } });
  const before = stage.getState().drum.pose;
  stage.setPaused(true);
  stage.setFeatures({
    time: 100,
    sourceGeneration: 1,
    drum: { hit: true, sequence: 2, kind: 'snap', weight: 0.8 },
  });
  stage.frame({ time: 100, beatIndex: 0, phase: 0.5 });
  assert.equal(stage.getState().cursor, cursor);
  assert.deepEqual(stage.getState().drum.pose, before);
  const restoredTrack = stage.current.track;
  stage.destroy();
  assert.equal(restoredTrack.style.scale, '');
});

test('real drum emphasis outranks internal keyword pulses without changing reading ticks or losing semantic roles', () => {
  const stage = new KnowledgeStage(host());
  stage.setRate(4);
  stage.setScript({
    lines: [
      {
        text: '知识需要慢慢理解并回想，真实声音的重点清楚而阅读速度保持舒服。',
        keyword: '知识',
        holdBeats: 32,
      },
    ],
  });
  tick(stage, 0, 0);
  tick(stage, 0, 1);
  const keyword = stage.current.featuredKeyword;
  assert.ok(keyword);
  const before = stage.cursor;
  const measured = {
    time: 1,
    sourceGeneration: 1,
    signalValid: 1,
    audioSilent: 0,
    drum: {
      hit: true,
      sequence: 1,
      kind: 'thump',
      weight: 0.9,
      strength: 0.8,
      confidence: 0.8,
      ageSeconds: 0.018,
    },
  };
  stage.setFeatures(measured);
  stage.frame({ time: 1, beatIndex: 0, phase: 0.8 });
  assert.equal(stage.cursor, before, 'A physical onset cannot independently advance the reading clock');
  assert.equal(stage.el.dataset.rhythmPriority, 'drum');
  assert.ok(
    Number(keyword.style.scale) > 1.1,
    'The real keyword is visibly emphasized in the confirmation frame',
  );
  tick(stage, 1, 0, measured);
  assert.equal(stage.cursor, before + 1, 'Existing shared reading slots remain intact');
  assert.ok(keyword.classList.contains('active'), 'The semantic highlight stays present');
  assert.equal(
    keyword.classList.contains('emphasis-current'),
    false,
    'A synthetic beat cannot restart the bigger emphasis',
  );
  stage.setFeatures({ ...measured, time: 2.5, drum: { ...measured.drum, hit: false } });
  assert.equal(
    stage.el.dataset.rhythmPriority,
    'drum',
    'Decorative grid emphasis cannot restart between beats',
  );
  tick(stage, 1, 2);
  assert.equal(stage.el.dataset.rhythmPriority, 'drum');
  tick(stage, 2, 0);
  assert.equal(stage.el.dataset.rhythmPriority, 'grid');
  assert.ok(
    keyword.classList.contains('emphasis-current'),
    'Ordinary rhythmic emphasis resumes on a shared beat',
  );
  stage.setFeatures({ ...measured, time: 3, sourceGeneration: 2, drum: { ...measured.drum, hit: false } });
  assert.equal(
    stage.drumResponse.getPriority(),
    0,
    'Source changes cannot inherit the former drum authority',
  );
});

test('same shared BPM gets denser character slots from measured delivery with a hard readable-speed budget', () => {
  for (const [bpm, drive, baseRate, expected] of [
    [120, 0.366, 2, 2],
    [120, 0.955, 2, 3],
    [108, 1, 2, 4],
    [300, 1, 2, 1],
    [180, 1, 4, 2],
  ]) {
    const stage = new KnowledgeStage(host());
    stage.setAutoDirection(false);
    stage.setRate(baseRate);
    stage.setScript({
      lines: [
        {
          text: '声音密度可以改变显现速度但是文字依然只在统一节拍的细分位置显现而且快速音乐需要更慢一点的字符预算。',
          keyword: '节拍',
          holdBeats: 1,
        },
      ],
    });
    stage.setFeatures({ delivery: { drive, readingMultiplier: 1 + drive * 0.75 } });
    for (let subdivision = 0; subdivision < 4; subdivision++)
      stage.onTick({
        kind: subdivision ? 'subdivision' : 'beat',
        subdivisionIndex: subdivision,
        beatIndex: 0,
        bpm,
        source: 'internal',
      });
    const state = stage.getState();
    assert.equal(state.effectiveCharsPerBeat, expected, `${bpm} BPM, drive ${drive}, rate ${baseRate}`);
    assert.equal(state.cursor, expected);
    assert.equal(stage.rate, baseRate, 'Reading adaptation must not silently rewrite the saved preference');
    assert.ok((state.effectiveCharsPerBeat * bpm) / 60 <= 7.5);
    stage.destroy();
  }
});

test('resizing paused knowledge preserves its actual frozen drum style while relaying out text', () => {
  const stage = new KnowledgeStage(host());
  stage.setAutoDirection(false);
  stage.setScript({
    lines: [{ text: '暂停后的鼓点姿态在调整窗口大小时也应该保留。', keyword: '姿态', holdBeats: 1 }],
  });
  tick(stage, 0);
  stage.setFeatures({
    time: 1,
    sourceGeneration: 1,
    drum: { hit: true, sequence: 1, kind: 'thump', weight: 0.9, confidence: 0.8 },
  });
  stage.frame({ time: 1.024, beatIndex: 0, phase: 0.5 });
  stage.setFeatures({ time: 1.024, sourceGeneration: 1, drum: { hit: false, sequence: 1 } });
  const track = stage.current.track;
  const before = { scale: track.style.scale, translate: track.style.translate, filter: track.style.filter };
  stage.setPaused(true);
  stage.setFeatures({ time: 2, sourceGeneration: 1, drum: { hit: false, sequence: 1 } });
  stage.el.clientWidth = 700;
  stage.layoutCurrent();
  assert.equal(track.style.scale, before.scale);
  assert.equal(track.style.filter, before.filter);
  assert.equal(track.style.translate, before.translate);
  assert.equal(stage.getState().cursor, 1);
  stage.destroy();
});
