import { MusicSectionDetector } from '../audio/music-section.js';
import { onsetAgeSeconds, onsetEnvelope, onsetPriority } from './onset-priority.js';

/**
 * Finite one-beat choreography with optional continuous two-beat body paths.
 * The shared grid latches combinations and phase; sampling never creates beats.
 * Phase means beat phase and relative character timing, not waveform phase.
 */
export const MOTIONS = Object.freeze(
  [
    { id: 'toss', label: '上抛' },
    { id: 'drop', label: '下压回弹' },
    { id: 'sway', label: '侧摆' },
    { id: 'twist', label: '扭转翻摆' },
    { id: 'stretch', label: '拉伸' },
    { id: 'wave', label: '字符波浪' },
    { id: 'scatter', label: '散开聚拢' },
    { id: 'spiral', label: '旋进' },
  ].map(Object.freeze),
);

/** Optional continuous cycles augment, rather than replace, the eight finite beats. */
export const MOTION_CYCLES = Object.freeze(
  [
    { id: 'alternating-twist', label: '两拍左右扭转', durationBeats: 2 },
    { id: 'alternating-sway', label: '两拍左右摇摆', durationBeats: 2 },
  ].map(Object.freeze),
);
const cycleIds = new Set(MOTION_CYCLES.map(({ id }) => id));

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const unit = (value) => clamp(finite(value), 0, 1);
const signed = (value) => clamp(finite(value), -1, 1);
const ease = (value) => {
  const p = unit(value);
  return p * p * p * (p * (p * 6 - 15) + 10);
};
const FEATURE_SMOOTHING_SECONDS = Object.freeze({
  amplitude: 0.07,
  energy: 0.07,
  strength: 0.045,
  attack: 0.045,
  frequencyHz: 0.12,
  brightness: 0.1,
  noisiness: 0.08,
  amplitudeTrend: 0.085,
  frequencyTrend: 0.11,
  pitchTrend: 0.11,
  bass: 0.1,
  mid: 0.1,
  treble: 0.1,
  deliveryDrive: 0.12,
});
const motionStrength = (features) =>
  0.3 + Math.max(features.strength, features.attack) * 0.36 + features.energy * 0.34;
const secondaryWeight = (features) => 0.24 + features.attack * 0.18;

export function normalizeMotionFeatures(features = {}) {
  const pitchConfidence = unit(features.pitchConfidence);
  const brightness = unit(features.timbreBrightness ?? features.brightness);
  const pitchTrend = pitchConfidence >= 0.85 ? signed(features.pitchTrend) : 0;
  return {
    energy: unit(features.energy),
    bass: unit(features.bass),
    mid: unit(features.mid),
    treble: unit(features.treble),
    brightness,
    noisiness: unit(features.noisiness),
    attack: unit(features.attack ?? features.onset),
    strength: unit(features.strength ?? features.onset),
    amplitudeTrend: signed(features.amplitudeTrend),
    frequencyTrend: signed(features.frequencyTrend),
    pitchConfidence,
    pitchTrend,
    beatPhase: unit(features.beatPhase ?? features.phase),
    frequencyHz: Math.max(0, finite(features.frequencyHz ?? features.centroidHz)),
    amplitude: unit(features.amplitude ?? features.rms),
    bpm: clamp(finite(features.bpm, 120) || 120, 30, 300),
    deliveryDrive: unit(features.delivery?.drive ?? features.deliveryDrive),
  };
}

/** Frame-rate-independent modulation; clock phase is deliberately never filtered. */
function smoothMotionFeatures(previous, current, elapsed) {
  const next = { ...current };
  const dt = clamp(finite(elapsed), 0, 0.25);
  for (const [key, seconds] of Object.entries(FEATURE_SMOOTHING_SECONDS)) {
    const amount = 1 - Math.exp(-dt / seconds);
    if (key === 'frequencyHz') {
      // Frequency is perceived proportionally; interpolation in log space also
      // prevents one bright consonant from snapping the whole word upward.
      next[key] = Math.expm1(
        Math.log1p(previous[key]) + (Math.log1p(current[key]) - Math.log1p(previous[key])) * amount,
      );
    } else next[key] = previous[key] + (current[key] - previous[key]) * amount;
  }
  if (current.pitchConfidence < 0.85) next.pitchTrend = 0;
  return next;
}

export function chooseMotionCandidate(features = {}) {
  const f = normalizeMotionFeatures(features);
  const trend = signed(
    f.amplitudeTrend * 0.72 + f.frequencyTrend * 0.46 + f.pitchTrend * f.pitchConfidence * 0.65,
  );
  let primary;
  if (trend > 0.22) primary = 'toss';
  else if (trend < -0.22) primary = 'drop';
  else if (f.noisiness > 0.65 && f.attack > 0.35) primary = 'scatter';
  else if (f.bass > 0.5 && f.attack > 0.45) primary = 'stretch';
  else if (f.brightness > 0.7 && f.frequencyTrend > 0.12) primary = 'twist';
  else if (f.treble > 0.45 && f.mid > 0.35) primary = 'wave';
  else if (f.brightness > 0.68 && f.bass < 0.4) primary = 'spiral';
  else primary = 'sway';
  const secondary = {
    toss: f.brightness > 0.55 ? 'wave' : 'twist',
    drop: 'stretch',
    sway: f.attack > 0.5 ? 'drop' : 'wave',
    twist: f.noisiness > 0.5 ? 'scatter' : 'sway',
    stretch: trend > 0.06 ? 'toss' : 'drop',
    wave: f.amplitudeTrend > 0.15 ? 'toss' : 'sway',
    scatter: 'twist',
    spiral: 'stretch',
  }[primary];
  const cycle = ['twist', 'stretch', 'spiral'].includes(primary)
    ? 'alternating-twist'
    : ['sway', 'wave'].includes(primary)
      ? 'alternating-sway'
      : null;
  return { primary, secondary, trend, cycle };
}

export function createMotionCommand(
  features = {},
  beatIndex = 0,
  selection = chooseMotionCandidate(features),
) {
  const f = normalizeMotionFeatures(features);
  return Object.freeze({
    primary: selection.primary,
    secondary: selection.secondary,
    beatIndex,
    direction: beatIndex % 2 ? 1 : -1,
    duration: clamp((60 / f.bpm) * 0.96, 0.25, 1.2),
    strength: motionStrength(f),
    secondaryWeight: secondaryWeight(f),
    trend: selection.trend,
    cycle: cycleIds.has(selection.cycle) ? selection.cycle : null,
    features: Object.freeze(f),
  });
}

/** Compare measured beat summaries; one sharp sample alone cannot switch a dance. */
export function musicChangeEvidence(baseline, current) {
  if (!baseline) return { changed: false, score: 0, cues: [] };
  const before = normalizeMotionFeatures(baseline),
    after = normalizeMotionFeatures(current);
  const cues = [
    { id: 'tempo', score: Math.abs(Math.log(after.bpm / before.bpm)) / 0.13 },
    {
      id: 'frequency',
      score:
        (Math.abs(after.bass - before.bass) +
          Math.abs(after.mid - before.mid) +
          Math.abs(after.treble - before.treble)) /
        0.78,
    },
    {
      id: 'timbre',
      score:
        (Math.abs(after.brightness - before.brightness) + Math.abs(after.noisiness - before.noisiness)) /
        0.58,
    },
    { id: 'attack', score: Math.abs(after.attack - before.attack) / 0.4 },
    { id: 'amplitude', score: Math.abs(after.energy - before.energy) / 0.45 },
    {
      id: 'trend',
      score:
        (Math.abs(after.amplitudeTrend - before.amplitudeTrend) +
          Math.abs(after.frequencyTrend - before.frequencyTrend) +
          Math.abs(after.pitchTrend - before.pitchTrend)) /
        0.85,
    },
  ];
  const score = Math.max(...cues.map((cue) => cue.score));
  return { changed: score >= 1, score, cues: cues.filter((cue) => cue.score >= 1).map((cue) => cue.id) };
}

export function neutralMotion(glyphCount = 0) {
  return {
    group: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    glyphs: Array.from({ length: glyphCount }, () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })),
    phase: 1,
    envelope: 0,
    primary: null,
    secondary: null,
    gain: 0,
  };
}

export function sampleMotion(
  command,
  phase,
  { glyphCount = 1, intensity = 1.25, reducedMotion = false, glyphOrders, features } = {},
) {
  const output = neutralMotion(glyphCount);
  if (Array.isArray(glyphOrders))
    output.glyphs.forEach((glyph, index) => {
      glyph.order = finite(glyphOrders[index], glyphCount > 1 ? index / (glyphCount - 1) - 0.5 : 0);
    });
  if (!command) return output;
  const p = unit(phase);
  output.phase = p;
  output.primary = command.primary;
  output.secondary = command.secondary;
  output.envelope = Math.sin(Math.PI * p) ** 2;
  // The beat command latches choreography and timing, not all musical values.
  // Live, filtered measurements continue shaping this same finite trajectory.
  const f = features ? normalizeMotionFeatures(features) : command.features;
  const motionCommand = { ...command, features: f };
  const amplitudeLevel =
    f.amplitude > 0 ? unit(Math.log1p(f.amplitude * 35) / Math.log1p(0.35 * 35)) : f.energy;
  const gain =
    clamp(finite(intensity, 1.25), 0.15, 2.5) *
    motionStrength(f) *
    (0.28 + amplitudeLevel * 0.72) *
    (1 + f.amplitudeTrend * 0.18) *
    (1 + f.deliveryDrive * 0.22) *
    (reducedMotion ? 0.09 : 1);
  output.gain = gain;
  if (p === 0 || p === 1) return output;
  applyPattern(output, command.primary, p, gain, motionCommand);
  applyPattern(output, command.secondary, p, gain * secondaryWeight(f), motionCommand);
  // Continuous musical parameters shape every held combination, independently
  // of which named patterns are latched. This is not eight fixed presets.
  const h = output.envelope;
  const frequencyLevel =
    f.frequencyHz > 0
      ? unit(Math.log2(Math.max(80, f.frequencyHz) / 80) / Math.log2(12000 / 80))
      : f.brightness;
  const tilt = Math.sin(p * Math.PI * 2 + f.beatPhase * Math.PI * 0.65) * h;
  output.group.y -=
    h * gain * (f.amplitudeTrend * 0.05 + f.frequencyTrend * 0.04 + f.pitchTrend * f.pitchConfidence * 0.045);
  output.group.rotation += tilt * gain * (0.025 + f.brightness * 0.07 + frequencyLevel * 0.06);
  output.group.rotation += Math.sin(p * Math.PI * 6) * h * gain * f.noisiness * 0.075;
  output.group.scaleY += f.amplitudeTrend * h * gain * 0.07;
  // Denser, more animated music adds two brisk details inside the same beat.
  // It changes articulation, never the shared cycle speed or beat identity.
  const detail = Math.sin(p * Math.PI * 4) * h * gain * f.deliveryDrive;
  output.group.y -= Math.abs(detail) * 0.035;
  output.group.scaleX += detail * 0.045;
  output.group.scaleY -= detail * 0.035;
  output.glyphs.forEach((glyph, index) => {
    const order = Number.isFinite(glyph.order)
      ? glyph.order
      : glyphCount > 1
        ? index / (glyphCount - 1) - 0.5
        : 0;
    const phaseOffset = order * Math.PI * 1.7 + f.beatPhase * Math.PI;
    glyph.y +=
      Math.sin(p * Math.PI * 2 - phaseOffset) * h * gain * (0.01 + frequencyLevel * 0.02) * f.brightness;
    glyph.rotation += Math.sin(p * Math.PI * 8 + phaseOffset) * h * gain * f.noisiness * 0.055;
    glyph.scaleX += Math.sin(p * Math.PI * 2) * h * gain * f.attack * 0.06;
    glyph.y += Math.sin(p * Math.PI * 4 - phaseOffset) * h * gain * f.deliveryDrive * 0.025;
  });
  output.group.rotation = clamp(output.group.rotation, -0.95, 0.95);
  output.group.scaleX = clamp(output.group.scaleX, 0.4, 1.95);
  output.group.scaleY = clamp(output.group.scaleY, 0.4, 1.95);
  for (const glyph of output.glyphs) {
    glyph.rotation = clamp(glyph.rotation, -1.2, 1.2);
    glyph.scaleX = clamp(glyph.scaleX, 0.5, 1.7);
    glyph.scaleY = clamp(glyph.scaleY, 0.5, 1.7);
  }
  return output;
}

/** A true two-beat path: even beat turns left, odd beat turns right, then repeats. */
export function sampleMotionCycle(
  command,
  {
    beatIndex = command?.beatIndex ?? 0,
    beatPhase = 0,
    glyphCount = 1,
    intensity = 1.25,
    reducedMotion = false,
    glyphOrders,
    features,
  } = {},
) {
  const output = neutralMotion(glyphCount);
  const index = Number.isSafeInteger(beatIndex) && beatIndex >= 0 ? beatIndex : 0;
  const phase = unit(beatPhase);
  const beatWithinCycle = index % 2;
  const cyclePhase = ((beatWithinCycle + phase) % 2) / 2;
  const id = cycleIds.has(command?.cycle) ? command.cycle : null;
  output.cycle = {
    id,
    active: Boolean(id),
    durationBeats: id ? 2 : 0,
    beatIndex: index,
    beatWithinCycle,
    phase: cyclePhase,
    direction: !id || phase === 0 || phase === 1 ? 'rest' : beatWithinCycle === 0 ? 'left' : 'right',
    source: 'internal-grid',
  };
  if (!id) return output;
  const f = features ? normalizeMotionFeatures(features) : command.features;
  const level = f.amplitude > 0 ? unit(Math.log1p(f.amplitude * 35) / Math.log1p(0.35 * 35)) : f.energy;
  const gain =
    clamp(finite(intensity, 1.25), 0.15, 2.5) *
    motionStrength(f) *
    (0.28 + level * 0.72) *
    (1 + f.amplitudeTrend * 0.18) *
    (1 + f.deliveryDrive * (0.38 + Math.sin(phase * Math.PI * 4) * 0.12)) *
    (reducedMotion ? 0.09 : 1);
  output.gain = gain;
  if (phase === 0 || phase === 1) return output;
  const turn = -Math.sin(cyclePhase * Math.PI * 2);
  const body = turn * turn;
  const frequency =
    f.frequencyHz > 0
      ? unit(Math.log2(Math.max(80, f.frequencyHz) / 80) / Math.log2(12000 / 80))
      : f.brightness;
  const twist = id === 'alternating-twist';
  output.group.x += turn * gain * (twist ? 0.045 + f.bass * 0.035 : 0.085 + frequency * 0.035);
  output.group.rotation +=
    turn *
    gain *
    (twist ? 0.4 + f.brightness * 0.32 + frequency * 0.12 : 0.2 + f.brightness * 0.1 + frequency * 0.045);
  output.group.y -=
    body *
    gain *
    (0.025 +
      frequency * 0.035 +
      f.amplitudeTrend * 0.04 +
      f.frequencyTrend * 0.035 +
      f.pitchTrend * f.pitchConfidence * 0.035);
  output.group.scaleX -= body * gain * (twist ? 0.16 + f.attack * 0.09 : 0.035 + f.bass * 0.035);
  output.group.scaleY += body * gain * (0.035 + f.attack * 0.055 + f.amplitudeTrend * 0.04);
  const detail = Math.sin(phase * Math.PI * 4) * body * gain * f.deliveryDrive;
  output.group.y -= Math.abs(detail) * 0.025;
  output.group.scaleY += detail * 0.035;
  output.glyphs.forEach((glyph, position) => {
    const order = Number.isFinite(glyphOrders?.[position])
      ? glyphOrders[position]
      : glyphCount > 1
        ? position / (glyphCount - 1) - 0.5
        : 0;
    glyph.order = order;
    glyph.x += turn * order * gain * (0.025 + f.brightness * 0.025);
    glyph.y +=
      Math.sin(cyclePhase * Math.PI * 2 - order * Math.PI) *
      body *
      gain *
      (0.008 + frequency * 0.015) *
      f.brightness;
    glyph.rotation += turn * order * gain * (0.12 + f.noisiness * 0.12);
    glyph.scaleX += body * gain * f.attack * 0.03;
    glyph.y += Math.sin(phase * Math.PI * 4 - order * Math.PI) * body * gain * f.deliveryDrive * 0.016;
  });
  return output;
}

function applyPattern(output, id, p, gain, command) {
  const f = command.features;
  const h = Math.sin(Math.PI * p) ** (1.35 + f.attack * 1.2);
  const swing = Math.sin(Math.PI * 2 * p) * h;
  const direction = command.direction;
  const frequencyLevel =
    f.frequencyHz > 0
      ? unit(Math.log2(Math.max(80, f.frequencyHz) / 80) / Math.log2(12000 / 80))
      : f.brightness;
  const lift = 0.75 + frequencyLevel * 0.6;
  const twist = 0.72 + f.brightness * 0.65;
  const elastic = 0.75 + f.attack * 0.5;
  const group = output.group;
  if (id === 'toss') {
    group.y -= 0.19 * h * gain * lift;
    group.rotation += direction * 0.085 * swing * gain;
    group.scaleY += 0.08 * swing * gain;
  } else if (id === 'drop') {
    const rebound = p > 0.5 ? Math.sin(Math.PI * (p - 0.5) * 2) ** 2 : 0;
    group.y += (0.14 * h - (0.09 + f.attack * 0.08) * rebound) * gain * lift;
    group.scaleX += (0.18 * h - 0.08 * rebound) * gain * elastic;
    group.scaleY -= (0.16 * h - 0.12 * rebound) * gain * elastic;
  } else if (id === 'sway') {
    group.x += direction * 0.072 * swing * gain;
    group.rotation += direction * 0.14 * swing * gain;
    group.y -= 0.035 * h * gain;
  } else if (id === 'twist') {
    group.rotation += direction * 0.56 * swing * gain * twist;
    group.scaleX -= 0.47 * h * gain;
    group.y -= 0.045 * h * gain;
  } else if (id === 'stretch') {
    group.scaleX += 0.32 * swing * gain * elastic;
    group.scaleY -= 0.38 * swing * gain * elastic;
    group.y += 0.045 * swing * gain;
  } else if (id === 'wave') {
    group.y -= 0.025 * h * gain;
  } else if (id === 'scatter') {
    group.scaleX -= 0.08 * h * gain;
    group.y -= 0.055 * h * gain;
  } else if (id === 'spiral') {
    group.x += direction * 0.044 * swing * gain;
    group.y -= 0.1 * Math.sin(Math.PI * p) * Math.sin(Math.PI * 2 * p) ** 2 * gain;
    group.rotation += direction * 0.65 * swing * gain * twist;
    group.scaleX += 0.1 * h * gain;
    group.scaleY += 0.1 * h * gain;
  }
  const count = output.glyphs.length;
  output.glyphs.forEach((glyph, index) => {
    const order = Number.isFinite(glyph.order) ? glyph.order : count > 1 ? index / (count - 1) - 0.5 : 0;
    const relativePhase = Math.PI * 2 * p - order * Math.PI * 1.7 + command.features.beatPhase * Math.PI;
    if (id === 'wave') {
      glyph.y += Math.sin(relativePhase) * 0.14 * h * gain * lift;
      glyph.rotation += Math.cos(relativePhase) * 0.15 * h * gain;
    } else if (id === 'scatter') {
      glyph.x += order * 0.19 * h * gain * (0.72 + frequencyLevel * 0.56);
      glyph.y -= Math.abs(order) * 0.12 * h * gain;
      glyph.rotation += order * 1.05 * h * gain;
    } else if (id === 'spiral') {
      glyph.x += order * 0.06 * h * gain;
      glyph.y += Math.sin(order * Math.PI * 2 + p * Math.PI * 2) * 0.07 * h * gain;
      glyph.rotation += direction * order * 0.8 * h * gain;
    } else if (id === 'toss') {
      glyph.y -= Math.sin(p * Math.PI) * Math.abs(order) * 0.04 * h * gain;
    } else if (id === 'twist') {
      glyph.rotation += order * 0.34 * h * gain;
    }
  });
}

function addMotion(target, source, weight) {
  for (const key of ['x', 'y', 'rotation']) target.group[key] += source.group[key] * weight;
  for (const key of ['scaleX', 'scaleY']) target.group[key] += (source.group[key] - 1) * weight;
  target.glyphs.forEach((glyph, index) => {
    const from = source.glyphs[index] || source.glyphs.at(-1);
    if (!from) return;
    for (const key of ['x', 'y', 'rotation']) glyph[key] += from[key] * weight;
    for (const key of ['scaleX', 'scaleY']) glyph[key] += (from[key] - 1) * weight;
  });
  return target;
}

/** Audio-labelled spectral proxies, rather than instruments or virtual grid hits. */
const drumKinds = new Set(['thump', 'snap', 'tick']);

function applyDrumAccent(output, accent, gain, features, glyphOrders) {
  const f = normalizeMotionFeatures(features);
  const frequency = unit(Math.log2(Math.max(80, f.frequencyHz) / 80) / Math.log2(12000 / 80));
  const level = unit(Math.log1p(f.amplitude * 35) / Math.log1p(0.35 * 35));
  const drive = gain * (0.75 + level * 0.25);
  const group = output.group;
  if (accent.kind === 'thump') {
    // A low, weighty hit compresses the whole word into a grounded stance.
    group.y += drive * (0.045 + f.bass * 0.045);
    group.scaleX += drive * (0.17 + f.attack * 0.08);
    group.scaleY -= drive * (0.14 + f.bass * 0.075);
  } else if (accent.kind === 'snap') {
    // A broad sharp attack lifts and opens the letters, without camera shake.
    group.y -= drive * (0.038 + frequency * 0.025 + f.frequencyTrend * 0.01);
    group.scaleX += drive * 0.1;
    group.scaleY += drive * (0.035 + f.amplitudeTrend * 0.025);
  }
  output.glyphs.forEach((glyph, index) => {
    const order = Number.isFinite(glyphOrders?.[index])
      ? glyphOrders[index]
      : output.glyphs.length > 1
        ? index / (output.glyphs.length - 1) - 0.5
        : 0;
    if (accent.kind === 'thump') {
      glyph.y += Math.abs(order) * drive * 0.012;
      glyph.scaleX += drive * 0.02;
    } else if (accent.kind === 'snap') {
      glyph.x += order * drive * (0.032 + f.brightness * 0.018);
      glyph.rotation += order * drive * (0.09 + f.noisiness * 0.1);
    } else {
      // Small high-frequency ticks stay with the characters, keeping the body
      // cycle readable even when hats subdivide a slow two-beat swing.
      const ripple = 0.72 + Math.cos(order * Math.PI + f.beatPhase * Math.PI * 2) * 0.28;
      glyph.y -= drive * ripple * (0.012 + frequency * 0.014);
      glyph.scaleX += drive * ripple * (0.04 + f.brightness * 0.035);
      glyph.scaleY += drive * ripple * 0.045;
    }
  });
}

export class MotionDirector {
  constructor({ intensity = 1.25 } = {}) {
    this.intensity = clamp(finite(intensity, 1.25), 0.15, 2.5);
    this.beatCount = 0;
    this.clockBeatIndex = null;
    this.lastBeat = -Infinity;
    this.lastBeatFlag = false;
    this.command = null;
    this.started = 0;
    this.carry = null;
    this.carryStarted = 0;
    this.carryDuration = 0.16;
    this.silent = true;
    this.features = normalizeMotionFeatures({
      energy: 0.72,
      bass: 0.65,
      mid: 0.38,
      treble: 0.22,
      brightness: 0.35,
      attack: 0.75,
      strength: 0.75,
    });
    this.audioSilent = true;
    this.hasMeasuredFeatures = false;
    this.lastFeatureTime = null;
    this.paused = false;
    this.pausedAt = null;
    this.selection = null;
    this.reference = null;
    this.musicWindow = null;
    this.pendingSelection = null;
    this.pendingCount = 0;
    this.switchCount = 0;
    this.lastSwitch = -Infinity;
    this.changeEvidence = { changed: false, score: 0, cues: [] };
    this.accent = null;
    this.bodyAccent = null;
    this.lastDrumTime = -Infinity;
    this.lastDrumSequence = null;
    this.lastObservedFlag = false;
    this.section = new MusicSectionDetector();
    this.phrase = null;
    this.pendingPhrase = null;
    this.lastSectionEpisode = 0;
    this.sectionGeneration = 0;
    this.phraseStarts = 0;
    this.sourceGeneration = null;
  }

  setIntensity(value) {
    this.intensity = clamp(finite(value, 1.25), 0.15, 2.5);
  }

  clear() {
    this.command = null;
    this.carry = null;
    this.lastBeatFlag = false;
    this.selection = null;
    this.reference = null;
    this.musicWindow = null;
    this.pendingSelection = null;
    this.pendingCount = 0;
    this.accent = null;
    this.bodyAccent = null;
    this.lastDrumTime = -Infinity;
    this.lastObservedFlag = false;
    this.resetSectionMotion();
  }

  resetSectionMotion() {
    this.section.reset();
    this.phrase = null;
    this.pendingPhrase = null;
    this.lastSectionEpisode = 0;
    this.sectionGeneration++;
  }

  observeSection(section, { allowPending = true } = {}) {
    const episode = Number.isSafeInteger(section.episodes) && section.episodes >= 0 ? section.episodes : 0;
    if (episode < this.lastSectionEpisode) this.pendingPhrase = null;
    if (episode > this.lastSectionEpisode && allowPending && section.high)
      this.pendingPhrase = { episodeId: episode, probability: unit(section.probability) };
    this.lastSectionEpisode = episode;
    // A cue which ends or is seen while paused/invalid is consumed, not held
    // until some unrelated later beat. Constant high cannot recreate a cue.
    if (!allowPending || !section.high) this.pendingPhrase = null;
  }

  update(features, time, { paused = false, glyphCount = 1, reducedMotion = false } = {}) {
    const beat = Boolean(features.beat);
    const rising = beat && !this.lastBeatFlag;
    this.lastBeatFlag = beat;
    const observed = Boolean(features.observedBeat);
    const observedRising = observed && !this.lastObservedFlag;
    this.lastObservedFlag = observed;
    const drum = features.drum;
    const drumSequence = Number.isSafeInteger(drum?.sequence) && drum.sequence >= 0 ? drum.sequence : null;
    const freshDrum =
      drum?.hit &&
      drumSequence !== null &&
      (this.lastDrumSequence === null || drumSequence > this.lastDrumSequence);
    // Consume cached identities while paused/invalid too. Resuming must not
    // replay an old physical hit that happened while the visual clock was held.
    if (freshDrum) this.lastDrumSequence = drumSequence;
    if (paused) {
      this.observeSection(this.section.getState(), { allowPending: false });
      if (!this.paused) this.pausedAt = time;
      this.paused = true;
      this.lastFeatureTime = time;
      return false;
    }
    if (this.paused) {
      const gap = Math.max(0, time - this.pausedAt);
      this.started += gap;
      this.carryStarted += gap;
      if (this.accent) this.accent.started += gap;
      if (this.bodyAccent && this.bodyAccent !== this.accent) this.bodyAccent.started += gap;
      if (Number.isFinite(this.lastDrumTime)) this.lastDrumTime += gap;
      this.section.holdTime(time);
      if (Number.isFinite(this.lastBeat)) this.lastBeat += gap;
      this.paused = false;
      this.pausedAt = null;
      this.lastFeatureTime = time;
    }
    // Carry only finite beat movement. Accents, phrases and the shared body cycle are sampled once
    // at its current global phase, never replayed as another layer after a beat.
    const previous = this.sample(time, {
      glyphCount,
      reducedMotion,
      includeCycle: false,
      includeAccent: false,
      includePhrase: false,
      includeDrumPriority: false,
    });
    const suppliedBeatIndex = Number.isSafeInteger(features.beatIndex) && features.beatIndex >= 0;
    // Musical index is separate from smoothed measurements, including silence.
    if (suppliedBeatIndex) this.clockBeatIndex = features.beatIndex;
    if (Number.isFinite(features.sourceGeneration) && features.sourceGeneration !== this.sourceGeneration) {
      this.sourceGeneration = features.sourceGeneration;
      this.resetSectionMotion();
      this.accent = null;
      this.bodyAccent = null;
      this.lastDrumTime = -Infinity;
    }
    const silent = Boolean(features.silent);
    this.audioSilent = Boolean(features.audioSilent ?? features.musicSilent) || features.signalValid === 0;
    const next = normalizeMotionFeatures({
      ...(this.audioSilent ? this.features : features),
      bpm: features.bpm ?? this.features.bpm,
      beatPhase: features.beatPhase ?? features.phase ?? this.features.beatPhase,
      deliveryDrive: features.delivery?.drive ?? features.deliveryDrive ?? this.features.deliveryDrive,
    });
    if (this.audioSilent) this.features = next;
    else {
      this.features = this.hasMeasuredFeatures
        ? smoothMotionFeatures(this.features, next, time - this.lastFeatureTime)
        : next;
      this.hasMeasuredFeatures = true;
    }
    this.lastFeatureTime = time;
    const section = this.section.update(
      {
        ...this.features,
        drum: features.drum,
        observedBeat: observedRising,
        audioSilent: this.audioSilent,
        signalValid: this.audioSilent ? 0 : 1,
      },
      time,
    );
    this.observeSection(section, { allowPending: !silent && !this.audioSilent });
    if (this.audioSilent || silent) {
      this.accent = null;
      this.bodyAccent = null;
    } else if (
      freshDrum &&
      drumKinds.has(drum.kind) &&
      unit(drum.confidence) >= 0.2 &&
      unit(drum.weight) > 0
    ) {
      const started = time - onsetAgeSeconds(drum);
      this.lastDrumTime = started;
      this.accent = {
        started,
        duration: clamp((0.13 + unit(drum.weight) * 0.13) * (drum.kind === 'tick' ? 0.72 : 1), 0.1, 0.26),
        strength: unit(drum.strength),
        weight: unit(drum.weight),
        confidence: unit(drum.confidence),
        kind: drum.kind,
        sequence: drumSequence,
        sourceGeneration: this.sourceGeneration,
        gridPhase: next.beatPhase,
        source: 'drum',
        evidence: 'spectral-transient',
      };
      // A hi-hat must not truncate the still-visible body of a real kick/snare.
      // Only one body and one character accent can coexist; neither restarts.
      if (drum.kind !== 'tick') this.bodyAccent = this.accent;
    } else if (
      onsetPriority(this.lastDrumTime, time) === 0 &&
      observedRising &&
      (unit(features.observedConfidence) >= 0.55 ||
        (unit(features.observedStrength) >= 0.18 && unit(features.amplitudeRise) >= 0.25))
    ) {
      this.accent = {
        started: time,
        duration: Math.min(0.18, (60 / next.bpm) * 0.3),
        strength: Math.max(0.3, unit(features.observedStrength)),
        gridPhase: next.beatPhase,
        source: 'observed',
        evidence: features.observedAccentSource ?? 'periodic-onset',
      };
      this.bodyAccent = null;
    }
    if (silent && !this.silent) {
      this.carry = previous;
      this.carryStarted = time;
      this.carryDuration = 0.18;
      this.command = null;
    }
    this.silent = silent;
    if (silent || !rising || time - this.lastBeat < 0.12) return false;
    this.carry = previous;
    this.carryStarted = time;
    if (!this.audioSilent || !this.selection) this.selectForBeat(this.features, time);
    const beatIndex = suppliedBeatIndex ? features.beatIndex : this.beatCount;
    this.clockBeatIndex = beatIndex;
    this.command = createMotionCommand(this.features, beatIndex, this.selection);
    const phrasePosition = beatIndex + next.beatPhase;
    const phraseFinished =
      !this.phrase || phrasePosition >= this.phrase.startBeat + this.phrase.durationBeats;
    if (this.pendingPhrase && phraseFinished) {
      this.phrase = {
        startBeat: beatIndex,
        durationBeats: this.pendingPhrase.probability > 0.8 ? 8 : 6,
        probability: this.pendingPhrase.probability,
        episodeId: this.pendingPhrase.episodeId,
        sectionGeneration: this.sectionGeneration,
        sourceGeneration: this.sourceGeneration,
      };
      this.pendingPhrase = null;
      this.phraseStarts++;
    }
    this.started = time;
    this.carryDuration = Math.min(0.22, this.command.duration * 0.35);
    this.lastBeat = time;
    this.beatCount++;
    return true;
  }

  selectForBeat(features, time) {
    if (!this.musicWindow) this.musicWindow = { ...features };
    else
      for (const key of Object.keys(features))
        this.musicWindow[key] += (features[key] - this.musicWindow[key]) * 0.38;
    const candidate = chooseMotionCandidate(this.musicWindow);
    if (!this.selection) {
      this.selection = candidate;
      this.reference = { ...this.musicWindow };
      this.lastSwitch = time;
      return;
    }
    this.changeEvidence = musicChangeEvidence(this.reference, this.musicWindow);
    const nextKey = `${candidate.primary}/${candidate.secondary}/${candidate.cycle || ''}`;
    const currentKey = `${this.selection.primary}/${this.selection.secondary}/${this.selection.cycle || ''}`;
    if (!this.changeEvidence.changed || nextKey === currentKey) {
      this.pendingSelection = null;
      this.pendingCount = 0;
      return;
    }
    if (this.pendingSelection === nextKey) this.pendingCount++;
    else {
      this.pendingSelection = nextKey;
      this.pendingCount = 1;
    }
    if (this.pendingCount < 3 || time - this.lastSwitch < 1.2) return;
    this.selection = candidate;
    this.reference = { ...this.musicWindow };
    this.pendingSelection = null;
    this.pendingCount = 0;
    this.lastSwitch = time;
    this.switchCount++;
  }

  sample(
    time,
    {
      glyphCount = 1,
      reducedMotion = false,
      beatPhase,
      glyphOrders,
      includeCycle = true,
      includeAccent = true,
      includePhrase = true,
      includeDrumPriority = true,
    } = {},
  ) {
    if (this.paused) time = this.pausedAt;
    const clockPhase = this.paused ? this.features.beatPhase : beatPhase;
    const phase =
      this.command && Number.isFinite(beatPhase)
        ? (unit(clockPhase) * (60 / this.command.features.bpm)) / this.command.duration
        : this.command
          ? (finite(time) - this.started) / this.command.duration
          : 1;
    const output = this.command
      ? sampleMotion(this.command, phase, {
          glyphCount,
          intensity: this.intensity,
          reducedMotion,
          glyphOrders,
          features: {
            ...this.features,
            beatPhase: Number.isFinite(beatPhase) ? clockPhase : this.features.beatPhase,
          },
        })
      : neutralMotion(glyphCount);
    if (this.carry) {
      const amount = 1 - ease((finite(time) - this.carryStarted) / this.carryDuration);
      if (amount > 0) addMotion(output, this.carry, amount);
    }
    const cycle = sampleMotionCycle(this.command, {
      beatIndex: this.clockBeatIndex ?? this.command?.beatIndex ?? Math.max(0, this.beatCount - 1),
      beatPhase: Number.isFinite(beatPhase)
        ? clockPhase
        : this.command
          ? unit((finite(time) - this.started) / (60 / this.command.features.bpm))
          : 0,
      glyphCount,
      glyphOrders,
      intensity: this.intensity,
      reducedMotion,
      features: this.features,
    });
    if (includeCycle) addMotion(output, cycle, 1);
    output.cycle = cycle.cycle;
    const priority = includeDrumPriority ? onsetPriority(this.lastDrumTime, time) : 0;
    const gridGain = 1 - priority * 0.86;
    // Keep every shared-phase path alive, but make measured attacks the main
    // visual events instead of competing with a large halfway-through-beat peak.
    for (const movement of [output.group, ...output.glyphs]) {
      for (const key of ['x', 'y', 'rotation']) movement[key] *= gridGain;
      for (const key of ['scaleX', 'scaleY']) movement[key] = 1 + (movement[key] - 1) * gridGain;
    }
    output.envelope *= gridGain;
    output.drumPriority = { active: priority > 0, amount: priority, gridGain };
    const accentMotion = this.sampleAccentMotion(time, { glyphCount, reducedMotion, glyphOrders });
    if (includeAccent) addMotion(output, accentMotion, 1);
    output.accent = accentMotion.accent;
    const phrase = this.samplePhrase(clockPhase ?? this.features.beatPhase, glyphCount, reducedMotion);
    if (includePhrase && phrase.active) {
      const f = this.features,
        h = phrase.envelope,
        p = phrase.phase;
      const level = unit(Math.log1p(f.amplitude * 35) / Math.log1p(0.35 * 35));
      const gain =
        this.intensity *
        (0.5 + level * 0.5) *
        (0.6 + phrase.probability * 0.4) *
        gridGain *
        (reducedMotion ? 0.08 : 1);
      output.group.x += Math.sin(p * Math.PI * 2) * h * gain * 0.11;
      output.group.y -= h * gain * (0.12 + f.amplitudeTrend * 0.07 + f.frequencyTrend * 0.055);
      output.group.rotation += Math.sin(p * Math.PI * 2) * h * gain * (0.13 + f.brightness * 0.12);
      const deformation = Math.sin(p * Math.PI * 3) * h * gain;
      output.group.scaleX += deformation * (0.12 + f.bass * 0.13);
      output.group.scaleY -= deformation * (0.08 + f.attack * 0.1);
      output.glyphs.forEach((glyph, index) => {
        const order = Number.isFinite(glyph.order)
          ? glyph.order
          : glyphCount > 1
            ? index / (glyphCount - 1) - 0.5
            : 0;
        glyph.x += order * h * gain * 0.055;
        glyph.y += Math.sin(p * Math.PI * 4 - order * Math.PI) * h * gain * (0.035 + f.treble * 0.03);
      });
    }
    output.group.scaleX = clamp(output.group.scaleX, 0.3, 2.3);
    output.group.scaleY = clamp(output.group.scaleY, 0.3, 2.3);
    output.phrase = phrase;
    return output;
  }

  samplePhrase(beatPhase, glyphCount, reducedMotion) {
    const position = (this.clockBeatIndex ?? this.beatCount - 1) + unit(beatPhase);
    const phase = this.phrase ? unit((position - this.phrase.startBeat) / this.phrase.durationBeats) : 1;
    return {
      active: Boolean(this.phrase && phase < 1),
      phase,
      envelope: Math.sin(Math.PI * phase) ** 2,
      durationBeats: this.phrase?.durationBeats ?? 0,
      probability: this.phrase?.probability ?? 0,
      episodeId: this.phrase?.episodeId ?? null,
      startBeat: this.phrase?.startBeat ?? null,
      sourceGeneration: this.phrase?.sourceGeneration ?? null,
      sectionGeneration: this.phrase?.sectionGeneration ?? this.sectionGeneration,
      source: 'internal-grid',
      cueSource: 'observed-section',
      glyphCount,
      reducedMotion,
    };
  }

  sampleAccent(time, reducedMotion = false, command = this.accent) {
    if (this.paused) time = this.pausedAt;
    const age = command ? Math.max(0, finite(time) - command.started) : Infinity;
    const peakSeconds = 0;
    const envelope =
      !command || age >= command.duration
        ? 0
        : onsetEnvelope(age, command.duration) * (0.55 + command.strength * 0.45);
    return {
      source: command?.source || null,
      evidence: command?.evidence || null,
      active: envelope > 0,
      envelope,
      ageSeconds: Number.isFinite(age) ? age : 0,
      peakSeconds,
      durationSeconds: command?.duration ?? 0,
      kind: command?.kind ?? null,
      sequence: command?.sequence ?? null,
      sourceGeneration: command?.sourceGeneration ?? null,
      weight: command?.weight ?? 0,
      strength: command?.strength ?? 0,
      confidence: command?.confidence ?? 0,
      gridPhaseAtOnset: command?.gridPhase ?? 0,
      reducedMotion,
    };
  }

  sampleAccentMotion(time, { glyphCount = 1, reducedMotion = false, glyphOrders } = {}) {
    const output = neutralMotion(glyphCount);
    const accent = this.sampleAccent(time, reducedMotion);
    const heldBody =
      this.accent?.kind === 'tick' && this.bodyAccent !== this.accent
        ? this.sampleAccent(time, reducedMotion, this.bodyAccent)
        : null;
    if (heldBody?.active) {
      const gain = heldBody.envelope * this.intensity * (reducedMotion ? 0.08 : 1);
      applyDrumAccent(
        output,
        heldBody,
        gain * (0.12 + Math.pow(heldBody.weight, 1.25) * 0.88),
        this.features,
        glyphOrders,
      );
    }
    if (accent.envelope > 0) {
      const gain = accent.envelope * this.intensity * (reducedMotion ? 0.08 : 1);
      if (accent.source === 'drum') {
        const weight = 0.12 + Math.pow(accent.weight, 1.25) * 0.88;
        applyDrumAccent(output, accent, gain * weight, this.features, glyphOrders);
      } else {
        output.group.scaleX += gain * 0.09;
        output.group.scaleY -= gain * 0.075;
        output.group.y += gain * 0.014;
      }
    }
    output.accent = {
      ...accent,
      heldBody: heldBody?.active ? { ...heldBody } : null,
      pose: { group: { ...output.group }, glyphs: output.glyphs.map((glyph) => ({ ...glyph })) },
    };
    return output;
  }

  getState(time, options = {}) {
    const sampled = this.sample(time, options);
    return {
      primary: this.command?.primary || null,
      secondary: this.command?.secondary || null,
      beatCount: this.beatCount,
      beatIndex: this.clockBeatIndex ?? this.command?.beatIndex ?? null,
      cycle: { ...sampled.cycle },
      phase: sampled.phase,
      beatPhase: this.features.beatPhase,
      intensity: this.intensity,
      silent: this.silent,
      audioSilent: this.audioSilent,
      paused: this.paused,
      gain: sampled.gain,
      combinationChanges: this.switchCount,
      pendingObservations: this.pendingCount,
      changeEvidence: { ...this.changeEvidence },
      section: this.section.getState(),
      pendingPhrase: this.pendingPhrase ? { ...this.pendingPhrase } : null,
      phraseStarts: this.phraseStarts,
      phrase: { ...sampled.phrase },
      accent: { ...sampled.accent },
      drumPriority: { ...sampled.drumPriority },
      featureMap: {
        frequencyTrend: this.features.frequencyTrend,
        amplitudeTrend: this.features.amplitudeTrend,
        pitchTrend: this.features.pitchTrend,
        pitchConfidence: this.features.pitchConfidence,
        timbreBrightness: this.features.brightness,
        noisiness: this.features.noisiness,
        attack: this.features.attack,
        frequencyHz: this.features.frequencyHz,
        amplitude: this.features.amplitude,
        energy: this.features.energy,
        deliveryDrive: this.features.deliveryDrive,
      },
      sample: sampled,
    };
  }
}

/** Bounds include rotated/scaled glyph corners and the group transform. */
export function measureMotionBounds(
  motion,
  glyphs,
  { width, height, originX = width / 2, originY = height * 0.45 },
) {
  if (!glyphs.length)
    return { left: originX, right: originX, top: originY, bottom: originY, width: 0, height: 0 };
  const group = motion.group;
  const gc = Math.cos(group.rotation),
    gs = Math.sin(group.rotation);
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  let visibleCount = 0;
  glyphs.forEach((glyph, index) => {
    if (glyph.visible === false) return;
    visibleCount++;
    const move = motion.glyphs[index] || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
    const c = Math.cos(move.rotation),
      s = Math.sin(move.rotation);
    for (const x of [-glyph.width / 2, glyph.width / 2]) {
      for (const y of [-glyph.height / 2, glyph.height / 2]) {
        const localX = glyph.x + move.x * width + c * x * move.scaleX - s * y * move.scaleY;
        const localY = glyph.y + move.y * height + s * x * move.scaleX + c * y * move.scaleY;
        const worldX = originX + group.x * width + gc * localX * group.scaleX - gs * localY * group.scaleY;
        const worldY = originY + group.y * height + gs * localX * group.scaleX + gc * localY * group.scaleY;
        left = Math.min(left, worldX);
        right = Math.max(right, worldX);
        top = Math.min(top, worldY);
        bottom = Math.max(bottom, worldY);
      }
    }
  });
  if (!visibleCount)
    return { left: originX, right: originX, top: originY, bottom: originY, width: 0, height: 0 };
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

/** Fit a pose to the available canvas, including the multi-beat phrase. */
export function constrainMotion(motion, glyphs, options) {
  const width = Math.max(1, finite(options.width, 1));
  const height = Math.max(1, finite(options.height, 1));
  const originX = finite(options.originX, width / 2),
    originY = finite(options.originY, height * 0.45);
  const margin = Math.min(18, width * 0.06, height * 0.06);
  const safe = { left: margin, right: width - margin, top: margin, bottom: height * 0.88 };
  const fitted = {
    ...motion,
    group: { ...motion.group },
    glyphs: motion.glyphs.map((glyph) => ({ ...glyph })),
    fitScale: 1,
  };
  let bounds = measureMotionBounds(fitted, glyphs, { width, height, originX, originY });
  const fit = Math.min(
    1,
    (safe.right - safe.left) / Math.max(0.001, bounds.width),
    (safe.bottom - safe.top) / Math.max(0.001, bounds.height),
  );
  if (fit < 1) {
    fitted.group.scaleX *= fit;
    fitted.group.scaleY *= fit;
    fitted.fitScale = fit;
    bounds = measureMotionBounds(fitted, glyphs, { width, height, originX, originY });
  }
  const xCorrection =
    bounds.left < safe.left
      ? safe.left - bounds.left
      : bounds.right > safe.right
        ? safe.right - bounds.right
        : 0;
  const yCorrection =
    bounds.top < safe.top
      ? safe.top - bounds.top
      : bounds.bottom > safe.bottom
        ? safe.bottom - bounds.bottom
        : 0;
  fitted.group.x += xCorrection / width;
  fitted.group.y += yCorrection / height;
  fitted.bounds = measureMotionBounds(fitted, glyphs, { width, height, originX, originY });
  return fitted;
}
