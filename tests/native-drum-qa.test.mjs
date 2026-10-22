import test from 'node:test';
import assert from 'node:assert/strict';
import { measureKnowledgeDrumPresentation, drumCaptionScript } from '../src/dev/drum-qa.js';
import { KnowledgeDrumResponse } from '../src/visuals/knowledge-drum-response.js';

// DOM/style boundary fixture. Production frame() applies the styles; the QA
// observer must inspect them instead of giving a model-only pose credit.
class Element {
  constructor(document, className = '', content = '') {
    this.ownerDocument = document;
    this.className = className;
    this.content = content;
    this.style = {};
    this.computed = {};
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.box = { left: 20, top: 40, right: 280, bottom: 80, width: 260, height: 40 };
    this.classList = { contains: (name) => this.className.split(/\s+/u).includes(name) };
  }
  get textContent() {
    return this.content + this.children.map((child) => child.textContent).join('');
  }
  get isConnected() {
    return this.root === true || Boolean(this.parentElement?.isConnected);
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }
  querySelectorAll(selector) {
    assert.equal(selector, '.char');
    return this.children.flatMap((child) => [
      ...(child.classList.contains('char') ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  getBoundingClientRect() {
    return { ...this.box };
  }
}

test('bounded real-audio positive fixture retains its first visible keyword for the entire measurement', () => {
  const script = drumCaptionScript();
  const { text, keyword } = script.lines[0];
  assert.equal([...keyword].length, 2);
  assert.ok(text.startsWith(keyword));
  assert.ok([...text].length > 15 * 7.5, 'even the hard reading cap cannot retire the line in 15s');
  assert.ok([...text].length <= 160, 'the diagnostic text stays bounded');
});

function surface(effect = 'stack') {
  const document = {
    defaultView: {
      matchMedia: () => ({ matches: false }),
      getComputedStyle: (node) => ({
        display: 'inline-block',
        visibility: 'visible',
        contentVisibility: 'visible',
        opacity: '1',
        scale: node.style.scale || 'none',
        translate: node.style.translate || 'none',
        filter: node.style.filter || 'none',
        ...node.computed,
      }),
    },
  };
  const host = new Element(document),
    line = new Element(document),
    track = new Element(document),
    focus = new Element(document),
    glyph = new Element(document, 'char read', '字'),
    spotlight = new Element(document, 'spotlight', '字');
  host.root = true;
  host.box = { left: 0, top: 0, right: 900, bottom: 200, width: 900, height: 200 };
  focus.append(glyph);
  track.append(focus);
  line.append(track, spotlight);
  host.append(line);
  const current = { el: line, track, spotlight, featuredMarker: { els: [focus] } };
  const response = new KnowledgeDrumResponse();
  const stage = {
    el: host,
    current,
    effect,
    drumResponse: response,
    getState: () => ({ drum: response.getState() }),
  };
  const frame = (kind = 'tick', weight = 0.4, time = 1, sequence = 1) => {
    response.update({
      time,
      sourceGeneration: 1,
      audioSilent: 0,
      signalValid: 1,
      drum: { hit: true, sequence, kind, weight, confidence: 1 },
    });
    response.frame(current, host, time, effect);
    return measureKnowledgeDrumPresentation(stage);
  };
  return { stage, response, current, host, line, track, focus, glyph, spotlight, frame };
}

test('native observer sees a real applied local tick while all sentence pose channels remain neutral', () => {
  const s = surface(),
    presentation = s.frame();
  const pose = s.response.getState().pose;
  assert.equal(pose.y, 0);
  assert.equal(pose.scaleY, 1);
  assert.equal(pose.brightness, 1);
  assert.ok(pose.focusScale > 1);
  assert.equal(presentation.stylesMatch, true);
  assert.equal(presentation.trackMotion, 0, 'reproduces the previous QA blind spot');
  assert.ok(presentation.focusMotion > 0);
  assert.equal(presentation.eventMotion, presentation.focusMotion);
  assert.equal(presentation.focusVisible, true);
  assert.equal(presentation.visibleFocusGlyphs, 1);
});

test('native observer retains real visible body response and heavy/light ordering', () => {
  const light = surface().frame('thump', 0.15),
    heavy = surface().frame('thump', 0.95);
  assert.equal(light.stylesMatch, true);
  assert.equal(heavy.stylesMatch, true);
  assert.ok(heavy.trackMotion > light.trackMotion * 2);
  assert.ok(heavy.eventMotion > light.eventMotion * 2);
});

test('neutral rendered text cannot receive credit from text visibility alone', () => {
  const s = surface();
  s.response.frame(s.current, s.host, 1);
  const p = measureKnowledgeDrumPresentation(s.stage);
  assert.equal(p.stylesMatch, true);
  assert.equal(p.eventMotion, 0);
});

test('an unread first keyword never earns local tick credit before its target exists', () => {
  const s = surface();
  s.current.featuredMarker = null;
  s.glyph.className = 'char unread';
  s.frame('tick');
  const p = measureKnowledgeDrumPresentation(s.stage);
  assert.ok(s.response.getState().pose.focusScale > 1, 'a measured tick still has a model pose');
  assert.equal(p.focusNodes, 0);
  assert.equal(p.focusVisible, false);
  assert.equal(p.eventMotion, 0, 'a model-only pose is never a visible response');
});

for (const [name, change] of [
  [
    'missing focus inline scale',
    (s) => {
      s.focus.style.scale = '';
    },
  ],
  [
    'incorrect focus inline scale',
    (s) => {
      s.focus.style.scale = '1';
    },
  ],
  [
    'computed scale overridden despite correct inline style',
    (s) => {
      s.focus.computed.scale = '1';
    },
  ],
  [
    'stale focus still connected to an old line',
    (s) => {
      const old = new Element(s.host.ownerDocument);
      s.host.append(old);
      old.append(s.focus);
    },
  ],
  [
    'detached focus',
    (s) => {
      s.focus.remove();
    },
  ],
])
  test(`native observer rejects ${name}`, () => {
    const s = surface();
    s.frame();
    change(s);
    const p = measureKnowledgeDrumPresentation(s.stage);
    assert.equal(p.stylesMatch, false);
    assert.equal(p.focusMotion, 0);
    assert.equal(p.eventMotion, 0);
  });

for (const [name, change] of [
  [
    'hidden reading-track ancestor',
    (s) => {
      s.track.computed.opacity = '0';
    },
  ],
  [
    'display-none keyword',
    (s) => {
      s.focus.computed.display = 'none';
    },
  ],
  [
    'hidden glyph',
    (s) => {
      s.glyph.computed.visibility = 'hidden';
    },
  ],
  [
    'fully transparent glyph',
    (s) => {
      s.glyph.computed.opacity = '0';
    },
  ],
  [
    'unread glyph',
    (s) => {
      s.glyph.className = 'char unread';
    },
  ],
  [
    'empty glyph',
    (s) => {
      s.glyph.content = '';
    },
  ],
  [
    'offscreen glyph',
    (s) => {
      s.glyph.box = { left: 1000, right: 1010, top: 40, bottom: 80, width: 10, height: 40 };
    },
  ],
])
  test(`native observer never credits ${name} as a visible tick`, () => {
    const s = surface();
    s.frame();
    change(s);
    const p = measureKnowledgeDrumPresentation(s.stage);
    assert.equal(p.focusVisible, false);
    assert.equal(p.focusMotion, 0);
    assert.equal(p.eventMotion, 0);
  });

test('a preceding body tail cannot substitute for a missing local tick response', () => {
  const s = surface();
  s.frame('thump', 0.95);
  s.current.featuredMarker = null;
  s.frame('tick', 0.15, 1.06, 2);
  const p = measureKnowledgeDrumPresentation(s.stage, s.response.getState(), 'tick');
  assert.ok(p.trackMotion > 0 && p.visibleMotion > 0, 'the previous body really is still visible');
  assert.equal(p.focusMotion, 0);
  assert.equal(p.eventMotion, 0, 'the new tick must show its own local target');
});

test('actual/computed sentence styles must match translation, compression and brightness', () => {
  for (const [property, wrong] of [
    ['translate', '0px 20px'],
    ['scale', '1 1'],
    ['filter', 'brightness(1)'],
  ]) {
    const s = surface();
    s.frame('thump', 0.95);
    s.track.computed[property] = wrong;
    assert.equal(measureKnowledgeDrumPresentation(s.stage).trackStylesMatch, false, property);
  }
});

for (const effect of ['pop', 'flash']) {
  test(`${effect} observer credits only the displayed spotlight and its actual composed scale`, () => {
    const s = surface(effect);
    s.track.computed.opacity = '0';
    s.focus.style.scale = '1.04';
    const p = s.frame();
    const state = s.response.getState();
    assert.equal(state.presentation.target, 'spotlight');
    assert.equal(s.focus.style.scale, '1.04', 'the hidden keyword was not used');
    assert.equal(s.response.focus[0].node, s.spotlight);
    assert.equal(state.pose.y, 0);
    assert.equal(state.pose.brightness, 1);
    assert.equal(p.stylesMatch, true);
    assert.equal(p.focusVisible, true);
    assert.ok(p.focusMotion > 0 && p.eventMotion > 0);
    assert.equal(p.trackMotion, 0, 'tick motion is local scaling, not sentence compression or brightness');
    const actualScale = s.spotlight.style.scale.split(/\s+/u).map(Number);
    assert.ok(actualScale[0] > 1 && actualScale[1] > 1);
    assert.ok(Math.abs(actualScale[0] - state.presentation.focusScale) < 0.00002);
  });

  test(`${effect} hidden marker cannot impersonate its visible spotlight`, () => {
    const s = surface(effect);
    s.track.computed.opacity = '0';
    s.frame();
    s.focus.style.scale = String(s.response.getState().pose.focusScale);
    s.response.focus = [{ node: s.focus, scale: '' }];
    const p = measureKnowledgeDrumPresentation(s.stage);
    assert.equal(p.stylesMatch, false);
    assert.equal(p.focusVisible, false);
    assert.equal(p.eventMotion, 0);
  });

  test(`${effect} model metadata cannot replace a missing visible CSS scale`, () => {
    const s = surface(effect);
    s.frame();
    s.spotlight.style.scale = '1 1';
    const p = measureKnowledgeDrumPresentation(s.stage);
    assert.equal(p.stylesMatch, false);
    assert.equal(p.eventMotion, 0);
  });
}

for (const [mode, maximumBlur, animationName] of [
  ['flash', 2, 'spotlight-flash'],
  ['scene-zoom', 3, 'scene-zoom'],
]) {
  const configured = () => {
    const s = surface(mode === 'flash' ? 'flash' : 'tunnel');
    if (mode === 'scene-zoom') Object.assign(s.host.dataset, { presentation: 'scene', entrance: 'zoom' });
    s.frame('thump', 0.9);
    const target = s.response.track;
    target.computed.animationName = animationName;
    return { s, target, brightness: s.response.getState().pose.brightness.toFixed(5) };
  };
  test(`${mode} allows the real bounded blur and correct drum brightness to compose`, () => {
    const { s, target, brightness } = configured();
    target.computed.filter = `blur(${maximumBlur * 0.4}px) brightness(${brightness})`;
    const p = measureKnowledgeDrumPresentation(s.stage);
    assert.equal(p.trackStylesMatch, true);
    assert.ok(p.trackMotion > 0);
    assert.equal(p.trackStyles.parsedComputedFilter.blur, maximumBlur * 0.4);
  });
  for (const [problem, chain] of [
    ['missing brightness', () => 'blur(0px)'],
    ['missing entrance blur', (brightness) => `brightness(${brightness})`],
    ['incorrect brightness despite valid blur', () => 'blur(0px) brightness(1)'],
    ['out-of-range blur', (brightness) => `blur(${maximumBlur + 1}px) brightness(${brightness})`],
    ['extra unsupported filter', (brightness) => `blur(0px) brightness(${brightness}) contrast(2)`],
  ])
    test(`${mode} rejects ${problem}`, () => {
      const { s, target, brightness } = configured();
      target.computed.filter = chain(brightness);
      assert.equal(measureKnowledgeDrumPresentation(s.stage).trackStylesMatch, false);
    });
}

test('ordinary track effects cannot borrow the animated-filter exception', () => {
  const s = surface();
  s.frame('thump');
  s.track.computed.filter = `blur(0px) brightness(${s.response.getState().pose.brightness.toFixed(5)})`;
  assert.equal(measureKnowledgeDrumPresentation(s.stage).trackStylesMatch, false);
});
