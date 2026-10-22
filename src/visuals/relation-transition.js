/** Pure character hand-off geometry for concept relationships. */
const clamp = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const smooth = (value) => {
  const p = clamp(value);
  return p * p * p * (p * (p * 6 - 15) + 10);
};
const range = (start, end, value) => smooth((value - start) / (end - start));
const mix = (a, b, amount) => a + (b - a) * amount;

export function relationKind(value = '') {
  const type = String(value).toLowerCase();
  if (/combine|merge|组合|合并|汇聚/u.test(type)) return 'combine';
  if (/expand|split|part|contain|组成|包含|展开|拆分|分解/u.test(type)) return 'expand';
  if (/contrast|compare|对比|对照|相反/u.test(type)) return 'contrast';
  if (/cause|effect|causal|因果|导致|产生/u.test(type)) return 'cause';
  if (/progress|递进|发展|进阶/u.test(type)) return 'progress';
  return 'related';
}

export const RELATION_SYMBOLS = Object.freeze({
  combine: '⊕',
  expand: '⊃',
  cause: '→',
  contrast: '↔',
  progress: '↗',
  related: '↔',
});
const DEFAULT_LABELS = Object.freeze({
  combine: '组合成',
  expand: '由此展开',
  cause: '带来',
  contrast: '对照理解',
  progress: '进一步',
  related: '联系起来',
});

export function cubicPoint(from, c1, c2, to, p) {
  const q = 1 - p;
  return {
    x: q ** 3 * from.x + 3 * q * q * p * c1.x + 3 * q * p * p * c2.x + p ** 3 * to.x,
    y: q ** 3 * from.y + 3 * q * q * p * c1.y + 3 * q * p * p * c2.y + p ** 3 * to.y,
  };
}

export function buildRelationTransition(
  previous,
  targets,
  relation = {},
  { started = 0, duration = 1 } = {},
) {
  const kind = relationKind(relation.type);
  const used = new Set();
  const matches = targets.map((target, index) => {
    let chosen = -1,
      gap = Infinity;
    previous.forEach((source, sourceIndex) => {
      if (used.has(sourceIndex) || source.char !== target.char) return;
      const distance = Math.abs(
        sourceIndex / Math.max(1, previous.length) - index / Math.max(1, targets.length),
      );
      if (distance < gap) {
        chosen = sourceIndex;
        gap = distance;
      }
    });
    if (chosen >= 0) used.add(chosen);
    return chosen;
  });
  // Preserve all common characters before pairing replacements by proximity.
  targets.forEach((target, index) => {
    if (matches[index] >= 0) return;
    let chosen = -1,
      gap = Infinity;
    previous.forEach((source, sourceIndex) => {
      const distance = Math.abs(source.x - target.x);
      if (!used.has(sourceIndex) && distance < gap) {
        chosen = sourceIndex;
        gap = distance;
      }
    });
    if (chosen >= 0) {
      matches[index] = chosen;
      used.add(chosen);
    }
  });
  const records = targets.map((target, index) =>
    record(previous[matches[index]] || null, target, index, targets.length, kind),
  );
  previous.forEach((source, index) => {
    if (!used.has(index)) records.push(record(source, null, index, previous.length, kind));
  });
  return {
    started,
    duration,
    kind,
    records,
    targets,
    from: String(relation.from || previous.map((glyph) => glyph.char).join('')),
    to: String(relation.to || targets.map((glyph) => glyph.char).join('')),
    label: String(relation.label || DEFAULT_LABELS[kind]),
    symbol: RELATION_SYMBOLS[kind],
  };
}

/** Refit destinations without resetting the running transition's musical deadline. */
export function retargetRelationTransition(transition, targets) {
  return {
    ...transition,
    targets,
    records: transition.records.map((entry, index) =>
      index < targets.length
        ? record(
            entry.source.char ? entry.source : null,
            targets[index],
            index,
            targets.length,
            transition.kind,
          )
        : entry,
    ),
  };
}

function record(source, target, index, count, kind) {
  const order = count > 1 ? index / (count - 1) - 0.5 : 0;
  const shared = !!source && !!target && source.char === target.char;
  const baseHub =
    kind === 'combine'
      ? { x: 0, y: 0.045 }
      : kind === 'expand'
        ? { x: 0, y: -0.1 }
        : kind === 'cause'
          ? { x: -0.025, y: -0.035 }
          : kind === 'progress'
            ? { x: order * 0.055, y: -0.115 }
            : { x: 0, y: -0.065 };
  const oldHub = kind === 'contrast' ? { x: order * 0.1, y: -0.14 } : baseHub;
  const newHub = kind === 'contrast' ? { x: -order * 0.1, y: 0.14 } : baseHub;
  const from = source || { char: '', ...oldHub, size: target?.size || 18 };
  const to = target || { char: '', ...newHub, size: source?.size || 18 };
  const sharedLift = kind === 'contrast' ? (order >= 0 ? -0.08 : 0.08) : -0.035;
  const sharedC1 = { x: from.x + (to.x - from.x) * 0.3, y: from.y + sharedLift };
  const sharedC2 = { x: from.x + (to.x - from.x) * 0.7, y: to.y + sharedLift };
  const oldC1 = {
    x: from.x * 0.72 + (kind === 'cause' ? 0.055 : 0),
    y: from.y + (kind === 'combine' ? 0.05 : -0.07),
  };
  const oldC2 = {
    x: oldHub.x - (kind === 'cause' ? 0.1 : 0),
    y: oldHub.y + (kind === 'progress' ? 0.035 : 0),
  };
  const newC1 = {
    x: newHub.x + (kind === 'cause' ? 0.1 : order * 0.035),
    y: newHub.y - (kind === 'expand' ? Math.abs(order) * 0.11 : 0.035),
  };
  const newC2 = {
    x: to.x * 0.82 + (kind === 'progress' ? -0.035 : 0),
    y: to.y + (kind === 'contrast' ? 0.07 : -0.055),
  };
  return {
    source: from,
    target: to,
    shared,
    order,
    oldHub,
    newHub,
    oldC1,
    oldC2,
    newC1,
    newC2,
    sharedC1,
    sharedC2,
  };
}

export function sampleRelationTransition(transition, progress, { reducedMotion = false } = {}) {
  const p = clamp(progress);
  const glyphs = [];
  transition.records.forEach((entry, recordIndex) => {
    const { source, target, order } = entry;
    if (entry.shared) {
      const t = smooth(p);
      const point = reducedMotion
        ? { x: mix(source.x, target.x, t), y: mix(source.y, target.y, t) }
        : cubicPoint(source, entry.sharedC1, entry.sharedC2, target, t);
      glyphs.push({
        ...point,
        char: target.char,
        size: mix(source.size, target.size, t),
        alpha: 1,
        rotation: 0,
        scaleX: 1 + Math.sin(Math.PI * p) * (reducedMotion ? 0.012 : 0.06),
        scaleY: 1 - Math.sin(Math.PI * p) * (reducedMotion ? 0.012 : 0.045),
        order,
        role: 'shared',
        recordIndex,
      });
      return;
    }
    const oldPhase = smooth(p / 0.65);
    const newPhase = smooth((p - 0.22) / 0.78);
    if (source.char) {
      const point = reducedMotion
        ? { x: mix(source.x, target.x, smooth(p)), y: mix(source.y, target.y, smooth(p)) }
        : cubicPoint(source, entry.oldC1, entry.oldC2, entry.oldHub, oldPhase);
      glyphs.push({
        ...point,
        char: source.char,
        size: source.size * (1 - (reducedMotion ? 0.02 : 0.25) * oldPhase),
        alpha: 1 - range(0.38, 0.68, p),
        rotation: reducedMotion ? 0 : order * oldPhase * 0.2,
        scaleX: 1 - oldPhase * (reducedMotion ? 0.01 : 0.12),
        scaleY: 1 + oldPhase * (reducedMotion ? 0.01 : 0.08),
        order,
        role: 'old',
        recordIndex,
      });
    }
    if (target.char) {
      const point = reducedMotion
        ? { x: mix(source.x, target.x, smooth(p)), y: mix(source.y, target.y, smooth(p)) }
        : cubicPoint(entry.newHub, entry.newC1, entry.newC2, target, newPhase);
      glyphs.push({
        ...point,
        char: target.char,
        size: target.size * (0.74 + newPhase * 0.26),
        alpha: range(0.22, 0.52, p),
        rotation: reducedMotion ? 0 : -order * (1 - newPhase) * 0.22,
        scaleX: 1 + (1 - newPhase) * (reducedMotion ? 0.01 : 0.1),
        scaleY: 1 - (1 - newPhase) * (reducedMotion ? 0.01 : 0.07),
        order,
        role: 'new',
        recordIndex,
      });
    }
  });
  return { glyphs, progress: p, connectorOpacity: Math.sin(Math.PI * p) ** 2, kind: transition.kind };
}
