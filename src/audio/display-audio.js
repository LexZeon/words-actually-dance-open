/** Browser screen-capture constraints are hints, never proof of shared sound.
 * https://w3c.github.io/mediacapture-screen-share/#dom-mediadevices-getdisplaymedia
 * https://developer.chrome.com/docs/web-platform/screen-sharing-controls
 */
export function getDisplayAudioSupport({
  desktop = globalThis.window?.desktop,
  secureContext = globalThis.window?.isSecureContext ?? globalThis.isSecureContext,
  mediaDevices = globalThis.navigator?.mediaDevices,
} = {}) {
  const provider = desktop ? 'desktop' : 'browser';
  let reason = null,
    guidance =
      provider === 'desktop'
        ? '读取当前默认输出的声音。切换输出设备后，请重新连接系统声音。'
        : '选择播放音乐的标签页或屏幕，并勾选「共享音频」。';
  if (desktop && !desktop.captureAvailable) {
    reason = 'unsupported-desktop';
    guidance = '此桌面环境不能读取共享声音，请使用本地音乐。';
  } else if (!desktop && !secureContext) {
    reason = 'insecure-context';
    guidance = '共享声音需要 HTTPS 或本机 localhost 页面。';
  } else if (typeof mediaDevices?.getDisplayMedia !== 'function') {
    reason = 'api-unavailable';
    guidance = '此浏览器无法请求共享声音，请尝试 Chrome／Edge 或本地音乐。';
  }
  return Object.freeze({
    available: !reason,
    provider: reason ? 'unavailable' : provider,
    reason,
    guidance,
    systemAudioGuaranteed: false,
  });
}

export function stopDisplayStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try {
      track.stop();
    } catch {}
  }
}

export function displayAudioError(error) {
  if (error?.code === 'NO_SHARED_AUDIO') return error;
  const message =
    error?.name === 'NotAllowedError'
      ? '共享已取消或未获允许，原声音来源保持不变。'
      : error?.name === 'InvalidStateError'
        ? '请在当前页面点击「读取共享声音」后选择音源。'
        : error?.name === 'NotReadableError'
          ? '浏览器无法读取所选声音，请尝试其他标签页或本地音乐。'
          : error?.message || '共享声音未连接，原声音来源保持不变。';
  const wrapped = new Error(message, { cause: error });
  wrapped.name = error?.name || 'Error';
  return wrapped;
}

export function createDisplayAudioAdapter({
  environment = () => ({
    desktop: globalThis.window?.desktop,
    secureContext: globalThis.window?.isSecureContext ?? globalThis.isSecureContext,
    mediaDevices: globalThis.navigator?.mediaDevices,
  }),
  createAudioStream = (tracks) => new MediaStream(tracks),
} = {}) {
  return Object.freeze({
    getSupport: () => getDisplayAudioSupport(environment()),
    request() {
      const current = environment();
      const support = getDisplayAudioSupport(current);
      if (!support.available) throw new Error(support.guidance);
      // Deliberately synchronous invocation, before WebAudio resume/other awaits,
      // so the browser still sees the click's transient user activation.
      return current.mediaDevices.getDisplayMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          restrictOwnAudio: false,
          suppressLocalAudioPlayback: false,
        },
        video: { width: 1, height: 1, frameRate: 1 },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
      });
    },
    prepare(stream, support) {
      const audioTracks = (stream?.getAudioTracks?.() || []).filter((track) => track.readyState !== 'ended');
      if (!audioTracks.length) {
        const error = new Error(
          '没有共享音频。请重新选择正在播放音乐的标签页或屏幕，并勾选「共享音频」；也可以使用本地音乐。',
        );
        error.code = 'NO_SHARED_AUDIO';
        throw error;
      }
      const videoTracks = stream.getVideoTracks?.() || [];
      const surface = videoTracks[0]?.getSettings?.().displaySurface;
      if (support.provider === 'desktop') {
        // The existing Electron loopback handler has a separately owned audio
        // source. Keep its already verified video-stop behavior compatible.
        for (const track of videoTracks) track.stop();
      } else {
        // Browsers need a video-bearing sharing session. Do not assume that
        // stopping video preserves audio. Its output is disabled and no video
        // consumer/preview/recorder/network sender is ever created by this app.
        for (const track of videoTracks) track.enabled = false;
      }
      return {
        audioStream: createAudioStream(audioTracks),
        provider: support.provider,
        name:
          support.provider === 'desktop' ? '系统声音' : surface === 'browser' ? '共享标签页声音' : '共享声音',
        lifetimeTracks: support.provider === 'desktop' ? audioTracks : [...audioTracks, ...videoTracks],
      };
    },
  });
}
