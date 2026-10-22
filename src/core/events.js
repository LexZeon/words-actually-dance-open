/**
 * Small, dependency-free event bus shared by the player and future providers.
 * Events stay in memory. Publishing an event never writes or uploads a metric.
 */
export function createEventBus({ onError = null } = {}) {
  const listeners = new Map();
  // Once subscriptions retire before invoking the callback, but that actual
  // invocation retains error ownership until its Promise settles. Explicit
  // disposal or clear() can still cancel a late report while it is pending.
  const pendingOnce = new Set();
  let errorHandler, handlerOwner;

  function setErrorHandler(handler = null) {
    if (handler !== null && typeof handler !== 'function')
      throw new TypeError('Event error handler must be a function or null.');
    const owner = {};
    handlerOwner = owner;
    errorHandler = handler;
    // Release only this installation; never clear a replacement or resurrect
    // an earlier handler whose owner may already have been destroyed.
    return () => {
      if (handlerOwner !== owner) return false;
      handlerOwner = null;
      errorHandler = null;
      return true;
    };
  }
  setErrorHandler(onError);

  function removeEntry(entry, dispose = true) {
    const subscribers = listeners.get(entry.type);
    const current = subscribers?.get(entry.key) === entry;
    if (dispose && (entry.disposed || (!current && !pendingOnce.has(entry)))) return false;
    entry.active = false;
    if (dispose) {
      entry.disposed = true;
      pendingOnce.delete(entry);
    }
    if (current) {
      subscribers.delete(entry.key);
      if (subscribers.size === 0) listeners.delete(entry.type);
    }
    return true;
  }

  function off(type, listener) {
    const entry = listeners.get(type)?.get(listener);
    return entry ? removeEntry(entry) : false;
  }

  function subscribe(type, listener, once = false) {
    if (typeof type !== 'string' || !type) throw new TypeError('Event name must be a non-empty string.');
    if (typeof listener !== 'function') throw new TypeError('Event listener must be a function.');
    if (!listeners.has(type)) listeners.set(type, new Map());
    const subscribers = listeners.get(type);
    const key = once ? Symbol(type) : listener;
    if (!subscribers.has(key))
      subscribers.set(key, {
        key,
        type,
        listener,
        once,
        active: true,
        disposed: false,
        errorReported: false,
      });
    const entry = subscribers.get(key);
    // An old owner must not unsubscribe a replacement registration of the same callback.
    return () => removeEntry(entry);
  }

  function on(type, listener) {
    return subscribe(type, listener);
  }

  function once(type, listener) {
    return subscribe(type, listener, true);
  }

  function logFailure(message, error, context) {
    // A broken reporter/console must not produce a second unhandled rejection.
    try {
      console.error(message, error, context);
    } catch {}
  }

  function isThenable(value) {
    return (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof value.then === 'function'
    );
  }

  function reportFailure(error, entry, context, asynchronous = false) {
    // Synchronous core failures stay fail-fast even if a previous frame was
    // already reported under a now-released explicit boundary.
    if (!asynchronous && !errorHandler) throw error;
    if ((asynchronous && entry.disposed) || entry.errorReported) return;
    entry.errorReported = true;
    if (!errorHandler) {
      logFailure('Unhandled async event subscriber error', error, context);
      return;
    }
    try {
      const result = errorHandler(error, context);
      if (isThenable(result))
        Promise.resolve(result).catch((failure) => {
          if (!entry.disposed) logFailure('Event error reporter failed', failure, context);
        });
    } catch (failure) {
      logFailure('Event error reporter failed', failure, context);
    }
  }

  function emit(type, detail) {
    // Snapshot the listeners so additions during dispatch wait for the next event.
    const subscribers = [...(listeners.get(type)?.values() ?? [])];
    let called = 0;
    for (const entry of subscribers) {
      if (!entry.active) continue;
      called++;
      const context = { type, listener: entry.listener, detail };
      let pending = false;
      if (entry.once) {
        pendingOnce.add(entry);
        removeEntry(entry, false);
      }
      try {
        const result = entry.listener(detail, type);
        if (isThenable(result)) {
          pending = true;
          Promise.resolve(result).then(
            () => pendingOnce.delete(entry),
            (error) => {
              reportFailure(error, entry, context, true);
              pendingOnce.delete(entry);
            },
          );
        }
      } catch (error) {
        reportFailure(error, entry, context);
      } finally {
        if (!pending) pendingOnce.delete(entry);
      }
    }
    return called;
  }

  function clear(type) {
    const groups = type === undefined ? [...listeners.values()] : [listeners.get(type)];
    for (const group of groups)
      if (group)
        for (const entry of group.values()) {
          entry.active = false;
          entry.disposed = true;
        }
    for (const entry of pendingOnce)
      if (type === undefined || entry.type === type) {
        entry.disposed = true;
        pendingOnce.delete(entry);
      }
    if (type === undefined) listeners.clear();
    else listeners.delete(type);
  }

  return Object.freeze({ on, once, off, emit, clear, setErrorHandler });
}

export const EVENTS = Object.freeze({
  AUDIO_SOURCE_CHANGED: 'audio:source-changed',
  AUDIO_FRAME: 'audio:frame',
  BEAT: 'audio:beat',
  DRUM_HIT: 'audio:drum-hit',
  BEAT_GRID: 'timeline:beat-grid',
  TIMELINE_PAUSED: 'timeline:paused',
  TIMELINE_GATE: 'timeline:gate',
  PLAYBACK_CHANGED: 'playback:changed',
  CONTENT_LOADED: 'content:loaded',
  CONTENT_COMPLETE: 'content:complete',
  LINE_ENTER: 'content:line-enter',
  KEYWORD_ENTER: 'content:keyword-enter',
  KEYWORD_TRANSITION: 'content:keyword-transition',
  LIKE_CHANGED: 'library:like-changed',
  DOWNLOAD: 'library:download',
  COLLABORATION_FILES_CHANGED: 'collaboration-library:files-changed',
  COLLABORATION_FILE_DOWNLOADED: 'collaboration-library:file-downloaded',
  INTERACTION: 'interaction',
  PREFERENCE_CHANGED: 'preference:changed',
  PROVIDER_CHANGED: 'provider:changed',
});

export const eventBus = createEventBus();
export default eventBus;
