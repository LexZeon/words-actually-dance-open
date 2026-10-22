import { EFFECTS } from '../visuals/effect-catalog.js';
import { normalizeGhostEffect } from './ghost-effects.js';
import { normalizeLocale } from './i18n.js';

export const DEFAULT_PREFERENCES = Object.freeze({
  effect: 'stack',
  rate: 2,
  intensity: 1.25,
  ghostEffect: 'auto',
  ghostFrequency: 0.9,
  emoji: true,
  autoDirection: true,
  repeat: true,
  language: 'zh',
});

/** A normalized preference; the UI's percentage is converted at its input edge. */
export function normalizeGhostFrequency(value) {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : DEFAULT_PREFERENCES.ghostFrequency;
}

export function normalizePreferences(value = {}, schemaVersion = 2) {
  const p = { ...DEFAULT_PREFERENCES, ...value };
  const numeric = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);
  const number = (v, fallback, min, max) =>
    Number.isFinite(numeric(v)) ? Math.min(max, Math.max(min, numeric(v))) : fallback;
  if (!EFFECTS.some((effect) => effect.id === p.effect)) p.effect = DEFAULT_PREFERENCES.effect;
  p.ghostEffect = normalizeGhostEffect(p.ghostEffect);
  p.ghostFrequency = normalizeGhostFrequency(p.ghostFrequency);
  p.language = normalizeLocale(p.language);
  p.rate = Math.round(number(p.rate, 2, 1, 4));
  p.intensity =
    schemaVersion < 2 && Math.abs(numeric(p.intensity) - 0.85) < 0.001
      ? 1.25
      : number(p.intensity, 1.25, 0.15, 2.5);
  for (const key of ['emoji', 'autoDirection', 'repeat'])
    p[key] = typeof p[key] === 'boolean' ? p[key] : DEFAULT_PREFERENCES[key];
  return Object.fromEntries(Object.keys(DEFAULT_PREFERENCES).map((key) => [key, p[key]]));
}
