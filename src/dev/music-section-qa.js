const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition, message) => {
  if (!condition) throw new Error(`Section QA: ${message}`);
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** Read-only diagnostics: accepting a sharing track does not establish that
 * the app is playing, its audio graph is live, or samples are nonzero. */
export function getLiveAudioState(app) {
  return {
    appPlaying: Boolean(app.state?.playing),
    playbackPlaying: Boolean(app.playback?.playing),
    audioSuspended: Boolean(app.audio?.suspended),
    contextState: app.audio?.context?.state || 'unavailable',
    contextTime: Number.isFinite(app.audio?.context?.currentTime) ? app.audio.context.currentTime : null,
    sourceMode: app.audio?.mode || null,
    sourceNodePresent: Boolean(app.audio?.node),
    analyserPresent: Boolean(app.audio?.analyser),
    rawDrumAnalyserPresent: Boolean(app.audio?.drumAnalyser),
  };
}

function captureState(name) {
  return {
    name,
    frameCount: 0,
    voicedFrames: 0,
    lastSampleTime: -Infinity,
    lastEpisode: 0,
    lastPhraseIdentity: null,
    episodes: [],
    phrases: [],
    samples: [],
    finiteCanvas: true,
    canvasWithinBounds: true,
    overflow: false,
  };
}

function recordFrame(app, capture, frame, musicTime) {
  if (!capture || !frame.playing || !Number.isFinite(musicTime)) return;
  const motion = app.dance.getMotionState();
  capture.frameCount++;
  if (!frame.measured.silent) capture.voicedFrames++;
  if (motion.section.episodes > capture.lastEpisode) {
    if (capture.episodes.length >= 64) capture.overflow = true;
    else
      capture.episodes.push({
        time: musicTime,
        episode: motion.section.episodes,
        probability: motion.section.probability,
      });
  }
  capture.lastEpisode = motion.section.episodes;
  const phrase = motion.phrase;
  const startBeat = phrase.startBeat ?? app.dance.motion.phrase?.startBeat ?? null;
  const identity =
    startBeat === null
      ? null
      : `${phrase.sourceGeneration}:${phrase.sectionGeneration}:${phrase.episodeId}:${startBeat}`;
  if (identity !== null && identity !== capture.lastPhraseIdentity) {
    if (capture.phrases.length >= 64) capture.overflow = true;
    else
      capture.phrases.push({
        time: musicTime,
        startBeat,
        episodeId: phrase.episodeId,
        sourceGeneration: phrase.sourceGeneration,
        sectionGeneration: phrase.sectionGeneration,
        durationBeats: phrase.durationBeats,
        visibleFrames: 0,
        maximumEnvelope: 0,
      });
  }
  capture.lastPhraseIdentity = identity;
  const active = capture.phrases.at(-1);
  if (active && phrase.active) {
    active.visibleFrames++;
    active.maximumEnvelope = Math.max(active.maximumEnvelope, phrase.envelope);
  }
  const poses = motion.poses ? [motion.poses.group, ...motion.poses.glyphs] : [];
  capture.finiteCanvas &&=
    poses.length > 0 && poses.every((pose) => Object.values(pose).every(Number.isFinite));
  const { bounds, canvas } = motion.constraints || {};
  capture.canvasWithinBounds &&= Boolean(
    bounds &&
    canvas &&
    bounds.left >= -1 &&
    bounds.top >= -1 &&
    bounds.right <= canvas.width + 1 &&
    bounds.bottom <= canvas.height + 1,
  );
  if (musicTime - capture.lastSampleTime >= 0.2 && capture.samples.length < 750) {
    capture.lastSampleTime = musicTime;
    capture.samples.push({
      time: musicTime,
      amplitude: frame.measured.amplitude,
      signalValid: frame.measured.signalValid,
      probability: motion.section.probability,
      high: motion.section.high,
      sectionEvidence: { ...motion.section.evidence },
      bpm: frame.grid.bpm,
      phraseActive: phrase.active,
      phrasePhase: phrase.phase,
      effectiveCharsPerBeat: app.knowledge.getState().effectiveCharsPerBeat,
    });
  }
}

/** Installed only in an explicit native test process. Production receives audio
 * bytes, never expected section identities or reference change timestamps. */
export function installMusicSectionQA(app) {
  const target = app.window || globalThis.window;
  if (!target?.desktop?.testMode) return false;
  let installed = true,
    running = false;

  async function actualAudio(fixtures) {
    assert(installed && !app.destroyed && !running, 'application unavailable');
    assert(
      Array.isArray(fixtures) && fixtures.length > 0 && fixtures.length <= 8,
      'bounded fixtures required',
    );
    running = true;
    const saved = {
      onFrame: app.playback.onFrame,
      onNextTrack: app.audio.onNextTrack,
      onLine: app.knowledge.onLine,
      onKeyword: app.knowledge.onKeyword,
      onComplete: app.knowledge.onComplete,
    };
    const files = [];
    let capture = null,
      recorder,
      pauseTested = false,
      pauseStable = false;
    try {
      app.setPlaying(false);
      await app.audio.setPaused(true);
      app.pendingTopic = null;
      app.audio.onNextTrack = () => false;
      app.knowledge.onLine = app.knowledge.onComplete = () => {};
      app.knowledge.onKeyword = (word, relation, duration) =>
        app.dance.setWord(word, relation, { beatDuration: duration });
      app.knowledge.setScript({
        id: 'qa-section-caption',
        lines: Array.from({ length: 24 }, (_, index) => ({
          text: '高能变化需要前后比较，持续重鼓仍然只是同一段音乐。保持阅读，让变化清晰而舒服。',
          keyword: index % 2 ? '变化' : '重鼓',
          holdBeats: 2,
        })),
      });
      recorder = (frame) => {
        saved.onFrame(frame);
        recordFrame(app, capture, frame, app.audio.context.currentTime - app.audio.startedAt);
      };
      app.playback.onFrame = recorder;
      for (const fixture of fixtures) {
        assert(
          /^[a-z0-9-]{1,80}$/i.test(fixture.name) &&
            Number.isFinite(fixture.seconds) &&
            fixture.seconds >= 1 &&
            fixture.seconds <= 40 &&
            typeof fixture.base64 === 'string' &&
            fixture.base64.length < 6000000,
          'invalid audio payload',
        );
        const bytes = Uint8Array.from(atob(fixture.base64), (character) => character.charCodeAt(0));
        const track = await app.audio.addTrack(fixture.name, bytes);
        capture = captureState(fixture.name);
        await app.changeSource(() => app.audio.playTrack(track));
        const deadline = performance.now() + (fixture.seconds + 5) * 1000;
        while (app.audio.context.currentTime - app.audio.startedAt < fixture.seconds - 0.12) {
          assert(
            installed && !app.destroyed && performance.now() < deadline,
            `playback timeout: ${fixture.name}`,
          );
          const phrase = app.dance.getMotionState().phrase;
          if (
            fixture.name === 'light-to-strong' &&
            !pauseTested &&
            phrase.active &&
            phrase.phase > 0.15 &&
            phrase.phase < 0.7
          ) {
            app.setPlaying(false);
            await app.audio.setPaused(true);
            await wait(40);
            const before = app.dance.getMotionState();
            await wait(150);
            const after = app.dance.getMotionState();
            pauseStable = same(before.poses, after.poses) && same(before.phrase, after.phrase);
            await app.audio.setPaused(false);
            app.setPlaying(true);
            pauseTested = true;
          }
          await new Promise((resolve) => target.requestAnimationFrame(resolve));
        }
        files.push(capture);
        capture = null;
        app.setPlaying(false);
        await app.audio.setPaused(true);
      }
      return {
        pass:
          files.every(
            (file) =>
              file.voicedFrames > 10 && file.finiteCanvas && file.canvasWithinBounds && !file.overflow,
          ) &&
          pauseTested &&
          pauseStable,
        actualWebAudio: true,
        inputSource: 'actual-WebAudio-file',
        syntheticAudio: true,
        referenceLabelsFedToDetector: false,
        pauseTested,
        pauseStable,
        files,
      };
    } finally {
      target.__wadSectionNativeEvidence = { files, partial: capture };
      capture = null;
      app.setPlaying(false);
      await app.audio.setPaused(true);
      if (!app.audio.destroyed) app.audio.onNextTrack = saved.onNextTrack;
      if (!app.playback.destroyed && app.playback.onFrame === recorder) app.playback.onFrame = saved.onFrame;
      if (!app.destroyed) {
        app.knowledge.onLine = saved.onLine;
        app.knowledge.onKeyword = saved.onKeyword;
        app.knowledge.onComplete = saved.onComplete;
      }
      running = false;
    }
  }

  async function observeLive({ duration = 30000 } = {}) {
    assert(
      installed && !app.destroyed && !running && app.audio.mode === 'system',
      'a real system source must already be selected',
    );
    duration = Math.min(120000, Math.max(1000, Number(duration) || 30000));
    running = true;
    const capture = captureState('live-shared-audio');
    const saved = app.playback.onFrame;
    const start = app.audio.context.currentTime;
    const runtimeStart = getLiveAudioState(app);
    const initial = app.dance.getMotionState();
    capture.lastEpisode = initial.section.episodes;
    const initialPhrase = initial.phrase;
    if (initialPhrase.startBeat != null)
      capture.lastPhraseIdentity = `${initialPhrase.sourceGeneration}:${initialPhrase.sectionGeneration}:${initialPhrase.episodeId}:${initialPhrase.startBeat}`;
    const recorder = (frame) => {
      saved(frame);
      recordFrame(app, capture, frame, app.audio.context.currentTime - start);
    };
    app.playback.onFrame = recorder;
    try {
      await wait(duration);
      return {
        ...capture,
        runtimeStart,
        runtimeEnd: getLiveAudioState(app),
        duration,
        source: 'actual-system-audio-observation',
        actualWebAudio: true,
        sourceMode: app.audio.mode,
        sourceGeneration: app.audio.committedSourceGeneration,
        audioTracks: (app.audio.stream?.getAudioTracks() || []).map((track) => ({
          kind: track.kind,
          readyState: track.readyState,
          enabled: track.enabled,
        })),
        videoTracks: (app.audio.stream?.getVideoTracks() || []).map((track) => ({
          kind: track.kind,
          readyState: track.readyState,
          enabled: track.enabled,
        })),
        sectionAccuracy: null,
        independentSectionLabels: false,
        labelsFedToDetector: false,
        captureUsable: capture.voicedFrames > 10 && !capture.overflow,
      };
    } finally {
      if (!app.playback.destroyed && app.playback.onFrame === recorder) app.playback.onFrame = saved;
      running = false;
    }
  }

  async function captureLive(options) {
    assert(installed && !app.destroyed && !running, 'application unavailable');
    // Electron's native test caller supplies a deliberate user gesture. This
    // uses the actual app capture transaction and never creates a fake stream.
    const accepted = await app.captureSystem();
    assert(accepted && app.audio.mode === 'system', 'system audio selection failed');
    const runtime = getLiveAudioState(app);
    assert(
      runtime.appPlaying &&
        runtime.playbackPlaying &&
        !runtime.audioSuspended &&
        runtime.contextState === 'running' &&
        runtime.sourceNodePresent &&
        runtime.analyserPresent,
      `capture committed but playback/audio graph is not running: ${JSON.stringify(runtime)}`,
    );
    return observeLive(options);
  }

  target.__wadSectionSmokeTest = actualAudio;
  target.__wadLiveSectionObserve = observeLive;
  target.__wadLiveSectionCapture = captureLive;
  const dispose = () => {
    installed = false;
    if (target.__wadSectionSmokeTest === actualAudio) delete target.__wadSectionSmokeTest;
    if (target.__wadLiveSectionObserve === observeLive) delete target.__wadLiveSectionObserve;
    if (target.__wadLiveSectionCapture === captureLive) delete target.__wadLiveSectionCapture;
    delete target.__wadSectionNativeEvidence;
    target.removeEventListener?.('beforeunload', dispose);
  };
  target.addEventListener?.('beforeunload', dispose, { once: true });
  return dispose;
}
