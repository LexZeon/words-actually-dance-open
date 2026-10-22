const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const assert = (condition, message) => {
  if (!condition) throw new Error(`Sentence QA: ${message}`);
};

/** Judge observed production quarter-ticks, never audio labels or musical meter. */
export function validateSentenceTimingEvidence(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const transitions = Array.isArray(result?.transitions) ? result.transitions : [];
  const natural = transitions.filter((entry) => entry.phase === 'natural');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const planMatches = (row) => {
    const plan = row?.sentenceTiming;
    if (!plan || !integer(row.lastGlyphStep) || !Number.isInteger(row.holdBeats)) return false;
    const minimumEndStep = row.lastGlyphStep + 4 + row.holdBeats * 4;
    const earliestBeat = Math.ceil(minimumEndStep / 4);
    return (
      plan.source === 'internal-four-beat-group' &&
      plan.groupBeats === 4 &&
      plan.completeAtStep === row.lastGlyphStep &&
      plan.readableAtStep === row.lastGlyphStep + 4 &&
      plan.minimumEndStep === minimumEndStep &&
      plan.earliestBeat === earliestBeat &&
      plan.transitionBeat === Math.ceil(earliestBeat / 4) * 4 &&
      plan.extraHoldBeats === plan.transitionBeat - earliestBeat &&
      plan.extraHoldBeats >= 0 &&
      plan.extraHoldBeats <= 3
    );
  };
  const checks = {
    actualWebAudio: result?.actualWebAudio === true && result.frames > 30 && result.voicedFrames > 10,
    observationOnly:
      result?.labelsFedToDetector === false &&
      result?.source === 'actual-post-frame-production-clock' &&
      result?.trueDownbeatDetection === false,
    bounded: result?.overflow === false && result.elapsedSeconds < 25,
    threeNaturalTransitions: natural.length >= 3,
    repeatUsesNewElement: natural.slice(0, 3).some((entry) => {
      const before = byId.get(entry.fromId),
        after = byId.get(entry.toId);
      return before?.lineIndex === 2 && after?.lineIndex === 0 && before.id !== after.id;
    }),
    completeBeforeRetirement: natural.slice(0, 3).every((entry) => {
      const row = byId.get(entry.fromId);
      return row?.totalChars > 0 && row.readAtExit === row.totalChars && row.cursorAtExit === row.totalChars;
    }),
    exactPlans: natural.slice(0, 3).every((entry) => planMatches(byId.get(entry.fromId))),
    internalGroupBoundaries: natural.slice(0, 3).every((entry) => {
      const plan = byId.get(entry.fromId)?.sentenceTiming;
      return (
        integer(entry.mountStep) && entry.mountStep % 16 === 0 && entry.mountStep === plan?.transitionBeat * 4
      );
    }),
    minimumFullHold: natural.slice(0, 3).every((entry) => {
      const row = byId.get(entry.fromId);
      return integer(row?.lastGlyphStep) && entry.mountStep >= row.lastGlyphStep + 4 + row.holdBeats * 4;
    }),
    settledDOMVisible: natural.slice(0, 3).every((entry) => byId.get(entry.fromId)?.settledVisibleFrames > 0),
    visibleGlyphs: rows.every((row) => row.cursorMatchesDOM && row.orderedGlyphs),
    pauseFrozen: result?.lifecycle?.pauseFrozen === true,
    resumedWithoutReplay: result?.lifecycle?.resumedWithoutReplay === true,
    manualOnSharedBeat: result?.lifecycle?.manualOnSharedBeat === true,
    sourceCommitted: result?.lifecycle?.sourceCommitted === true,
    sourceRetainsCurrentReading: result?.lifecycle?.sourceRetainsCurrentReading === true,
    sourceTicksMonotonic: result?.lifecycle?.sourceTicksMonotonic === true,
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    failures: Object.entries(checks)
      .filter(([, pass]) => !pass)
      .map(([name]) => name),
  };
}

/** Native-only observer. RAF waits observe the existing shared clock; they do
 * not schedule characters, provide ticks, set tempo, or train the detector. */
export function installSentenceQA(app, { target = app.window || globalThis.window } = {}) {
  if (!target?.desktop?.testMode) return false;
  let installed = true,
    running = false;

  async function actualSentences() {
    assert(installed && !running && !app.destroyed, 'application unavailable');
    running = true;
    const saved = {
      onFrame: app.playback.onFrame,
      onLine: app.knowledge.onLine,
      onKeyword: app.knowledge.onKeyword,
      onComplete: app.knowledge.onComplete,
      onNextTrack: app.audio.onNextTrack,
      preferences: { ...app.state.preferences },
      topic: app.activeTopic,
      topicIndex: app.state.topicIndex,
      custom: app.state.custom,
      profile: app.state.profile,
      pendingTopic: app.pendingTopic,
    };
    const started = target.performance.now(),
      deadline = started + 24000;
    const result = {
      pass: false,
      source: 'actual-post-frame-production-clock',
      trueDownbeatDetection: false,
      actualWebAudio: false,
      labelsFedToDetector: false,
      frames: 0,
      voicedFrames: 0,
      overflow: false,
      rows: [],
      transitions: [],
      lifecycle: {},
    };
    let recorder,
      previousElement = null,
      currentRow = null,
      phase = 'natural';
    const snapshot = () => {
      const state = app.knowledge.getState();
      return {
        element: app.knowledge.current?.el,
        lineIndex: state.lineIndex,
        cursor: state.cursor,
        lastTick: state.lastTick,
        sentenceTiming: state.sentenceTiming,
        sourceGeneration: app.audio.committedSourceGeneration,
      };
    };
    const until = async (condition) => {
      while (!condition()) {
        assert(installed && !app.destroyed, 'application disposed during observation');
        assert(target.performance.now() < deadline, '24-second observation deadline exceeded');
        await new Promise((resolve) => target.requestAnimationFrame(resolve));
      }
    };
    const observeFor = async (milliseconds) => {
      const end = target.performance.now() + milliseconds;
      await until(() => target.performance.now() >= end);
    };
    try {
      await app.queueAudio(async () => {
        app.setPlaying(false);
        await app.audio.setPaused(true);
      });
      app.pendingTopic = null;
      app.audio.onNextTrack = () => false;
      app.state.preferences = {
        ...saved.preferences,
        autoDirection: false,
        effect: 'stack',
        rate: 4,
        repeat: true,
      };
      app.applyPreferences();
      app.applyTopic(
        {
          id: 'qa-sentence-boundaries',
          title: 'Sentence boundary check',
          emoji: '',
          lines: [
            { text: '见节拍', keyword: '节拍', holdBeats: 1 },
            { text: '读整句', keyword: '整句', holdBeats: 1 },
            { text: '再继续', keyword: '继续', holdBeats: 1 },
          ],
        },
        -1,
        { persist: false },
      );
      recorder = (frame) => {
        saved.onFrame(frame);
        result.frames++;
        if (frame.playing && !frame.measured.silent && frame.measured.amplitude > 0) result.voicedFrames++;
        result.actualWebAudio ||= Boolean(
          app.audio.mode === 'demo' &&
          app.audio.context?.state === 'running' &&
          app.audio.analyser &&
          app.audio.node,
        );
        const state = app.knowledge.getState(),
          current = app.knowledge.current;
        if (!current?.el) return;
        if (current.el !== previousElement) {
          if (result.rows.length >= 32) {
            result.overflow = true;
            return;
          }
          const nextId = result.rows.length;
          if (currentRow) {
            currentRow.readAtExit = currentRow.lastReadCount;
            currentRow.cursorAtExit = currentRow.lastCursor;
            result.transitions.push({
              phase,
              fromId: currentRow.id,
              toId: nextId,
              mountStep: state.lastTick,
            });
          }
          currentRow = {
            id: nextId,
            phase,
            lineIndex: state.lineIndex,
            mountStep: state.lastTick,
            firstGlyphStep: null,
            lastGlyphStep: null,
            totalChars: state.totalChars,
            holdBeats: state.holdBeats,
            sentenceTiming: null,
            cursorMatchesDOM: true,
            orderedGlyphs: true,
            settledVisibleFrames: 0,
            lastReadCount: 0,
            lastCursor: 0,
          };
          result.rows.push(currentRow);
          previousElement = current.el;
        }
        const read = current.chars.map(({ el }) => el.classList.contains('read')),
          count = read.filter(Boolean).length;
        currentRow.cursorMatchesDOM &&= count === state.cursor && state.totalChars === current.chars.length;
        currentRow.orderedGlyphs &&= read.every((visible, index) => visible === index < count);
        if (count > 0 && currentRow.firstGlyphStep === null) currentRow.firstGlyphStep = state.lastTick;
        if (count === current.chars.length && currentRow.lastGlyphStep === null)
          currentRow.lastGlyphStep = state.lastTick;
        if (state.sentenceTiming) currentRow.sentenceTiming = { ...state.sentenceTiming };
        if (count === current.chars.length && state.lastTick >= state.sentenceTiming?.readableAtStep) {
          const visible = (element) => {
            const style = target.getComputedStyle(element),
              box = element.getBoundingClientRect();
            return (
              style.display !== 'none' &&
              style.visibility === 'visible' &&
              Number(style.opacity) > 0 &&
              box.width > 0 &&
              box.height > 0
            );
          };
          if (visible(current.el) && current.chars.every(({ el }) => visible(el)))
            currentRow.settledVisibleFrames++;
        }
        currentRow.lastReadCount = count;
        currentRow.lastCursor = state.cursor;
      };
      app.playback.onFrame = recorder;
      assert((await app.demo('balanced')) !== false, 'actual demo source could not start');
      await until(() => result.transitions.filter((entry) => entry.phase === 'natural').length >= 3);

      phase = 'pause';
      await app.togglePlayback();
      const paused = snapshot();
      await observeFor(180);
      const held = snapshot();
      result.lifecycle.pauseFrozen =
        !app.state.playing &&
        paused.element === held.element &&
        paused.cursor === held.cursor &&
        paused.lastTick === held.lastTick &&
        same(paused.sentenceTiming, held.sentenceTiming);
      await app.togglePlayback();
      await until(() => app.knowledge.getState().lastTick > paused.lastTick);
      const resumed = snapshot();
      result.lifecycle.resumedWithoutReplay =
        resumed.element === paused.element &&
        resumed.lastTick === paused.lastTick + 1 &&
        resumed.cursor >= paused.cursor;

      phase = 'manual';
      const manualBefore = snapshot();
      app.step(1);
      await until(() => app.knowledge.current?.el !== manualBefore.element);
      const manualAfter = snapshot(),
        manualTransition = result.transitions.at(-1);
      result.lifecycle.manualOnSharedBeat =
        manualAfter.lineIndex === Math.min(2, manualBefore.lineIndex + 1) &&
        manualTransition?.phase === 'manual' &&
        manualTransition.mountStep % 4 === 0 &&
        manualTransition.mountStep === (Math.floor(manualBefore.lastTick / 4) + 1) * 4;

      phase = 'source';
      await until(() => app.knowledge.getState().cursor === app.knowledge.getState().totalChars);
      const sourceBefore = snapshot();
      assert((await app.demo('bright')) !== false, 'second actual demo source could not start');
      const sourceAfter = snapshot();
      result.lifecycle.sourceCommitted = sourceAfter.sourceGeneration > sourceBefore.sourceGeneration;
      result.lifecycle.sourceRetainsCurrentReading =
        sourceAfter.element === sourceBefore.element &&
        sourceAfter.cursor === sourceBefore.cursor &&
        same(sourceAfter.sentenceTiming, sourceBefore.sentenceTiming);
      await until(() => app.knowledge.getState().lastTick > sourceBefore.lastTick);
      result.lifecycle.sourceTicksMonotonic = app.knowledge.getState().lastTick > sourceBefore.lastTick;
      result.elapsedSeconds = (target.performance.now() - started) / 1000;
      Object.assign(result, validateSentenceTimingEvidence(result));
      return result;
    } finally {
      result.elapsedSeconds = (target.performance.now() - started) / 1000;
      target.__wadSentenceNativeEvidence = result;
      try {
        await app.queueAudio(async () => {
          app.setPlaying(false);
          await app.audio.setPaused(true);
        });
      } finally {
        if (!app.playback.destroyed && app.playback.onFrame === recorder)
          app.playback.onFrame = saved.onFrame;
        if (!app.audio.destroyed) app.audio.onNextTrack = saved.onNextTrack;
        if (!app.destroyed) {
          app.knowledge.onLine = saved.onLine;
          app.knowledge.onKeyword = saved.onKeyword;
          app.knowledge.onComplete = saved.onComplete;
          app.state.preferences = saved.preferences;
          app.state.custom = saved.custom;
          app.state.profile = saved.profile;
          app.applyPreferences();
          app.applyTopic(saved.topic, saved.topicIndex, { persist: false });
          app.pendingTopic = saved.pendingTopic;
        }
        running = false;
      }
    }
  }

  target.__wadSentenceSmokeTest = actualSentences;
  const dispose = () => {
    installed = false;
    if (target.__wadSentenceSmokeTest === actualSentences) delete target.__wadSentenceSmokeTest;
    delete target.__wadSentenceNativeEvidence;
    target.removeEventListener?.('beforeunload', dispose);
  };
  target.addEventListener?.('beforeunload', dispose, { once: true });
  return dispose;
}
