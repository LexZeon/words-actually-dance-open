import { GHOST_EFFECTS, normalizeGhostEffect } from '../core/ghost-effects.js';
import { measureMotionBounds } from './dance-motion.js';

export { GHOST_EFFECTS, normalizeGhostEffect };

export const GHOST_HISTORY_LIMIT = 128;
const HISTORY_SECONDS = 0.42;
const KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const unit = (value) => clamp(finite(value), 0, 1);
const signed = (value) => clamp(finite(value), -1, 1);
const mix = (from, to, amount) => from + (to - from) * amount;
const clonePose = (pose) => ({
  ...pose,
  group: { ...pose.group },
  glyphs: pose.glyphs.map((glyph) => ({ ...glyph })),
});
const DELAYS = Object.freeze({
  'scale-echo': 0.11,
  'twist-shadow': 0.14,
  'vertical-lift': 0.12,
  'horizontal-stretch': 0.1,
  'glyph-wave': 0.16,
});
const TONE_EFFECTS = Object.freeze({
  pulse: 'scale-echo',
  pluck: 'glyph-wave',
  lead: 'vertical-lift',
  pad: 'twist-shadow',
  noise: 'horizontal-stretch',
});

const frequencyValue = (value) => (Number.isFinite(Number(value)) ? clamp(Number(value), 0, 1) : 0.9);

function variationInterval(frequency, features) {
  const normal = clamp(Math.round(20 - ((frequency - 0.2) * 16) / 0.7), 2, 20);
  const active =
    unit(features.energy) >= 0.68 &&
    (unit(features.attack) >= 0.55 || unit(features.delivery?.drive) >= 0.65);
  return active ? Math.max(1, Math.round(normal / 2)) : normal;
}

// These scores describe visual affinity with measured sound, not instruments.
function variationCandidate(features, current, recent) {
  const bass = unit(features.bass),
    mid = unit(features.mid),
    treble = unit(features.treble);
  const attack = unit(features.attack),
    brightness = unit(features.brightness ?? features.timbreBrightness);
  const rise = Math.abs(signed(features.amplitudeTrend)) + Math.abs(signed(features.frequencyTrend));
  const scores = {
    'scale-echo': 0.2 + bass * 0.6 + unit(features.energy) * 0.4 + attack * 0.2,
    'twist-shadow': 0.25 + mid * 0.35 + (1 - attack) * 0.25,
    'vertical-lift': 0.2 + rise * 0.4 + brightness * 0.3,
    'horizontal-stretch': 0.2 + unit(features.noisiness) * 0.5 + bass * 0.3 + attack * 0.25,
    'glyph-wave': 0.2 + brightness * 0.45 + treble * 0.5 + attack * 0.15,
  };
  const preferred = chooseGhostEffect(features);
  if (preferred) scores[preferred] += 0.8;
  recent.forEach((effect, index) => {
    scores[effect] -= (index + 1) * 0.55;
  });
  return Object.keys(scores)
    .filter((effect) => effect !== current)
    .sort((a, b) => scores[b] - scores[a])[0];
}

/** Select from measured proxies; a stable grid alone is never a new cue. */
export function chooseGhostEffect(features = {}) {
  const drum = features.drum;
  if (drum?.hit && unit(drum.confidence) >= 0.3 && unit(drum.weight) >= 0.65) {
    if (drum.kind === 'thump') return 'scale-echo';
    if (drum.kind === 'snap') return 'horizontal-stretch';
    if (drum.kind === 'tick') return 'glyph-wave';
  }
  const tone = features.toneStyle;
  if (tone?.valid && unit(tone.confidence) >= 0.45 && TONE_EFFECTS[tone.kind]) return TONE_EFFECTS[tone.kind];
  return null;
}

/** Five distinct channels augment the existing pose, without replacing it. */
export function styleGhostMain(
  pose,
  features,
  effect,
  { intensity = 1.25, toneAttack = 0, beatIndex = 0, beatPhase = 0 } = {},
) {
  const styled = clonePose(pose);
  if (!DELAYS[effect]) return styled;
  const amplitude = unit(features.amplitude ?? features.rms);
  const level = unit(Math.log1p(amplitude * 35) / Math.log1p(0.35 * 35));
  const rise = signed(
    finite(features.amplitudeTrend) * 0.65 +
      finite(features.frequencyTrend) * 0.45 +
      finite(features.toneStyle?.trend) * 0.3,
  );
  const brightness = unit(features.brightness ?? features.timbreBrightness);
  const energy = unit(features.energy);
  const toneLevel = features.toneStyle?.valid
    ? unit(features.toneStyle.intensity) * unit(features.toneStyle.confidence)
    : 0;
  const accent =
    pose.accent?.source === 'drum' ? unit(pose.accent.envelope) * (0.2 + unit(pose.accent.weight) * 0.8) : 0;
  const body = unit(pose.envelope) * (0.25 + energy * 0.75);
  const power =
    (body * 0.22 + Math.max(accent, unit(toneAttack)) * 0.78) *
    (0.4 + level * 0.6) *
    (1 + toneLevel * 0.2) *
    clamp(finite(intensity, 1.25), 0.15, 2.5);
  const position = Math.max(0, finite(beatIndex)) + unit(beatPhase);
  const turn = -Math.sin(position * Math.PI);
  if (effect === 'scale-echo') {
    styled.group.scaleX += power * 0.27;
    styled.group.scaleY += power * 0.27;
  } else if (effect === 'twist-shadow') {
    styled.group.rotation += turn * power * (0.3 + brightness * 0.16);
    styled.group.scaleX -= Math.abs(turn) * power * 0.1;
  } else if (effect === 'vertical-lift') {
    styled.group.y -= power * (0.05 + rise * 0.1);
    styled.group.scaleY += power * rise * 0.1;
  } else if (effect === 'horizontal-stretch') {
    styled.group.scaleX += power * (0.28 + unit(features.bass) * 0.14);
    styled.group.scaleY -= power * 0.17;
  } else if (effect === 'glyph-wave') {
    styled.glyphs.forEach((glyph, index) => {
      const order = finite(
        glyph.order,
        styled.glyphs.length > 1 ? index / (styled.glyphs.length - 1) - 0.5 : 0,
      );
      const wave = Math.sin(position * Math.PI * 2 - order * Math.PI * 2);
      glyph.y += wave * power * (0.025 + brightness * 0.04);
      glyph.rotation += wave * power * 0.16;
    });
  }
  styled.group.scaleX = clamp(styled.group.scaleX, 0.3, 2.5);
  styled.group.scaleY = clamp(styled.group.scaleY, 0.3, 2.5);
  return styled;
}

function interpolatePose(one, two, amount) {
  const output = clonePose(one);
  for (const key of KEYS) output.group[key] = mix(one.group[key], two.group[key], amount);
  output.glyphs.forEach((glyph, index) => {
    for (const key of KEYS) glyph[key] = mix(one.glyphs[index][key], two.glyphs[index][key], amount);
  });
  return output;
}

/** Bounded actual drawn-pose history; sampling uses the stage's elapsed time. */
export class GhostMotionDirector {
  constructor({ effect = 'auto', frequency = 0.9 } = {}) {
    this.mode = normalizeGhostEffect(effect);
    this.effect = this.mode === 'auto' || this.mode === 'off' ? 'scale-echo' : this.mode;
    this.history = [];
    this.pending = null;
    this.lastSelection = -Infinity;
    this.hasSelection = false;
    this.lastDrumSequence = null;
    this.lastToneSequence = null;
    this.sourceGeneration = null;
    this.wordGeneration = 0;
    this.toneCue = null;
    this.delayWeight = 0;
    this.delayWeightTarget = 0;
    this.delayBase = DELAYS[this.effect];
    this.delaySampleTime = null;
    this.paused = false;
    this.invalidSince = null;
    this.recordingSegment = 0;
    this.recordingBreak = false;
    this.frequency = frequencyValue(frequency);
    this.autoLastBeat = null;
    this.autoObservedBeat = null;
    this.autoHeldBeat = null;
    this.autoInterval = null;
    this.autoSwitches = 0;
    this.recentEffects = [];
    this.previousEffect = null;
    this.transitionAt = null;
  }
  setFrequency(value) {
    this.frequency = frequencyValue(value);
    if (this.frequency <= 0.2) this.autoInterval = null;
    return this.frequency;
  }
  setEffect(effect) {
    const mode = normalizeGhostEffect(effect);
    if (mode !== this.mode) {
      this.mode = mode;
      if (mode !== 'auto' && mode !== 'off') this.effect = mode;
      this.pending = null;
      this.autoLastBeat = null;
      this.autoObservedBeat = null;
      this.autoHeldBeat = null;
      this.recentEffects = [];
      if (mode === 'auto') this.hasSelection = false;
      this.clear();
    }
    return this.mode;
  }
  clear() {
    this.history = [];
    this.toneCue = null;
    this.recordingSegment = 0;
    this.recordingBreak = false;
    this.wordGeneration++;
    this.previousEffect = null;
    this.transitionAt = null;
  }
  selectEffect(effect, time, beat) {
    if (effect !== this.effect) {
      if (this.hasSelection) {
        this.previousEffect = this.effect;
        this.transitionAt = time;
        this.recentEffects = [...this.recentEffects, this.effect].slice(-2);
        this.autoSwitches++;
      }
      this.effect = effect;
    }
    this.hasSelection = true;
    this.lastSelection = time;
    this.autoLastBeat = beat;
    this.pending = null;
  }
  observe(features, time, { paused = false, reducedMotion = false } = {}) {
    this.paused = paused;
    if (Number.isFinite(features.sourceGeneration) && features.sourceGeneration !== this.sourceGeneration) {
      this.sourceGeneration = features.sourceGeneration;
      this.clear();
      this.pending = null;
      this.hasSelection = false;
      this.lastSelection = -Infinity;
      this.lastDrumSequence = null;
      this.lastToneSequence = null;
      this.delayWeight = 0;
      this.delayWeightTarget = 0;
      this.delayBase = DELAYS[this.effect];
      this.delaySampleTime = null;
      this.invalidSince = null;
      this.autoLastBeat = null;
      this.autoObservedBeat = null;
      this.autoHeldBeat = null;
      this.autoInterval = null;
      this.recentEffects = [];
    }
    // Advance old targets to this measured time before accepting a fresh cue.
    // A newly arrived weight cannot retroactively govern the preceding frame.
    this.followDelay(time);
    const fresh = (cue, previous) =>
      Number.isSafeInteger(cue?.sequence) &&
      cue.sequence >= 0 &&
      (previous === null || cue.sequence > previous);
    const drumFresh = fresh(features.drum, this.lastDrumSequence);
    const toneFresh = fresh(features.toneStyle, this.lastToneSequence);
    if (drumFresh) this.lastDrumSequence = features.drum.sequence;
    if (toneFresh) this.lastToneSequence = features.toneStyle.sequence;
    const invalid = features.audioSilent || features.silent || features.signalValid === 0;
    const beat =
      Number.isSafeInteger(features.beatIndex) && features.beatIndex >= 0 ? features.beatIndex : null;
    const enteredBeat = beat !== null && beat !== this.autoObservedBeat;
    this.autoObservedBeat = beat;
    if (paused || invalid || reducedMotion) {
      this.autoHeldBeat ??= beat;
      if (paused || (this.pending && time - this.pending.lastEvidence > 0.6)) this.pending = null;
      if (this.pending) this.pending.lastCandidateTime = null;
      if (invalid && !paused) {
        this.recordingBreak = true;
        this.invalidSince ??= time;
        // A short musical rest may still display recorded real poses. No new
        // poses/hits are recorded; the tail stops at the last point + delay.
        if (time - this.invalidSince >= 0.5) {
          this.pending = null;
          if (this.history.length || this.toneCue) this.clear();
          this.delayWeightTarget = 0;
        }
      }
      return;
    }
    if (this.autoHeldBeat !== null && beat !== null && this.autoLastBeat !== null)
      this.autoLastBeat += Math.max(0, beat - this.autoHeldBeat);
    this.autoHeldBeat = null;
    this.invalidSince = null;
    // Confidence describes the selected kind, not whether this physical
    // envelope attack happened. A first validated hit must not wait for kind.
    if (
      toneFresh &&
      features.toneStyle.hit &&
      features.toneStyle.valid &&
      Number.isFinite(features.toneStyle.strength) &&
      features.toneStyle.strength > 0
    )
      this.toneCue = {
        time,
        strength: unit(features.toneStyle.strength),
        sequence: features.toneStyle.sequence,
      };
    if (drumFresh && features.drum.hit) {
      this.delayWeightTarget = unit(features.drum.weight);
      if (!this.history.length) this.delayWeight = this.delayWeightTarget;
    }
    if (this.mode !== 'auto') return;
    if (this.frequency > 0.2 && beat !== null) {
      const measured = { ...features, drum: drumFresh ? features.drum : null };
      const hasAudio =
        (features.signalValid === 1 || features.signalValid === true) &&
        finite(features.amplitude ?? features.rms) > 0.00003;
      if (!hasAudio) {
        this.autoLastBeat = beat;
        return;
      }
      this.autoInterval = variationInterval(this.frequency, measured);
      if (!this.hasSelection) {
        this.selectEffect(chooseGhostEffect(measured) || variationCandidate(measured, null, []), time, beat);
        // An initial choice has no preceding style to crossfade.
        this.previousEffect = null;
        this.transitionAt = null;
      } else if (this.autoLastBeat === null || beat < this.autoLastBeat) {
        this.autoLastBeat = beat;
      } else if (enteredBeat && beat - this.autoLastBeat >= this.autoInterval) {
        this.selectEffect(variationCandidate(measured, this.effect, this.recentEffects), time, beat);
      }
      return;
    }
    // Cached drum flags retain no style-change authority; persistent tone kind
    // may nominate a candidate even in drumless music.
    const candidate = chooseGhostEffect({ ...features, drum: drumFresh ? features.drum : null });
    if (!candidate) {
      if (this.pending && time - this.pending.lastEvidence > 1.5) this.pending = null;
      if (this.pending) this.pending.lastCandidateTime = null;
      return;
    }
    if (!this.hasSelection) {
      this.effect = candidate;
      this.hasSelection = true;
      this.lastSelection = time;
      return;
    }
    if (candidate === this.effect) {
      this.pending = null;
      return;
    }
    if (this.pending?.effect !== candidate)
      this.pending = {
        effect: candidate,
        since: time,
        cues: 0,
        lastEvidence: time,
        validSeconds: 0,
        lastCandidateTime: null,
        toneSequence: null,
        drumSequence: null,
      };
    if (this.pending.lastCandidateTime !== null)
      this.pending.validSeconds += Math.max(0, time - this.pending.lastCandidateTime);
    this.pending.lastCandidateTime = time;
    this.pending.lastEvidence = time;
    // A kind may become confident shortly after its physical attack. Associate
    // that already confirmed sequence once, rather than waiting an extra note.
    const toneEvidence =
      this.toneCue &&
      features.toneStyle?.valid &&
      this.toneCue.sequence === features.toneStyle.sequence &&
      time - this.toneCue.time <= 0.16 &&
      this.pending.toneSequence !== this.toneCue.sequence;
    const drumEvidence =
      drumFresh && features.drum.hit && this.pending.drumSequence !== features.drum.sequence;
    if (toneEvidence || drumEvidence) this.pending.cues++;
    if (toneEvidence) this.pending.toneSequence = this.toneCue.sequence;
    if (drumEvidence) this.pending.drumSequence = features.drum.sequence;
    if (time - this.lastSelection >= 1 && (this.pending.validSeconds >= 0.6 || this.pending.cues >= 2)) {
      this.effect = candidate;
      this.lastSelection = time;
      this.pending = null;
    }
  }
  styleMain(
    pose,
    features,
    time,
    { reducedMotion = false, intensity = 1.25, beatIndex = 0, beatPhase = 0 } = {},
  ) {
    if (this.mode === 'off' || reducedMotion) return clonePose(pose);
    const age = this.toneCue ? Math.max(0, time - this.toneCue.time) : Infinity;
    const attack =
      age < 0.018
        ? Math.sin(((age / 0.018) * Math.PI) / 2)
        : age < 0.16
          ? Math.cos((((age - 0.018) / 0.142) * Math.PI) / 2) ** 2
          : 0;
    const options = {
      intensity,
      beatIndex,
      beatPhase,
      toneAttack: attack * (0.25 + (this.toneCue?.strength ?? 0) * 0.75),
    };
    const current = styleGhostMain(pose, features, this.effect, options);
    if (this.previousEffect && this.transitionAt !== null) {
      const progress = unit((time - this.transitionAt) / 0.18);
      if (progress < 1) {
        const previous = styleGhostMain(pose, features, this.previousEffect, options);
        return interpolatePose(previous, current, progress * progress * (3 - 2 * progress));
      }
      this.previousEffect = null;
      this.transitionAt = null;
    }
    return current;
  }
  record(time, pose, { paused = false } = {}) {
    if (paused || this.mode === 'off' || !Number.isFinite(time)) return;
    if (this.history.length && time < this.history.at(-1).time) this.clear();
    if (this.recordingBreak) {
      this.recordingSegment++;
      this.recordingBreak = false;
    }
    const point = { time, pose: clonePose(pose), segment: this.recordingSegment };
    if (this.history.at(-1)?.time === time) this.history[this.history.length - 1] = point;
    else if (!this.history.length || time - this.history.at(-1).time >= 1 / 240 - 1e-9)
      this.history.push(point);
    while (this.history.length > 2 && this.history[1].time < time - HISTORY_SECONDS) this.history.shift();
    if (this.history.length > GHOST_HISTORY_LIMIT)
      this.history.splice(0, this.history.length - GHOST_HISTORY_LIMIT);
  }
  followDelay(time) {
    if (this.paused || !Number.isFinite(time)) return;
    const dt = this.delaySampleTime === null ? 0 : Math.max(0, time - this.delaySampleTime);
    this.delaySampleTime = time;
    if (!this.history.length) {
      this.delayWeight = this.delayWeightTarget;
      this.delayBase = DELAYS[this.effect];
      return;
    }
    // The whole delay target spans at most 80ms. A 90ms time constant bounds
    // its increase below elapsed time, so sourceTime cannot travel backward.
    const amount = 1 - Math.exp(-dt / 0.09);
    this.delayWeight = mix(this.delayWeight, this.delayWeightTarget, amount);
    this.delayBase = mix(this.delayBase, DELAYS[this.effect], amount);
  }
  sample(time, { reducedMotion = false, suspended = false } = {}) {
    this.followDelay(time);
    const delaySeconds = clamp(this.delayBase - this.delayWeight * 0.02, 0.08, 0.16);
    const sourceTime = time - delaySeconds;
    const metadata = {
      mode: this.mode,
      effect: this.effect,
      active: false,
      delaySeconds,
      sourceTime: null,
      opacity: 0,
      historySamples: this.history.length,
      maxHistorySamples: GHOST_HISTORY_LIMIT,
      sourceGeneration: this.sourceGeneration,
      wordGeneration: this.wordGeneration,
      reducedMotion,
      frequency: this.frequency,
      automaticIntervalBeats: this.autoInterval,
      automaticSwitches: this.autoSwitches,
    };
    if (this.mode === 'off' || reducedMotion || suspended || this.history.length < 2)
      return { pose: null, metadata };
    if (sourceTime < this.history[0].time || sourceTime > this.history.at(-1).time)
      return { pose: null, metadata };
    const after = this.history.findIndex((point) => point.time >= sourceTime);
    const next = this.history[after];
    const before = after === 0 || Math.abs(next.time - sourceTime) < 1e-9 ? next : this.history[after - 1];
    // A dropped render frame can be interpolated, but an observed silent rest
    // has no real poses to interpolate. Keep the preceding finite tail while
    // refusing a bridge into a later note, even once that note is recorded.
    if (before.segment !== next.segment) return { pose: null, metadata };
    if (before.pose.glyphs.length !== next.pose.glyphs.length) return { pose: null, metadata };
    const amount = unit((sourceTime - before.time) / Math.max(1e-9, next.time - before.time));
    const tail =
      this.invalidSince === null
        ? 1
        : unit((this.history.at(-1).time - sourceTime) / Math.min(0.06, delaySeconds * 0.6));
    if (tail <= 0.001) return { pose: null, metadata };
    return {
      pose: interpolatePose(before.pose, next.pose, amount),
      metadata: { ...metadata, active: true, opacity: (0.15 + this.delayWeight * 0.07) * tail, sourceTime },
    };
  }
}

const unionBounds = (bounds) => {
  const left = Math.min(...bounds.map((value) => value.left)),
    right = Math.max(...bounds.map((value) => value.right));
  const top = Math.min(...bounds.map((value) => value.top)),
    bottom = Math.max(...bounds.map((value) => value.bottom));
  return { left, right, top, bottom, width: right - left, height: bottom - top };
};

/** Apply one canvas-space fit to both layers around their common anchor. */
export function constrainGhostPair(main, ghost, glyphs, { width, height }) {
  const poses = [clonePose(main), ...(ghost ? [clonePose(ghost)] : [])];
  const options = { width, height };
  const margin = Math.min(18, width * 0.06, height * 0.06);
  const safe = { left: margin, right: width - margin, top: margin, bottom: height * 0.88 };
  const measure = () => unionBounds(poses.map((pose) => measureMotionBounds(pose, glyphs, options)));
  let bounds = measure();
  const fit = Math.min(
    1,
    (safe.right - safe.left) / Math.max(0.001, bounds.width),
    (safe.bottom - safe.top) / Math.max(0.001, bounds.height),
  );
  for (const pose of poses) {
    pose.group.x *= fit;
    pose.group.y *= fit;
    pose.group.scaleX *= fit;
    pose.group.scaleY *= fit;
  }
  bounds = measure();
  const dx =
    bounds.left < safe.left
      ? safe.left - bounds.left
      : bounds.right > safe.right
        ? safe.right - bounds.right
        : 0;
  const dy =
    bounds.top < safe.top
      ? safe.top - bounds.top
      : bounds.bottom > safe.bottom
        ? safe.bottom - bounds.bottom
        : 0;
  for (const pose of poses) {
    pose.group.x += dx / width;
    pose.group.y += dy / height;
    pose.fitScale = finite(pose.fitScale, 1) * fit;
    pose.bounds = measureMotionBounds(pose, glyphs, options);
  }
  return { main: poses[0], ghost: poses[1] || null, combinedBounds: measure(), fitScale: fit };
}
