const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const positive = (value, fallback = 1) => (Number.isFinite(value) && value > 0 ? value : fallback);
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const mix = (from, to, progress) => from + (to - from) * progress;
const smooth = (progress) => {
  const p = clamp(finite(progress), 0, 1);
  return p * p * p * (p * (p * 6 - 15) + 10);
};

function measured(value = {}) {
  return {
    width: positive(value.width),
    height: positive(value.height),
    fontPx: positive(value.fontPx, 27),
  };
}

/** Axis-aligned bounds of a center-origin, planar Z-axis rotation. */
export function quarterTurnBounds(value = {}) {
  const width = positive(value.width);
  const height = positive(value.height);
  const scale = Math.max(0, finite(value.scale, 1));
  const radians = (finite(value.angleDeg) * Math.PI) / 180;
  const halfWidth =
    ((width * Math.abs(Math.cos(radians)) + height * Math.abs(Math.sin(radians))) * scale) / 2;
  const halfHeight =
    ((height * Math.abs(Math.cos(radians)) + width * Math.abs(Math.sin(radians))) * scale) / 2;
  const centerX = finite(value.centerX);
  const centerY = finite(value.centerY);
  return {
    left: centerX - halfWidth,
    top: centerY - halfHeight,
    right: centerX + halfWidth,
    bottom: centerY + halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
  };
}

function pose(box, rect, angleDeg, maxScale, extra = {}) {
  const rotation = quarterTurnBounds({ ...box, angleDeg });
  const scale = Math.max(0, Math.min(maxScale, rect.width / rotation.width, rect.height / rotation.height));
  const result = {
    ...box,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    angleDeg,
    scale,
    renderedFontPx: box.fontPx * scale,
    ...extra,
  };
  result.bounds = quarterTurnBounds(result);
  return result;
}

const rectangle = (left, top, width, height) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

/**
 * Pack the current horizontal sentence and up to three measured past sentences.
 * Measurements include the caller's keyword/emphasis envelope; no text is truncated.
 * History indices remain the input indices, so dropping the oldest does not change
 * a sentence's rotation. Its successive targets are 90, 180 and 270 degrees.
 */
export function planQuarterTurnLayout({
  width,
  height,
  current = {},
  history = [],
  padding = 12,
  gap = 12,
  maxHistory = 3,
  minCurrentFontPx = 18,
  minHistoryFontPx = 8,
  maxCurrentScale = 1.35,
} = {}) {
  width = positive(width);
  height = positive(height);
  padding = clamp(finite(padding, 12), 0, Math.min(width, height) / 8);
  gap = clamp(finite(gap, 12), 0, Math.min(width, height) / 16);
  const inner = rectangle(padding, padding, width - padding * 2, height - padding * 2);
  const currentBox = measured(current);
  const old = (Array.isArray(history) ? history : []).map(measured);
  const count = Math.min(old.length, clamp(Math.trunc(finite(maxHistory, 3)), 0, 3));
  const currentFloor = positive(minCurrentFontPx, 18);
  const oldFloor = positive(minHistoryFontPx, 8);
  maxCurrentScale = positive(maxCurrentScale, 1.35);
  const fullCurrent = pose(currentBox, inner, 0, maxCurrentScale);

  // Prefer readable foreground type. A very long, already-wrapped measurement
  // may still be physically too large; return its real fit rather than overflow.
  let selected = { current: fullCurrent, history: [], readingRect: inner };
  for (let retained = count; retained > 0; retained--) {
    const side = inner.width * 0.14;
    const top = retained > 1 ? inner.height * 0.24 : 0;
    const reading = rectangle(
      inner.left + side + gap,
      inner.top + top + (top ? gap : 0),
      inner.width - side - gap - (retained > 2 ? side + gap : 0),
      inner.height - top - (top ? gap : 0),
    );
    if (reading.width <= 0 || reading.height <= 0) continue;
    const foreground = pose(currentBox, reading, 0, maxCurrentScale);
    if (foreground.renderedFontPx + 1e-8 < Math.min(currentFloor, fullCurrent.renderedFontPx)) continue;
    const slots = [
      rectangle(inner.left, reading.top, side, reading.height),
      rectangle(inner.left, inner.top, inner.width, top),
      rectangle(inner.right - side, reading.top, side, reading.height),
    ];
    const placed = old
      .slice(0, retained)
      .map((box, age) => pose(box, slots[age], (age + 1) * 90, 0.74 - age * 0.1, { index: age, age }));
    // The newly retired sentence always gets a complete 90-degree movement.
    // Older type may leave the scene when preserving it would reduce readability.
    if (placed.slice(1).some((entry) => entry.renderedFontPx < oldFloor)) continue;
    selected = { current: foreground, history: placed, readingRect: reading };
    break;
  }
  const present = new Set(selected.history.map((entry) => entry.index));
  return {
    width,
    height,
    ...selected,
    currentReadable: selected.current.renderedFontPx >= currentFloor - 1e-8,
    omitted: old.flatMap((_, index) => (present.has(index) ? [] : [index])),
  };
}

function fitEndpoint(value, width, height) {
  const box = measured(value);
  const angleDeg = finite(value?.angleDeg);
  const rotation = quarterTurnBounds({ ...box, angleDeg });
  const scale = Math.max(
    0,
    Math.min(finite(value?.scale, 1), width / rotation.width, height / rotation.height),
  );
  const halfWidth = (rotation.width * scale) / 2;
  const halfHeight = (rotation.height * scale) / 2;
  const result = {
    ...box,
    ...value,
    width: box.width,
    height: box.height,
    fontPx: box.fontPx,
    angleDeg,
    scale,
    centerX: clamp(finite(value?.centerX, width / 2), halfWidth, width - halfWidth),
    centerY: clamp(finite(value?.centerY, height / 2), halfHeight, height - halfHeight),
    renderedFontPx: box.fontPx * scale,
  };
  result.bounds = quarterTurnBounds(result);
  return result;
}

/**
 * Sample by shared-clock progress, never elapsed wall time. First shrink in place,
 * then turn/move, then enlarge in the destination slot. The middle phase reserves
 * the full diagonal circle, so a long sentence also fits at 45/135/225 degrees.
 * New readable text should be withheld until this turn finishes; this function
 * guarantees stage containment, while the final layout provides disjoint slots.
 */
export function sampleQuarterTurnTransition({ from, to, width, height } = {}, progress = 0) {
  width = positive(width);
  height = positive(height);
  from = fitEndpoint(from || {}, width, height);
  to = fitEndpoint(to || from, width, height);
  progress = clamp(finite(progress), 0, 1);
  const radius = Math.max(Math.hypot(from.width, from.height), Math.hypot(to.width, to.height)) / 2;
  const clearance = Math.min(
    from.centerX,
    from.centerY,
    width - from.centerX,
    height - from.centerY,
    to.centerX,
    to.centerY,
    width - to.centerX,
    height - to.centerY,
  );
  const safeScale = Math.min(from.scale, to.scale, Math.max(0, clearance) / radius);
  let phase, amount, result;
  if (progress < 0.22) {
    phase = 'shrink';
    amount = smooth(progress / 0.22);
    result = { ...from, scale: mix(from.scale, safeScale, amount) };
  } else if (progress < 0.8) {
    phase = 'turn';
    amount = smooth((progress - 0.22) / 0.58);
    result = {
      ...from,
      width: mix(from.width, to.width, amount),
      height: mix(from.height, to.height, amount),
      fontPx: mix(from.fontPx, to.fontPx, amount),
      centerX: mix(from.centerX, to.centerX, amount),
      centerY: mix(from.centerY, to.centerY, amount),
      angleDeg: mix(from.angleDeg, to.angleDeg, amount),
      scale: safeScale,
    };
  } else {
    phase = 'settle';
    amount = smooth((progress - 0.8) / 0.2);
    result = { ...to, scale: mix(safeScale, to.scale, amount) };
  }
  result.renderedFontPx = result.fontPx * result.scale;
  result.bounds = quarterTurnBounds(result);
  return { ...result, progress, phase, finished: progress === 1 };
}
