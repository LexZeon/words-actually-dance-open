import { EVENTS } from '../core/events.js';
import { MusicDelivery } from '../audio/music-delivery.js';

/** One musical grid drives both renderers; audio observations remain separate. */
export class PlaybackCoordinator {
  constructor({ audio, clock, dance, knowledge, bus, beforeBeat = () => {}, onFrame = () => {} }) {
    Object.assign(this, { audio, clock, dance, knowledge, bus, beforeBeat, onFrame });
    this.playing = false;
    this.beatOffset = 0;
    this.lastGlobalBeat = -1;
    this.lastObservedBeat = false;
    this.lastDrumSequence = -1;
    this.delivery = new MusicDelivery();
    this.rawFeatures = { bpm: 0, confidence: 0, silent: 1 };
    this.metrics = { frames: 0, beats: 0, observedBeats: 0, drumHits: 0, subdivisions: 0, fps: 0 };
    this.lastFrameTime = null;
    this.destroyed = false;
    this.started = false;
    this.raf = null;
    this.frame = this.frame.bind(this);
    this.scheduledFrame = (now) => {
      this.raf = null;
      this.frame(now);
    };
  }

  start() {
    if (this.destroyed || this.started) return false;
    this.started = true;
    this.scheduleFrame();
    return true;
  }

  scheduleFrame() {
    if (this.destroyed || !this.started || this.raf !== null) return;
    this.raf = requestAnimationFrame(this.scheduledFrame);
  }

  setPlaying(value) {
    if (this.destroyed) return;
    this.playing = Boolean(value);
    this.clock.setPaused(!this.playing);
    this.dance.setPaused(!this.playing);
    this.knowledge.setPaused(!this.playing);
    this.bus.emit(EVENTS.TIMELINE_PAUSED, { paused: !this.playing });
    this.bus.emit(EVENTS.PLAYBACK_CHANGED, { playing: this.playing, source: this.audio.mode });
  }

  resetSource() {
    if (this.destroyed) return;
    this.beatOffset = this.lastGlobalBeat + 1;
    this.clock.reset({ preserveTempo: true });
    this.clock.setPaused(!this.playing);
    this.lastObservedBeat = false;
    this.delivery.reset();
  }

  frame(now) {
    if (this.destroyed) return;
    const time = now / 1000;
    const measured = this.audio.sample();
    this.rawFeatures = { ...measured };
    this.metrics.frames++;
    if (this.lastFrameTime !== null && now > this.lastFrameTime) {
      const instantaneous = 1000 / (now - this.lastFrameTime);
      this.metrics.fps = this.metrics.fps ? this.metrics.fps * 0.95 + instantaneous * 0.05 : instantaneous;
    }
    this.lastFrameTime = now;
    this.bus.emit(EVENTS.AUDIO_FRAME, this.rawFeatures);
    if (this.destroyed) return;
    const observedPulse = Boolean(measured.beat && !this.lastObservedBeat && !measured.silent);
    if (observedPulse) {
      this.metrics.observedBeats++;
      this.bus.emit(EVENTS.BEAT, { source: 'observed', time, features: this.rawFeatures });
      if (this.destroyed) return;
    }
    this.lastObservedBeat = Boolean(measured.beat);

    const drum = measured.drum;
    const freshDrum = Boolean(
      drum?.hit && Number.isSafeInteger(drum.sequence) && drum.sequence > this.lastDrumSequence,
    );
    // Consume observations even while paused: a cached onset must never replay
    // as a fresh strike when the user resumes.
    if (freshDrum) this.lastDrumSequence = drum.sequence;
    const drumHit = Boolean(this.playing && !measured.silent && freshDrum);
    if (drumHit) {
      this.metrics.drumHits++;
      this.bus.emit(EVENTS.DRUM_HIT, { ...drum, source: 'observed', time, audioTime: drum.time });
      if (this.destroyed) return;
    }
    const delivery = this.delivery.update(
      { ...measured, sourceGeneration: this.audio.committedSourceGeneration },
      time,
      { paused: !this.playing },
    );

    const events = this.clock.update(measured, time);
    const grid = this.clock.getState();
    const pulse = this.playing && events.some((event) => event.kind === 'beat');
    const periodicAccent = observedPulse && grid.observationAccepted && measured.confidence >= 0.55;
    const sensorAccent = !measured.silent && measured.strength >= 0.18 && measured.amplitudeRise >= 0.25;
    const rendering = {
      ...measured,
      beat: pulse ? 1 : 0,
      bpm: grid.bpm,
      phase: grid.phase,
      beatPhase: grid.phase,
      // Dance cycles and knowledge use the same globally rebased musical
      // position, including skipped frames and committed source changes.
      beatIndex: grid.beatIndex + this.beatOffset,
      audioSilent: measured.silent ? 1 : 0,
      silent: this.playing ? 0 : 1,
      time,
      pulseSource: 'internal',
      observedBeat: this.playing && (periodicAccent || sensorAccent) ? 1 : 0,
      observedStrength: measured.strength,
      observedConfidence: measured.confidence,
      observedTime: time,
      observedAccentSource: periodicAccent ? 'periodic-onset' : 'transient',
      // Pending capture and pause cancel async operations, but neither starts
      // another musical source. Only an actually committed source resets poses.
      sourceGeneration: this.audio.committedSourceGeneration,
      drum: drum ? { ...drum, hit: drumHit } : undefined,
      delivery,
    };
    this.dance.setFeatures(rendering);
    if (this.destroyed) return;
    this.knowledge.setFeatures?.(rendering);
    if (this.destroyed) return;

    if (this.playing) {
      for (const rawEvent of events) {
        if (!this.playing) break;
        const event = { ...rawEvent, beatIndex: rawEvent.beatIndex + this.beatOffset };
        if (event.kind === 'beat') this.beforeBeat(event);
        if (this.destroyed) return;
        if (!this.playing) break;
        this.lastGlobalBeat = Math.max(this.lastGlobalBeat, event.beatIndex);
        this.knowledge.onTick(event, rendering);
        if (this.destroyed) return;
        // Count what knowledge has actually received. Reentrant Pause cancels
        // remaining work immediately, without replaying the rest of this batch.
        if (event.kind === 'beat') this.metrics.beats++;
        else this.metrics.subdivisions++;
        if (!this.playing) break;
        this.bus.emit(EVENTS.BEAT_GRID, event);
        if (this.destroyed) return;
        if (!this.playing) break;
      }
    }
    // A hook can pause during dispatch. Keep one static render/UI update with
    // the newly frozen state, while the shared clock owns all musical time.
    const frameGrid = this.clock.getState();
    if (!this.playing && !rendering.silent) {
      rendering.beat = 0;
      rendering.observedBeat = 0;
      if (rendering.drum) rendering.drum.hit = false;
      rendering.silent = 1;
      this.dance.setFeatures(rendering);
      if (this.destroyed) return;
    }
    // Managed stages render the exact grid/features used above, in this frame.
    // Legacy/simple test stages can omit frame() without changing scheduling.
    this.dance.frame?.(time);
    if (this.destroyed) return;
    this.knowledge.frame?.({ ...frameGrid, beatIndex: frameGrid.beatIndex + this.beatOffset, time });
    if (this.destroyed) return;
    this.onFrame({
      time,
      measured: this.rawFeatures,
      grid: frameGrid,
      events,
      rendering,
      playing: this.playing,
    });
    this.scheduleFrame();
  }

  getState() {
    return {
      playing: this.playing,
      features: { ...this.rawFeatures },
      clock: this.clock.getState(),
      metrics: { ...this.metrics },
      knowledge: this.knowledge.getState(),
      motion: this.dance.getMotionState?.(),
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.started = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}
