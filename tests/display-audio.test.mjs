import test from 'node:test';
import assert from 'node:assert/strict';
import { getDisplayAudioSupport, createDisplayAudioAdapter } from '../src/audio/display-audio.js';
import { AudioController } from '../src/audio/audio-controller.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function track(kind, surface = 'browser') {
  const listeners = new Set();
  return {
    kind,
    readyState: 'live',
    enabled: true,
    stops: 0,
    stop() {
      this.stops++;
      this.readyState = 'ended';
    },
    addEventListener(type, listener) {
      assert.equal(type, 'ended');
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.delete(listener);
    },
    getSettings: () => ({ displaySurface: surface }),
    end() {
      this.readyState = 'ended';
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}
function sharedStream({ audio = true, surface = 'browser' } = {}) {
  const videoTrack = track('video', surface),
    audioTrack = audio ? track('audio') : null;
  const tracks = [videoTrack, ...(audioTrack ? [audioTrack] : [])];
  return {
    audioTrack,
    videoTrack,
    getTracks: () => tracks,
    getAudioTracks: () => (audioTrack ? [audioTrack] : []),
    getVideoTracks: () => [videoTrack],
  };
}
function player({ desktop = false, connectError = false } = {}) {
  const capture = deferred(),
    resume = deferred(),
    calls = [],
    states = [];
  const audioStreams = [];
  const adapter = createDisplayAudioAdapter({
    environment: () => ({
      desktop: desktop ? { captureAvailable: true } : undefined,
      secureContext: true,
      mediaDevices: {
        getDisplayMedia(options) {
          calls.push({ action: 'picker', options });
          return capture.promise;
        },
      },
    }),
    createAudioStream: (tracks) => {
      const stream = { tracks };
      audioStreams.push(stream);
      return stream;
    },
  });
  const audio = new AudioController((state) => states.push(state), { displayAudioAdapter: adapter });
  const old = {
    stops: 0,
    disconnected: 0,
    stop() {
      this.stops++;
    },
    disconnect() {
      this.disconnected++;
    },
  };
  const nodes = [];
  audio.context = {
    currentTime: 1,
    resume() {
      calls.push({ action: 'resume' });
      return resume.promise;
    },
    close: () => Promise.resolve(),
    createMediaStreamSource(stream) {
      const node = {
        stream,
        connections: [],
        disconnected: 0,
        connect(target) {
          if (connectError) throw new Error('connect failed');
          this.connections.push(target);
        },
        disconnect() {
          this.disconnected++;
        },
      };
      nodes.push(node);
      return node;
    },
  };
  audio.node = old;
  audio.analyser = {};
  audio.mode = 'file';
  audio.name = 'existing music';
  audio.suspended = false;
  return { audio, capture, resume, calls, states, old, nodes, audioStreams, adapter };
}

test('browser capability means an attempted picker, never guaranteed audio and never desktop fallback', () => {
  const mediaDevices = { getDisplayMedia() {} };
  const browser = getDisplayAudioSupport({ desktop: undefined, secureContext: true, mediaDevices });
  assert.equal(browser.available, true);
  assert.equal(browser.provider, 'browser');
  assert.equal(browser.systemAudioGuaranteed, false);
  assert.ok(Object.isFrozen(browser));
  assert.equal(
    getDisplayAudioSupport({ desktop: undefined, secureContext: false, mediaDevices }).reason,
    'insecure-context',
  );
  assert.equal(
    getDisplayAudioSupport({ desktop: undefined, secureContext: true, mediaDevices: {} }).reason,
    'api-unavailable',
  );
  const blockedDesktop = getDisplayAudioSupport({
    desktop: { captureAvailable: false },
    secureContext: true,
    mediaDevices,
  });
  assert.equal(blockedDesktop.available, false);
  assert.equal(blockedDesktop.reason, 'unsupported-desktop');
});

test('picker starts in the calling activation before WebAudio resumes, with audio-only graph and black unused browser video', async () => {
  const { audio, capture, resume, calls, old, nodes, audioStreams } = player();
  const pending = audio.startSystem();
  assert.equal(calls[0].action, 'picker', 'no await before the browser selection request');
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].options.video, false);
  assert.equal(calls[0].options.systemAudio, 'include');
  await turn();
  assert.equal(calls[1].action, 'resume');
  const stream = sharedStream();
  capture.resolve(stream);
  await turn();
  assert.equal(old.stops, 0, 'pending WebAudio must not retire the prior source');
  resume.resolve();
  assert.equal(await pending, true);
  assert.equal(stream.videoTrack.enabled, false);
  assert.equal(stream.videoTrack.stops, 0, 'browser sharing session remains live');
  assert.deepEqual(audioStreams[0].tracks, [stream.audioTrack]);
  assert.deepEqual(nodes[0].connections, [audio.analyser], 'no speaker output or video consumer');
  assert.equal(audio.name, '共享标签页声音');
  assert.equal(audio.mode, 'system');
  assert.equal(audio.committedSourceGeneration, 1);
  assert.equal(old.stops, 1);
  await audio.destroy();
  assert.equal(stream.videoTrack.stops, 1);
  assert.equal(stream.audioTrack.stops, 1);
  assert.equal(stream.videoTrack.listenerCount(), 0);
});

test('desktop retains its established loopback video-stop policy', async () => {
  const { audio, capture, resume } = player({ desktop: true });
  const pending = audio.startSystem(),
    stream = sharedStream({ surface: 'monitor' });
  capture.resolve(stream);
  resume.resolve();
  assert.equal(await pending, true);
  assert.equal(stream.videoTrack.stops, 1);
  assert.equal(stream.audioTrack.stops, 0);
  assert.equal(audio.name, '系统声音');
  await audio.destroy();
});

test('a picker stream without audio is fully released and leaves the previous music committed', async () => {
  const { audio, capture, resume, old, states } = player();
  const pending = audio.startSystem(),
    stream = sharedStream({ audio: false });
  capture.resolve(stream);
  resume.resolve();
  await assert.rejects(
    pending,
    (error) => error.code === 'NO_SHARED_AUDIO' && error.message.includes('共享音频'),
  );
  assert.equal(stream.videoTrack.stops, 1);
  assert.equal(audio.node, old);
  assert.equal(old.stops, 0);
  assert.equal(audio.name, 'existing music');
  assert.equal(audio.committedSourceGeneration, 0);
  assert.equal(states.length, 0);
  assert.equal(audio.pendingSource, null);
});

test('user cancellation rejects promptly even while resume is pending and never silences the old source', async () => {
  const { audio, capture, old } = player();
  const pending = audio.startSystem();
  const error = new Error('permission denied');
  error.name = 'NotAllowedError';
  capture.reject(error);
  await assert.rejects(pending, /共享已取消或未获允许/);
  assert.equal(audio.node, old);
  assert.equal(old.stops, 0);
  assert.equal(audio.pendingSource, null);
});

test('initialization failure still releases a capture that arrives later', async () => {
  const { audio, capture, old } = player();
  audio.initialize = async () => {
    throw new Error('init failed');
  };
  const pending = audio.startSystem();
  await assert.rejects(pending, /init failed/);
  const stream = sharedStream();
  capture.resolve(stream);
  await turn();
  assert.ok(stream.getTracks().every((track) => track.stops === 1));
  assert.equal(audio.node, old);
  assert.equal(old.stops, 0);
});

test('resume and replacement-connect failures release candidate tracks and preserve old graph', async () => {
  for (const failure of ['resume', 'connect']) {
    const { audio, capture, resume, old, nodes } = player({ connectError: failure === 'connect' });
    const pending = audio.startSystem(),
      stream = sharedStream();
    capture.resolve(stream);
    if (failure === 'resume') resume.reject(new Error('resume failed'));
    else resume.resolve();
    await assert.rejects(pending, new RegExp(failure + ' failed'));
    assert.ok(stream.getTracks().every((track) => track.stops === 1));
    assert.equal(audio.node, old);
    assert.equal(old.stops, 0);
    assert.equal(audio.committedSourceGeneration, 0);
    if (nodes[0]) assert.equal(nodes[0].disconnected, 1);
  }
});

test('superseded or page-closed late picker results cannot resurrect a captured source', async () => {
  for (const cancel of ['superseded', 'closed']) {
    const { audio, capture, resume } = player();
    const pending = audio.startSystem();
    await turn();
    if (cancel === 'closed') await audio.destroy();
    else audio.beginSourceChange();
    const stream = sharedStream();
    capture.resolve(stream);
    resume.resolve();
    assert.equal(await pending, false);
    assert.ok(stream.getTracks().every((track) => track.stops === 1));
    assert.equal(audio.committedSourceGeneration, 0);
  }
});

test('ending the browser share releases its audio/video resources once and emits an honest ended source', async () => {
  const { audio, capture, resume, states } = player();
  const pending = audio.startSystem(),
    stream = sharedStream({ surface: 'window' });
  capture.resolve(stream);
  resume.resolve();
  await pending;
  assert.equal(audio.name, '共享声音', 'window capture cannot promise whole-system audio');
  stream.videoTrack.end();
  assert.equal(audio.suspended, true);
  assert.equal(audio.node, null);
  assert.equal(audio.stream, null);
  assert.equal(states.filter((state) => state.ended).length, 1);
  assert.ok(stream.getTracks().every((track) => track.stops === 1 && track.listenerCount() === 0));
  await audio.destroy();
  assert.equal(states.filter((state) => state.ended).length, 1);
});
