import test from 'node:test';
import assert from 'node:assert/strict';
import { getLikeKey } from '../src/content/content-identity.js';
import { parseTextScript } from '../src/content/text-script.js';
import { parseScriptInput, stringifyScriptDocument } from '../src/content/script-document.js';
import { restoreCustomScript } from '../src/core/local-state.js';

const custom = (title, texts) => ({ id: 'custom', title, lines: texts.map((text) => ({ text })) });

test('distinct custom notes use different local like keys while retaining the compatible parser id', () => {
  const first = parseTextScript('连接｜连接形成理解。', '材料一');
  const second = parseTextScript('节拍｜节拍提供参照。', '材料二');
  assert.equal(first.id, 'custom');
  assert.equal(second.id, 'custom');
  const likes = new Set([getLikeKey(first)]);
  assert.equal(likes.has(getLikeKey(second)), false);
  assert.match(getLikeKey(first), /^custom-like-v1:[0-9a-f]{32}$/u);
  assert.ok(!getLikeKey(first).includes(first.title));
  assert.ok(!getLikeKey(first).includes(first.lines[0].text));
});

test('the same literal title and lines keep their like key through save, restore and JSON reimport', () => {
  const original = parseTextScript('👩‍💻连接｜👩‍💻连接形成理解。\n节拍｜节拍提供参照。', '我的材料👨‍👩‍👧‍👦');
  const restored = restoreCustomScript(JSON.parse(JSON.stringify(original)));
  const structured = parseScriptInput(stringifyScriptDocument(original));
  const structuredRestored = restoreCustomScript(JSON.parse(JSON.stringify(structured)));
  assert.equal(getLikeKey(restored), getLikeKey(original));
  assert.equal(getLikeKey(structured), getLikeKey(original));
  assert.equal(getLikeKey(structuredRestored), getLikeKey(original));
});

test('title, literal line order and boundaries are identity while runtime and choreography metadata are not', () => {
  const original = custom('说明', ['甲乙', '丙丁']);
  const key = getLikeKey(original);
  for (const different of [
    custom('另一说明', ['甲乙', '丙丁']),
    custom('说明', ['甲', '乙丙丁']),
    custom('说明', ['丙丁', '甲乙']),
    custom('说明', ['甲乙 ', '丙丁']),
  ])
    assert.notEqual(getLikeKey(different), key);
  const presented = {
    ...original,
    emoji: '✦',
    sourceMode: 'free-examples',
    lines: original.lines.map((line, index) => ({
      ...line,
      id: `runtime-${index}`,
      keyword: line.text,
      sentenceType: 'definition',
      holdBeats: 32,
      keywords: [{ text: line.text, role: 'primary' }],
    })),
  };
  assert.equal(getLikeKey(presented), key);
  assert.deepEqual(original, custom('说明', ['甲乙', '丙丁']));
});

test('literal punctuation, quotes and Unicode remain distinct instead of being normalized or concatenated', () => {
  const variants = [
    custom('标题', ['[甲,乙]', '丙']),
    custom('标题', ['[甲', '乙],丙']),
    custom('标题', ['"甲"', '乙']),
    custom('标题', ['甲', '"乙"']),
    custom('标题', ['é']),
    custom('标题', ['e\u0301']),
    custom('标题', ['👩‍💻']),
    custom('标题', ['👩', '💻']),
  ];
  assert.equal(new Set(variants.map(getLikeKey)).size, variants.length);
});

test('built-in content retains its existing like key without depending on title or presentation', () => {
  assert.equal(getLikeKey({ id: 'rhythm' }), 'rhythm');
  assert.equal(getLikeKey({ id: 'resonance', title: '共振', emoji: '✦' }), 'resonance');
});

test('the version-one storage key stays stable for a known UTF-8 document', () => {
  assert.equal(
    getLikeKey(custom('标题', ['连接形成理解。'])),
    'custom-like-v1:290cd6378ab91bdecbda68aa5a07c6a7',
    'Changing the canonical tuple or fingerprint needs an explicit key-version migration',
  );
});
