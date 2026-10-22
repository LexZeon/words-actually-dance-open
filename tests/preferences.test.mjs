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
