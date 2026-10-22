import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { BeatClock } from '../src/audio/beat-clock.js';
import { DrumDetector } from '../src/audio/drum-detector.js';
import { MotionFeatures } from '../src/audio/motion-features.js';
import { MusicDelivery } from '../src/audio/music-delivery.js';
import { MotionDirector } from '../src/visuals/dance-motion.js';
import {
  MUSIC_SECTION_CASES,
  musicSectionPcmFixture,
  pcmSectionFixture,
} from '../tests/helpers/music-section-pcm-fixtures.mjs';
import { pcm16Wav } from '../tests/helpers/drum-pcm-fixtures.mjs';

/** Production DSP and motion graph. Reference change times are read only after
 * the audio loop, for scoring; no labelled BPM or section input enters it. */
export function measureMusicSectionFixture(
  fixture,
  { analysisHz = 90, phaseOffset = 0, MotionDirectorClass = MotionDirector } = {},
) {
  const options = { sampleRate: fixture.sampleRate, fftSize: fixture.fftSize };
  const beats = new BeatDetector(options);
  const drums = new DrumDetector(options);
  const descriptors = new MotionFeatures({ ...options, estimatePitch: false });
  const clock = new BeatClock();
  const delivery = new MusicDelivery();
  const motion = new MotionDirectorClass();
  const episodes = [],
    phrases = [];
  const samples = [];
  let lastEpisodes = 0,
    lastPhrase = null,
    observedFlag = false,
    voicedFrames = 0;
  for (let frame = 0; frame < fixture.seconds * analysisHz; frame++) {
    const time = frame / analysisHz + phaseOffset;
    const input = fixture.frame(time);
    const periodic = beats.process(input);
    const measured = {
      ...periodic,
      ...descriptors.process({ ...input, beatFeatures: periodic }),
      drum: drums.process({ ...input, spectrum: input.rawSpectrum }),
    };
    const observedPulse = Boolean(measured.beat) && !observedFlag;
    observedFlag = Boolean(measured.beat);
    const events = clock.update(measured, time);
    const grid = clock.getState();
    const periodicAccent = observedPulse && grid.observationAccepted && measured.confidence >= 0.55;
    const sensorAccent = !measured.silent && measured.strength >= 0.18 && measured.amplitudeRise >= 0.25;
    const rendering = {
      ...measured,
      delivery: delivery.update(measured, time),
      beat: events.some((event) => event.kind === 'beat') ? 1 : 0,
      bpm: grid.bpm,
      phase: grid.phase,
      beatPhase: grid.phase,
      beatIndex: grid.beatIndex,
      sourceGeneration: 1,
      audioSilent: measured.silent ? 1 : 0,
      silent: 0,
      observedBeat: periodicAccent || sensorAccent ? 1 : 0,
      observedStrength: measured.strength,
      observedConfidence: measured.confidence,
      observedTime: time,
    };
    motion.update(rendering, time, { glyphCount: 4 });
    const state = motion.getState(time, { glyphCount: 4 });
    if (!measured.silent) voicedFrames++;
    if (state.section.episodes > lastEpisodes)
      episodes.push({
        time,
        episode: state.section.episodes,
        probability: state.section.probability,
        sourceGeneration: rendering.sourceGeneration,
        sectionGeneration: motion.sectionGeneration ?? null,
      });
    lastEpisodes = state.section.episodes;
    const identity = motion.phrase?.startBeat ?? null;
    if (identity !== null && identity !== lastPhrase)
      phrases.push({
        time,
        startBeat: identity,
        episodeId: motion.phrase.episodeId ?? null,
        sourceGeneration: motion.phrase.sourceGeneration ?? null,
        sectionGeneration: motion.phrase.sectionGeneration ?? null,
        durationBeats: motion.phrase.durationBeats,
      });
    lastPhrase = identity;
    if (frame % Math.max(1, Math.round(analysisHz / 5)) === 0)
      samples.push({
        time,
        probability: state.section.probability,
        high: state.section.high,
        amplitude: measured.amplitude,
        bpm: grid.bpm,
        phraseActive: state.phrase.active,
        sectionEvidence: { ...state.section.evidence },
      });
  }
  const used = new Set();
  const matched = fixture.changes.map((change) => {
    const index = episodes.findIndex(
      (event, index) =>
        !used.has(index) &&
        event.time >= change.time &&
        event.time <= Math.min(change.until, change.time + 3),
    );
    if (index < 0) return { ...change, detectedAt: null, delaySeconds: null };
    used.add(index);
    return { ...change, detectedAt: episodes[index].time, delaySeconds: episodes[index].time - change.time };
  });
  const extraEpisodes = episodes.filter((_, index) => !used.has(index));
  const identityScoring = phrases.every(
    (phrase) => Number.isSafeInteger(phrase.episodeId) && phrase.episodeId > 0,
  );
  const identities = new Set(
    phrases.map((phrase) => `${phrase.sourceGeneration}:${phrase.sectionGeneration}:${phrase.episodeId}`),
  );
  const repeatedPhrases = identityScoring
    ? phrases.length - identities.size
    : Math.max(0, phrases.length - episodes.length);
  const missingPhraseEpisodes = identityScoring
    ? episodes.filter(
        (episode) =>
          !identities.has(`${episode.sourceGeneration}:${episode.sectionGeneration}:${episode.episode}`),
      ).length
    : Math.max(0, episodes.length - phrases.length);
  return {
    profile: fixture.profile,
    seconds: fixture.seconds,
    analysisHz,
    phaseOffset,
    sampleRate: fixture.sampleRate,
    source: 'actual-PCM-production-analysis-motion',
    labelsFedToDetector: false,
    voicedFrames,
    expectedChanges: fixture.labelsAvailable ? fixture.changes.length : null,
    detectedEpisodes: episodes.length,
    phraseStarts: phrases.length,
    repeatedPhrases,
    missingPhraseEpisodes,
    identityScoring,
    matched,
    extraEpisodes: fixture.labelsAvailable ? extraEpisodes.length : null,
    extraEpisodesPerMinute: fixture.labelsAvailable ? (extraEpisodes.length / fixture.seconds) * 60 : null,
    observedEpisodesPerMinute: (episodes.length / fixture.seconds) * 60,
    independentSectionLabels: fixture.labelsAvailable,
    pass: fixture.labelsAvailable
      ? matched.every((change) => change.detectedAt !== null) &&
        extraEpisodes.length === 0 &&
        repeatedPhrases === 0 &&
        missingPhraseEpisodes === 0 &&
        phrases.length === episodes.length
      : null,
    episodes,
    phrases,
    samples,
  };
}

export function readSectionWav(file, { seconds = 30 } = {}) {
  const bytes = fs.readFileSync(file);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
    throw new TypeError('Expected WAV');
  let format, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size > bytes.length) throw new TypeError('Truncated WAV');
    if (kind === 'fmt ') format = bytes.subarray(offset + 8, offset + 8 + size);
    if (kind === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (
    !format ||
    !data ||
    format.readUInt16LE(0) !== 1 ||
    format.readUInt16LE(2) !== 1 ||
    format.readUInt16LE(14) !== 16
  )
    throw new TypeError('Expected mono PCM16 WAV');
  const sampleRate = format.readUInt32LE(4);
  const count = Math.min(Math.floor(data.length / 2), Math.floor(seconds * sampleRate));
  const samples = Float32Array.from({ length: count }, (_, index) => data.readInt16LE(index * 2) / 32768);
  return pcmSectionFixture({
    profile: path.basename(file),
    sampleRate,
    seconds: count / sampleRate,
    samples,
    labelsAvailable: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? null : process.argv[index + 1];
  };
  const baseline = option('--baseline-motion');
  const MotionDirectorClass = baseline
    ? (await import(pathToFileURL(path.resolve(baseline)).href)).MotionDirector
    : MotionDirector;
  const analysisHz = Number(option('--analysis-hz') || 90);
  if (!Number.isFinite(analysisHz) || analysisHz < 20 || analysisHz > 240)
    throw new TypeError('Analysis Hz must be 20..240');
  const fixtures = MUSIC_SECTION_CASES.map((profile) => musicSectionPcmFixture({ profile }));
  const real = option('--real-audio');
  if (real) fixtures.push(readSectionWav(real));
  const report = {
    scope:
      'Independent original PCM arrangements. Unlabelled real audio only gives event frequency, never chorus accuracy.',
    baselineMotion: baseline || null,
    results: fixtures.map((fixture) =>
      measureMusicSectionFixture(fixture, { analysisHz, MotionDirectorClass }),
    ),
    limitations: [
      'Offline timing excludes WebAudio/OS buffers and actual rendering.',
      'High-energy evidence is not lyric, chorus or instrument recognition.',
      'No exhaustive section labels exist for the optional real recording.',
    ],
  };
  const output = option('--output');
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  const wavDirectory = option('--write-wav');
  if (wavDirectory) {
    fs.mkdirSync(wavDirectory, { recursive: true });
    for (const fixture of fixtures)
      fs.writeFileSync(path.join(wavDirectory, `${fixture.profile}.wav`), pcm16Wav(fixture));
  }
  console.log(
    JSON.stringify(
      report.results.map(
        ({
          profile,
          expectedChanges,
          detectedEpisodes,
          phraseStarts,
          repeatedPhrases,
          extraEpisodes,
          matched,
          pass,
        }) => ({
          profile,
          expectedChanges,
          detectedEpisodes,
          phraseStarts,
          repeatedPhrases,
          extraEpisodes,
          matched,
          pass,
        }),
      ),
      null,
      2,
    ),
  );
  if (report.results.some((result) => result.pass === false)) process.exitCode = 1;
}
