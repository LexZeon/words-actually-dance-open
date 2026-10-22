import { AppController } from '../src/app/app-controller.js';
import { mountWebLibrary } from './web-library-client.js';
import { registerWebLibraryProvider } from './web-library-provider.js';
import { getDisplayAudioSupport } from '../src/audio/display-audio.js';

/** Capability presentation only; a button click still owns the browser's consent flow. */
export function configureWebSystemAudioButton({ documentRef, windowRef, collaborationLibrary }) {
  const system = documentRef.getElementById('system-audio-button');
  if (!system) return null;
  const support = getDisplayAudioSupport({
    desktop: windowRef.desktop ?? null,
    secureContext: Boolean(windowRef.isSecureContext),
    mediaDevices: windowRef.navigator?.mediaDevices ?? null,
  });
  const label = windowRef.desktop ? '读取系统声音' : '读取共享声音';
  const guidance =
    !collaborationLibrary && !windowRef.desktop
      ? support.available
        ? '选择播放音乐的标签页或屏幕，并勾选「共享音频」。'
        : !windowRef.isSecureContext
          ? '共享声音需要 HTTPS 或 localhost；也可以使用内置试听。'
          : '当前浏览器无法共享声音，请尝试 Chrome／Edge 或使用内置试听。'
      : support.guidance;
  system.disabled = !support.available;
  system.setAttribute('aria-disabled', String(!support.available));
  system.setAttribute('aria-label', label);
  const heading = system.querySelector('strong');
  if (heading) heading.textContent = label;
  const description = system.querySelector('small');
  if (description) description.textContent = guidance;
  system.title = guidance;

  if (support.available && support.provider === 'browser') {
    system.title += ' 浏览器也会请求共享画面权限；画面不展示、保存或上传。';
    const panel = documentRef.getElementById('source-dialog');
    if (panel && typeof documentRef.createElement === 'function') {
      const note = documentRef.createElement('p');
      note.id = 'web-system-audio-guide';
      note.className = 'panel-note';
      note.textContent = `浏览器也会请求共享画面权限；画面不展示、保存或上传。没有“共享音频”选项时，可用 Chrome／Edge，或${collaborationLibrary ? '选择本地音乐／协作库音乐' : '使用内置试听'}。`;
      panel.append(note);
      system.setAttribute('aria-describedby', note.id);
      return note;
    }
  }
  return null;
}

export async function bootWebApp({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  AppClass = AppController,
  mountLibrary = mountWebLibrary,
  collaborationLibrary = true,
} = {}) {
  if (!collaborationLibrary) {
    const element = documentRef.documentElement;
    if (element?.dataset) {
      element.dataset.webPublic = 'true';
      element.dataset.webMusicImport = 'off';
    }
    for (const id of ['import-audio-button', 'audio-input']) {
      const control = documentRef.getElementById(id);
      if (control) {
        control.hidden = true;
        control.disabled = true;
      }
    }
  }
  const app = new AppClass({ documentRef, windowRef });
  let library = null;
  let libraryProvider = null;
  let systemAudioGuide = null;
  const cleanup = () => {
    try {
      library?.destroy();
    } finally {
      libraryProvider?.dispose();
      systemAudioGuide?.remove();
    }
  };
  windowRef.addEventListener('beforeunload', cleanup, { once: true });
  try {
    if (!(await app.boot())) {
      windowRef.removeEventListener('beforeunload', cleanup);
      return { app, library };
    }
    systemAudioGuide = configureWebSystemAudioButton({ documentRef, windowRef, collaborationLibrary });
    app.ui?.refreshLocalization?.();
    if (collaborationLibrary) {
      libraryProvider = registerWebLibraryProvider({ registry: app.registry, eventBus: app.bus });
      if (app.destroyed) {
        cleanup();
        return { app, library };
      }
      app.ownedProviders.push(libraryProvider.provider);
      library = mountLibrary({
        provider: libraryProvider.provider,
        container: documentRef.body,
        toggleContainer: documentRef.querySelector('.header-actions') || documentRef.body,
        documentRef,
        beginSelection: (item) => app.reserveImportIntent(item.kind === 'music' ? 'music' : 'script'),
        // Unlock audio during the click, before cloud file I/O loses user
        // activation. This uses the product player and its shared clock.
        onPrepareMusic: () => {
          const initialized = app.audio.initialize();
          const resumed = app.audio.context?.resume();
          return Promise.all([initialized, resumed]);
        },
        onSelectMusic: (file, _item, intent) => app.importFiles([file], { intent }),
        onSelectScript: (file, _item, intent) => app.importScriptFile(file, { intent }),
      });
    }
    return { app, library };
  } catch (error) {
    cleanup();
    windowRef.removeEventListener('beforeunload', cleanup);
    await app.destroy();
    throw error;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined')
  bootWebApp({ collaborationLibrary: document.documentElement.dataset.collaborationLibrary !== 'off' }).catch(
    (error) => {
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = '网页版启动失败，请刷新重试。';
        toast.classList.add('visible');
      }
      console.error('Words Actually Dance web startup failed:', error);
    },
  );
