const GITHUB = 'https://github.com/LexZeon/words-actually-dance-open';
export const BILIBILI_PLAYER_ORIGIN = 'https://player.bilibili.com';
const SOURCE_START_SECONDS = Object.freeze({
  'die-for-you': 90,
  'qian-si-xi': 79,
  'mc-mong-remix': 124,
  'friends-wine': 0,
});
export const CLIPS = Object.freeze([
  {
    id: 'die-for-you',
    file: 'song-die-for-you-silent.mp4',
    preview: 'song-die-for-you-preview.gif',
    seconds: 12,
    kind: 'song',
    title: { en: 'Die For You', zh: 'Die For You' },
    subtitle: { en: 'English interface', zh: '英文界面' },
    description: {
      en: 'A song-driven recording of the actual app, from 1:30 to 1:42. The source-song audio has been removed.',
      zh: '源歌曲 1:30–1:42 驱动实际程序的录屏，已去除原曲声音。',
    },
    source: 'https://www.bilibili.com/video/BV1Zopb6KEFo/',
    credits: [
      { label: { en: 'Original performer', zh: '原演唱' }, value: { en: 'The Weeknd', zh: 'The Weeknd' } },
      {
        label: { en: 'Video uploader', zh: '参考视频上传者' },
        value: { en: '大西洋电台', zh: '大西洋电台' },
      },
    ],
  },
  {
    id: 'qian-si-xi',
    file: 'song-qian-si-xi-silent.mp4',
    preview: 'song-qian-si-xi-preview.gif',
    seconds: 34,
    kind: 'song',
    title: { en: '牵丝戏 / Qian Si Xi', zh: '牵丝戏' },
    subtitle: { en: 'English interface', zh: '英文界面' },
    description: {
      en: 'The selected lowered-pitch presentation, from 1:19 to 1:53, driving the actual app. This preview is silent; the selected version’s complete vocal and remix credits remain unverified.',
      zh: '所选降调版本 1:19–1:53 驱动实际程序的无声预览；该版本的具体演唱与混音署名尚未全部核实。',
    },
    source: 'https://www.bilibili.com/video/BV1Eqh9z1EcP/',
    credits: [
      {
        label: { en: 'Original vocals', zh: '原演唱' },
        value: { en: '银临 / Aki阿杰', zh: '银临 / Aki阿杰' },
      },
      {
        label: { en: 'Music / lyrics', zh: '作曲／作词' },
        value: { en: '银临 / Vagary', zh: '银临 / Vagary' },
      },
      { label: { en: 'Video uploader', zh: '参考视频上传者' }, value: { en: '南秋辞巷', zh: '南秋辞巷' } },
    ],
  },
  {
    id: 'mc-mong-remix',
    file: 'song-mc-mong-remix-silent.mp4',
    preview: 'song-mc-mong-remix-preview.gif',
    seconds: 61,
    kind: 'song',
    title: { en: '죽을 만큼 아파서 / Remix', zh: '죽을 만큼 아파서／改编版' },
    subtitle: { en: 'Chinese interface', zh: '中文界面' },
    description: {
      en: 'The referenced adaptation/remix, from 2:04 to 3:05, driving the actual app. The preview contains no source-song audio; the full version and permission chain remain unverified.',
      zh: '参考改编／remix 版本 2:04–3:05 驱动实际程序的录屏，不含原曲声音；完整版本制作与授权链仍待核实。',
    },
    source: 'https://www.bilibili.com/video/BV1Kmpc6zEi3/',
    credits: [
      {
        label: { en: 'Original performers', zh: '原演唱' },
        value: { en: 'MC몽 (MC MONG) feat. 멜로우 (Mellow)', zh: 'MC몽（MC MONG）feat. 멜로우（Mellow）' },
      },
      {
        label: { en: 'Adaptation / uploader', zh: '参考改编／视频创作者' },
        value: { en: '清风最梦', zh: '清风最梦' },
      },
    ],
  },
  {
    id: 'friends-wine',
    file: 'song-friends-wine-silent.mp4',
    preview: 'song-friends-wine-preview.gif',
    seconds: 57,
    kind: 'song',
    title: { en: '朋友的酒 / HALO DJ', zh: '朋友的酒／HALO DJ' },
    subtitle: { en: 'Chinese interface', zh: '中文界面' },
    description: {
      en: 'The complete selected short presentation, about 57 seconds. The linked version uses synthesized vocals; this actual app recording is silent. The DJ backing and complete production chain are not fully verified.',
      zh: '所选短版的完整录屏，约57秒。参考版本使用合成歌声，此处程序预览无声；DJ 伴奏及完整制作链尚未全部核实。',
    },
    source: 'https://www.bilibili.com/video/BV1cn8t6tE5m/',
    credits: [
      {
        label: { en: 'Original performer', zh: '原演唱' },
        value: { en: '李晓杰 (Li Xiaojie)', zh: '李晓杰' },
      },
      {
        label: { en: 'Original words / music', zh: '原作词曲' },
        value: { en: '积木鱼 (Jimu Yu)', zh: '积木鱼' },
      },
      {
        label: { en: 'Selected version / uploader', zh: '所选版本／视频创作者' },
        value: {
          en: '活跃黑江乐 · Synthesizer V 夢ノ結唱 HALO',
          zh: '活跃黑江乐 · Synthesizer V 夢ノ結唱 HALO',
        },
      },
    ],
  },
  {
    id: 'overview',
    file: 'demo-overview.mp4',
    preview: 'preview-overview.gif',
    seconds: 10,
    kind: 'original',
    title: { en: 'Let knowledge follow the rhythm', zh: '让知识跟上节奏' },
    subtitle: { en: 'Bass and weighted percussion', zh: '低频与轻重鼓点' },
    description: {
      en: 'Original bass and weighted percussion, short explanations, and transitions between related keywords. Recorded directly from the app.',
      zh: '原创低频与轻重鼓点、短句讲解，以及关联关键词之间的交接，直接录制实际程序。',
    },
  },
  {
    id: 'ghosts',
    file: 'demo-ghosts.mp4',
    preview: 'preview-ghosts.gif',
    seconds: 10,
    kind: 'original',
    title: { en: 'One word, two moments', zh: '一字，两道时间' },
    subtitle: { en: 'Chords and white ghost text', zh: '和弦与白字虚影' },
    description: {
      en: 'Original chord synths and five styles of solid white text with a delayed translucent white ghost. Recorded directly from the app.',
      zh: '原创和弦配乐，五种清晰白字与延迟淡白虚影，直接录制实际程序。',
    },
  },
  {
    id: 'learning',
    file: 'demo-learning.mp4',
    preview: 'preview-learning.gif',
    seconds: 12,
    kind: 'original',
    title: { en: 'Read, then recall', zh: '读过之后，回想一下' },
    subtitle: { en: 'Arpeggios and a real pause', zh: '琶音与实际暂停' },
    description: {
      en: 'Original bright arpeggios, a real pause, a concealed explanation, and a manual reveal after recall. This demonstrates the interaction, not a measured learning benefit.',
      zh: '原创明亮琶音、实际暂停、遮住讲解，回想后手动核对。这里展示交互，不代表已测得学习收益。',
    },
  },
  {
    id: 'full',
    file: 'demo-full.mp4',
    seconds: 32,
    kind: 'original',
    title: { en: 'The full picture', zh: '把三段连起来看' },
    subtitle: { en: 'Three complete recordings', zh: '三段完整录屏合辑' },
    description: {
      en: 'Three complete clips with different original audio styles, joined with simple cuts. Actual app footage, with no added animation or changed playback speed.',
      zh: '三段不同原创配乐风格的完整录屏，以简单切镜合并。全部来自实际程序，不添加动画，不改变播放速度。',
    },
  },
]);

export const MEDIA_FILES = Object.freeze([
  ...CLIPS.map((clip) => clip.file),
  'poster.webp',
  ...CLIPS.flatMap((clip) => (clip.preview ? [clip.preview] : [])),
]);

const COPY = {
  en: {
    skip: 'Skip to video',
    room: 'Film room',
    github: 'Source on GitHub',
    headline: 'Watch the words move.',
    introduction: 'Actual recordings. A little reading, a little rhythm, and room to pause.',
    choose: 'Choose a recording',
    songGroup: 'Song-driven · source player available',
    originalGroup: 'Original music · sound available',
    download: 'Download preview video',
    openSong: 'Open source song',
    share: 'Copy video link',
    fullCredits: 'Full music credits',
    footer:
      'This is a video gallery. The recordings demonstrate software, not proven learning benefits or beat accuracy.',
    play: 'Play video',
    replay: 'Play again',
    retry: 'Retry video',
    soundOn: 'Turn sound on',
    soundOff: 'Mute',
    silent: 'App recording file · no song audio',
    muted: 'Original music · sound off',
    audible: 'Original music · sound on',
    song: 'Song-driven recording',
    original: 'Original-music recording',
    language: 'Language',
    navigation: 'Language and source',
    blocked: 'Press Play video to watch. Your browser did not start playback automatically.',
    reduced:
      'Automatic playback is paused for your reduced-motion preference. Press Play video when you are ready.',
    error: 'The video could not load. Retry, or use Download preview video.',
    soundBlocked: 'The browser did not start sound. Press Play with sound, or use the video controls.',
    pairBlocked: 'The demo did not start. Press Restart together to try both players again.',
    playTogether: 'Play song + demo',
    restartTogether: 'Restart together',
    playWithSound: 'Play with sound',
    stopSource: 'Stop source song',
    pairRestart: 'Source song stopped. To resume the pair, press Restart together.',
    pairEnded:
      'This demo segment ended, so its source song was stopped. Press Restart together to replay the pair.',
    pairSeek:
      'The demo position changed, so its source song was stopped. Press Restart together; seeking is not continuously synchronized.',
    sourcePlayer: 'Source video · Bilibili official player',
    sourceRequest:
      'Bilibili’s page loaded; the demo is starting. Music may still buffer or require Play in Bilibili. Restarting does not guarantee ongoing sync.',
    sourceLoading: 'Waiting for Bilibili’s player page. The demo stays at the start while it loads.',
    sourceTimeout:
      'Bilibili has not finished loading. If you can hear the song, start the demo below, or restart to retry.',
    sourceError:
      'Bilibili’s player page could not load. Retry, or open the source song. The demo has not started.',
    startDemoNow: 'Song audible? Start demo now',
    sourceManual:
      'Demo started at your request. This page cannot read Bilibili’s playback position; ongoing sync is not guaranteed.',
    sourceWaitLabel: 'Waiting for Bilibili…',
    songWatchNote:
      'Hear the corresponding song in a visible Bilibili player. This contacts Bilibili; its playback and privacy rules apply. The downloaded app recording stays silent.',
    originalWatchNote:
      'Original project music starts with sound when the browser allows it. If blocked, press Play with sound. Your mute choice stays for other original clips on this page.',
    copyrightContact: 'Copyright contact',
    copied: 'Video link copied.',
    copyFallback: 'Copy the address from your browser to share this video.',
    creator: 'Original music',
    creatorName: 'LexZeon Studio and project contributors',
    capture: 'Recording',
    captureValue: 'Actual app interface and original example text',
    songRights:
      'We do not upload, extract or bundle the source recording. The local app-recording file is silent; the source video plays only through Bilibili’s official player or source link. Attribution is not a licence to redistribute the song.',
    originalRights:
      'The music is generated by this project’s code. These recordings contain original example text and the actual app interface.',
  },
  zh: {
    skip: '跳至视频',
    room: '影像展厅',
    github: 'GitHub 源码',
    headline: '看看文字怎么跳动。',
    introduction: '真实程序录屏。读一点，跟着节奏动一动，也给暂停留点空间。',
    choose: '选择一段录屏',
    songGroup: '歌曲驱动 · 可播放源歌曲',
    originalGroup: '原创配乐 · 可以开声音',
    download: '下载预览视频',
    openSong: '打开源歌曲',
    share: '复制视频链接',
    fullCredits: '完整音乐署名',
    footer: '这里是视频展厅。录屏展示软件表现，不代表已验证学习收益或拍点准确率。',
    play: '播放视频',
    replay: '再看一次',
    retry: '重试播放',
    soundOn: '打开声音',
    soundOff: '静音',
    silent: '程序录屏文件 · 不含源歌曲声音',
    muted: '原创配乐 · 声音已关闭',
    audible: '原创配乐 · 声音已打开',
    song: '歌曲驱动录屏',
    original: '原创配乐录屏',
    language: '语言',
    navigation: '语言与源码',
    blocked: '请点击「播放视频」。浏览器没有自动开始播放。',
    reduced: '已按你的减少动态效果偏好暂停自动播放，准备好后可点击「播放视频」。',
    error: '视频暂时无法加载。可以重试，或点击「下载预览视频」。',
    soundBlocked: '浏览器没有开始播放声音。请点击「播放并开声」，或使用视频原生控件。',
    pairBlocked: '演示未能开始播放。请按「重新同步」，重新尝试两个播放器。',
    playTogether: '播放原曲与演示',
    restartTogether: '重新同步',
    playWithSound: '播放并开声',
    stopSource: '停止原曲',
    pairRestart: '已停止原曲。若要继续配对播放，请按「重新同步」。',
    pairEnded: '这段演示已结束，原曲也已停止。按「重新同步」可重新配对播放。',
    pairSeek: '演示进度已改变，原曲已停止。请按「重新同步」；拖动进度不会持续同步原曲。',
    sourcePlayer: '来源视频 · Bilibili 官方播放器',
    sourceRequest:
      'Bilibili 页面已加载，正在启动演示；音乐仍可能缓冲或需在 Bilibili 内点击播放。重新启动不保证持续同步。',
    sourceLoading: '正在等待 Bilibili 播放器页面，演示会先停在开头。',
    sourceTimeout: 'Bilibili 尚未完成加载。如果已听到原曲，可在下方开始演示，或重新同步重试。',
    sourceError: 'Bilibili 播放器页面未能加载。可重试或打开原曲链接，演示尚未开始。',
    startDemoNow: '音乐已响，开始演示',
    sourceManual: '已按你的操作开始演示。网页无法读取 Bilibili 进度，不能保证持续同步。',
    sourceWaitLabel: '正在等待 Bilibili…',
    songWatchNote:
      '通过可见的 Bilibili 官方播放器听对应歌曲；这会连接 Bilibili，适用其播放与隐私规则。下载的程序录屏仍无声。',
    originalWatchNote:
      '本项目原创配乐默认尝试开声；浏览器阻止时请按「播放并开声」。此页面后续原创片段会保留你的静音选择。',
    copyrightContact: '版权联系',
    copied: '已复制此视频链接。',
    copyFallback: '可复制浏览器地址栏中的链接，分享这段视频。',
    creator: '原创配乐',
    creatorName: 'LexZeon Studio及项目贡献者',
    capture: '录制内容',
    captureValue: '真实程序界面与原创示例文案',
    songRights:
      '不重新上传、提取或打包源录音。本地程序录屏文件无声，源视频只通过 Bilibili 官方播放器或原链接播放；署名不是再分发歌曲的许可。',
    originalRights: '配乐由本项目代码生成，录屏使用原创示例文案与实际程序界面。',
  },
};

export function resolveSelection(input, fallbackLanguage = 'en') {
  const url = new URL(input, 'https://showcase.invalid/');
  const clip =
    CLIPS.find((entry) => entry.id === url.searchParams.get('clip')) ??
    CLIPS.find((entry) => entry.id === 'full');
  const requested = url.searchParams.get('lang');
  const language = ['en', 'zh'].includes(requested) ? requested : fallbackLanguage === 'zh' ? 'zh' : 'en';
  return { clip, language };
}

export function selectionURL(input, clipId, language) {
  const url = new URL(input, 'https://showcase.invalid/');
  const selection = resolveSelection(
    `?clip=${encodeURIComponent(clipId)}&lang=${encodeURIComponent(language)}`,
  );
  url.searchParams.set('clip', selection.clip.id);
  url.searchParams.set('lang', selection.language);
  return url;
}

/** Only the four reviewed source videos can be embedded; no arbitrary URL input. */
export function officialPlayerURL(clipId) {
  const clip = CLIPS.find((entry) => entry.id === clipId && entry.kind === 'song');
  if (!clip || !Object.hasOwn(SOURCE_START_SECONDS, clipId))
    throw new RangeError('Unknown source-song clip.');
  const bvid = /^https:\/\/www\.bilibili\.com\/video\/(BV[a-zA-Z0-9]+)\/$/.exec(clip.source)?.[1];
  if (!bvid) throw new RangeError('The reviewed source is not a Bilibili video.');
  const url = new URL('/player.html', BILIBILI_PLAYER_ORIGIN);
  for (const [name, value] of Object.entries({
    bvid,
    t: SOURCE_START_SECONDS[clipId],
    autoplay: 1,
    muted: 0,
    danmaku: 0,
  }))
    url.searchParams.set(name, String(value));
  return url.href;
}

export function bootGallery(document) {
  const view = document.defaultView;
  const byId = (id) => document.getElementById(id);
  const player = byId('player');
  let savedLanguage;
  try {
    savedLanguage = view.localStorage.getItem('wad-showcase-language');
  } catch {
    /* Storage is optional. */
  }
  const initial = resolveSelection(
    view.location.href,
    savedLanguage ?? (view.navigator.language?.startsWith('zh') ? 'zh' : 'en'),
  );
  let language = initial.language,
    current = initial.clip,
    generation = 0,
    playbackError = false,
    originalSoundIntent = true,
    sourceIframe = null,
    sourceAttempt = null,
    sourceStartPhase = 'idle',
    queuedInternalPauses = 0,
    pairNeedsRestart = false,
    expectedPairReset = null,
    lastAppliedMuted = player.muted,
    autoplaySoundBlocked = false;
  const t = (key) => COPY[language][key];
  const message = (key = '') => {
    byId('player-message').textContent = key ? t(key) : '';
  };
  const setPlayerMuted = (muted) => {
    lastAppliedMuted = Boolean(muted);
    player.muted = lastAppliedMuted;
  };
  const reducedMotion = () => Boolean(view.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  // pause events are queued: a reset's old event must not cancel its new load gate.
  const pauseLocal = () => {
    if (!player.paused) queuedInternalPauses += 1;
    player.pause();
  };
  const loadLocal = () => {
    // The media load algorithm removes queued media events, including our pause.
    queuedInternalPauses = 0;
    expectedPairReset = null;
    player.load();
  };
  const syncURL = () => {
    try {
      view.history.replaceState(null, '', selectionURL(view.location.href, current.id, language));
    } catch {
      /* A local file preview can keep its original address. */
    }
    byId('home-link').href = `./?clip=full&lang=${language}`;
  };

  function playbackState() {
    byId('play-cover').hidden = !player.paused && !player.ended && !playbackError;
    const waiting = sourceStartPhase === 'loading';
    byId('play-button').disabled = waiting;
    byId('play-label').textContent = t(
      waiting ? 'sourceWaitLabel' : playbackError ? 'retry' : player.ended ? 'replay' : 'play',
    );
    byId('audio-description').textContent = t(
      current.kind === 'song' ? 'silent' : player.muted ? 'muted' : 'audible',
    );
    byId('sound-button').hidden = current.kind === 'song';
    byId('sound-button').textContent = t(player.muted ? 'soundOn' : 'soundOff');
    byId('sound-button').setAttribute('aria-pressed', String(!player.muted));
    byId('play-together-button').hidden = current.kind !== 'song';
    byId('play-together-button').textContent = t(
      sourceIframe || pairNeedsRestart ? 'restartTogether' : 'playTogether',
    );
    byId('play-with-sound-button').hidden = current.kind !== 'original';
    byId('start-demo-now-button').hidden = !sourceIframe || !['loading', 'error'].includes(sourceStartPhase);
    byId('watch-note').textContent = t(current.kind === 'song' ? 'songWatchNote' : 'originalWatchNote');
  }

  function stopSource({ focus = false, restart = false } = {}) {
    if (sourceAttempt) {
      sourceAttempt.cancelled = true;
      clearSourceWait(sourceAttempt);
      if (sourceStartPhase === 'starting') pauseLocal();
    }
    if (sourceIframe || sourceAttempt) generation += 1;
    sourceAttempt = null;
    sourceStartPhase = 'idle';
    if (sourceIframe) {
      sourceIframe.src = 'about:blank';
      sourceIframe.remove();
      sourceIframe = null;
    }
    byId('source-player-slot').replaceChildren();
    byId('source-player-section').hidden = true;
    pairNeedsRestart = restart;
    expectedPairReset = null;
    byId('play-together-button').textContent = t(restart ? 'restartTogether' : 'playTogether');
    if (focus && current.kind === 'song') byId('play-together-button').focus({ preventScroll: true });
  }

  function clearSourceWait(attempt) {
    view.clearTimeout(attempt.timeout);
    attempt.iframe.removeEventListener('load', attempt.onLoad);
    attempt.iframe.removeEventListener('error', attempt.onError);
  }

  function isCurrentSource(attempt) {
    return (
      attempt === sourceAttempt &&
      !attempt.cancelled &&
      attempt.generation === generation &&
      attempt.iframe === sourceIframe &&
      current.kind === 'song'
    );
  }

  function startSourceDemo({ manual = false } = {}) {
    const attempt = sourceAttempt;
    if (!attempt || !isCurrentSource(attempt) || !['loading', 'error'].includes(sourceStartPhase)) return;
    clearSourceWait(attempt);
    sourceStartPhase = 'starting';
    byId('source-player-note').textContent = t(manual ? 'sourceManual' : 'sourceRequest');
    message();
    playbackState();
    void play({ user: manual || attempt.user });
  }

  function playTogether({ user = true } = {}) {
    if (current.kind !== 'song') return;
    stopSource();
    if (!user && reducedMotion()) {
      message('reduced');
      playbackState();
      return;
    }
    generation += 1;
    pauseLocal();
    if (player.currentTime !== 0) {
      expectedPairReset = { generation, target: 0 };
      player.currentTime = 0;
    }
    setPlayerMuted(true);
    const iframe = document.createElement('iframe');
    iframe.src = officialPlayerURL(current.id);
    iframe.title = `${t('sourcePlayer')}: ${current.title[language]}`;
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    sourceIframe = iframe;
    sourceStartPhase = 'loading';
    const attempt = { iframe, generation, user, cancelled: false, timeout: null };
    sourceAttempt = attempt;
    attempt.onLoad = () => {
      if (isCurrentSource(attempt) && sourceStartPhase === 'loading') startSourceDemo();
    };
    const waitFailed = (key) => {
      if (!isCurrentSource(attempt) || sourceStartPhase !== 'loading') return;
      clearSourceWait(attempt);
      sourceStartPhase = 'error';
      byId('source-player-note').textContent = t(key);
      message(key);
      playbackState();
    };
    attempt.onError = () => waitFailed('sourceError');
    iframe.addEventListener('load', attempt.onLoad);
    iframe.addEventListener('error', attempt.onError);
    attempt.timeout = view.setTimeout(() => waitFailed('sourceTimeout'), 15_000);
    byId('source-player-section').hidden = false;
    byId('source-player-slot').append(iframe);
    byId('source-player-note').textContent = t('sourceLoading');
    message('sourceLoading');
    playbackState();
  }

  function playlist() {
    const list = byId('clip-list');
    list.replaceChildren();
    for (const kind of ['song', 'original']) {
      const group = document.createElement('section');
      group.className = 'clip-group';
      const heading = document.createElement('h3');
      heading.textContent = t(kind === 'song' ? 'songGroup' : 'originalGroup');
      group.append(heading);
      const options = document.createElement('div');
      options.className = 'clip-group-list';
      for (const clip of CLIPS.filter((entry) => entry.kind === kind)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'clip-option';
        button.dataset.clip = clip.id;
        button.setAttribute('aria-pressed', String(clip.id === current.id));
        button.setAttribute('aria-controls', 'player');
        const icon = document.createElement('span');
        icon.className = 'clip-option-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = clip.id === current.id ? '▶' : '▷';
        const words = document.createElement('span');
        words.className = 'clip-option-text';
        const title = document.createElement('span');
        title.className = 'clip-option-title';
        title.textContent = clip.title[language];
        const subtitle = document.createElement('span');
        subtitle.className = 'clip-option-subtitle';
        subtitle.textContent = clip.subtitle[language];
        const duration = document.createElement('span');
        duration.className = 'clip-option-duration';
        duration.textContent = `${clip.seconds}${language === 'zh' ? '秒' : 's'}`;
        words.append(title, subtitle);
        button.append(icon, words, duration);
        button.addEventListener('click', () => selectClip(clip, { user: true }));
        options.append(button);
      }
      group.append(options);
      list.append(group);
    }
  }

  function details() {
    byId('clip-title').textContent = current.title[language];
    byId('clip-category').textContent = t(current.kind === 'song' ? 'song' : 'original');
    byId('clip-duration').textContent = `${current.seconds}${language === 'zh' ? '秒' : 's'}`;
    byId('clip-description').textContent = current.description[language];
    byId('rights-note').textContent = t(current.kind === 'song' ? 'songRights' : 'originalRights');
    player.setAttribute(
      'aria-label',
      `${current.title[language]} — ${t(current.kind === 'song' ? 'silent' : 'original')}`,
    );
    const credits = byId('clip-credits');
    credits.replaceChildren();
    const rows = current.credits ?? [
      { label: { [language]: t('creator') }, value: { [language]: t('creatorName') } },
      { label: { [language]: t('capture') }, value: { [language]: t('captureValue') } },
    ];
    for (const row of rows) {
      const term = document.createElement('dt'),
        value = document.createElement('dd');
      term.textContent = row.label[language];
      value.textContent = row.value[language];
      credits.append(term, value);
    }
    byId('download-link').href = `./media/${current.file}`;
    byId('download-link').download = current.file;
    byId('song-link').hidden = !current.source;
    if (current.source) byId('song-link').href = current.source;
    byId('credits-link').href =
      `${GITHUB}/blob/main/MUSIC-CREDITS.md#${language === 'zh' ? '简体中文' : 'english'}`;
    document.title = `${current.title[language]} — Words Actually Dance`;
    playbackState();
  }

  function localize() {
    document.documentElement.lang = language === 'zh' ? 'zh-Hans' : 'en';
    for (const element of document.querySelectorAll('[data-i18n]'))
      element.textContent = t(element.dataset.i18n);
    for (const button of document.querySelectorAll('[data-language]'))
      button.setAttribute('aria-pressed', String(button.dataset.language === language));
    byId('language-group').setAttribute('aria-label', t('language'));
    byId('header-nav').setAttribute('aria-label', t('navigation'));
    playlist();
    details();
    syncURL();
    try {
      view.localStorage.setItem('wad-showcase-language', language);
    } catch {
      /* Storage is optional. */
    }
  }

  async function play({ user = false } = {}) {
    const request = generation;
    if (!user && reducedMotion()) {
      message('reduced');
      playbackState();
      return;
    }
    playbackError = false;
    if (player.error) loadLocal();
    try {
      await player.play();
      if (request !== generation) return;
      if (sourceAttempt && isCurrentSource(sourceAttempt) && sourceStartPhase === 'starting')
        sourceStartPhase = 'playing';
      if (!player.muted) autoplaySoundBlocked = false;
      message(pairNeedsRestart ? 'pairRestart' : autoplaySoundBlocked ? 'soundBlocked' : '');
      playbackState();
    } catch (error) {
      if (request !== generation) return;
      // One policy-respecting fallback, with the requested sound intent intact.
      if (
        current.kind === 'original' &&
        !player.muted &&
        error?.name === 'NotAllowedError' &&
        !player.error
      ) {
        autoplaySoundBlocked = true;
        setPlayerMuted(true);
        try {
          await player.play();
          if (request !== generation) return;
          message('soundBlocked');
          playbackState();
          return;
        } catch {
          if (request !== generation) return;
        }
      }
      if (sourceIframe && player.paused) {
        stopSource({ restart: true });
        message('pairBlocked');
        playbackState();
        return;
      }
      message(playbackError || player.error ? 'error' : !player.muted ? 'soundBlocked' : 'blocked');
      playbackState();
    }
  }

  function selectClip(clip, { user = false, initial = false } = {}) {
    stopSource();
    if (clip.id === current.id && !initial && player.getAttribute('src')) {
      if (clip.kind === 'song') playTogether({ user });
      else {
        setPlayerMuted(!originalSoundIntent);
        void play({ user });
      }
      return;
    }
    generation += 1;
    pauseLocal();
    current = clip;
    playbackError = false;
    autoplaySoundBlocked = false;
    setPlayerMuted(!(clip.kind === 'original' && originalSoundIntent));
    player.src = `./media/${clip.file}`;
    player.preload = clip.kind === 'song' ? 'auto' : 'metadata';
    loadLocal();
    message();
    playlist();
    details();
    syncURL();
    if (clip.kind === 'song') playTogether({ user });
    else void play({ user });
  }

  byId('play-button').addEventListener('click', () => {
    if (sourceAttempt && ['loading', 'error'].includes(sourceStartPhase)) {
      startSourceDemo({ manual: true });
      return;
    }
    if (player.ended) player.currentTime = 0;
    void play({ user: true });
  });
  byId('sound-button').addEventListener('click', () => {
    if (current.kind !== 'original') return;
    originalSoundIntent = player.muted;
    setPlayerMuted(!originalSoundIntent);
    autoplaySoundBlocked = false;
    playbackState();
  });
  byId('play-together-button').addEventListener('click', playTogether);
  byId('start-demo-now-button').addEventListener('click', () => startSourceDemo({ manual: true }));
  byId('stop-source-button').addEventListener('click', () => {
    stopSource({ focus: true, restart: true });
    message('pairRestart');
    playbackState();
  });
  byId('play-with-sound-button').addEventListener('click', () => {
    if (current.kind !== 'original') return;
    originalSoundIntent = true;
    setPlayerMuted(false);
    autoplaySoundBlocked = false;
    if (player.volume === 0) player.volume = 1;
    if (player.ended) player.currentTime = 0;
    void play({ user: true });
  });
  for (const button of document.querySelectorAll('[data-language]'))
    button.addEventListener('click', () => {
      stopSource();
      generation += 1;
      pauseLocal();
      language = button.dataset.language;
      message();
      localize();
    });
  player.addEventListener('play', () => {
    if (sourceAttempt && isCurrentSource(sourceAttempt) && !player.paused) {
      // `play` can precede buffering/Promise resolution. Keep cancellation active.
      const manuallyStarted = ['loading', 'error'].includes(sourceStartPhase);
      clearSourceWait(sourceAttempt);
      sourceStartPhase = 'starting';
      if (manuallyStarted) byId('source-player-note').textContent = t('sourceManual');
      if (byId('player-message').textContent === t('sourceLoading')) message();
    }
    playbackState();
  });
  player.addEventListener('pause', () => {
    // pause() during Restart queues an event which may arrive after play().
    // Read the actual current local state rather than stopping a new iframe.
    if (queuedInternalPauses > 0) {
      queuedInternalPauses -= 1;
    } else if (player.paused && sourceIframe) {
      stopSource({ restart: true });
      message('pairRestart');
    }
    playbackState();
  });
  player.addEventListener('ended', () => {
    if (player.ended && (sourceIframe || pairNeedsRestart)) {
      stopSource({ restart: true });
      message('pairEnded');
    }
    playbackState();
  });
  player.addEventListener('seeking', () => {
    if (!sourceIframe) return;
    if (
      expectedPairReset?.generation === generation &&
      Math.abs(player.currentTime - expectedPairReset.target) < 0.25
    )
      return;
    stopSource({ restart: true });
    message('pairSeek');
    playbackState();
  });
  player.addEventListener('seeked', () => {
    if (!player.seeking) expectedPairReset = null;
  });
  player.addEventListener('volumechange', () => {
    if (player.muted !== lastAppliedMuted) {
      lastAppliedMuted = player.muted;
      if (current.kind === 'original') {
        originalSoundIntent = !player.muted;
        autoplaySoundBlocked = false;
      }
    }
    playbackState();
  });
  player.addEventListener('error', () => {
    stopSource({ restart: current.kind === 'song' });
    playbackError = true;
    message('error');
    playbackState();
  });
  byId('share-button').addEventListener('click', async () => {
    try {
      await view.navigator.clipboard.writeText(selectionURL(view.location.href, current.id, language).href);
      message('copied');
    } catch {
      message('copyFallback');
    }
  });
  view.addEventListener('popstate', () => {
    stopSource();
    generation += 1;
    pauseLocal();
    const next = resolveSelection(view.location.href, language);
    const changed = next.clip.id !== current.id;
    language = next.language;
    localize();
    if (changed) selectClip(next.clip, { initial: true });
  });
  const stopAll = () => {
    generation += 1;
    pauseLocal();
    stopSource();
    playbackState();
  };
  view.addEventListener('pagehide', stopAll);
  view.addEventListener('beforeunload', stopAll);
  localize();
  selectClip(initial.clip, { initial: true });
  return Object.freeze({
    getState: () => ({
      clip: current.id,
      language,
      paused: player.paused,
      muted: player.muted,
      kind: current.kind,
      originalSoundIntent,
      sourcePlayerRequested: Boolean(sourceIframe),
      sourceStartPhase,
      pairNeedsRestart,
      autoplaySoundBlocked,
    }),
    pause: stopAll,
  });
}

if (typeof document !== 'undefined') bootGallery(document);
