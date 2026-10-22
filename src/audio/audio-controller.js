import { BeatDetector } from './beat-detector.js';
import { MotionFeatures, EMPTY_MOTION_FEATURES } from './motion-features.js';
import { DrumDetector, EMPTY_DRUM, ageDrumObservation } from './drum-detector.js';
import { createDemoPcm } from './demo-music.js';
import { createDisplayAudioAdapter, stopDisplayStream, displayAudioError } from './display-audio.js';
import { prepareBufferPlayback, stopAudioNode, disconnectAudioNode } from './buffer-playback.js';
const EMPTY = Object.freeze({
  energy: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  brightness: 0,
  onset: 0,
  beat: 0,
  bpm: 0,
  confidence: 0,
  phase: 0,
  strength: 0,
  silent: 1,
  ...EMPTY_MOTION_FEATURES,
  drum: EMPTY_DRUM,
});
export class AudioController {
  constructor(
    onState = () => {},
    { onNextTrack = null, displayAudioAdapter = createDisplayAudioAdapter() } = {},
  ) {
    this.onState = onState;
    this.context = null;
    this.node = null;
    this.stream = null;
    this.output = null;
    this.buffer = null;
    this.mode = null;
    this.name = '';
    this.offset = 0;
    this.startedAt = 0;
    this.suspended = true;
    this.playlist = [];
    this.trackIndex = -1;
    this.onNextTrack = onNextTrack;
    this.displayAudioAdapter = displayAudioAdapter;
    this.releaseDisplayTracks = null;
    // Async intent/cancellation token: changes even for pause and resume.
    this.sourceGeneration = 0;
    // Musical source identity: changes only after a new source is committed.
    this.committedSourceGeneration = 0;
    this.pendingSource = null;
    this.destroyed = false;
    this.destroyPromise = null;
  }
  async initialize() {
    if (this.destroyed) throw new Error('音频播放器已关闭。');
    if (this.context) return;
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.45;
    this.analyser.minDecibels = -95;
    this.analyser.maxDecibels = -10;
    this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.decibels = new Float32Array(this.analyser.frequencyBinCount);
    this.wave = new Float32Array(this.analyser.fftSize);
    this.detector = new BeatDetector({ sampleRate: this.context.sampleRate, fftSize: this.analyser.fftSize });
    // The smoothed spectrum remains the tempo/trend input. Percussive attacks
    // need the current window rather than accumulated FFT display smoothing.
    this.drumAnalyser = this.context.createAnalyser();
    this.drumAnalyser.fftSize = this.analyser.fftSize;
    this.drumAnalyser.smoothingTimeConstant = 0;
    this.drumAnalyser.minDecibels = -95;
    this.drumAnalyser.maxDecibels = -10;
    this.drumDecibels = new Float32Array(this.drumAnalyser.frequencyBinCount);
    this.drumSpectrum = new Float32Array(this.drumAnalyser.frequencyBinCount);
    this.drumDetector = new DrumDetector({
      sampleRate: this.context.sampleRate,
      fftSize: this.drumAnalyser.fftSize,
    });
    // A zero-gain output keeps the analysis graph active without replaying system audio.
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.analyser.connect(this.drumAnalyser);
    this.drumAnalyser.connect(this.sink);
    this.sink.connect(this.context.destination);
  }
  beginSourceChange() {
    if (this.destroyed) throw new Error('音频播放器已关闭。');
    const generation = ++this.sourceGeneration;
    this.pendingSource = generation;
    return generation;
  }
  currentSourceChange(generation) {
    return !this.destroyed && generation === this.sourceGeneration;
  }
  finishSourceChange(generation) {
    if (this.pendingSource === generation) this.pendingSource = null;
  }
  resetAnalysis() {
    this.detector?.reset();
    this.motionFeatures?.reset();
    this.drumDetector?.reset();
    this.motionSource = null;
    this.sampleSnapshot = null;
    this.lastSampleTime = null;
    this.lastTraceTime = null;
  }
  disconnectSource() {
    const node = this.node,
      stream = this.stream,
      output = this.output;
    // Remove ownership before stop/ended callbacks can observe this source.
    this.node = null;
    this.stream = null;
    this.output = null;
    this.releaseDisplayTracks?.();
    this.releaseDisplayTracks = null;
    stopAudioNode(node);
    stopDisplayStream(stream);
    disconnectAudioNode(output);
  }
  async startSystem() {
    const support = this.getSystemAudioSupport();
    if (!support.available) throw new Error(support.guidance);
    const generation = this.beginSourceChange();
    let stream = null,
      preparedNode = null,
      abandoned = false,
      committed = false,
      releasePreparedTracks = null;
    try {
      const capture = Promise.resolve(this.displayAudioAdapter.request()).then((candidate) => {
        stream = candidate;
        if (abandoned || !this.currentSourceChange(generation)) {
          stopDisplayStream(candidate);
          stream = null;
          return null;
        }
        return candidate;
      });
      const ready = this.initialize().then(async () => {
        if (!this.currentSourceChange(generation)) return false;
        await this.context.resume();
        return this.currentSourceChange(generation);
      });
      const [, accepted] = await Promise.all([capture, ready]);
      if (!this.currentSourceChange(generation)) {
        return false;
      }
      if (!accepted || !stream) return false;
      const prepared = this.displayAudioAdapter.prepare(stream, support);
      preparedNode = this.context.createMediaStreamSource(prepared.audioStream);
      preparedNode.connect(this.analyser);
      const ended = () => {
        if (this.stream === stream) {
          this.suspended = true;
          this.disconnectSource();
          this.resetAnalysis();
          this.onState({ mode: this.mode, name: this.name, ended: true });
        }
      };
      const subscribed = [];
      releasePreparedTracks = () => {
        for (const track of subscribed) track.removeEventListener?.('ended', ended);
      };
      for (const track of prepared.lifetimeTracks) {
        track.addEventListener('ended', ended);
        subscribed.push(track);
      }
      // Preparing/connecting a replacement may fail; retire the old source
      // only after the new audio-only graph is complete and still current.
      if (!this.currentSourceChange(generation)) return false;
      this.disconnectSource();
      this.stream = stream;
      this.node = preparedNode;
      this.mode = 'system';
      this.name = prepared.name;
      this.suspended = false;
      this.offset = 0;
      this.releaseDisplayTracks = releasePreparedTracks;
      releasePreparedTracks = null;
      this.resetAnalysis();
      this.committedSourceGeneration++;
      committed = true;
      this.onState({ mode: this.mode, name: this.name, provider: prepared.provider });
      return true;
    } catch (error) {
      if (!this.currentSourceChange(generation)) return false;
      throw displayAudioError(error);
    } finally {
      abandoned = true;
      if (!committed) {
        releasePreparedTracks?.();
        stopAudioNode(preparedNode);
        stopDisplayStream(stream);
      }
      this.finishSourceChange(generation);
    }
  }
  getSystemAudioSupport() {
    return this.displayAudioAdapter.getSupport();
  }
  createDemo(profile = 'balanced') {
    const { samples, bpm } = createDemoPcm(profile, this.context.sampleRate);
    const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
    buffer.getChannelData(0).set(samples);
    return { buffer, bpm };
  }
  async startDemo(profile = 'balanced') {
    const generation = this.beginSourceChange();
    try {
      await this.initialize();
      if (!this.currentSourceChange(generation)) return false;
      await this.context.resume();
      if (!this.currentSourceChange(generation)) return false;
      const buffer = this.createDemo(profile).buffer;
      this.playBuffer(true, { buffer, offset: 0 });
      this.buffer = buffer;
      this.mode = 'demo';
      this.name = '试听 · ' + ({ bass: '低频', balanced: '律动', bright: '明亮' }[profile] || '律动');
      this.profile = profile;
      this.offset = 0;
      this.suspended = false;
      this.resetAnalysis();
      this.committedSourceGeneration++;
      this.onState({ mode: this.mode, name: this.name });
      return true;
    } catch (error) {
      if (!this.currentSourceChange(generation)) return false;
      throw error;
    } finally {
      this.finishSourceChange(generation);
    }
  }
  async addTrack(name, bytes, { accept = () => true } = {}) {
    await this.initialize();
    if (!accept()) return -1;
    if (this.playlist.length >= 8) throw new Error('实验列表最多 8 首，重新打开后可清空。');
    const arrayBuffer =
      bytes instanceof ArrayBuffer
        ? bytes
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    let buffer;
    try {
      buffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      throw new Error('暂时无法读取这个音频格式，请试试 MP3 或 WAV。');
    }
    if (this.destroyed) throw new Error('音频播放器已关闭。');
    if (!accept()) return -1;
    // Decoding yields control: another concurrent import may consume the slot.
    if (this.playlist.length >= 8) throw new Error('实验列表最多 8 首，重新打开后可清空。');
    this.playlist.push({ name, buffer });
    return this.playlist.length - 1;
  }
  async playTrack(index, { accept = () => true } = {}) {
    const track = this.playlist[index];
    if (!track || !accept()) return false;
    const generation = this.beginSourceChange();
    try {
      await this.initialize();
      if (!this.currentSourceChange(generation) || !accept()) return false;
      await this.context.resume();
      if (!this.currentSourceChange(generation) || !accept()) return false;
      this.playBuffer(false, { buffer: track.buffer, offset: 0 });
      this.trackIndex = index;
      this.buffer = track.buffer;
      this.mode = 'file';
      this.name = track.name;
      this.offset = 0;
      this.suspended = false;
      this.resetAnalysis();
      this.committedSourceGeneration++;
      this.onState({ mode: this.mode, name: this.name });
      return true;
    } catch (error) {
      if (!this.currentSourceChange(generation)) return false;
      throw error;
    } finally {
      this.finishSourceChange(generation);
    }
  }
  playBuffer(loop, { buffer = this.buffer, offset = this.offset } = {}) {
    const prepared = prepareBufferPlayback(this.context, this.analyser, { buffer, loop, offset });
    this.disconnectSource();
    Object.assign(this, prepared);
    const node = this.node;
    node.onended = () => {
      if (this.node === node && !this.suspended && !loop) {
        // Explicit selections/capture requests take precedence over automatic
        // advancement. Let the app coordinate natural next-track transitions.
        if (this.playlist.length > 1 && this.pendingSource === null) {
          const next = (this.trackIndex + 1) % this.playlist.length;
          const generation = this.sourceGeneration;
          Promise.resolve()
            .then(() => {
              if (!this.currentSourceChange(generation) || this.suspended) return false;
              return this.onNextTrack ? this.onNextTrack(next) : this.playTrack(next);
            })
            .catch((error) => {
              if (!this.destroyed && this.node === node && this.pendingSource === null) {
                this.suspended = true;
                this.onState({ mode: this.mode, name: this.name, ended: true, error: error.message });
              }
            });
        } else {
          this.suspended = true;
          this.onState({ mode: this.mode, name: this.name, ended: true });
        }
      }
    };
  }
  async setPaused(value) {
    if (this.destroyed) return false;
    const generation = ++this.sourceGeneration;
    this.pendingSource = null;
    if (!this.context) {
      this.suspended = !!value;
      return true;
    }
    if (value) {
      this.suspended = true;
      this.drumDetector?.reset();
      this.sampleSnapshot = null;
    }
    if (value && this.mode !== 'system' && this.node) {
      this.offset = (this.context.currentTime - this.startedAt) % this.buffer.duration;
      const node = this.node;
      this.node = null;
      stopAudioNode(node);
      disconnectAudioNode(this.output);
      this.output = null;
    } else if (!value) {
      await this.context.resume();
      if (!this.currentSourceChange(generation)) return false;
      if (this.mode !== 'system' && this.buffer && !this.node) this.playBuffer(this.mode === 'demo');
      this.suspended = false;
      this.resetAnalysis();
    }
    return true;
  }
  sample() {
    if (!this.context || !this.node || this.suspended) {
      if (this.motionSource) {
        this.motionFeatures?.reset();
        this.drumDetector?.reset();
        this.motionSource = null;
      }
      this.sampleSnapshot = null;
      this.lastSampleTime = null;
      return EMPTY;
    }
    this.motionFeatures ||= new MotionFeatures({
      sampleRate: this.context.sampleRate,
      fftSize: this.analyser.fftSize,
    });
    this.drumDetector ||= new DrumDetector({
      sampleRate: this.context.sampleRate,
      fftSize: this.analyser.fftSize,
    });
    if (this.motionSource !== this.node) {
      this.motionFeatures.reset();
      this.drumDetector.reset();
      this.motionSource = this.node;
      this.sampleSnapshot = null;
      this.lastSampleTime = null;
      this.lastTraceTime = null;
    }
    const time = this.context.currentTime;
    // A high-refresh screen can render >250 FPS. Analysis uses audio time and
    // a bounded 90 Hz cadence; duplicate render frames reuse the snapshot.
    if (this.sampleSnapshot && time >= this.lastSampleTime && time - this.lastSampleTime < 1 / 90) {
      if (!Number.isFinite(this.sampleSnapshot.drum.attackTime)) return this.sampleSnapshot;
      const drum = ageDrumObservation(this.sampleSnapshot.drum, time);
      if (drum.ageSeconds === this.sampleSnapshot.drum.ageSeconds) return this.sampleSnapshot;
      return {
        ...this.sampleSnapshot,
        // Reused analysis keeps its event identity, but its audio-clock age
        // still advances. Renderers compensate using their own current elapsed.
        drum,
      };
    }
    this.lastSampleTime = time;
    this.analyser.getFloatFrequencyData(this.decibels);
    this.analyser.getFloatTimeDomainData(this.wave);
    let square = 0;
    for (let i = 0; i < this.wave.length; i++) square += this.wave[i] * this.wave[i];
    for (let i = 0; i < this.spectrum.length; i++)
      this.spectrum[i] = Number.isFinite(this.decibels[i])
        ? Math.min(1, Math.pow(10, this.decibels[i] / 20))
        : 0;
    const rms = Math.sqrt(square / this.wave.length);
    // Fallback is for externally provided test analysers; the production graph
    // always provides the separate zero-smoothing analyser above.
    let attackSpectrum = this.spectrum;
    if (this.drumAnalyser) {
      this.drumAnalyser.getFloatFrequencyData(this.drumDecibels);
      for (let bin = 0; bin < this.drumSpectrum.length; bin++)
        this.drumSpectrum[bin] = Number.isFinite(this.drumDecibels[bin])
          ? Math.min(1, Math.pow(10, this.drumDecibels[bin] / 20))
          : 0;
      attackSpectrum = this.drumSpectrum;
    }
    if (
      window.desktop?.testMode &&
      window.__wadCollectTrace &&
      (this.lastTraceTime === null || this.lastTraceTime === undefined || time - this.lastTraceTime >= 0.05)
    ) {
      const trace = window.__wadAudioTrace || (window.__wadAudioTrace = []);
      window.__wadAudioTraceMeta = {
        sampleRate: this.context.sampleRate,
        fftSize: this.analyser.fftSize,
        sampleIntervalSeconds: 0.05,
        maxAnalysisHz: 90,
        frameLimit: 1200,
      };
      if (trace.length < 1200)
        trace.push({
          time,
          rms,
          sampleRate: this.context.sampleRate,
          fftSize: this.analyser.fftSize,
          spectrum: Array.from(this.spectrum),
        });
      this.lastTraceTime = time;
    }
    const input = { spectrum: this.spectrum, time, rms };
    const beatFeatures = this.detector.process(input);
    this.sampleSnapshot = {
      ...beatFeatures,
      ...this.motionFeatures.process({ ...input, wave: this.wave, beatFeatures }),
      drum: this.drumDetector.process({ ...input, spectrum: attackSpectrum, wave: this.wave }),
    };
    return this.sampleSnapshot;
  }
  destroy() {
    if (this.destroyed) return this.destroyPromise;
    this.destroyed = true;
    this.suspended = true;
    this.sourceGeneration++;
    this.pendingSource = null;
    this.disconnectSource();
    disconnectAudioNode(this.analyser);
    disconnectAudioNode(this.drumAnalyser);
    disconnectAudioNode(this.sink);
    this.resetAnalysis();
    this.buffer = null;
    this.playlist = [];
    this.trackIndex = -1;
    this.motionFeatures = null;
    this.detector = null;
    this.drumDetector = null;
    this.drumAnalyser = null;
    this.drumSpectrum = null;
    this.drumDecibels = null;
    this.spectrum = null;
    this.decibels = null;
    this.wave = null;
    // Cleanup cannot depend on close() succeeding, and concurrent callers
    // must all await the same close rather than seeing an early success.
    this.destroyPromise = Promise.resolve().then(() => this.context?.close());
    return this.destroyPromise;
  }
}
