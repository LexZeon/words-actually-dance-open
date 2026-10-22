import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../src/core/events.js';
import { createProviderRegistry, getExtensionStatus } from '../src/core/contracts.js';
import { sampleLibrary } from '../src/content/sample-library.js';
import { EFFECTS, FUTURE_EFFECTS, EFFECT_CATALOG } from '../src/visuals/effect-catalog.js';

test('unimplemented cloud services cannot appear available from extension declarations', () => {
  const registry = createProviderRegistry();
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.get('deepseek'), undefined);
  const remotePoints = getExtensionStatus(registry).filter(({ kind }) =>
    ['llm', 'tts', 'account', 'recommendation', 'billing'].includes(kind),
  );
  assert.ok(remotePoints.length > 0);
  assert.ok(remotePoints.every(({ available }) => available === false));
  assert.throws(() => registry.register({ id: 'fake-cloud', kind: 'llm', methods: {} }), /implemented/);
  assert.throws(
    () => registry.register({ id: 'fake-cloud', kind: 'llm', methods: { generateScript: null } }),
    /implemented/,
  );
  assert.equal(registry.get('fake-cloud'), undefined);
  const billing = getExtensionStatus(registry).filter(({ kind }) => kind === 'billing');
  assert.deepEqual(
    billing.map(({ method }) => method),
    ['getEntitlements', 'checkBudget', 'recordUsage'],
  );
  assert.ok(billing.every(({ available }) => !available));
});

test('a local adapter does not accidentally enable another provider type', () => {
  const registry = createProviderRegistry();
  registry.register('input', { id: 'local-text', methods: { extractText: (text) => text } });
  assert.equal(registry.get('local-text').methods.extractText('笔记'), '笔记');
  const status = getExtensionStatus(registry);
  assert.equal(
    status.find(({ kind, method }) => kind === 'input' && method === 'extractText').available,
    true,
  );
  assert.ok(status.filter(({ kind }) => kind !== 'input').every(({ available }) => !available));
  assert.throws(
    () => registry.register({ id: 'local-text', kind: 'llm', methods: { generateScript() {} } }),
    /already registered/,
  );
  registry.unregister('local-text');
  assert.ok(getExtensionStatus(registry).every(({ available }) => !available));
});

test('one-shot beat hooks are safe when a listener triggers another dispatch', () => {
  const bus = createEventBus();
  let calls = 0;
  bus.once('beat', () => {
    calls += 1;
    bus.emit('beat', { nested: true });
  });
  bus.emit('beat', {});
  assert.equal(calls, 1);
});

test('disposing a player subscription prevents reactions to later audio', () => {
  const bus = createEventBus();
  let beats = 0;
  let interactions = 0;
  const stop = bus.on('beat', () => {
    beats += 1;
  });
  bus.on('interaction', () => {
    interactions += 1;
  });
  bus.emit('beat');
  stop();
  bus.emit('beat');
  bus.emit('interaction');
  bus.clear();
  bus.emit('interaction');
  assert.equal(beats, 1);
  assert.equal(interactions, 1);
});

test('curated scripts can locate their exact emphasis targets and have no wall-clock duration', () => {
  assert.ok(sampleLibrary.length >= 6);
  const chapterIds = new Set();
  for (const chapter of sampleLibrary) {
    assert.ok(!chapterIds.has(chapter.id), `Duplicate chapter ${chapter.id}`);
    chapterIds.add(chapter.id);
    if (chapter.id === 'easter-egg') {
      assert.equal(chapter.lines.length, 1);
      assert.equal(chapter.lines[0].text, '你怎么找到这里的');
    } else assert.ok(chapter.lines.length >= 3);
    for (const line of chapter.lines) {
      assert.ok(line.keyword && line.text.includes(line.keyword), `Cannot emphasize ${line.id}`);
      assert.ok(Number.isInteger(line.holdBeats) && line.holdBeats > 0, `Invalid beat duration ${line.id}`);
      assert.equal(Object.hasOwn(line, 'holdMs'), false, `Wall-clock knowledge schedule in ${line.id}`);
    }
  }
});

test('the knowledge effect selector cannot expose future or dance-stage modes as implemented', () => {
  assert.ok(EFFECTS.length >= 20);
  assert.ok(FUTURE_EFFECTS.length >= 20);
  assert.ok(EFFECTS.every(({ implemented, target }) => implemented && target === 'knowledge-text'));
  assert.ok(FUTURE_EFFECTS.every(({ implemented, target }) => !implemented && target === 'knowledge-text'));
  const ids = EFFECT_CATALOG.map(({ id }) => id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    'Effect IDs must be unique across implemented and future catalogs',
  );
  assert.ok(
    EFFECT_CATALOG.every(({ intensity }) => Number.isFinite(intensity) && intensity >= 0 && intensity <= 1),
  );
});
