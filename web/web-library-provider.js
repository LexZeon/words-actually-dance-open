import { parseScriptInput } from '../src/content/script-document.js';
import {
  decodeScriptFile,
  scriptTitleFromFilename,
  MAX_SCRIPT_FILE_BYTES,
} from '../src/content/script-file.js';
import { EVENTS } from '../src/core/events.js';

export const WEB_LIBRARY_MUSIC_LIMIT = 64 * 1024 * 1024;
export const WEB_LIBRARY_MUSIC_ACCEPT = '.mp3,.wav,.ogg,.opus,.flac,.m4a,.aac,.aif,.aiff,.webm';
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const aborted = () => new DOMException('协作库请求已取消。', 'AbortError');

async function responseValue(response) {
  if ((response.headers.get('content-type') || '').includes('application/json')) return response.json();
  return { error: '无法连接协作库，请登录或稍后重试。' };
}

export async function validateLibraryUpload(file, kind) {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('请选择非空文件。');
  if (
    typeof file.name !== 'string' ||
    !file.name ||
    file.name.length > 180 ||
    /[\x00-\x1f/\\]/u.test(file.name)
  )
    throw new Error('文件名不正确或过长。');
  if (kind === 'music') {
    if (file.size > WEB_LIBRARY_MUSIC_LIMIT) throw new Error('请选择 64 MB 以内的音乐。');
    if (!WEB_LIBRARY_MUSIC_ACCEPT.split(',').some((extension) => file.name.toLowerCase().endsWith(extension)))
      throw new Error('此音乐格式暂不支持。');
    return;
  }
  if (kind !== 'script' || !/\.(?:txt|json)$/iu.test(file.name)) throw new Error('文案支持 TXT 或 JSON。');
  if (file.size > MAX_SCRIPT_FILE_BYTES) throw new Error('请选择 512 KB 以内的文案。');
  parseScriptInput(decodeScriptFile(await file.arrayBuffer()), scriptTitleFromFilename(file.name));
}

/** One transport request. 100% is not a successful server commit. */
export function uploadLibraryFile(
  file,
  kind,
  { onProgress = () => {}, signal, XMLHttpRequestClass = globalThis.XMLHttpRequest } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    if (typeof XMLHttpRequestClass !== 'function') {
      reject(new Error('此浏览器暂不支持上传。'));
      return;
    }
    const xhr = new XMLHttpRequestClass();
    const abort = () => xhr.abort();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    try {
      xhr.open('POST', `/api/library?kind=${encodeURIComponent(kind)}`);
      xhr.withCredentials = true;
      xhr.timeout = 180000;
      xhr.setRequestHeader('x-wad-library-request', '1');
      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
      xhr.setRequestHeader('x-file-size', String(file.size));
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      xhr.upload.onprogress = (event) => {
        if (!settled && event.lengthComputable)
          onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      };
      xhr.onload = () => {
        let result;
        try {
          result = JSON.parse(xhr.responseText);
        } catch {
          finish(reject, new Error('协作库返回了无法读取的结果，请重新登录或重试。'));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300 || !result.item?.id)
          finish(reject, new Error(result.error || '文件未保存，请重试。'));
        else finish(resolve, result.item);
      };
      xhr.onerror = () => finish(reject, new Error('上传连接中断，请重试。'));
      xhr.ontimeout = () => finish(reject, new Error('上传超时，请检查网络后重试。'));
      xhr.onabort = () => finish(reject, aborted());
      signal?.addEventListener('abort', abort, { once: true });
      xhr.send(file);
    } catch (error) {
      finish(reject, error);
    }
  });
}

function validateItem(item) {
  const maximum = item?.kind === 'music' ? WEB_LIBRARY_MUSIC_LIMIT : MAX_SCRIPT_FILE_BYTES;
  if (
    !item ||
    !uuidPattern.test(item.id) ||
    !['music', 'script'].includes(item.kind) ||
    typeof item.name !== 'string' ||
    !item.name ||
    item.name.length > 180 ||
    /[\x00-\x1f/\\]/u.test(item.name) ||
    !Number.isSafeInteger(item.size) ||
    item.size < 1 ||
    item.size > maximum
  )
    throw new Error('协作库返回了无法读取的文件资料，请重试。');
  return item;
}

async function downloadBounded(response, item, signal) {
  const rejectBody = async (message) => {
    await response.body?.cancel().catch(() => {});
    throw new Error(message);
  };
  if ((response.headers.get('content-type') || '').includes('text/html'))
    return rejectBody('无法连接协作库，请登录或稍后重试。');
  const declared = response.headers.get('content-length');
  const encoding = response.headers.get('content-encoding');
  // Fetch exposes decoded bytes, while a proxy may describe compressed wire
  // length. The actual decoded stream is always bounded against stored size.
  if ((!encoding || encoding === 'identity') && declared !== null && Number(declared) !== item.size)
    return rejectBody('文件长度不一致，请重新读取。');
  if (!response.body) throw new Error('文件内容为空。');
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel(aborted()).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw aborted();
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw aborted();
      if (done) break;
      size += value.byteLength;
      if (size > item.size) throw new Error('文件超过声明的长度，请重新读取。');
      parts.push(value);
    }
    if (size !== item.size) throw new Error('文件未完整读取，请重试。');
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const file = new File(parts, item.name, { type: item.type || '' });
  await validateLibraryUpload(file, item.kind);
  return file;
}

/** Actual same-origin file service. It deliberately has no formal account,
 * likes, recommendation, cross-device sync or knowledge-library save methods. */
export function createWebLibraryProvider({
  fetchImpl = globalThis.fetch,
  XMLHttpRequestClass = globalThis.XMLHttpRequest,
  eventBus,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('协作库需要实际网络读取接口。');
  let disposed = false;
  const operations = new Set();
  async function operate(signal, action) {
    if (disposed || signal?.aborted) throw aborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    operations.add(controller);
    try {
      const result = await action(controller.signal);
      if (disposed || controller.signal.aborted) throw aborted();
      return result;
    } finally {
      signal?.removeEventListener('abort', abort);
      operations.delete(controller);
    }
  }
  async function request(url, signal, options = {}) {
    const response = await fetchImpl(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      signal,
    });
    const value = await responseValue(response);
    if (!response.ok || value.error) throw new Error(value.error || '协作库操作未完成。');
    return value;
  }
  const methods = {
    listFiles({ cursor = null, signal } = {}) {
      return operate(signal, async (ownedSignal) => {
        const value = await request(
          `/api/library${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`,
          ownedSignal,
        );
        if (!Array.isArray(value.items) || value.items.length > 100)
          throw new Error('协作库返回了无法读取的文件列表，请重试。');
        value.items.forEach(validateItem);
        return value;
      });
    },
    uploadFile(file, { kind, onProgress, signal } = {}) {
      return operate(signal, async (ownedSignal) => {
        await validateLibraryUpload(file, kind);
        if (ownedSignal.aborted) throw aborted();
        const item = validateItem(
          await uploadLibraryFile(file, kind, { onProgress, signal: ownedSignal, XMLHttpRequestClass }),
        );
        if (item.kind !== kind || item.name !== file.name || item.size !== file.size)
          throw new Error('服务端未确认完整保存此文件，请刷新后重试。');
        if (ownedSignal.aborted || disposed) throw aborted();
        eventBus?.emit(EVENTS.COLLABORATION_FILES_CHANGED, {
          reason: 'upload',
          id: item.id,
          kind: item.kind,
          size: item.size,
        });
        return item;
      });
    },
    downloadFile(item, { signal } = {}) {
      return operate(signal, async (ownedSignal) => {
        validateItem(item);
        const response = await fetchImpl(`/api/library/${item.id}/file`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: ownedSignal,
        });
        if (!response.ok) throw new Error((await responseValue(response)).error || '文件读取失败。');
        const file = await downloadBounded(response, item, ownedSignal);
        if (ownedSignal.aborted || disposed) throw aborted();
        eventBus?.emit(EVENTS.COLLABORATION_FILE_DOWNLOADED, {
          id: item.id,
          kind: item.kind,
          size: file.size,
        });
        return file;
      });
    },
    removeFile(id, { signal } = {}) {
      return operate(signal, async (ownedSignal) => {
        if (!uuidPattern.test(id)) throw new Error('文件标识不正确。');
        const result = await request(`/api/library/${id}`, ownedSignal, {
          method: 'DELETE',
          headers: { 'x-wad-library-request': '1' },
        });
        if (result.deleted !== id) throw new Error('文件未确认删除，请刷新后重试。');
        if (ownedSignal.aborted || disposed) throw aborted();
        eventBus?.emit(EVENTS.COLLABORATION_FILES_CHANGED, { reason: 'remove', id });
        return result;
      });
    },
  };
  return {
    id: 'private-site-collaboration-files',
    kind: 'library',
    title: '临时协作库',
    methods,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const operation of operations) operation.abort();
      operations.clear();
    },
  };
}

/** Registration ownership is explicit; an old cleanup cannot remove a replacement. */
export function registerWebLibraryProvider({ registry, eventBus, ...options }) {
  if (!registry?.register || !registry?.get || !registry?.unregister)
    throw new TypeError('协作库需要实际提供者注册表。');
  const implementation = createWebLibraryProvider({ ...options, eventBus });
  let provider;
  try {
    provider = registry.register(implementation);
    eventBus?.emit(EVENTS.PROVIDER_CHANGED, {
      id: provider.id,
      kind: provider.kind,
      action: 'registered',
      capabilities: provider.capabilities,
    });
  } catch (error) {
    if (provider && registry.get(provider.id) === provider) registry.unregister(provider.id);
    implementation.dispose();
    throw error;
  }
  let released = false;
  return {
    provider,
    dispose() {
      if (released) return false;
      released = true;
      implementation.dispose();
      if (registry.get(provider.id) !== provider) return false;
      registry.unregister(provider.id);
      eventBus?.emit(EVENTS.PROVIDER_CHANGED, {
        id: provider.id,
        kind: provider.kind,
        action: 'unregistered',
      });
      return true;
    },
  };
}
