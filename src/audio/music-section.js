/**
 * Causal relative section lift, not semantic chorus or instrument recognition.
 * One current second and the preceding four seconds never overlap. Bounded
 * descriptor summaries remain local; neither audio nor spectra are retained.
 * FMP C4S4_NoveltySegmentation informs the novelty/coherence concept only:
 * this directional streaming algorithm does not copy its offline SSM code.
 */
const CURRENT_SECONDS = 1;
const REFERENCE_SECONDS = 4;
const BUCKET_SECONDS = 0.1;
// One event at either boundary is quantized at the respective window rate.
const DENSITY_BOUNDARY_TOLERANCE = 1 / CURRENT_SECONDS + 1 / REFERENCE_SECONDS;
const KEYS = ['amplitude', 'bass', 'mid', 'treble', 'brightness', 'noisiness'];
const unit = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const emptyValues = () => Object.fromEntries(KEYS.map((key) => [key, 0]));
const overlap = (bucket, from, to) => Math.max(0, Math.min(bucket.end, to) - Math.max(bucket.start, from));

export class MusicSectionDetector {
  constructor() {
    this.reset();
  }
  reset() {
    this.lastTime = null;
    this.validSeconds = 0;
    this.buckets = [];
    this.onsets = [];
    this.lastOnset = -Infinity;
    this.lastDensityLiftTime = -Infinity;
    this.lastEscalationDensityTime = -Infinity;
    this.lastDrumSequence = null;
    this.lastObservedFlag = false;
    this.probability = 0;
    this.high = false;
    this.episodes = 0;
    this.invalidSeconds = 0;
    this.dwell = 0;
    this.releaseSeconds = 0;
    this.rearmSeconds = 0;
    this.armed = true;
    this.candidateReference = null;
    this.episodeLevel = null;
    this.episodeReference = null;
    this.lastEpisodeTime = -Infinity;
    this.evidence = emptyEvidence();
  }
  holdTime(time) {
    if (!Number.isFinite(time)) return;
    // Shift all retained ranges together: pause cannot become music history.
    const shift = this.lastTime === null ? 0 : Math.max(0, time - this.lastTime);
    for (const bucket of this.buckets) {
      bucket.start += shift;
      bucket.end += shift;
    }
    this.onsets = this.onsets.map((onset) => onset + shift);
    if (Number.isFinite(this.lastOnset)) this.lastOnset += shift;
    if (Number.isFinite(this.lastEpisodeTime)) this.lastEpisodeTime += shift;
    if (Number.isFinite(this.lastDensityLiftTime)) this.lastDensityLiftTime += shift;
    if (Number.isFinite(this.lastEscalationDensityTime)) this.lastEscalationDensityTime += shift;
    this.lastTime = time;
  }
  update(features = {}, time) {
    if (!Number.isFinite(time)) return this.getState();
    let dt = this.lastTime === null ? 0 : time - this.lastTime;
    if (this.lastTime !== null && dt === 0) return this.getState();
    if (dt < 0 || dt > 0.25) {
      this.clearEvidence();
      dt = 0;
      this.lastTime = time;
    }
    const from = this.lastTime ?? time;
    this.lastTime = time;
    const observed = Boolean(features.observedBeat);
    const sequence =
      Number.isSafeInteger(features.drum?.sequence) && features.drum.sequence >= 0
        ? features.drum.sequence
        : null;
    const fresh = sequence !== null && (this.lastDrumSequence === null || sequence > this.lastDrumSequence);
    if (sequence !== null) this.lastDrumSequence = Math.max(this.lastDrumSequence ?? 0, sequence);
    const onset = features.drum
      ? fresh &&
        features.drum.hit &&
        unit(features.drum.confidence) >= 0.2 &&
        unit(features.drum.weight) >= 0.02
      : observed && !this.lastObservedFlag;
    this.lastObservedFlag = observed;
    // Consume identities even while invalid, avoiding replay of cached hits.
    if (features.audioSilent || features.silent || features.signalValid === 0) {
      this.invalidSeconds += dt;
      this.dwell = 0;
      this.candidateReference = null;
      this.lastDensityLiftTime = -Infinity;
      this.lastEscalationDensityTime = -Infinity;
      this.releaseSeconds = 0;
      this.rearmSeconds = 0;
      this.probability *= Math.exp(-dt / 0.5);
      if (this.probability < 0.3) this.high = false;
      if (this.invalidSeconds >= 0.8) this.clearEvidence();
      this.evidence = { ...this.evidence, sustainSeconds: 0, reason: 'invalid-audio' };
      return this.getState();
    }
    this.invalidSeconds = 0;
    this.validSeconds += dt;
    this.append(descriptors(features), from, time);
    if (onset && dt > 0 && time - this.lastOnset >= 0.055) {
      this.onsets.push(time);
      this.lastOnset = time;
    }
    const cutoff = time - CURRENT_SECONDS - REFERENCE_SECONDS;
    this.buckets = this.buckets.filter((bucket) => bucket.end > cutoff).slice(-56);
    this.onsets = this.onsets.filter((onsetTime) => onsetTime >= cutoff).slice(-128);
    const current = this.summarize(time - CURRENT_SECONDS, time);
    const rollingReference = this.summarize(cutoff, time - CURRENT_SECONDS);
    const reference = this.candidateReference ?? rollingReference;
    const ready = current.seconds >= 0.9 && rollingReference.seconds >= 3;
    if (ready && current.density - reference.density >= 0.75) this.lastDensityLiftTime = time;
    // One-second event counts change by one at a boundary, especially when a
    // weak tick was missed. Retain recently measured corroboration briefly,
    // requiring texture support every frame; no event is invented or replayed.
    const densitySupported = time - this.lastDensityLiftTime <= 0.35;
    const comparison = ready ? compare(current, reference, densitySupported) : emptyComparison();
    const support = ready ? this.support(time - CURRENT_SECONDS, time, reference, comparison) : 0;
    const tailSupport = ready ? this.support(time - 0.3, time, reference, comparison) : 0;
    const sustained = support >= 0.65 && tailSupport >= 0.5;
    const target = ready && sustained ? comparison.score : 0;
    this.probability +=
      (target - this.probability) * (1 - Math.exp(-dt / (target > this.probability ? 0.2 : 0.6)));
    const settled = ready && compare(current, rollingReference).score < 0.18;
    const recovered =
      ready && this.episodeLevel && recoveredLevel(current, this.episodeLevel, this.episodeReference);
    if (!this.armed) {
      this.releaseSeconds = settled || recovered ? this.releaseSeconds + dt : 0;
      if (time - this.lastEpisodeTime >= 2.5 && (this.releaseSeconds >= 0.65 || this.probability < 0.28))
        this.high = false;
      // Baseline adaptation is not a recovery. Only an actual retreat from
      // the frozen confirmed level can rearm the original low-to-high path.
      this.rearmSeconds = recovered && !this.high ? this.rearmSeconds + dt : 0;
      if (this.rearmSeconds >= 1.25) {
        this.armed = true;
        this.episodeLevel = null;
        this.episodeReference = null;
      }
    }
    // A later genuinely stronger section can follow without first going quiet.
    if (this.episodeLevel && current.density - this.episodeLevel.density >= 0.75)
      this.lastEscalationDensityTime = time;
    const escalation =
      !this.armed && this.episodeLevel && time - this.lastEpisodeTime >= 2
        ? compare(current, this.episodeLevel, time - this.lastEscalationDensityTime <= 0.35)
        : emptyComparison();
    const escalationSustained =
      this.episodeLevel &&
      this.support(time - CURRENT_SECONDS, time, this.episodeLevel, escalation) >= 0.65 &&
      this.support(time - 0.3, time, this.episodeLevel, escalation) >= 0.5;
    const candidate =
      ready && (this.armed ? target >= 0.58 : escalation.score >= 0.68 && escalationSustained);
    // Do not let the new section leak into its own reference during dwell.
    // A short fill loses recent support and releases this snapshot immediately.
    if (candidate && this.armed && !this.candidateReference) this.candidateReference = reference;
    if (!candidate) this.candidateReference = null;
    this.dwell = candidate ? this.dwell + dt : 0;
    if (this.dwell >= 0.85) {
      this.episodes++;
      this.high = true;
      this.armed = false;
      this.lastEpisodeTime = time;
      this.episodeLevel = { ...current, deviation: reference.deviation };
      this.episodeReference = reference;
      this.candidateReference = null;
      this.lastDensityLiftTime = -Infinity;
      this.lastEscalationDensityTime = -Infinity;
      this.releaseSeconds = 0;
      this.rearmSeconds = 0;
      this.dwell = 0;
    }
    this.evidence = {
      ready,
      armed: this.armed,
      currentSeconds: current.seconds,
      referenceSeconds: reference.seconds,
      ...comparison,
      currentDensity: current.density,
      referenceDensity: reference.density,
      support,
      tailSupport,
      sustainSeconds: this.dwell,
      recoverySeconds: this.rearmSeconds,
      reason: !ready
        ? 'warming-history'
        : this.high
          ? 'confirmed-relative-lift'
          : !this.armed
            ? 'waiting-for-recovery'
            : candidate
              ? 'sustaining-relative-lift'
              : 'no-sustained-lift',
    };
    return this.getState();
  }
  clearEvidence() {
    const episodes = this.episodes,
      time = this.lastTime,
      lastDrumSequence = this.lastDrumSequence,
      lastObservedFlag = this.lastObservedFlag;
    this.reset();
    this.episodes = episodes;
    this.lastTime = time;
    this.lastDrumSequence = lastDrumSequence;
    this.lastObservedFlag = lastObservedFlag;
  }
  append(values, from, to) {
    while (to - from > 1e-9) {
      let bucket = this.buckets.at(-1);
      if (!bucket || from >= bucket.start + BUCKET_SECONDS - 1e-9 || from - bucket.end > 1e-7) {
        bucket = { start: from, end: from, seconds: 0, sum: emptyValues() };
        this.buckets.push(bucket);
      }
      const end = Math.min(to, bucket.start + BUCKET_SECONDS),
        dt = end - from;
      for (const key of KEYS) bucket.sum[key] += values[key] * dt;
      bucket.seconds += dt;
      bucket.end = end;
      from = end;
    }
  }
  summarize(from, to) {
    const mean = this.mean(from, to);
    const density =
      this.onsets.filter((time) => time >= from && time < to).length / Math.max(0.1, mean.seconds);
    // Natural variation uses one-second block means, not individual drum frames.
    const blocks = [];
    for (let start = from; start + 0.9 <= to; start += 1) {
      const block = this.mean(start, Math.min(start + 1, to));
      if (block.seconds >= 0.8) {
        block.density =
          this.onsets.filter((time) => time >= start && time < start + 1).length / block.seconds;
        blocks.push(block);
      }
    }
    const deviation = {};
    for (const key of [...KEYS, 'density']) {
      const values = blocks.map((block) =>
        key === 'amplitude' ? Math.log(Math.max(0.002, block[key])) : block[key],
      );
      const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      deviation[key] = Math.sqrt(
        values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length),
      );
    }
    return { ...mean, density, deviation };
  }
  mean(from, to) {
    const mean = emptyValues();
    let seconds = 0;
    for (const bucket of this.buckets) {
      const covered = overlap(bucket, from, to);
      seconds += covered;
      for (const key of KEYS) mean[key] += (bucket.sum[key] / bucket.seconds) * covered;
    }
    if (seconds) for (const key of KEYS) mean[key] /= seconds;
    return { ...mean, seconds };
  }
  support(from, to, reference, comparison) {
    let supported = 0,
      seconds = 0;
    for (const bucket of this.buckets) {
      const covered = overlap(bucket, from, to);
      if (!covered) continue;
      seconds += covered;
      const value = Object.fromEntries(KEYS.map((key) => [key, bucket.sum[key] / bucket.seconds]));
      const amplitudeLift =
        Math.log(Math.max(0.002, value.amplitude) / Math.max(0.002, reference.amplitude)) >=
        0.16 + reference.deviation.amplitude * 1.2;
      const bandLift = ['bass', 'mid', 'treble'].some(
        (key) => value[key] - reference[key] >= 0.025 + reference.deviation[key] * 1.2,
      );
      const timbreLift =
        value.brightness - reference.brightness >= 0.03 + reference.deviation.brightness * 1.2 ||
        value.noisiness - reference.noisiness >= 0.03 + reference.deviation.noisiness * 1.2;
      const layerLift =
        comparison.amplitudeRatio >= 0.85 &&
        ((comparison.densityChange >= 0.45 && (bandLift || timbreLift)) ||
          (comparison.coherentLayers && bandLift && timbreLift));
      if (amplitudeLift || layerLift) supported += covered;
    }
    return seconds ? supported / seconds : 0;
  }
  getState() {
    return {
      probability: this.probability,
      high: this.high,
      episodes: this.episodes,
      validSeconds: this.validSeconds,
      evidence: { ...this.evidence },
    };
  }
}
function descriptors(features) {
  const bands = [unit(features.bass), unit(features.mid), unit(features.treble)];
  const total = bands.reduce((sum, value) => sum + value, 0);
  return {
    amplitude: unit(features.amplitude ?? features.rms),
    bass: total ? bands[0] / total : 0,
    mid: total ? bands[1] / total : 0,
    treble: total ? bands[2] / total : 0,
    brightness: unit(features.brightness ?? features.timbreBrightness),
    noisiness: unit(features.noisiness),
  };
}
function compare(current, reference, recentDensity = false) {
  const amplitudeRatio = Math.max(0.002, current.amplitude) / Math.max(0.002, reference.amplitude);
  const logRise = Math.log(amplitudeRatio);
  const amplitudeChange = unit((logRise - 0.18 - reference.deviation.amplitude * 2) / 0.5);
  const bandDistance = ['bass', 'mid', 'treble'].reduce(
    (sum, key) => sum + Math.abs(current[key] - reference[key]),
    0,
  );
  const bandNoise = ['bass', 'mid', 'treble'].reduce((sum, key) => sum + reference.deviation[key], 0);
  const bandChange = unit((bandDistance - 0.04 - bandNoise * 2) / 0.12);
  const timbreDistance =
    Math.abs(current.brightness - reference.brightness) + Math.abs(current.noisiness - reference.noisiness);
  const timbreChange = unit(
    (timbreDistance - 0.035 - (reference.deviation.brightness + reference.deviation.noisiness) * 2) / 0.1,
  );
  const densityDelta = current.density - reference.density;
  const densityChange =
    unit((densityDelta - 0.65 - reference.deviation.density * 1.5) / 1.8) *
    unit((current.density / Math.max(0.5, reference.density) - 1.15) / 0.55);
  const texture = Math.max(bandChange, timbreChange);
  const directionalTexture =
    ['bass', 'mid', 'treble'].some(
      (key) => current[key] - reference[key] > 0.025 + reference.deviation[key] * 1.2,
    ) ||
    current.brightness > reference.brightness + 0.03 + reference.deviation.brightness * 1.2 ||
    current.noisiness > reference.noisiness + 0.03 + reference.deviation.noisiness * 1.2;
  const positiveTimbre =
    current.brightness > reference.brightness + 0.03 + reference.deviation.brightness * 1.2 ||
    current.noisiness > reference.noisiness + 0.03 + reference.deviation.noisiness * 1.2;
  // Weak added attacks can be masked by existing drums or coarse sampling.
  // Persistent band and timbre changes corroborate a weak actual density rise.
  const coherentLayers =
    bandChange >= 0.65 &&
    timbreChange >= 0.18 &&
    positiveTimbre &&
    (densityDelta >= 0.75 || (recentDensity && densityDelta >= -DENSITY_BOUNDARY_TOLERANCE));
  return {
    amplitudeRatio,
    bandChange,
    timbreChange,
    densityChange,
    coherentLayers,
    score: Math.max(
      // Band proxies have a nonlinear scale; gain can move them slightly.
      // Independent timbre or actual density must corroborate their change.
      amplitudeChange * Math.max(timbreChange, densityChange, bandChange * unit(timbreChange * 3)),
      directionalTexture && amplitudeRatio >= 0.85 ? texture * densityChange : 0,
      coherentLayers && amplitudeRatio >= 0.85 ? bandChange * 0.75 + timbreChange * 0.25 : 0,
    ),
  };
}
function emptyComparison() {
  return {
    amplitudeRatio: 1,
    bandChange: 0,
    timbreChange: 0,
    densityChange: 0,
    coherentLayers: false,
    score: 0,
  };
}
function recoveredLevel(current, episode, before) {
  const amplitudeRetreat =
    Math.log(Math.max(0.002, current.amplitude) / Math.max(0.002, episode.amplitude)) <
    -0.24 - episode.deviation.amplitude;
  if (amplitudeRetreat) return true;
  const densityRetreat =
    episode.density - current.density > Math.max(1.5, episode.density * 0.25, episode.deviation.density * 2);
  if (!densityRetreat || !before) return false;
  const textureDistance = (a, b) =>
    ['bass', 'mid', 'treble', 'brightness', 'noisiness'].reduce(
      (sum, key) => sum + Math.abs(a[key] - b[key]),
      0,
    );
  return textureDistance(current, before) < textureDistance(episode, before) * 0.6;
}
function emptyEvidence() {
  return {
    ready: false,
    armed: true,
    currentSeconds: 0,
    referenceSeconds: 0,
    ...emptyComparison(),
    currentDensity: 0,
    referenceDensity: 0,
    support: 0,
    tailSupport: 0,
    sustainSeconds: 0,
    recoverySeconds: 0,
    reason: 'warming-history',
  };
}
