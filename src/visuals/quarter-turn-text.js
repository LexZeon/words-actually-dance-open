import { planQuarterTurnLayout, sampleQuarterTurnTransition } from './quarter-turn-layout.js';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
export const QUARTER_TURN_BEATS = 0.85;

/** DOM adapter for planar text choreography. The player supplies every beat phase. */
export class QuarterTurnText {
  constructor(host) {
    this.host = host;
    this.poses = new Map();
    this.transition = null;
    this.plan = null;
    this.progress = 1;
    this.reducedMotion = host.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  }

  measure(node) {
    return {
      width: node.offsetWidth || this.host.clientWidth || 900,
      height: node.offsetHeight || 40,
      fontPx: parseFloat(this.host.ownerDocument.defaultView?.getComputedStyle(node).fontSize) || 27,
    };
  }

  layout(current, history, { startBeat = 0, animate = false } = {}) {
    const width = this.host.clientWidth || 900;
    const height = this.host.clientHeight || 200;
    const previous = new Map(this.poses);
    const ongoing = animate ? null : this.transition;
    const progress = this.progress;
    // Retired type keeps its exact wrapping and font metrics while rotating.
    for (const node of history) {
      const prior = previous.get(node);
      if (prior) {
        node.style.width = `${prior.width}px`;
        node.style.maxWidth = `${prior.width}px`;
        node.style.fontSize = `${prior.fontPx}px`;
      }
    }
    // Batch DOM measurements before writing transformed positions.
    const measuredCurrent = this.measure(current);
    const measuredHistory = history.map((node) => previous.get(node) || this.measure(node));
    this.plan = planQuarterTurnLayout({ width, height, current: measuredCurrent, history: measuredHistory });
    const targets = new Map([[current, { ...this.plan.current, opacity: 1 }]]);
    for (const pose of this.plan.history)
      targets.set(history[pose.index], { ...pose, opacity: 0.6 - pose.age * 0.15 });
    const rows = [];
    for (const [index, node] of history.entries()) {
      const from = ongoing?.rows.find((row) => row.node === node)?.from ||
        previous.get(node) || {
          ...measuredHistory[index],
          centerX: width / 2,
          centerY: height / 2,
          angleDeg: index * 90,
          scale: 1,
          opacity: 0.5,
        };
      // An omitted sentence still finishes its quarter-turn before fading out.
      const to = targets.get(node) || {
        ...from,
        centerX: width / 2,
        centerY: height / 2,
        angleDeg: from.angleDeg + 90,
        scale: Math.min(from.scale, (height - 24) / Math.max(from.width, from.height)),
        opacity: 0,
      };
      targets.set(node, to);
      rows.push({ node, from, to });
    }
    this.poses = targets;
    this.transition =
      (animate || ongoing) && rows.length
        ? { rows, startBeat: ongoing?.startBeat ?? finite(startBeat, 0), width, height }
        : null;
    // Resizing can reflow the stage, but never advance an in-flight musical turn.
    this.progress = ongoing ? progress : this.transition && !this.reducedMotion?.matches ? 0 : 1;
    this.paint(current, targets.get(current));
    if (this.transition) this.paintTransition();
    else for (const node of history) this.paint(node, targets.get(node));
  }

  frame(position) {
    if (!this.transition || !Number.isFinite(position)) return;
    const { startBeat } = this.transition;
    // A stale frame cannot rewind already rendered text after a source rebase.
    this.progress = this.reducedMotion?.matches
      ? 1
      : Math.max(this.progress, clamp((position - startBeat) / QUARTER_TURN_BEATS, 0, 1));
    this.paintTransition();
  }

  paintTransition() {
    const { rows, width, height } = this.transition;
    for (const { node, from, to } of rows) {
      const pose = sampleQuarterTurnTransition({ from, to, width, height }, this.progress);
      // Keep omitted old text present throughout the turn, then gently retire it.
      const fade = Math.max(0, (this.progress - 0.72) / 0.28);
      pose.opacity =
        to.opacity === 0
          ? (from.opacity ?? 0.6) * (1 - fade)
          : (from.opacity ?? 1) + (to.opacity - (from.opacity ?? 1)) * this.progress;
      this.paint(node, pose);
      this.poses.set(node, pose);
    }
    if (this.progress === 1) this.transition = null;
  }

  paint(node, pose) {
    node.style.left = `${pose.centerX}px`;
    node.style.top = `${pose.centerY}px`;
    node.style.right = 'auto';
    node.style.transform = `translate(-50%, -50%) rotate(${pose.angleDeg}deg) scale(${pose.scale})`;
    node.style.opacity = String(pose.opacity ?? 1);
    node.style.filter = 'none';
    node.dataset.quarterAngle = String(pose.angleDeg);
  }

  clear() {
    for (const node of this.poses.keys()) {
      for (const property of [
        'left',
        'top',
        'right',
        'width',
        'maxWidth',
        'fontSize',
        'transform',
        'opacity',
      ])
        node.style[property] = '';
      delete node.dataset.quarterAngle;
    }
    this.poses.clear();
    this.transition = null;
    this.plan = null;
    this.progress = 1;
  }

  getState() {
    return {
      active: Boolean(this.transition),
      progress: this.progress,
      durationBeats: QUARTER_TURN_BEATS,
      source: 'internal-grid',
      current: this.plan?.current ?? null,
      history: this.plan?.history ?? [],
    };
  }
}
