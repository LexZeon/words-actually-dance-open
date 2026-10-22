import { stringifyScriptDocument } from '../content/script-document.js';

/** Local-only persistence; all remote library services remain provider adapters. */
export class LocalRepository {
  constructor({ onError = () => {} } = {}) {
    this.onError = onError;
    this.pending = null;
    this.writes = new Set();
    this.lastWrite = Promise.resolve(true);
  }

  async load() {
    try {
      return window.desktop
        ? await window.desktop.loadState()
        : JSON.parse(localStorage.getItem('wad-experiment') || 'null');
    } catch {
      // Native I/O and JSON parser errors can contain original notes or paths.
      this.onError('本地文案或设置未能读取。');
      return null;
    }
  }

  save(payload) {
    this.pending = payload;
    // Send the current snapshot immediately; the native bridge serializes writes
    // and drains accepted saves before closing the application.
    return this.flush();
  }

  async flush() {
    if (this.pending) {
      const payload = this.pending;
      this.pending = null;
      // Invoke IPC immediately; native shutdown can drain every accepted snapshot.
      const write = this.writeSnapshot(payload);
      this.lastWrite = write;
      this.writes.add(write);
      const remove = () => this.writes.delete(write);
      write.then(remove, remove);
    }
    const latest = this.lastWrite;
    await Promise.all([...this.writes]);
    return latest;
  }

  async writeSnapshot(payload) {
    try {
      if (window.desktop) await window.desktop.saveState(payload);
      else localStorage.setItem('wad-experiment', JSON.stringify(payload));
      return true;
    } catch {
      this.onError('这次文案或设置未能保存。');
      return false;
    }
  }

  async download(topic) {
    const text = `${topic.title}\n\n${topic.lines.map((line) => line.text).join('\n\n')}\n\n— 字真的在跳动 / Words Actually Dance\n`;
    if (window.desktop) return (await window.desktop.exportText({ title: topic.title, text })).saved;
    return triggerBrowserDownload('\uFEFF' + text, 'text/plain;charset=utf-8', `${topic.title}.txt`);
  }

  async downloadScript(topic) {
    const text = stringifyScriptDocument(topic);
    if (window.desktop) return (await window.desktop.exportScript({ title: topic.title, text })).saved;
    return triggerBrowserDownload(text, 'application/json;charset=utf-8', `${topic.title}.wad.json`);
  }
}

/** Browser completion is unobservable; true means the download was initiated. */
function triggerBrowserDownload(text, type, filename) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
