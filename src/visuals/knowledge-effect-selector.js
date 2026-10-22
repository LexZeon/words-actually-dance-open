import { splitGraphemes } from '../content/text-boundaries.js';
import { EFFECTS } from './effect-catalog.js';
import { SENTENCE_LAYOUTS } from './knowledge-director.js';

const preferredOrder = [
  'waterfall-flow',
  'karaoke',
  'quarter-turn',
  'marker',
  'slide',
  'pop',
  'typewriter',
  'echo',
  'wave',
  'invert',
  'flip',
  'underline',
  'scatter',
  'stack',
  'flash',
  'waterfall',
  'overlay',
  'shake',
  'fold',
  'barrage',
  'glitch',
  'tunnel',
];
const implemented = new Set(EFFECTS.filter(({ implemented }) => implemented).map(({ id }) => id));

/** Alternate stronger movement and calmer reading; include new implemented modes. */
export const AUTOMATIC_EFFECT_ORDER = Object.freeze([
  ...preferredOrder.filter((id) => implemented.has(id)),
  ...[...implemented].filter((id) => !preferredOrder.includes(id)),
]);

const longTextSafe = new Set([
  'typewriter',
  'karaoke',
  'marker',
  'underline',
  'slide',
  'stack',
  'waterfall',
  'echo',
  'overlay',
  'wave',
  'invert',
  'flip',
  'fold',
  'quarter-turn',
  'waterfall-flow',
  'tunnel',
]);

// Only explicitly tagged scripts prefer these scene-compatible alternatives.
// Ordinary inferred scenes may use an independent effect presentation instead.
const compatible = Object.freeze({
  opening: ['tunnel', 'echo', 'slide', 'typewriter', 'fold'],
  definition: ['marker', 'underline', 'karaoke', 'typewriter', 'invert'],
  contrast: ['slide', 'marker', 'underline', 'karaoke', 'typewriter', 'invert', 'echo'],
  steps: ['wave', 'slide', 'typewriter', 'underline', 'karaoke', 'marker'],
  spotlight: ['karaoke', 'marker', 'pop', 'typewriter', 'underline', 'invert'],
  diagonal: ['scatter', 'slide', 'echo', 'typewriter', 'fold'],
  flip: ['flip', 'fold', 'slide', 'echo', 'typewriter'],
  ink: ['tunnel', 'echo', 'marker', 'typewriter', 'karaoke', 'underline'],
});

/**
 * Pick once at sentence entry, never at reveal ticks or audio-frame updates.
 * Index zero keeps the director's opening. For ordinary, untagged short text,
 * every subsequent complete block of catalog-size sentences visits all modes.
 * The next block shifts its order by seven positions; there is no randomness.
 * Explicit author tags and long-text readability take priority over coverage.
 * No AI call, wall timer, text rewrite, or input mutation occurs here.
 * lineCount is deliberately not a seed, so appending text cannot reshuffle it.
 */
export function selectKnowledgeEffect({ scene = {}, line = {}, index = 0, previousEffect } = {}) {
  const count = AUTOMATIC_EFFECT_ORDER.length;
  const position = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0;
  const text = typeof line?.text === 'string' ? line.text : '';
  const long = splitGraphemes(text).length > 38;
  const explicit =
    scene?.directionSource === 'explicit' || Object.hasOwn(SENTENCE_LAYOUTS, line?.sentenceType);
  const primary = implemented.has(scene?.effect) ? scene.effect : 'tunnel';
  const layout = scene?.layout || SENTENCE_LAYOUTS[line?.sentenceType];
  const pool = explicit && Object.hasOwn(compatible, layout) ? compatible[layout] : AUTOMATIC_EFFECT_ORDER;
  const allowed = new Set(pool.filter((id) => implemented.has(id) && (!long || longTextSafe.has(id))));

  if ((position === 0 || explicit) && allowed.has(primary) && primary !== previousEffect) return primary;

  const ordinal = Math.max(0, position - 1);
  const round = Math.floor(ordinal / count);
  const start = ((ordinal % count) + round * 7) % count;
  for (let offset = 0; offset < count; offset++) {
    const id = AUTOMATIC_EFFECT_ORDER[(start + offset) % count];
    if (allowed.has(id) && id !== previousEffect) return id;
  }
  // Implemented typewriter is always a readable baseline for an unknown scene.
  return (
    AUTOMATIC_EFFECT_ORDER.find((id) => (!long || longTextSafe.has(id)) && id !== previousEffect) ||
    'typewriter'
  );
}

export default selectKnowledgeEffect;

/** Explicit author layouts stay active for their compatible effect variants. */
export function usesDirectedKnowledgeLayout(scene, effect) {
  return (
    effect === scene?.effect ||
    (scene?.directionSource === 'explicit' && Boolean(compatible[scene.layout]?.includes(effect)))
  );
}
