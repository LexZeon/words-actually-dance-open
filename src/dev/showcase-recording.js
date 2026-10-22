import { EVENTS } from '../core/events.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const SHOWCASE_SCRIPTS = Object.freeze({
  overview: [
    '把知识，读进节奏里',
    '节奏、声音｜节奏从声音里来，文字跟着轻重起势。\n理解、知识｜一小段知识，留出理解的空间。\n回想、练习｜回想是一种练习，用自己的话说一遍。',
  ],
  ghosts: [
    '一字，两道时间',
    '虚影、回声｜虚影像回声，清晰的字先起势。\n轻重、动作｜声音的轻重，改变文字的动作。\n节奏、变化｜节奏有变化，同一个词也能跳出不同舞步。',
  ],
  learning: [
    '读过之后，回想一下',
    '回想、记忆｜回想是主动提取记忆，先试着自己说出来。\n核对、反馈｜核对原文的反馈，帮助发现遗漏与误解。\n间隔、复习｜间隔一段时间，再回来复习一次。',
  ],
});

export const SHOWCASE_ENGLISH_SCRIPT = Object.freeze([
  'Read. Recall. Check.',
  'Recall,memory｜Recall retrieves a memory.\nCheck,feedback｜Check the source for feedback.\nSpacing,review｜Spacing means returning for another review later.',
]);

/** A test-only recorder of the current app frame. Never captures a desktop or device microphone. */
export function installShowcaseRecording(app) {
  if (!app.window.desktop?.testMode) return false;
  let busy = false;
  app.window.__wadRecordShowcase = async (scenario) => {
    if (busy || !Object.hasOwn(SHOWCASE_SCRIPTS, scenario))
      throw new Error('Invalid or overlapping recording.');
    busy = true;
    let stream, recorder;
    const releases = [],
      chunks = [];
    const stats = {
      scenario,
      audioFrames: 0,
      voicedFrames: 0,
      drumHits: 0,
      ghostSamples: 0,
      source: 'self-generated-demo',
      captured: 'own-app-WebFrameMain-only',
      microphone: false,
      desktopCapture: false,
    };
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: true });
      if (!stream.getAudioTracks().length || !stream.getVideoTracks().length)
        throw new Error('Own-app recording requires both live tracks.');
      stats.tracks = stream.getTracks().map((track) => {
        const { width, height, frameRate, sampleRate, channelCount } = track.getSettings();
        return {
          kind: track.kind,
          readyState: track.readyState,
          width,
          height,
          frameRate,
          sampleRate,
          channelCount,
        };
      });
      document.getElementById('welcome-dismiss')?.click();
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      await app.changeLanguage(scenario === 'learning' ? 'en' : 'zh');
      stats.language = scenario === 'learning' ? 'en' : 'zh';
      app.applyText(...(scenario === 'learning' ? SHOWCASE_ENGLISH_SCRIPT : SHOWCASE_SCRIPTS[scenario]));
      app.preference('emoji', false);
      app.preference('rate', 3);
      app.preference('intensity', 1.4);
      app.preference('ghostEffect', scenario === 'ghosts' ? 'scale-echo' : 'auto');
      const profile = { overview: 'bass', ghosts: 'balanced', learning: 'bright' }[scenario];
      stats.profile = profile;
      await app.demo(profile);
      releases.push(
        app.bus.on(EVENTS.AUDIO_FRAME, (frame) => {
          stats.audioFrames++;
          if (frame.signalValid && frame.amplitude > 0) stats.voicedFrames++;
          if (app.dance.getGhostState().active) stats.ghostSamples++;
        }),
      );
      releases.push(app.bus.on(EVENTS.DRUM_HIT, () => stats.drumHits++));
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
        (mime) => MediaRecorder.isTypeSupported(mime),
      );
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 6000000,
        audioBitsPerSecond: 160000,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = (event) => reject(event.error || new Error('MediaRecorder failed.'));
      });
      const start = performance.now();
      recorder.start(500);
      if (scenario === 'ghosts') {
        for (const effect of [
          'scale-echo',
          'twist-shadow',
          'vertical-lift',
          'horizontal-stretch',
          'glyph-wave',
        ]) {
          app.preference('ghostEffect', effect);
          await wait(2000);
        }
      } else if (scenario === 'learning') {
        await wait(4000);
        await app.showcase.beginRecall();
        stats.recall = app.showcase.getState().recalling;
        stats.pausedDuringRecall = !app.state.playing && app.audio.suspended;
        await wait(3000);
        app.showcase.revealAnswer();
        stats.answerDidNotAutoplay = !app.state.playing;
        await wait(1300);
        await app.togglePlayback();
        await wait(3700);
      } else {
        await wait(10000);
      }
      recorder.stop();
      await stopped;
      stats.durationMilliseconds = performance.now() - start;
      const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
      stats.bytes = bytes.length;
      stats.mimeType = mimeType;
      let binary = '';
      for (let index = 0; index < bytes.length; index += 32768)
        binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      return { stats, base64: btoa(binary) };
    } finally {
      if (recorder?.state === 'recording') recorder.stop();
      releases.forEach((release) => release());
      stream?.getTracks().forEach((track) => track.stop());
      app.setPlaying(false);
      await app.audio.setPaused(true);
      busy = false;
    }
  };
  return true;
}
