const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const positive = (value, fallback = 1) => (Number.isFinite(value) && value > 0 ? value : fallback);
const mix = (from, to, progress) => from + (to - from) * progress;
const smooth = (progress) => progress ** 3 * (progress * (progress * 6 - 15) + 10);
const rotate = (x, y, angleDeg) => {
  const radians = (angleDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
};

function viewportOf(value = {}) {
  return { width: positive(value.width), height: positive(value.height) };
}

function optionsOf(value = {}) {
  return {
    padding: Math.max(0, finite(value.padding, 12)),
    gap: Math.max(0, finite(value.gap, 12)),
    maxHistory: clamp(Math.trunc(finite(value.maxHistory, 4)), 0, 4),
    minFontPx: positive(value.minFontPx, 18),
    maxFontPx: positive(value.maxFontPx, 100),
    targetFontPx: positive(value.targetFontPx, 0),
    historyReserve: clamp(finite(value.historyReserve, 0.12), 0, 0.3),
  };
}

function boundsOf(centerX, centerY, width, height, angleDeg, scale = 1) {
  const radians = (angleDeg * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const halfWidth = ((width * cosine + height * sine) * scale) / 2;
  const halfHeight = ((height * cosine + width * sine) * scale) / 2;
  return {
    left: centerX - halfWidth,
    top: centerY - halfHeight,
    right: centerX + halfWidth,
    bottom: centerY + halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
  };
}

function rotatedWorldBounds(node, angleDeg) {
  const center = rotate(node.centerX, node.centerY, angleDeg);
  return boundsOf(center.x, center.y, node.width, node.height, node.angleDeg + angleDeg);
}

/** Project every word through the same camera; history has no individual scale. */
export function textFlowScreenPose(node, camera, viewport) {
  viewport = viewportOf(viewport);
  const center = rotate(node.centerX - camera.centerX, node.centerY - camera.centerY, camera.angleDeg);
  const pose = {
    width: node.width,
    height: node.height,
    fontPx: node.fontPx,
    centerX: camera.focusX + center.x * camera.zoom,
    centerY: camera.focusY + center.y * camera.zoom,
    angleDeg: node.angleDeg + camera.angleDeg,
    scale: camera.zoom,
    renderedFontPx: node.fontPx * camera.zoom,
  };
  pose.bounds = boundsOf(pose.centerX, pose.centerY, pose.width, pose.height, pose.angleDeg, pose.scale);
  pose.visible =
    pose.bounds.right > 0 &&
    pose.bounds.bottom > 0 &&
    pose.bounds.left < viewport.width &&
    pose.bounds.top < viewport.height;
  pose.clipped =
    pose.bounds.left < -1e-7 ||
    pose.bounds.top < -1e-7 ||
    pose.bounds.right > viewport.width + 1e-7 ||
    pose.bounds.bottom > viewport.height + 1e-7;
  return pose;
}

/** Equivalent to translate(focus) scale(zoom) rotate(angle) translate(-center). */
export function textFlowCameraMatrix(camera) {
  const radians = (camera.angleDeg * Math.PI) / 180;
  const a = camera.zoom * Math.cos(radians);
  const b = camera.zoom * Math.sin(radians);
  const c = -b;
  const d = a;
  return {
    a,
    b,
    c,
    d,
    e: camera.focusX - a * camera.centerX - c * camera.centerY,
    f: camera.focusY - b * camera.centerX - d * camera.centerY,
  };
}

function overlaps(a, b, gap) {
  return (
    a.left < b.right + gap - 1e-7 &&
    a.right > b.left - gap + 1e-7 &&
    a.top < b.bottom + gap - 1e-7 &&
    a.bottom > b.top - gap + 1e-7
  );
}

function adjacentCenter(previous, history, box, angleDeg, gap) {
  if (!previous) return { x: 0, y: 0 };
  // In the destination camera, the previous sentence is a vertical column.
  // Attach the new horizontal phrase to its right, preserving that relation in
  // world space. A four-turn cycle can revisit older text, so find the nearest
  // vacant vertical interval rather than relocating or shrinking old sentences.
  const previousBounds = rotatedWorldBounds(previous, angleDeg);
  const centerX = previousBounds.right + gap + box.width / 2;
  const preferredY = previousBounds.bottom - box.height / 2;
  const obstacles = history.map((node) => rotatedWorldBounds(node, angleDeg));
  const candidates = [
    preferredY,
    (previousBounds.top + previousBounds.bottom) / 2,
    previousBounds.top + box.height / 2,
    ...obstacles.flatMap((bounds) => [
      bounds.top - gap - box.height / 2,
      bounds.bottom + gap + box.height / 2,
    ]),
  ].sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));
  const centerY = candidates.find((candidate) => {
    const bounds = boundsOf(centerX, candidate, box.width, box.height, 0);
    return obstacles.every((obstacle) => !overlaps(bounds, obstacle, gap));
  });
  return rotate(centerX, centerY ?? preferredY, -angleDeg);
}

function cameraFor(node, viewport, angleDeg, options, hasHistory) {
  const padding = Math.min(options.padding, Math.min(viewport.width, viewport.height) / 8);
  const reserve = hasHistory ? viewport.width * options.historyReserve : 0;
  const width = Math.max(0.001, viewport.width - padding * 2 - reserve);
  const height = Math.max(0.001, viewport.height - padding * 2);
  const shape = boundsOf(0, 0, node.width, node.height, node.angleDeg + angleDeg);
  const estimatedCharacters = node.width / node.fontPx;
  const preferredFont =
    options.targetFontPx || (estimatedCharacters <= 8 ? 96 : estimatedCharacters <= 14 ? 80 : 64);
  const desiredFont = clamp(preferredFont, Math.min(options.minFontPx, options.maxFontPx), options.maxFontPx);
  return {
    centerX: node.centerX,
    centerY: node.centerY,
    focusX: padding + reserve + width / 2,
    focusY: viewport.height / 2,
    zoom: Math.min(desiredFont / node.fontPx, width / shape.width, height / shape.height),
    angleDeg,
  };
}

/**
 * Persistent typography on one rotating plane. Coordinates and measured sizes
 * of existing nodes never change. Only a common camera pans, turns and zooms.
 * Caller supplies progress from its shared beat clock; this class has no timer.
 *
 * const flow = new TextFlowLayout();
 * flow.append({ width: 420, height: 80, fontPx: 64 }, viewport, { id: 'line-1' });
 * flow.append({ width: 300, height: 80, fontPx: 64 }, viewport, { id: 'line-2' });
 * const frame = flow.sample(0.5); // paint node world poses once; paint camera each frame
 * flow.resize(nextViewport); // keeps world layout and the same transition progress
 */
export class TextFlowLayout {
  constructor(options = {}) {
    this.options = optionsOf(options);
    this.clear();
  }

  clear() {
    this.nodes = [];
    this.viewport = { width: 1, height: 1 };
    this.currentId = null;
    this.sequence = 0;
    this.progress = 1;
    this.fromCamera = null;
    this.targetCamera = null;
    this.camera = null;
    this.removedIds = [];
    return this.snapshot();
  }

  append(measurement = {}, viewport = this.viewport, options = {}) {
    this.options = optionsOf({ ...this.options, ...options });
    this.viewport = viewportOf(viewport);
    const previous = this.nodes.at(-1);
    const sequence = this.sequence;
    const id = options.id ?? measurement.id ?? `flow-${sequence + 1}`;
    if (this.nodes.some((node) => node.id === id)) throw new Error(`Duplicate text-flow node id: ${id}`);
    const angleDeg = sequence * 90;
    const box = {
      width: positive(measurement.width),
      height: positive(measurement.height),
      fontPx: positive(measurement.fontPx, 64),
    };
    const history = this.options.maxHistory ? this.nodes.slice(-this.options.maxHistory) : [];
    const center = adjacentCenter(previous, history, box, angleDeg, this.options.gap);
    const node = Object.freeze({
      id,
      ...box,
      centerX: center.x,
      centerY: center.y,
      angleDeg: -angleDeg || 0,
      sequence,
    });
    this.removedIds = this.nodes.filter((old) => !history.includes(old)).map((old) => old.id);
    this.nodes = [...history, node];
    this.sequence++;
    this.currentId = id;
    this.fromCamera = this.camera
      ? { ...this.camera }
      : cameraFor(node, this.viewport, angleDeg, this.options, false);
    this.targetCamera = cameraFor(node, this.viewport, angleDeg, this.options, history.length > 0);
    this.progress = previous ? 0 : 1;
    this.updateCamera();
    return this.snapshot();
  }

  sample(progress = this.progress) {
    // A running turn cannot rewind if the shared grid is rebased or resized.
    this.progress = Math.max(this.progress, clamp(finite(progress, this.progress), 0, 1));
    this.updateCamera();
    return this.snapshot();
  }

  resize(viewport, options = {}) {
    this.viewport = viewportOf(viewport);
    this.options = optionsOf({ ...this.options, ...options });
    if (!this.nodes.length) return this.snapshot();
    const current = this.nodes.at(-1);
    const previous = this.nodes.at(-2) || current;
    this.fromCamera = cameraFor(
      previous,
      this.viewport,
      this.fromCamera.angleDeg,
      this.options,
      this.nodes.length > 2,
    );
    this.targetCamera = cameraFor(
      current,
      this.viewport,
      this.targetCamera.angleDeg,
      this.options,
      this.nodes.length > 1,
    );
    this.updateCamera();
    return this.snapshot();
  }

  updateCamera() {
    if (!this.targetCamera) return;
    const amount = smooth(this.progress);
    this.camera = Object.fromEntries(
      ['centerX', 'centerY', 'focusX', 'focusY', 'zoom', 'angleDeg'].map((key) => [
        key,
        mix(this.fromCamera[key], this.targetCamera[key], amount),
      ]),
    );
  }

  snapshot() {
    const nodes = this.nodes.map((node) => {
      const screenPose = textFlowScreenPose(node, this.camera, this.viewport);
      return { ...node, screenPose, bounds: { ...screenPose.bounds } };
    });
    const current = nodes.at(-1);
    return {
      viewport: { ...this.viewport },
      nodes,
      currentId: this.currentId,
      camera: this.camera ? { ...this.camera } : null,
      fromCamera: this.fromCamera ? { ...this.fromCamera } : null,
      targetCamera: this.targetCamera ? { ...this.targetCamera } : null,
      progress: this.progress,
      active: this.progress < 1,
      currentReadable: current ? current.screenPose.renderedFontPx >= this.options.minFontPx - 1e-7 : false,
      currentFits: current ? !current.screenPose.clipped : false,
      removedIds: [...this.removedIds],
    };
  }
}

export { TextFlowLayout as FlowLayout };
