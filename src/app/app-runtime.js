import { AudioController } from '../audio/audio-controller.js';
import { BeatClock } from '../audio/beat-clock.js';
import { DanceStage } from '../visuals/dance-stage.js';
import { KnowledgeStage } from '../visuals/knowledge-stage.js';
import { EFFECTS } from '../visuals/effect-catalog.js';
import { EVENTS } from '../core/events.js';
import { LocalRepository } from '../core/local-repository.js';
import { PlaybackCoordinator } from '../playback/playback-coordinator.js';
import { PlayerUI } from '../ui/player-ui.js';
import { mountShowcase } from '../ui/showcase.js';

const DEFAULT_FACTORIES = Object.freeze({
  ui: (options) => new PlayerUI(options),
  repository: (options) => new LocalRepository(options),
  audio: (onSource, options) => new AudioController(onSource, options),
  clock: () => new BeatClock(),
  dance: (element, options) => new DanceStage(element, options),
  knowledge: (element, options) => new KnowledgeStage(element, options),
  playback: (options) => new PlaybackCoordinator(options),
});

/** Composition root: concrete dependencies and callback wiring, never playback timing. */
export function createAppRuntime(app, { factories = {}, documentRef = globalThis.document } = {}) {
  const create = { ...DEFAULT_FACTORIES, ...factories };
  app.ui = create.ui({
    documentRef,
    library: app.getLibrary(),
    effects: EFFECTS,
    handlers: {
      selectTopic: (topic, index) => app.loadTopic(topic, index),
      playPause: () => app.togglePlayback(),
      step: (delta) => app.step(delta),
      restart: () => app.step(-100),
      download: () => app.download(),
      like: () => app.like(),
      systemAudio: () => app.captureSystem(),
      demo: (profile) => app.demo(profile),
      selectTrack: (index) => app.changeSource(() => app.audio.playTrack(index)),
      importAudio: () => app.importAudio(),
      importFiles: (files) => app.importFiles(files),
      preference: (key, value) => app.preference(key, value),
      applyText: (title, text) => app.applyText(title, text, { editor: true }),
      copyAuthoringPrompt: (mode) => app.copyAuthoringPrompt(mode),
      importScript: () => app.importScript(),
      importScriptFile: (file) => app.importScriptFile(file),
      exportScript: () => app.exportScript(),
      interaction: (detail) => app.bus.emit(EVENTS.INTERACTION, detail),
    },
  });
  app.ui.setReady(false);
  app.releaseEventErrors = app.bus.setErrorHandler((error, { type }) => {
    if (app.destroyed) return;
    console.error(`Extension event failed: ${type}`, error);
    app.ui.toast('一项扩展交互未完成，播放仍在继续。');
  });
  app.repository = create.repository({ onError: (message) => !app.destroyed && app.ui.toast(message) });
  app.audio = create.audio((info) => app.onSource(info), {
    onNextTrack: (index) => app.changeSource(() => app.audio.playTrack(index)),
  });
  app.clock = create.clock();
  app.dance = create.dance(documentRef.getElementById('dance-canvas'), { managedFrame: true });
  app.knowledge = create.knowledge(documentRef.getElementById('knowledge-stage'), {
    onKeyword: (keyword, relation, beatDuration) => app.onKeyword(keyword, relation, beatDuration),
    onLine: (index, line) => {
      if (app.destroyed) return;
      app.ui.setLine(index, app.activeTopic.lines.length, { text: line.text });
      app.bus.emit(EVENTS.LINE_ENTER, { index, text: line.text, keyword: line.keyword });
    },
    onComplete: () => app.onComplete(),
  });
  app.playback = create.playback({
    audio: app.audio,
    clock: app.clock,
    dance: app.dance,
    knowledge: app.knowledge,
    bus: app.bus,
    beforeBeat: () => {
      if (app.pendingTopic) {
        const next = app.pendingTopic;
        app.pendingTopic = null;
        app.applyTopic(next.topic, next.index);
      }
    },
    onFrame: (frame) => {
      if (frame.time - app.lastMeter > 0.15) {
        app.lastMeter = frame.time;
        app.ui.renderFrame({ ...frame, finished: app.knowledge.getState().finished });
      }
    },
  });
  app.showcase = mountShowcase({ app, documentRef });
}
