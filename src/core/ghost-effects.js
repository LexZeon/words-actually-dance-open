/** Shared preference contract for keyword layers; no renderer or audio dependency. */
export const GHOST_EFFECTS = Object.freeze(
  [
    { id: 'scale-echo', label: '缩放回声' },
    { id: 'twist-shadow', label: '左右扭影' },
    { id: 'vertical-lift', label: '纵向升降' },
    { id: 'horizontal-stretch', label: '横向拉伸' },
    { id: 'glyph-wave', label: '字间波浪' },
  ].map((effect) => Object.freeze(effect)),
);

export function normalizeGhostEffect(value) {
  return value === 'off' || GHOST_EFFECTS.some((effect) => effect.id === value) ? value : 'auto';
}
