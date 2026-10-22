import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioController } from '../src/audio/audio-controller.js';
import { PlaybackCoordinator } from '../src/playback/playback-coordinator.js';
import { BeatClock } from '../src/audio/beat-clock.js';
import { MotionDirector } from '../src/visuals/dance-motion.js';
import { createEventBus } from '../src/core/events.js';
const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function player(options = {}) {
  const states = [],
    sources = [],
    gains = [],
    resumes = [];
  const audio = new AudioController((state) => states.push(state), options);
  audio.context = {
    currentTime: 1,
    sampleRate: 48000,
    destination: {},
    closeCount: 0,
    resume() {
      const request = deferred();
      resumes.push(request);
      return request.promise;
    },
    close() {
      this.closeCount++;
      return Promise.resolve();
    },
    createBufferSource() {
      const node = {
        stopped: 0,
        disconnected: 0,
        starts: 0,
        connect() {},
        disconnect() {
          this.disconnected++;
        },
        stop() {
          this.stopped++;
        },
        start() {
          this.starts++;
        },
      };
      sources.push(node);
      return node;
    },
    createGain() {
      const gain = {
        gain: { value: 0 },
        connect() {},
        disconnected: 0,
        disconnect() {
          this.disconnected++;
        },
      };
      gains.push(gain);
      return gain;
    },
  };
  audio.analyser = {};
  audio.detector = { reset() {} };
  audio.playlist = [
    { name: 'first', buffer: { duration: 10, id: 0 } },
    { name: 'latest', buffer: { duration: 10, id: 1 } },
  ];
  return { audio, states, sources, resumes, gains };
}
test('a delayed older selection cannot replace or overlap the newer audio source', async () => {
  const { audio, sources, resumes } = player();
  const first = audio.playTrack(0);
  await turn();
  const latest = audio.playTrack(1);
  await turn();
  resumes[1].resolve();
  assert.equal(await latest, true);
  const selected = audio.node;
  resumes[0].resolve();
  assert.equal(await first, false);
  assert.equal(audio.name, 'latest');
  assert.equal(audio.node, selected);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].starts, 1);
  assert.equal(audio.committedSourceGeneration, 1, 'canceled selection is not a committed musical source');
});
test('a cancelled external import intent cannot commit after AudioContext resumes', async () => {
  const { audio, resumes, sources } = player();
  let current = true;
  const pending = audio.playTrack(0, { accept: () => current });
  await turn();
  current = false;
  resumes[0].resolve();
  assert.equal(await pending, false);
  assert.equal(sources.length, 0);
  assert.equal(audio.committedSourceGeneration, 0);
});
test('a cancelled decode does not consume a playlist slot', async () => {
  const { audio } = player();
  const decode = deferred();
  audio.context.decodeAudioData = () => decode.promise;
  let current = true;
  const previousSize = audio.playlist.length;
  const pending = audio.addTrack('cancelled.wav', new ArrayBuffer(8), { accept: () => current });
  await turn();
  current = false;
  decode.resolve({ duration: 1 });
  assert.equal(await pending, -1);
  assert.equal(audio.playlist.length, previousSize);
});
test('failed resume preserves the current source and pause cancels an in-flight selection', async () => {
  const { audio, resumes } = player();
  const old = {
    stops: 0,
    stop() {
      this.stops++;
    },
    disconnect() {},
  };
  audio.node = old;
  audio.buffer = { duration: 10 };
  audio.suspended = false;
  const failed = audio.playTrack(1);
  await turn();
  resumes[0].reject(new Error('resume failed'));
  await assert.rejects(failed, /resume failed/);
  assert.equal(audio.node, old);
  assert.equal(old.stops, 0);
  assert.equal(
    audio.committedSourceGeneration,
    0,
    'failed selection cannot reset the current musical source',
  );
  const pending = audio.playTrack(1);
  await turn();
  await audio.setPaused(true);
  resumes[1].resolve();
  assert.equal(await pending, false);
  assert.equal(audio.node, null);
  assert.equal(audio.suspended, true);
  assert.equal(audio.committedSourceGeneration, 0, 'pause cancels work without committing a new source');
});
test('natural next-track selection delegates to the app instead of bypassing its queue', async () => {
  const selected = [];
  const { audio, resumes } = player({
    onNextTrack: (index) => {
      selected.push(index);
      return false;
    },
  });
  const started = audio.playTrack(0);
  await turn();
  resumes[0].resolve();
  await started;
  audio.node.onended();
  await turn();
  assert.deepEqual(selected, [1]);
  assert.equal(resumes.length, 1);
});

test('a buffer-start failure preserves the currently committed source and disposes the failed graph', async () => {
  const { audio, resumes, sources, states, gains } = player();
  const first = audio.playTrack(0);
  await turn();
  resumes[0].resolve();
  await first;
  const current = { node: audio.node, output: audio.output, buffer: audio.buffer, name: audio.name };
  const create = audio.context.createBufferSource;
  audio.context.createBufferSource = () => {
    const node = create();
    node.start = () => {
      throw new Error('buffer start failed');
    };
    return node;
  };
  const failed = audio.playTrack(1);
  await turn();
  resumes[1].resolve();
  await assert.rejects(failed, /buffer start failed/);
  for (const [key, value] of Object.entries(current)) assert.equal(audio[key], value);
  assert.equal(current.node.stopped, 0, 'previous source remains audible on failed replacement');
  assert.equal(sources[1].disconnected, 1, 'failed graph releases the analysis connection');
  assert.equal(gains[1].disconnected, 1, 'failed output releases the speaker connection');
  assert.equal(audio.suspended, false);
  assert.equal(audio.committedSourceGeneration, 1);
  assert.equal(audio.pendingSource, null);
  assert.equal(states.length, 1);
});

test('partial buffer connections are cleaned up without disconnecting the current source', async () => {
  for (const failure of ['source', 'output']) {
    const { audio, resumes, sources, gains } = player();
    const first = audio.playTrack(0);
    await turn();
    resumes[0].resolve();
    await first;
    const current = audio.node;
    if (failure === 'source') {
      const create = audio.context.createBufferSource;
      audio.context.createBufferSource = () => {
        const node = create();
        node.connect = () => {
          throw new Error('connection failed');
        };
        return node;
      };
    } else {
      const create = audio.context.createGain;
      audio.context.createGain = () => {
        const output = create();
        output.connect = () => {
          throw new Error('connection failed');
        };
        return output;
      };
    }
    const next = audio.playTrack(1);
    await turn();
    resumes[1].resolve();
    await assert.rejects(next, /connection failed/);
    assert.equal(audio.node, current);
    assert.equal(current.stopped, 0);
    assert.equal(sources[1].disconnected, 1);
    assert.equal(gains[1].disconnected, 1);
    assert.equal(audio.committedSourceGeneration, 1);
  }
});

test('demo synthesis failure does not disconnect the current source or rewrite its metadata', async () => {
  const { audio, resumes } = player();
  const first = audio.playTrack(0);
  await turn();
  resumes[0].resolve();
  await first;
  const node = audio.node,
    name = audio.name,
    buffer = audio.buffer;
  audio.createDemo = () => {
    throw new Error('synthesis failed');
  };
  const failed = audio.startDemo();
  await turn();
  resumes[1].resolve();
  await assert.rejects(failed, /synthesis failed/);
  assert.equal(audio.node, node);
  assert.equal(node.stopped, 0);
  assert.equal(audio.name, name);
  assert.equal(audio.buffer, buffer);
  assert.equal(audio.committedSourceGeneration, 1);
});

test('concurrent decoded tracks cannot exceed the playlist capacity', async () => {
  const { audio } = player();
  audio.playlist = Array.from({ length: 7 }, (_, index) => ({ name: `existing-${index}`, buffer: {} }));
  const decodes = [];
  audio.context.decodeAudioData = () => {
    const decode = deferred();
    decodes.push(decode);
    return decode.promise;
  };
  const first = audio.addTrack('first', new ArrayBuffer(4));
  const second = audio.addTrack('second', new ArrayBuffer(4));
  await turn();
  decodes[0].resolve({ duration: 10 });
  assert.equal(await first, 7);
  decodes[1].resolve({ duration: 10 });
  await assert.rejects(second, /最多 8 首/);
  assert.equal(audio.playlist.length, 8);
});

test('resume failure keeps a captured system source suspended', async () => {
  const { audio, resumes } = player();
  audio.mode = 'system';
  audio.node = {};
  audio.suspended = true;
  const failed = audio.setPaused(false);
  resumes[0].reject(new Error('resume failed'));
  await assert.rejects(failed, /resume failed/);
  assert.equal(audio.suspended, true);
  assert.equal(audio.committedSourceGeneration, 0);
});

test('every destroy caller waits for close, while decoded buffers are released immediately', async () => {
  const { audio } = player();
  const closed = deferred();
  let closes = 0,
    secondFinished = false;
  audio.buffer = audio.playlist[0].buffer;
  audio.context.close = () => {
    closes++;
    return closed.promise;
  };
  const first = audio.destroy();
  const second = audio.destroy().then(() => {
    secondFinished = true;
  });
  await turn();
  assert.equal(audio.buffer, null);
  assert.equal(audio.playlist.length, 0);
  assert.equal(secondFinished, false, 'a duplicate destroy must wait for the same asynchronous close');
  assert.equal(closes, 1);
  closed.resolve();
  await Promise.all([first, second]);
  assert.equal(secondFinished, true);
});

test('buffer and playlist cleanup still completes when closing the audio context rejects', async () => {
  const { audio } = player();
  audio.buffer = audio.playlist[0].buffer;
  audio.context.close = () => Promise.reject(new Error('close failed'));
  await assert.rejects(audio.destroy(), /close failed/);
  assert.equal(audio.buffer, null);
  assert.equal(audio.playlist.length, 0);
  assert.equal(audio.node, null);
  assert.equal(audio.pendingSource, null);
  await assert.rejects(audio.destroy(), /close failed/);
});
test('late system capture after destroy is stopped and cannot resurrect playback', async () => {
  const previousWindow = globalThis.window,
    previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = { desktop: { captureAvailable: true } };
  const capture = deferred();
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getDisplayMedia: () => capture.promise } },
    configurable: true,
  });
  try {
    const { audio, resumes } = player();
    const started = audio.startSystem();
    await turn();
    resumes[0].resolve();
    await turn();
    await audio.destroy();
    await audio.destroy();
    const tracks = [
      {
        stops: 0,
        stop() {
          this.stops++;
        },
      },
      {
        stops: 0,
        stop() {
          this.stops++;
        },
      },
    ];
    capture.resolve({
      getTracks: () => tracks,
      getAudioTracks: () => tracks.slice(0, 1),
      getVideoTracks: () => tracks.slice(1),
    });
    assert.equal(await started, false);
    assert.ok(tracks.every((track) => track.stops === 1));
    assert.equal(audio.node, null);
    assert.equal(audio.context.closeCount, 1);
    assert.equal(audio.playlist.length, 0);
    assert.equal(audio.committedSourceGeneration, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});

test('controller cancellation and committed epochs preserve a phrase across pause/resume and pending capture', async () => {
  const saved = {
    window: globalThis.window,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  globalThis.window = { desktop: { captureAvailable: true } };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const capture = deferred();
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getDisplayMedia: () => capture.promise } },
    configurable: true,
  });
  let coordinator;
  try {
    const { audio, resumes } = player();
    const started = audio.playTrack(0);
    await turn();
    resumes[0].resolve();
    assert.equal(await started, true);
    const committed = audio.committedSourceGeneration;
    let level = 0.08;
    // Measurements are deterministic here: this exercises production source,
    // grid and MotionDirector integration rather than re-testing FFT accuracy.
    audio.sample = () => ({
      beat: 0,
      bpm: 0,
      confidence: 0,
      silent: audio.suspended ? 1 : 0,
      amplitude: level,
      energy: level > 0.1 ? 1 : 0.5,
      bass: 0.3,
      mid: 0.3,
      treble: level > 0.1 ? 0.8 : 0.1,
      brightness: level > 0.1 ? 0.85 : 0.25,
      noisiness: level > 0.1 ? 0.4 : 0.05,
      attack: 0.2,
      signalValid: 1,
    });
    const motion = new MotionDirector();
    let paused = true,
      rendering;
    coordinator = new PlaybackCoordinator({
      audio,
      clock: new BeatClock(),
      bus: createEventBus(),
      dance: {
        setPaused(value) {
          paused = value;
        },
        setFeatures(value) {
          rendering = value;
        },
        frame(time) {
          motion.update(rendering, time, { paused, glyphCount: 4 });
        },
      },
      knowledge: { setPaused() {}, onTick() {}, getState: () => ({}) },
    });
    coordinator.setPlaying(true);
    for (let frame = 0; frame <= 7 * 90; frame++) {
      level = frame < 5 * 90 ? 0.08 : 0.3;
      audio.context.currentTime = frame / 90;
      coordinator.frame((frame * 1000) / 90);
    }
    const phrase = motion.phrase;
    assert.ok(phrase && motion.samplePhrase(coordinator.clock.getState().phase, 4, false).active);
    const pending = audio.startSystem();
    await turn();
    resumes[1].resolve();
    await turn(); // Now waiting inside getDisplayMedia; current node keeps playing.
    assert.equal(audio.pendingSource, audio.sourceGeneration);
    coordinator.frame(7011.111);
    assert.equal(motion.phrase, phrase, 'waiting capture is not a new musical epoch');
    assert.equal(audio.committedSourceGeneration, committed);

    coordinator.setPlaying(false);
    await audio.setPaused(true); // Also cancels the pending capture.
    coordinator.frame(7022.222);
    const frozen = motion.sample(7.022222, { glyphCount: 4, beatPhase: coordinator.clock.getState().phase });
    const steps = coordinator.metrics.beats + coordinator.metrics.subdivisions;
    coordinator.frame(20000);
    assert.deepEqual(motion.sample(20, { glyphCount: 4, beatPhase: 0.9 }), frozen);
    assert.equal(motion.phrase, phrase);
    assert.equal(audio.committedSourceGeneration, committed);
    assert.equal(coordinator.metrics.beats + coordinator.metrics.subdivisions, steps);
    const track = {
      stopped: 0,
      stop() {
        this.stopped++;
      },
    };
    capture.resolve({ getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] });
    assert.equal(await pending, false);
    assert.equal(track.stopped, 1);

    const resumed = audio.setPaused(false);
    await turn();
    resumes[2].resolve();
    assert.equal(await resumed, true);
    coordinator.setPlaying(true);
    coordinator.frame(20011.111);
    assert.equal(audio.committedSourceGeneration, committed);
    assert.equal(motion.phrase, phrase, 'resume recreates playback node, not musical source identity');
    assert.ok(motion.samplePhrase(coordinator.clock.getState().phase, 4, false).active);

    const next = audio.playTrack(1);
    await turn();
    assert.equal(audio.committedSourceGeneration, committed, 'pending local selection also preserves epoch');
    resumes[3].resolve();
    assert.equal(await next, true);
    assert.equal(audio.committedSourceGeneration, committed + 1);
    coordinator.resetSource();
    assert.equal(
      audio.committedSourceGeneration,
      committed + 1,
      'clock reset does not commit another audio source',
    );
    coordinator.frame(20022.222);
    assert.equal(motion.sourceGeneration, committed + 1);
    assert.equal(motion.phrase, null, 'successful new musical source clears the old phrase');
    assert.equal(motion.section.episodes, 0);
    await audio.destroy();
  } finally {
    coordinator?.destroy();
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
    else delete globalThis.navigator;
    globalThis.requestAnimationFrame = saved.requestAnimationFrame;
    globalThis.cancelAnimationFrame = saved.cancelAnimationFrame;
  }
});
