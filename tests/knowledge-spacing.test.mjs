import test from 'node:test';
import assert from 'node:assert/strict';
import { phraseEnvelope, inkHeadlineFit } from '../src/visuals/knowledge-spacing.js';

test('reserved lane contains long rotating rings and nested karaoke glyphs', () => {
  for (const width of [30, 120, 320])
    for (const fontPx of [21, 27, 42]) {
      const reserve = phraseEnvelope({ width, fontPx, keyword: true, marker: true, karaoke: true });
      const radians = Math.PI / 36;
      const ringWidth = 1.18 * ((width + 18) * Math.cos(radians) + (fontPx + 18) * Math.sin(radians));
      const ringHeight = 1.18 * ((fontPx + 18) * Math.cos(radians) + (width + 18) * Math.sin(radians));
      assert.ok(width + reserve.x * 2 >= ringWidth + fontPx * 0.26);
      assert.ok(fontPx + reserve.y * 2 >= ringHeight + fontPx * 0.26);
      // Enlarged edge glyph remains within the keyword's reserved border.
      assert.ok(width + reserve.x * 2 >= width * 1.18 + fontPx * 0.2 * 1.18);
    }
});

test('ordinary continuous text has no artificial horizontal gap; scaling scenes get a lane', () => {
  const plain = phraseEnvelope({ width: 54, fontPx: 27 });
  const focused = phraseEnvelope({ width: 54, fontPx: 27, focusScale: 1.12 });
  const diagonal = phraseEnvelope({ width: 150, fontPx: 27, focusScale: 1.06, angle: 2 });
  assert.equal(plain.x, 0);
  assert.ok(focused.x > plain.x);
  assert.ok(diagonal.y > plain.y);
});

test('ink bands fit the rotated ghost and foreground after reading height changes', () => {
  const fits = [80, 120, 155].map((readingHeight) =>
    inkHeadlineFit({
      width: 700,
      stageHeight: 200,
      readingHeight,
      measuredWordWidth: 120,
      fontPx: 60,
    }),
  );
  for (const fit of fits) {
    const maximumGhostHeight = fit.fontPx * 1.6 * (Math.cos(Math.PI / 15) + 2 * Math.sin(Math.PI / 15));
    assert.ok(fit.centerY + maximumGhostHeight / 2 <= 200 - fit.readingHeight - fit.gap + 1e-8);
    assert.ok(fit.centerY - maximumGhostHeight / 2 >= -1e-8);
  }
  assert.ok(fits[0].fontPx > fits[1].fontPx && fits[1].fontPx > fits[2].fontPx);
});
