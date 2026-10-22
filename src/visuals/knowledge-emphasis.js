/** Stable sentence/role direction. No random styles, text changes or independent clock. */
export const EMPHASIS_VARIANTS = Object.freeze([
  'ring',
  'underline',
  'invert',
  'weight',
  'lift',
  'offset',
  'frame',
]);

const PALETTES = Object.freeze({
  opening: ['frame', 'weight'],
  definition: ['ring', 'underline'],
  contrast: ['invert', 'frame'],
  steps: ['lift', 'underline'],
  spotlight: ['weight', 'lift'],
  diagonal: ['offset', 'weight'],
  flip: ['underline', 'offset'],
  ink: ['frame', 'underline'],
});
const RELATIONS = Object.freeze({
  contrast: ['invert', 'underline'],
  limit: ['invert', 'underline'],
  cause: ['lift', 'offset'],
  effect: ['lift', 'offset'],
  combine: ['frame', 'weight'],
  coordination: ['frame', 'weight'],
  expand: ['ring', 'underline'],
  part: ['ring', 'underline'],
  progress: ['lift', 'underline'],
  direction: ['lift', 'underline'],
});

export function directKnowledgeEmphasis({
  scene = 'definition',
  marker = {},
  primaryKeyword = '',
  index = 0,
} = {}) {
  const role =
    marker.role === 'primary' || marker.role === 'secondary'
      ? marker.role
      : marker.text === primaryKeyword
        ? 'primary'
        : 'secondary';
  const relation = marker.relation?.type;
  const layout = typeof scene === 'string' ? scene : scene?.layout;
  const palette = Object.hasOwn(RELATIONS, relation)
    ? RELATIONS[relation]
    : Object.hasOwn(PALETTES, layout)
      ? PALETTES[layout]
      : PALETTES.definition;
  const variant = palette[role === 'primary' ? 0 : 1];
  return Object.freeze({
    variant,
    role,
    peakScale: role === 'primary' ? 1.18 : 1.1,
    direction: index % 2 ? -1 : 1,
    envelope: Object.freeze({
      marker: variant === 'ring',
      decorationPx: variant === 'frame' ? 6 : 0,
      shiftX: variant === 'offset' ? 3 : 0,
      shiftY: variant === 'lift' ? 6 : variant === 'underline' ? 3 : 0,
      angle: variant === 'offset' ? 2 : 0,
    }),
  });
}
