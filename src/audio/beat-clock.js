/**
 * Continuous internal musical grid. It plays at a default/held tempo even when
 * audio is quiet or uncertain. Repeated observed evidence can slowly change
 * the tempo; grid events are explicitly INTERNAL, never detected audio beats.
 */
export class BeatClock {
  constructor({ defaultBpm = 108 } = {}) {
    this.defaultBpm = validTempo(defaultBpm) ? defaultBpm : 108;
    this.reset({ preserveTempo: false });
  }

  reset({ preserveTempo = true } = {}) {
    const existing = preserveTempo && validTempo(this.bpm);
    this.bpm = existing ? this.bpm : this.defaultBpm;
    this.targetBpm = this.bpm;
    this.hasAudioTempo = Boolean(existing && this.hasAudioTempo);
    this.tempoSource = existing ? 'held' : 'default';
    this.position = 0; // Quarter-beat units, independent of wall-clock content time.
    this.lastEmittedStep = -1;
    this.beatIndex = -1;
    this.lastTime = null;
    this.paused = false;
    this.lastObservedFlag = false;
    this.lastObservedTime = -Infinity;
    this.lastEvidenceTime = -Infinity;
    this.pendingEvidence = [];
    this.phaseObservations = [];
    this.phaseError = 0;
    this.phaseCorrectionRate = 0;
    this.phaseCorrectionTarget = 0;
    this.phaseLockSource = 'none';
    this.lastPhaseEvidenceTime = -Infinity;
    this.observationAccepted = false;
  }

  setPaused(paused) {
    const next = Boolean(paused);
    if (next === this.paused) return;
    this.paused = next;
    this.lastTime = null; // Freeze musical position; never replay paused time.
    this.releasePhaseLock();
  }

  getState() {
    return {
      bpm: this.bpm,
      targetBpm: this.targetBpm,
      tempoSource: this.tempoSource,
      phase: (((this.position / 4) % 1) + 1) % 1,
      beatIndex: this.beatIndex,
      subdivisionIndex: Math.max(0, this.lastEmittedStep) % 4,
      paused: this.paused,
      source: 'internal',
      phaseSource: 'internal-grid',
      phaseLockSource: this.phaseLockSource,
      phaseError: this.phaseError, // Signed shortest-cycle error, in beats.
      phaseCorrectionRate: this.phaseCorrectionRate, // Beats per second.
      effectiveBpm: this.bpm + this.phaseCorrectionRate * 60,
      observationAccepted: this.observationAccepted,
      phaseEvidenceSamples: this.phaseObservations.length,
    };
  }

  update(features = {}, time) {
    if (!Number.isFinite(time)) throw new TypeError('BeatClock requires a finite time in seconds.');
    const rawDt = this.lastTime === null || time < this.lastTime ? 0 : time - this.lastTime;
    this.lastTime = time;
    this.observationAccepted = false;
    if (this.paused) {
      this.lastObservedFlag = Boolean(features.beat);
      return [];
    }
    // The PLL only changes velocity. Never jump phase, rewind musical position,
    // or manufacture a catch-up burst to match an observed onset.
    if (
      rawDt > 0.25 ||
      features.silent ||
      !Number.isFinite(features.confidence) ||
      features.confidence < 0.3 ||
      time - this.lastPhaseEvidenceTime > 1.5
    )
      this.releasePhaseLock();
    else if (features.confidence < 0.45) {
      this.phaseCorrectionTarget = 0;
      this.phaseCorrectionRate = 0;
      this.phaseLockSource = Number.isFinite(this.lastPhaseEvidenceTime) ? 'held' : 'none';
    }
    const dt = Math.min(rawDt, 0.12, 0.95 / ((this.bpm / 60 + 0.28) * 4));
    const projectedPosition = this.position + dt * (this.bpm / 60 + this.phaseCorrectionRate) * 4;
    const observedEvidence = this.observeTempo(features, time, projectedPosition);
    this.observationAccepted = observedEvidence;
    if (this.hasAudioTempo && (features.silent || time - this.lastEvidenceTime > 2))
      this.tempoSource = 'held';
    // Bound elapsed musical time after a dropped frame, preserving ordered
    // subdivisions without a burst or catch-up after a long gap.
    const previousBpm = this.bpm;
    this.bpm += (this.targetBpm - this.bpm) * (1 - Math.exp(-dt / 1.1));
    this.phaseCorrectionRate +=
      (this.phaseCorrectionTarget - this.phaseCorrectionRate) * (1 - Math.exp(-dt / 0.18));
    const rate = ((previousBpm + this.bpm) / 2 / 60 + this.phaseCorrectionRate) * 4;
    this.position += dt * rate;
    const step = Math.floor(this.position + 1e-8);
    if (step <= this.lastEmittedStep) return [];
    const next = this.lastEmittedStep + 1;
    this.lastEmittedStep = next;
    this.beatIndex = Math.floor(next / 4);
    const subdivisionIndex = next % 4;
    return [
      {
        kind: subdivisionIndex === 0 ? 'beat' : 'subdivision',
        beatIndex: this.beatIndex,
        subdivisionIndex,
        phase: subdivisionIndex / 4,
        bpm: this.bpm,
        time: time - Math.max(0, this.position - next) / rate,
        source: 'internal',
        tempoSource: this.tempoSource,
        observedEvidence,
        phaseSource: 'internal-grid',
        phaseLockSource: this.phaseLockSource,
        phaseCorrectionRate: this.phaseCorrectionRate,
      },
    ];
  }

  observeTempo(features, time, projectedPosition) {
    const flag = Boolean(features.beat);
    const rising = flag && !this.lastObservedFlag;
    this.lastObservedFlag = flag;
    if (!rising || features.silent) return false;
    const interval = time - this.lastObservedTime;
    this.lastObservedTime = time;
    if (!validTempo(features.bpm) || !Number.isFinite(features.confidence) || features.confidence < 0.45)
      return false;
    const period = 60 / features.bpm;
    if (!Number.isFinite(interval) || Math.abs(interval - period) > period * 0.3) {
      this.releasePhaseLock();
      return false;
    }
    const coherentPhaseEvidence = this.observePhase(features, time, interval, projectedPosition);
    this.lastEvidenceTime = time;
    if (this.hasAudioTempo) this.tempoSource = 'audio';
    this.pendingEvidence = this.pendingEvidence.filter((entry) => time - entry.time <= 6);
    this.pendingEvidence.push({ time, bpm: features.bpm });
    if (this.pendingEvidence.length > 5) this.pendingEvidence.shift();
    if (this.pendingEvidence.length < 3) return true;
    const values = this.pendingEvidence
      .slice(-3)
      .map((entry) => entry.bpm)
      .sort((a, b) => a - b);
    const candidate = values[1];
    if (values[2] - values[0] > Math.max(3, candidate * 0.035)) return true;
    const difference = Math.abs(candidate - this.targetBpm);
    const meaningful = difference >= Math.max(6, this.targetBpm * 0.08);
    const confirmingHeldTempo = difference <= Math.max(2, this.targetBpm * 0.02);
    // Both a learned tempo and the default can lie between the coarse change
    // threshold and PLL admission window. Four strong, coherent real onsets
    // can resolve that gap. Otherwise a song near 108 BPM could remain on the
    // free-running default forever. Moderate/irregular guesses still hold it.
    const trustedFineAdjustment =
      coherentPhaseEvidence &&
      features.confidence >= 0.6 &&
      this.phaseObservations.every((entry) => entry.confidence >= 0.6) &&
      difference >= 1 &&
      !meaningful;
    if (meaningful || confirmingHeldTempo || trustedFineAdjustment) {
      if (meaningful || trustedFineAdjustment) this.targetBpm = candidate;
      this.hasAudioTempo = true;
      this.tempoSource = 'audio';
      this.pendingEvidence = [];
    }
    return true;
  }

  observePhase(features, time, interval, projectedPosition) {
    const period = 60 / features.bpm;
    if (features.confidence < 0.45 || Math.abs(interval - period) > period * 0.12) {
      this.releasePhaseLock();
      return false;
    }
    const matchesGrid = Math.abs(features.bpm - this.bpm) <= this.bpm * 0.03;
    const matchesAcceptedTempo =
      this.hasAudioTempo && Math.abs(features.bpm - this.targetBpm) <= this.targetBpm * 0.035;
    if (!matchesGrid && !matchesAcceptedTempo) {
      // Collect genuine onset consistency while tempo evidence is accumulating,
      // but never pull the grid toward an unaccepted arbitrary candidate.
      this.phaseCorrectionTarget = 0;
      this.phaseCorrectionRate = 0;
      this.phaseLockSource = Number.isFinite(this.lastPhaseEvidenceTime) ? 'held' : 'none';
    }
    if (
      this.phaseObservations.length &&
      Math.abs(this.phaseObservations.at(-1).bpm - features.bpm) > features.bpm * 0.06
    )
      this.phaseObservations = [];
    const phase = (((projectedPosition / 4) % 1) + 1) % 1;
    this.phaseObservations.push({ time, bpm: features.bpm, phase, confidence: features.confidence });
    if (this.phaseObservations.length > 4) this.phaseObservations.shift();
    this.lastPhaseEvidenceTime = time;
    if (this.phaseObservations.length < 4) return false;
    const tempos = this.phaseObservations.map((entry) => entry.bpm);
    if (Math.max(...tempos) - Math.min(...tempos) > features.bpm * 0.03) {
      this.releasePhaseLock();
      return false;
    }
    // Check observation-time consistency, not internal-phase consistency: a
    // working PLL intentionally changes internal phase during convergence.
    const firstObserved = this.phaseObservations[0].time;
    const cos =
      this.phaseObservations.reduce(
        (sum, entry) => sum + Math.cos(((entry.time - firstObserved) / period) * 2 * Math.PI),
        0,
      ) / 4;
    const sin =
      this.phaseObservations.reduce(
        (sum, entry) => sum + Math.sin(((entry.time - firstObserved) / period) * 2 * Math.PI),
        0,
      ) / 4;
    if (Math.hypot(cos, sin) < (features.confidence < 0.6 ? 0.98 : 0.96)) {
      this.releasePhaseLock();
      return false;
    }
    if (!matchesGrid && !matchesAcceptedTempo) return true;
    this.phaseError = phase >= 0.5 ? 1 - phase : -phase;
    const maximumRate = Math.min(0.28, (this.bpm / 60) * 0.12);
    this.phaseCorrectionTarget = Math.max(-maximumRate, Math.min(maximumRate, this.phaseError * 0.95));
    this.phaseLockSource = 'observed-onsets';
    return true;
  }

  releasePhaseLock() {
    this.phaseObservations = [];
    this.phaseCorrectionTarget = 0;
    this.phaseCorrectionRate = 0;
    this.phaseLockSource = Number.isFinite(this.lastPhaseEvidenceTime) ? 'held' : 'none';
  }
}

const validTempo = (bpm) => Number.isFinite(bpm) && bpm >= 45 && bpm <= 220;
