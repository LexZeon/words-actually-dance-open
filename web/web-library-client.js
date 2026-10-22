import {
  createWebLibraryProvider,
  validateLibraryUpload,
  uploadLibraryFile,
  WEB_LIBRARY_MUSIC_LIMIT,
  WEB_LIBRARY_MUSIC_ACCEPT,
} from './web-library-provider.js';
export { validateLibraryUpload, uploadLibraryFile, WEB_LIBRARY_MUSIC_LIMIT };
const musicAccept = WEB_LIBRARY_MUSIC_ACCEPT;

const sizeLabel = (size) =>
  size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;

export function mountWebLibrary({
  container,
  toggleContainer = container,
  onPrepareMusic = () => {},
  beginSelection = () => null,
  onSelectMusic,
  onSelectScript,
  fetchImpl = globalThis.fetch,
  provider = null,
  documentRef = globalThis.document,
} = {}) {
  if (!container || typeof onSelectMusic !== 'function' || typeof onSelectScript !== 'function')
    throw new Error('协作库需要受控音乐与文案导入接口。');
  const ownedProvider = provider ? null : createWebLibraryProvider({ fetchImpl });
  const service = provider || ownedProvider;
  if (
    !['listFiles', 'uploadFile', 'downloadFile', 'removeFile'].every(
      (name) => typeof service.methods?.[name] === 'function',
    )
  )
    throw new Error('协作库需要实际文件服务。');
  let disposed = false,
    uploadAbort = null,
    requestAbort = null,
    nextCursor = null,
    items = [],
    busy = false,
    generation = 0;
  const cleanups = [];
  let selectionOperation = null;
  const element = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const panel = element('dialog', 'web-library');
  panel.setAttribute('aria-label', '临时协作库');
  const header = element('div', 'web-library-heading');
  header.append(element('h2', '', '临时协作库'));
  const close = element('button', 'web-library-close', '收起');
  close.type = 'button';
  const toggle = element('button', 'web-library-toggle', '协作库');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  panel.hidden = true;
  header.append(close);
  panel.append(
    header,
    element('p', 'web-library-description', '仅限获准访问者 · 共享音乐和文案 · 与桌面资料独立'),
  );
  const controls = element('div', 'web-library-controls');
  const musicInput = element('input'),
    scriptInput = element('input');
  for (const [input, accept, label] of [
    [musicInput, musicAccept, '上传音乐'],
    [scriptInput, '.txt,.json', '上传文案'],
  ]) {
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    input.setAttribute('aria-label', label);
  }
  const uploadMusic = element('button', '', '＋ 音乐'),
    uploadScript = element('button', '', '＋ 文案'),
    refresh = element('button', '', '刷新'),
    cancel = element('button', '', '取消上传');
  cancel.hidden = true;
  for (const button of [uploadMusic, uploadScript, refresh, cancel]) button.type = 'button';
  controls.append(uploadMusic, uploadScript, refresh, cancel, musicInput, scriptInput);
  const status = element('p', 'web-library-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const progress = element('progress');
  progress.max = 100;
  progress.value = 0;
  progress.hidden = true;
  progress.setAttribute('aria-label', '上传进度');
  const list = element('ul', 'web-library-list');
  const more = element('button', 'web-library-more', '更多文件');
  more.type = 'button';
  more.hidden = true;
  panel.append(controls, status, progress, list, more);
  container.append(panel);
  toggleContainer.append(toggle);
  const listen = (node, type, fn) => {
    node.addEventListener(type, fn);
    cleanups.push(() => node.removeEventListener(type, fn));
  };
  const say = (text) => {
    if (!disposed) status.textContent = text;
  };
  const setBusy = (value) => {
    busy = value;
    for (const button of [uploadMusic, uploadScript, refresh, more]) button.disabled = value;
    for (const button of list.querySelectorAll('button')) button.disabled = value;
  };

  function cancelSelection({ invalidateIntent = true } = {}) {
    const operation = selectionOperation;
    if (!operation) return;
    selectionOperation = null;
    if (invalidateIntent) operation.intent?.cancel();
    operation.abort.abort();
    if (requestAbort === operation.abort) requestAbort = null;
    if (!disposed) {
      say('已取消载入。');
      setBusy(false);
    }
  }

  async function choose(item) {
    if (busy || disposed) return;
    setBusy(true);
    say(`正在读取“${item.title || item.name}”…`);
    const abort = (requestAbort = new AbortController());
    const operation = { abort, intent: null };
    selectionOperation = operation;
    const current = () =>
      !disposed &&
      selectionOperation === operation &&
      !abort.signal.aborted &&
      (!operation.intent || operation.intent.isCurrent());
    const intentAborted = () => {
      if (selectionOperation === operation) cancelSelection({ invalidateIntent: false });
      else abort.abort();
    };
    try {
      operation.intent = beginSelection(item);
      operation.intent?.signal.addEventListener('abort', intentAborted, { once: true });
      if (!current()) {
        cancelSelection({ invalidateIntent: false });
        return;
      }
      if (item.kind === 'music') await onPrepareMusic();
      if (!current()) return;
      const file = await service.methods.downloadFile(item, { signal: abort.signal });
      if (!current()) return;
      const accepted = await (item.kind === 'music'
        ? onSelectMusic(file, item, operation.intent)
        : onSelectScript(file, item, operation.intent));
      if (!current()) return;
      if (accepted === false) {
        say('该次载入已取消。');
        return;
      }
      say(item.kind === 'music' ? `已选用音乐“${item.name}”。` : `已载入文案“${item.title}”。`);
    } catch (error) {
      if (current() && error.name !== 'AbortError') say(error.message);
    } finally {
      operation.intent?.signal.removeEventListener('abort', intentAborted);
      if (requestAbort === abort) requestAbort = null;
      if (selectionOperation === operation) {
        selectionOperation = null;
        if (!disposed) setBusy(false);
      }
    }
  }

  function render() {
    list.replaceChildren();
    if (!items.length)
      list.append(element('li', 'web-library-empty', '还没有共享文件，上传一首音乐或一份文案开始。'));
    for (const item of items) {
      const row = element('li', 'web-library-item');
      const details = element('div', 'web-library-item-info');
      details.append(element('strong', '', item.title || item.name));
      details.append(
        element(
          'span',
          '',
          `${item.kind === 'music' ? '音乐' : '文案'} · ${sizeLabel(item.size)} · ${item.uploader} · ${new Date(item.createdAt).toLocaleDateString()}`,
        ),
      );
      if (item.title !== item.name) details.append(element('small', '', item.name));
      const actions = element('div', 'web-library-item-actions');
      const use = element('button', '', item.kind === 'music' ? '播放' : '载入');
      use.type = 'button';
      use.disabled = busy;
      use.setAttribute('aria-label', `${item.kind === 'music' ? '播放' : '载入'} ${item.name}`);
      use.addEventListener('click', () => choose(item));
      const download = element('a', '', '下载');
      download.href = `/api/library/${item.id}/file`;
      download.download = item.name;
      actions.append(use, download);
      if (item.canDelete) {
        const remove = element('button', '', '删除');
        remove.type = 'button';
        remove.disabled = busy;
        remove.setAttribute('aria-label', `删除 ${item.name}`);
        remove.addEventListener('click', async () => {
          if (busy || disposed) return;
          if (!globalThis.confirm(`删除自己上传的“${item.name}”？`)) return;
          setBusy(true);
          try {
            await service.methods.removeFile(item.id);
            items = items.filter((value) => value.id !== item.id);
            render();
            say('文件已删除。');
          } catch (error) {
            say(error.message);
          } finally {
            if (!disposed) setBusy(false);
          }
        });
        actions.append(remove);
      }
      row.append(details, actions);
      list.append(row);
    }
    more.hidden = !nextCursor;
  }

  async function reload(append = false) {
    if (disposed || busy) return;
    const version = ++generation;
    setBusy(true);
    say('正在读取协作库…');
    const abort = (requestAbort = new AbortController());
    try {
      const value = await service.methods.listFiles({
        cursor: append ? nextCursor : null,
        signal: abort.signal,
      });
      if (!Array.isArray(value.items)) throw new Error('协作库返回了无法读取的文件列表，请重试。');
      if (disposed || version !== generation) return;
      items = append ? [...items, ...value.items] : value.items;
      nextCursor = value.nextCursor;
      render();
      say(`${items.length} 个共享文件`);
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') say(error.message);
    } finally {
      if (requestAbort === abort) requestAbort = null;
      if (!disposed) setBusy(false);
    }
  }

  async function upload(file, kind) {
    if (!file || busy || disposed) return;
    setBusy(true);
    const abort = (uploadAbort = new AbortController());
    try {
      say('正在检查文件…');
      await validateLibraryUpload(file, kind);
      if (disposed || abort.signal.aborted) return;
      progress.hidden = false;
      cancel.hidden = false;
      progress.value = 0;
      const item = await service.methods.uploadFile(file, {
        kind,
        signal: abort.signal,
        onProgress: (value) => {
          if (disposed) return;
          progress.value = value;
          say(value === 100 ? '正在保存文件…' : `上传中 ${value}%`);
        },
      });
      if (disposed) return;
      items.unshift(item);
      render();
      say(`“${item.name}”已保存到协作库。`);
    } catch (error) {
      say(error.name === 'AbortError' ? '上传请求已取消。' : error.message);
    } finally {
      uploadAbort = null;
      progress.hidden = true;
      cancel.hidden = true;
      musicInput.value = '';
      scriptInput.value = '';
      if (!disposed) setBusy(false);
    }
  }

  listen(toggle, 'click', () => {
    panel.hidden = false;
    panel.showModal?.();
    toggle.setAttribute('aria-expanded', 'true');
    if (!panel.hidden && !items.length) reload();
  });
  listen(close, 'click', () => {
    cancelSelection();
    panel.close?.();
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  });
  listen(panel, 'close', () => {
    cancelSelection();
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  });
  listen(panel, 'cancel', () => cancelSelection());
  listen(uploadMusic, 'click', () => musicInput.click());
  listen(uploadScript, 'click', () => scriptInput.click());
  listen(musicInput, 'change', () => upload(musicInput.files?.[0], 'music'));
  listen(scriptInput, 'change', () => upload(scriptInput.files?.[0], 'script'));
  listen(refresh, 'click', () => reload());
  listen(more, 'click', () => reload(true));
  listen(cancel, 'click', () => uploadAbort?.abort());
  return {
    reload,
    destroy() {
      if (disposed) return;
      disposed = true;
      cancelSelection();
      generation++;
      uploadAbort?.abort();
      requestAbort?.abort();
      ownedProvider?.dispose();
      for (const cleanup of cleanups) cleanup();
      panel.remove();
      toggle.remove();
    },
    getState() {
      return { busy, items: items.length, uploading: Boolean(uploadAbort), disposed };
    },
  };
}
