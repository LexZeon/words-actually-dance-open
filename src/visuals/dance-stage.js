import { MotionDirector, constrainMotion } from './dance-motion.js';
import { GhostMotionDirector, constrainGhostPair } from './ghost-motion.js';
import {
  buildRelationTransition,
  retargetRelationTransition,
  sampleRelationTransition,
  relationKind,
} from './relation-transition.js';

/** Beat-driven choreography with ordered character-level concept transitions. */
export class DanceStage {
  constructor(canvas, { reducedMotion = false, managedFrame = false, onFrame } = {}) {
    if (!canvas?.getContext) throw new TypeError('DanceStage requires a canvas.');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onFrame = onFrame;
    this.managedFrame = Boolean(managedFrame);
    this.measurements = new Map();
    this.motionOverride = Boolean(reducedMotion);
    this.motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionOverride || Boolean(this.motionQuery?.matches);
    this.motionListener = () => {
      this.reducedMotion = this.motionOverride || Boolean(this.motionQuery?.matches);
    };
    this.motionQuery?.addEventListener?.('change', this.motionListener);
    this.features = emptyFeatures();
    this.display = emptyFeatures();
    this.intensity = 1.25;
    this.motion = new MotionDirector({ intensity: this.intensity });
    this.ghost = new GhostMotionDirector();
    this.lastMotionPose = null;
    this.lastGhostPose = null;
    this.lastGhostState = null;
    this.lastPulse = null;
    this.paused = false;
    this.destroyed = false;
    this.word = '';
    this.relation = {};
    this.emoji = '';
    this.glyphs = [];
    this.transition = null;
    this.elapsed = 0;
    this.lastBeatTime = -Infinity;
    this.lastBeatStrength = 0;
    this.beatCount = 0;
    this.lastBeatFlag = false;
    this.lastWallTime = null;
    this.lastDrawTime = null;
    this.width = 1;
    this.height = 1;
    this.canvas.style.display = 'block';
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.raf = this.managedFrame ? null : requestAnimationFrame(this.frame);
  }

  setWord(word, relation = {}, { beatDuration = 0.5, immediate = false } = {}) {
    const next = String(word ?? '').trim();
    this.relation = relation || {};
    if (immediate) {
      this.word = next;
      this.glyphs = this.layout(next);
      this.transition = null;
      this.motion.clear();
      this.resetGhostHistory();
      this.lastMotionPose = null;
      this.draw();
      return;
    }
    if (next === this.word) return;
    this.resetGhostHistory();
    const previous = this.snapshotGlyphs();
    const targets = this.layout(next);
    this.word = next;
    if (!previous.length || !targets.length) {
      this.glyphs = targets;
      this.transition = null;
      return;
    }

    this.transition = buildRelationTransition(previous, targets, this.relation, {
      started: this.elapsed,
      duration: clamp(Number(beatDuration) * 0.85 || 0.43, 0.22, 0.65),
    });
  }

  setFeatures(features = {}) {
    if (this.destroyed) return;
    // Managed production order is features -> knowledge callbacks -> render.
    // Advance once before those callbacks so a new word uses this frame's start,
    // rather than consuming time lost before the word existed.
    if (this.managedFrame && Number.isFinite(features.time)) this.advanceTime(features.time);
    const next = { ...this.features, ...features, beat: Boolean(features.beat) };
    for (const key of ['energy', 'bass', 'mid', 'treble', 'brightness', 'strength', 'onset']) {
      next[key] = unit(next[key]);
    }
    const triggered = this.motion.update(next, this.elapsed, {
      paused: this.paused,
      glyphCount: this.transition?.records.length || this.glyphs.length,
      reducedMotion: this.reducedMotion,
    });
    if (triggered) {
      this.lastBeatTime = this.elapsed;
      this.lastBeatStrength = this.motion.command.strength;
      this.lastPulse = {
        time: this.elapsed,
        beatIndex: this.motion.command.beatIndex,
        phase: this.motion.features.beatPhase,
      };
    }
    this.beatCount = this.motion.beatCount;
    this.lastBeatFlag = Boolean(next.beat);
    this.features = next;
    const sourceGeneration = this.ghost.sourceGeneration;
    this.ghost.observe(next, this.elapsed, { paused: this.paused });
    if (sourceGeneration !== this.ghost.sourceGeneration) {
      this.lastGhostPose = null;
      this.lastGhostState = null;
    }
  }

  setIntensity(value) {
    this.intensity = clamp(Number(value) || 0.15, 0.15, 2.5);
    this.motion.setIntensity(this.intensity);
  }

  setGhostEffect(value) {
    const mode = this.ghost.setEffect(value);
    this.lastGhostPose = null;
    this.lastGhostState = null;
    if (!this.destroyed) this.draw();
    return mode;
  }

  resetGhostHistory() {
    this.ghost.clear();
    this.lastGhostPose = null;
    this.lastGhostState = null;
  }

  getGhostState() {
    const layer = (pose, opacity) =>
      pose
        ? {
            opacity,
            group: { ...pose.group },
            glyphs: pose.glyphs.map((glyph) => ({ ...glyph })),
            bounds: { ...pose.bounds },
          }
        : null;
    return {
      ...(this.lastGhostState ||
        this.ghost.sample(this.elapsed, { reducedMotion: this.reducedMotion }).metadata),
      paused: this.paused,
      reducedMotion: this.reducedMotion,
      anchor: { x: this.width / 2, y: this.height * 0.45 },
      layers: {
        main: layer(this.lastMotionPose, 1),
        ghost: layer(this.lastGhostPose, this.lastGhostState?.opacity ?? 0),
      },
      combinedBounds: this.lastGhostState?.combinedBounds
        ? { ...this.lastGhostState.combinedBounds }
        : this.lastMotionPose?.bounds
          ? { ...this.lastMotionPose.bounds }
          : null,
    };
  }

  getMotionState() {
    return {
      ...this.motion.getState(this.elapsed, {
        glyphCount:
          this.lastMotionPose?.glyphs.length || this.transition?.records.length || this.glyphs.length,
        reducedMotion: this.reducedMotion,
        beatPhase: this.features.beatPhase ?? this.features.phase,
      }),
      paused: this.paused,
      reducedMotion: this.reducedMotion,
      lastPulse: this.lastPulse,
      ghost: this.getGhostState(),
      poses: this.lastMotionPose
        ? {
            group: { ...this.lastMotionPose.group },
            glyphs: this.lastMotionPose.glyphs.map((glyph) => ({ ...glyph })),
          }
        : null,
      constraints: this.lastMotionPose
        ? {
            fitScale: this.lastMotionPose.fitScale,
            bounds: { ...(this.lastGhostState?.combinedBounds || this.lastMotionPose.bounds) },
            canvas: { width: this.width, height: this.height },
          }
        : null,
      transition: {
        active: Boolean(this.transition),
        kind: this.transition?.kind || relationKind(this.relation.type),
        from: this.transition?.from || this.relation.from || '',
        to: this.transition?.to || this.relation.to || this.word,
        label: this.transition?.label || this.relation.label || '',
        progress: this.transition
          ? unit((this.elapsed - this.transition.started) / this.transition.duration)
          : 1,
      },
    };
  }

  setPaused(paused) {
    const next = Boolean(paused);
    if (next !== this.paused) {
      this.lastWallTime = null;
      this.lastDrawTime = null;
    }
    this.paused = next;
  }

  setEmoji(value) {
    this.emoji = typeof value === 'string' ? value : value ? '✦' : '';
  }

  destroy() {
    this.destroyed = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.resizeObserver.disconnect();
    this.motionQuery?.removeEventListener?.('change', this.motionListener);
    this.measurements.clear();
    this.resetGhostHistory();
    this.onFrame = null;
  }

  resize() {
    if (this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    const parent = this.canvas.parentElement?.getBoundingClientRect();
    this.width = Math.max(1, rect.width || parent?.width || 900);
    this.height = Math.max(1, rect.height || parent?.height || 350);
    const ratio = Math.min(2.5, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.resetGhostHistory();
    this.lastMotionPose = null;
    if (!this.transition) this.glyphs = this.layout(this.word);
    else {
      const targets = this.layout(this.word);
      this.transition = retargetRelationTransition(this.transition, targets);
      this.lastMotionPose = null;
    }
    this.draw();
  }

  layout(word) {
    const chars = segment(word);
    if (!chars.length) return [];
    let size = Math.min(124, this.height * 0.35);
    const tracking = /[\u3400-\u9fff]/u.test(word) ? 0.045 : 0.018;
    this.ctx.font = font(size);
    const initial =
      chars.reduce((sum, char) => sum + this.ctx.measureText(char).width, 0) +
      (chars.length - 1) * size * tracking;
    if (initial > this.width * 0.86) size *= (this.width * 0.86) / initial;
    size = Math.max(18, size);
    this.ctx.font = font(size);
    const widths = chars.map((char) => this.ctx.measureText(char).width);
    const gap = size * tracking;
    const total = widths.reduce((sum, width) => sum + width, 0) + (chars.length - 1) * gap;
    let cursor = -total / 2;
    return chars.map((char, index) => {
      const glyph = { char, x: (cursor + widths[index] / 2) / this.width, y: 0, size };
      cursor += widths[index] + gap;
      return glyph;
    });
  }

  snapshotGlyphs() {
    if (!this.transition) return this.glyphs.map((glyph) => ({ ...glyph }));
    const progress = unit((this.elapsed - this.transition.started) / this.transition.duration);
    const sampled = sampleRelationTransition(this.transition, progress, {
      reducedMotion: this.reducedMotion,
    });
    const strongest = new Map();
    sampled.glyphs.forEach((glyph) => {
      if (glyph.alpha > (strongest.get(glyph.recordIndex)?.alpha || 0))
        strongest.set(glyph.recordIndex, glyph);
    });
    return [...strongest.values()]
      .filter((glyph) => glyph.alpha > 0.15)
      .map((glyph) => ({ char: glyph.char, x: glyph.x, y: glyph.y, size: glyph.size }));
  }

  advanceTime(seconds) {
    if (!Number.isFinite(seconds) || (this.lastWallTime !== null && seconds < this.lastWallTime)) return;
    // Interpolations use elapsed shared time, not a capped simulation delta. A
    // dropped frame must still finish a handoff by its original beat deadline.
    const dt = this.lastWallTime === null ? 0 : Math.max(0, seconds - this.lastWallTime);
    this.lastWallTime = seconds;
    if (!this.paused) {
      this.elapsed += dt;
      const follow = 1 - Math.exp(-dt / 0.09);
      for (const key of ['energy', 'bass', 'mid', 'treble', 'brightness']) {
        this.display[key] = mix(this.display[key], this.features.silent ? 0 : this.features[key], follow);
      }
      if (this.transition && this.elapsed - this.transition.started >= this.transition.duration) {
        this.glyphs = this.transition.targets;
        this.transition = null;
      }
    }
  }

  frame(wallTime) {
    if (this.destroyed) return;
    const seconds = this.managedFrame ? wallTime : wallTime / 1000;
    if (!Number.isFinite(seconds)) return;
    const dt = this.lastDrawTime === null ? 0 : Math.max(0, seconds - this.lastDrawTime);
    this.lastDrawTime = seconds;
    this.advanceTime(seconds);
    this.draw();
    this.onFrame?.({ time: this.elapsed, delta: dt, fps: dt ? 1 / dt : 0, paused: this.paused });
    if (!this.managedFrame) this.raf = requestAnimationFrame(this.frame);
  }

  measureGlyph(char, size) {
    // Reuse static word metrics; transition sizes keep subpixel precision.
    const rounded = Math.round(size * 64) / 64;
    const key = `${char}\u0000${rounded}`;
    if (!this.measurements.has(key)) {
      if (this.measurements.size >= 1024) this.measurements.clear();
      this.ctx.font = font(rounded);
      this.measurements.set(key, this.ctx.measureText(char).width);
    }
    return this.measurements.get(key);
  }

  draw() {
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, width, height);
    if (!this.word) return;
    if (this.reducedMotion && this.ghost.history.length) this.resetGhostHistory();
    const transitionProgress = this.transition
      ? unit((this.elapsed - this.transition.started) / this.transition.duration)
      : 1;
    const glyphs = this.transition
      ? sampleRelationTransition(this.transition, transitionProgress, { reducedMotion: this.reducedMotion })
          .glyphs
      : this.glyphs.map((glyph, index) => ({
          ...glyph,
          alpha: 1,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          order: this.glyphs.length > 1 ? index / (this.glyphs.length - 1) - 0.5 : 0,
        }));
    const layout = glyphs.map((glyph) => {
      const glyphWidth = this.measureGlyph(glyph.char, glyph.size) * glyph.scaleX;
      const glyphHeight = glyph.size * 1.36 * glyph.scaleY;
      const c = Math.abs(Math.cos(glyph.rotation)),
        s = Math.abs(Math.sin(glyph.rotation));
      return {
        x: glyph.x * width,
        y: glyph.y * height,
        width: c * glyphWidth + s * glyphHeight,
        height: s * glyphWidth + c * glyphHeight,
        visible: glyph.alpha > 0.01,
      };
    });
    const motionSample =
      this.paused && this.lastMotionPose
        ? this.lastMotionPose
        : this.motion.sample(this.elapsed, {
            glyphCount: glyphs.length,
            reducedMotion: this.reducedMotion,
            beatPhase: this.features.beatPhase ?? this.features.phase,
            glyphOrders: glyphs.map((glyph) => glyph.order),
          });
    let pose, ghostPose, ghostState;
    if (this.paused && this.lastMotionPose) {
      pose = this.lastMotionPose;
      ghostPose = this.reducedMotion ? null : this.lastGhostPose;
      ghostState =
        this.reducedMotion && this.lastGhostState
          ? {
              ...this.lastGhostState,
              active: false,
              opacity: 0,
              sourceTime: null,
              reducedMotion: true,
              combinedBounds: { ...pose.bounds },
            }
          : this.lastGhostState;
      this.lastGhostPose = ghostPose;
      this.lastGhostState = ghostState;
    } else {
      const styled = this.ghost.styleMain(
        motionSample,
        { ...this.motion.features, toneStyle: this.features.toneStyle },
        this.elapsed,
        {
          reducedMotion: this.reducedMotion,
          intensity: this.intensity,
          beatIndex: this.motion.clockBeatIndex ?? this.motion.command?.beatIndex ?? 0,
          beatPhase: this.features.beatPhase ?? this.features.phase ?? 0,
        },
      );
      const delayed = this.ghost.sample(this.elapsed, {
        reducedMotion: this.reducedMotion,
        suspended: Boolean(this.transition),
      });
      // History is already in actual canvas space. Fit the current main layer
      // into the same space before the joint fit, avoiding recursive shrink.
      const fittedMain = constrainMotion(styled, layout, { width, height });
      if (delayed.pose && delayed.pose.glyphs.length === glyphs.length) {
        const pair = constrainGhostPair(fittedMain, delayed.pose, layout, { width, height });
        pose = pair.main;
        ghostPose = pair.ghost;
        ghostState = {
          ...delayed.metadata,
          combinedBounds: pair.combinedBounds,
          fitScale: pair.main.fitScale,
        };
      } else {
        pose = fittedMain;
        ghostPose = null;
        ghostState = {
          ...delayed.metadata,
          active: false,
          opacity: 0,
          sourceTime: null,
          combinedBounds: { ...pose.bounds },
          fitScale: pose.fitScale,
        };
      }
      if (!this.transition && !this.reducedMotion && !this.motion.audioSilent && !this.features.silent)
        this.ghost.record(this.elapsed, pose);
      ghostState.historySamples = this.ghost.history.length;
      this.lastMotionPose = pose;
      this.lastGhostPose = ghostPose;
      this.lastGhostState = ghostState;
    }
    if (ghostPose) this.drawTextLayer(glyphs, ghostPose, ghostState.opacity);
    this.drawTextLayer(glyphs, pose, 1, transitionProgress);
    if (this.emoji) {
      ctx.save();
      ctx.font = '22px "Segoe UI Emoji", sans-serif';
      ctx.globalAlpha = 0.65;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.emoji, width * 0.94, height * 0.9);
      ctx.restore();
    }
  }

  drawTextLayer(glyphs, pose, opacity, transitionProgress) {
    const ctx = this.ctx,
      width = this.width,
      height = this.height;
    ctx.save();
    ctx.filter = 'none';
    ctx.shadowBlur = 0;
    ctx.translate(width / 2 + pose.group.x * width, height * 0.45 + pose.group.y * height);
    ctx.rotate(pose.group.rotation);
    ctx.scale(pose.group.scaleX, pose.group.scaleY);
    if (opacity === 1 && this.transition && !this.reducedMotion) this.drawHandoffPaths(transitionProgress);
    for (const [index, glyph] of glyphs.entries()) {
      if (glyph.alpha < 0.01) continue;
      const movement = pose.glyphs[index] || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      ctx.save();
      ctx.translate(glyph.x * width + movement.x * width, glyph.y * height + movement.y * height);
      ctx.rotate(movement.rotation + glyph.rotation);
      ctx.scale(movement.scaleX * glyph.scaleX, movement.scaleY * glyph.scaleY);
      ctx.font = font(glyph.size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = glyph.alpha * opacity;
      ctx.fillText(glyph.char, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  drawHandoffPaths(progress) {
    const ctx = this.ctx,
      width = this.width,
      height = this.height;
    ctx.save();
    ctx.strokeStyle = '#a5a5a5';
    ctx.lineWidth = 1;
    ctx.globalAlpha = Math.sin(Math.PI * progress) ** 2 * 0.23;
    ctx.setLineDash([2, 7]);
    for (const entry of this.transition.records.filter((record) => !record.shared).slice(0, 8)) {
      ctx.beginPath();
      ctx.moveTo(entry.source.x * width, entry.source.y * height);
      ctx.bezierCurveTo(
        entry.oldC1.x * width,
        entry.oldC1.y * height,
        entry.oldC2.x * width,
        entry.oldC2.y * height,
        entry.oldHub.x * width,
        entry.oldHub.y * height,
      );
      ctx.moveTo(entry.newHub.x * width, entry.newHub.y * height);
      ctx.bezierCurveTo(
        entry.newC1.x * width,
        entry.newC1.y * height,
        entry.newC2.x * width,
        entry.newC2.y * height,
        entry.target.x * width,
        entry.target.y * height,
      );
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function segment(value) {
  if (globalThis.Intl?.Segmenter)
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
      (part) => part.segment,
    );
  return Array.from(value);
}

const emptyFeatures = () => ({
  energy: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  brightness: 0,
  strength: 0,
  onset: 0,
  beat: 0,
  silent: 1,
});
const font = (size) => `600 ${size}px "Segoe UI Variable Display", "Segoe UI", "Microsoft YaHei", sans-serif`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const unit = (value) => (Number.isFinite(value) ? clamp(value, 0, 1) : 0);
const mix = (from, to, amount) => from + (to - from) * amount;
