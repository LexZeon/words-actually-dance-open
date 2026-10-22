import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { directKnowledgeEmphasis, EMPHASIS_VARIANTS } from '../src/visuals/knowledge-emphasis.js';
import { phraseEnvelope } from '../src/visuals/knowledge-spacing.js';

test('all eight sentence scenes distinguish primary and supporting words with stable choices', () => {
  const scenes = ['opening', 'definition', 'contrast', 'steps', 'spotlight', 'diagonal', 'flip', 'ink'];
  const choices = scenes.map((scene) => {
    const input = { scene, marker: { text: '概念' }, primaryKeyword: '概念', index: 2 };
    const primary = directKnowledgeEmphasis(input);
    const support = directKnowledgeEmphasis({ ...input, marker: { text: '例子' } });
    assert.deepEqual(directKnowledgeEmphasis(input), primary);
    assert.notEqual(primary.variant, support.variant);
    assert.equal(primary.role, 'primary');
    assert.equal(support.role, 'secondary');
    assert.ok(primary.peakScale > support.peakScale && primary.peakScale <= 1.18);
    return primary.variant;
  });
  assert.equal(new Set(choices).size, 7);
  assert.deepEqual([...new Set(choices)].sort(), [...EMPHASIS_VARIANTS].sort());
});

test('semantic relations affect emphasis without depending on musical frames', () => {
  const base = { scene: 'opening', marker: { text: '概念' }, primaryKeyword: '概念' };
  assert.equal(
    directKnowledgeEmphasis({ ...base, marker: { ...base.marker, relation: { type: 'contrast' } } }).variant,
    'invert',
  );
  assert.equal(
    directKnowledgeEmphasis({ ...base, marker: { ...base.marker, relation: { type: 'progress' } } }).variant,
    'lift',
  );
  assert.equal(
    directKnowledgeEmphasis({ ...base, marker: { ...base.marker, relation: { type: 'part' } } }).variant,
    'ring',
  );
  assert.equal(
    directKnowledgeEmphasis({ ...base, marker: { text: '辅助', relation: { type: 'combine' } } }).variant,
    'weight',
  );
  assert.equal(
    directKnowledgeEmphasis({
      ...base,
      scene: 'constructor',
      marker: { text: '概念', relation: { type: '__proto__' } },
    }).variant,
    'ring',
  );
});

test('finite emphasis displacement is contained by its reserved lane', () => {
  for (const scene of [
    'opening',
    'definition',
    'contrast',
    'steps',
    'spotlight',
    'diagonal',
    'flip',
    'ink',
  ]) {
    const emphasis = directKnowledgeEmphasis({ scene, marker: { text: '关键词' }, primaryKeyword: '关键词' });
    const reserve = phraseEnvelope({
      width: 300,
      fontPx: 27,
      keyword: true,
      karaoke: true,
      ...emphasis.envelope,
    });
    const base = phraseEnvelope({ width: 300, fontPx: 27, keyword: true, karaoke: true });
    assert.ok(reserve.x >= base.x + emphasis.envelope.shiftX);
    assert.ok(reserve.y >= base.y + emphasis.envelope.shiftY);
  }
});

test('each directed choice has actual CSS behaviour; visual weight keeps layout metrics fixed', async () => {
  const css = await fs.readFile(new URL('../src/visuals/extra-effects.css', import.meta.url), 'utf8');
  for (const variant of EMPHASIS_VARIANTS) {
    assert.match(css, new RegExp(`data-emphasis=['"]${variant}['"]`));
    assert.match(css, new RegExp(`@keyframes emphasis-${variant}\\s*\\{`));
  }
  assert.match(css, /data-emphasis='invert'[\s\S]*?background:\s*#e7e7e4/);
  assert.match(css, /data-emphasis='weight'[\s\S]*?-webkit-text-stroke:/);
  assert.match(css, /@keyframes emphasis-lift[\s\S]*?translateY\(-6px\)/);
  assert.match(css, /@keyframes emphasis-offset[\s\S]*?rotate\(/);
  assert.doesNotMatch(css.slice(css.indexOf('/* Automatic emphasis')), /font-weight\s*:/);
});

test('explicit word roles take precedence over legacy keyword equality', () => {
  assert.equal(
    directKnowledgeEmphasis({
      scene: 'contrast',
      marker: { text: '主题', role: 'secondary' },
      primaryKeyword: '主题',
    }).variant,
    'frame',
  );
  assert.equal(
    directKnowledgeEmphasis({
      scene: 'contrast',
      marker: { text: '其他', role: 'primary' },
      primaryKeyword: '主题',
    }).variant,
    'invert',
  );
  assert.equal(
    directKnowledgeEmphasis({
      scene: 'contrast',
      marker: { text: '主题', role: 'unknown' },
      primaryKeyword: '主题',
    }).role,
    'primary',
  );
});
