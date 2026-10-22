import { EVENTS } from '../core/events.js';

/** Only installed in native QA. Captures the state after the actual drawing frame. */
export function collectAlignment(app, { file = false } = {}) {
  const frames = [],
    beats = [];
  const previousFrame = app.playback.onFrame;
  const recorder = (frame) => {
    previousFrame(frame);
    if (!frame.playing) return;
    const motion = app.dance.getMotionState();
    const audioTime = app.audio.context.currentTime;
    frames.push({
      time: frame.time,
      audioTime,
      ...(file ? { musicTime: audioTime - app.audio.startedAt } : {}),
      measured: {
        beat: frame.measured.beat,
        bpm: frame.measured.bpm,
        confidence: frame.measured.confidence,
        silent: frame.measured.silent,
        strength: frame.measured.strength,
      },
      grid: { ...frame.grid },
      rendering: {
        beat: frame.rendering.beat,
        observedBeat: frame.rendering.observedBeat,
        observedAccentSource: frame.rendering.observedAccentSource,
      },
      accent: { ...motion.accent },
      group: motion.poses ? { ...motion.poses.group } : null,
      fps: app.playback.metrics.fps,
    });
  };
  const unsubscribe = app.bus.on(EVENTS.BEAT_GRID, (event) => {
    if (!file || event.kind !== 'beat') return;
    const now = performance.now() / 1000;
    const musicNow = app.audio.context.currentTime - app.audio.startedAt;
    beats.push({ time: musicNow - (now - event.time), bpm: event.bpm });
  });
  app.playback.onFrame = recorder;
  return () => {
    unsubscribe();
    if (app.playback.onFrame === recorder) app.playback.onFrame = previousFrame;
    return { frames, beats };
  };
}

export async function runAnnotatedFile(app, { name, base64, duration = 30000 } = {}) {
  app.setPlaying(false);
  await app.audio.setPaused(true);
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const index = await app.audio.addTrack(name, bytes);
  const previousNext = app.audio.onNextTrack;
  app.audio.onNextTrack = () => false;
  let stop;
  let fileDuration;
  try {
    await app.changeSource(() => app.audio.playTrack(index));
    fileDuration = app.audio.buffer.duration;
    stop = collectAlignment(app, { file: true });
    await new Promise((resolve) => setTimeout(resolve, Math.min(60000, Math.max(1000, duration))));
  } finally {
    const recorded = stop ? stop() : { frames: [], beats: [] };
    window.__wadAnnotatedTrace = recorded;
    app.setPlaying(false);
    try {
      await app.audio.setPaused(true);
    } finally {
      app.audio.onNextTrack = previousNext;
    }
  }
  const recorded = window.__wadAnnotatedTrace;
  const voiced = recorded.frames.filter((row) => !row.measured.silent);
  return {
    name,
    duration,
    fileDuration,
    frames: recorded.frames.length,
    internalBeats: recorded.beats.length,
    voicedCoverage: voiced.length / Math.max(1, recorded.frames.length),
    source: 'actual-WebAudio-file',
    referenceLabelsFedToPlayer: false,
    syntheticAudio: false,
  };
}
