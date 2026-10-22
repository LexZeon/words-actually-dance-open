import { TextFlowLayout } from './text-flow-layout.js';

export const TEXT_FLOW_BEATS = 0.85;
const clamp = (value) => Math.min(1, Math.max(0, value));

/** One shared plane/camera preserves the spatial relationship of every sentence. */
export class TextFlow {
  constructor(host) {
    this.host = host;
    this.layoutModel = new TextFlowLayout();
    this.entries = new Map();
    this.plane = null;
    this.state = null;
    this.startBeat = null;
    this.reducedMotion = host.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  }

  has(node) {
    return this.entries.has(node);
  }

  measure(node) {
    return {
      width: node.offsetWidth || this.host.clientWidth || 900,
      height: node.offsetHeight || 40,
      fontPx: parseFloat(this.host.ownerDocument.defaultView?.getComputedStyle(node).fontSize) || 27,
    };
  }

  viewport() {
    return { width: this.host.clientWidth || 900, height: this.host.clientHeight || 200 };
  }

  append(node) {
    const measured = this.measure(node);
    const state = this.layoutModel.append(measured, this.viewport());
    this.entries.set(node, state.currentId);
    node.style.width = `${measured.width}px`;
    node.style.maxWidth = `${measured.width}px`;
    node.style.fontSize = `${measured.fontPx}px`;
    this.plane.append(node);
    return state;
  }

  layout(current, history, { startBeat = 0, animate = false } = {}) {
    if (!this.plane) {
      this.plane = this.host.ownerDocument.createElement('div');
      this.plane.className = 'knowledge-flow-plane';
      this.host.append(this.plane);
      // Entering this effect also retains existing DOM and literal text.
      for (const node of [...history].reverse()) {
        this.append(node);
        this.layoutModel.sample(1);
      }
    }
    if (!this.has(current)) {
      this.state = this.append(current);
      this.startBeat = animate ? startBeat : null;
      if (!animate || this.reducedMotion?.matches) this.state = this.layoutModel.sample(1);
    } else this.state = this.layoutModel.resize(this.viewport());
    const retained = new Set([current, ...history]);
    for (const node of this.entries.keys()) if (!retained.has(node)) this.entries.delete(node);
    this.paint();
  }

  frame(position) {
    if (!this.state?.active || this.startBeat === null || !Number.isFinite(position)) return;
    const progress = this.reducedMotion?.matches
      ? 1
      : Math.max(this.state.progress, clamp((position - this.startBeat) / TEXT_FLOW_BEATS));
    this.state = this.layoutModel.sample(progress);
    this.paintCamera();
    if (!this.state.active) this.startBeat = null;
  }

  paint() {
    const poses = new Map(this.state.nodes.map((pose) => [pose.id, pose]));
    for (const [node, id] of this.entries) {
      const pose = poses.get(id);
      if (!pose) continue;
      node.style.left = `${pose.centerX}px`;
      node.style.top = `${pose.centerY}px`;
      node.style.right = 'auto';
      node.style.transform = `translate(-50%, -50%) rotate(${pose.angleDeg}deg)`;
      node.style.opacity = node.classList.contains('current') ? '1' : '0.78';
      node.style.filter = 'none';
      node.dataset.flowId = id;
    }
    this.paintCamera();
  }

  paintCamera() {
    const { centerX, centerY, focusX, focusY, zoom, angleDeg } = this.state.camera;
    this.plane.style.transform = `translate(${focusX}px, ${focusY}px) scale(${zoom}) rotate(${angleDeg}deg) translate(${-centerX}px, ${-centerY}px)`;
  }

  clear() {
    // Move, never clone: KnowledgeStage retains references to every glyph/group.
    if (this.plane) {
      for (const node of [...this.plane.children]) this.host.append(node);
      this.plane.remove();
    }
    for (const node of this.entries.keys()) {
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
      delete node.dataset.flowId;
    }
    this.entries.clear();
    this.layoutModel.clear();
    this.plane = null;
    this.state = null;
    this.startBeat = null;
  }

  getState() {
    return this.state
      ? { ...this.state, source: 'internal-grid', durationBeats: TEXT_FLOW_BEATS, sharedPlane: true }
      : null;
  }
}
