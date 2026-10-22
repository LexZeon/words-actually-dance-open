import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreferences, DEFAULT_PREFERENCES } from '../src/core/preferences.js';

test('malformed numeric settings fall back to defaults instead of becoming minimum intensity or speed', () => {
  for (const value of [null, false, true, '', ' ', [], {}, NaN, Infinity, Symbol('bad')]) {
    const restored = normalizePreferences({ rate: value, intensity: value });
    assert.equal(restored.rate, DEFAULT_PREFERENCES.rate);
    assert.equal(restored.intensity, DEFAULT_PREFERENCES.intensity);
  }
});

test('valid settings clamp safely and old numeric defaults migrate without overwriting other choices', () => {
  assert.equal(normalizePreferences({ intensity: 0.85 }, 1).intensity, 1.25);
  assert.equal(normalizePreferences({ intensity: '.85' }, 1).intensity, 1.25);
  assert.equal(normalizePreferences({ intensity: 0.9 }, 1).intensity, 0.9);
  assert.equal(normalizePreferences({ intensity: 0.85 }, 2).intensity, 0.85);
  assert.deepEqual(
    normalizePreferences({
      rate: '99',
      intensity: '-1',
      emoji: false,
      autoDirection: false,
      repeat: false,
      language: 'zh',
      unknown: 'secret',
    }),
    {
      effect: 'stack',
      rate: 4,
      intensity: 0.15,
      ghostEffect: 'auto',
      ghostFrequency: 0.9,
      emoji: false,
      autoDirection: false,
      repeat: false,
      language: 'zh',
    },
  );
});

test('the UI language is a restored local preference with a safe legacy default', () => {
  assert.equal(normalizePreferences({ language: 'en' }).language, 'en');
  assert.equal(normalizePreferences({ language: 'zh' }).language, 'zh');
  for (const language of [undefined, null, 'fr', 'EN', {}, [], true])
    assert.equal(normalizePreferences({ language }).language, 'zh');
  assert.equal(normalizePreferences({}, 1).language, 'zh');
});

test('keyword ghost choices survive normalization while malformed and old settings use automatic mode', () => {
  for (const ghostEffect of [
    'off',
    'scale-echo',
    'twist-shadow',
    'vertical-lift',
    'horizontal-stretch',
    'glyph-wave',
  ])
    assert.equal(normalizePreferences({ ghostEffect }).ghostEffect, ghostEffect);
  for (const ghostEffect of [undefined, null, true, {}, [], 'unknown', 'AUTO'])
    assert.equal(normalizePreferences({ ghostEffect }).ghostEffect, 'auto');
  assert.equal(normalizePreferences({ intensity: 0.85 }, 1).ghostEffect, 'auto');
});

test('ghost frequency restores a frequent legacy default and preserves normalized endpoints independently of reading', () => {
  assert.equal(DEFAULT_PREFERENCES.ghostFrequency, 0.9);
  for (const schema of [1, 2]) assert.equal(normalizePreferences({}, schema).ghostFrequency, 0.9);
  for (const value of [undefined, null, true, false, '', ' ', [], {}, NaN, Infinity, Symbol('bad')])
    assert.equal(normalizePreferences({ ghostFrequency: value }).ghostFrequency, 0.9);
  for (const [value, expected] of [
    [0, 0],
    [0.2, 0.2],
    ['.9', 0.9],
    [1, 1],
    [-3, 0],
    [8, 1],
  ]) {
    const restored = normalizePreferences({ ghostFrequency: value, rate: 3, ghostEffect: 'off' });
    assert.equal(restored.ghostFrequency, expected);
    assert.equal(restored.rate, 3, 'The frequency preference cannot change knowledge reading speed');
    assert.equal(restored.ghostEffect, 'off', 'A disabled control retains its stored preference');
  }
});
