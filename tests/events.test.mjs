import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../src/core/events.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('once remains exactly once when an earlier subscriber dispatches recursively', () => {
  const bus = createEventBus();
  let nested = false,
    calls = 0;
  bus.on('beat', () => {
    if (!nested) {
      nested = true;
      bus.emit('beat');
    }
  });
  bus.once('beat', () => calls++);
  bus.emit('beat');
  assert.equal(calls, 1);
});

test('unsubscribe and clear during dispatch stop remaining disposed subscribers', () => {
  for (const remove of ['unsubscribe', 'clear-type', 'clear-all']) {
    const bus = createEventBus();
    let calls = 0,
      stop;
    bus.on('frame', () => {
      if (remove === 'unsubscribe') stop();
      else if (remove === 'clear-type') bus.clear('frame');
      else bus.clear();
    });
    stop = bus.on('frame', () => calls++);
    assert.equal(bus.emit('frame'), 1);
    assert.equal(calls, 0);
  }
});

test('stale unsubscribe cannot remove a new registration of the same callback', () => {
  const bus = createEventBus();
  let calls = 0;
  const listener = () => calls++;
  const oldStop = bus.on('beat', listener);
  bus.off('beat', listener);
  const currentStop = bus.on('beat', listener);
  assert.equal(oldStop(), false);
  bus.emit('beat');
  assert.equal(calls, 1);
  assert.equal(currentStop(), true);
});

test('new subscribers wait for another event and duplicate callbacks retain single subscription semantics', () => {
  const bus = createEventBus();
  let calls = 0;
  const listener = () => calls++;
  bus.on('beat', () => bus.on('beat', listener));
  assert.equal(bus.emit('beat'), 1);
  assert.equal(calls, 0);
  bus.on('beat', listener);
  assert.equal(bus.emit('beat'), 2);
  assert.equal(calls, 1);
});

test('an explicit error boundary preserves errors and other hooks without reporting every frame', () => {
  const reports = [];
  const error = new Error('extension frame hook');
  const bus = createEventBus({ onError: (caught, context) => reports.push({ caught, context }) });
  let frames = 0;
  const broken = () => {
    throw error;
  };
  bus.on('frame', broken);
  bus.on('frame', () => frames++);
  for (let frame = 0; frame < 60; frame++) assert.equal(bus.emit('frame', frame), 2);
  assert.equal(frames, 60);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].caught, error);
  assert.equal(reports[0].context.type, 'frame');
  assert.equal(reports[0].context.listener, broken);
  bus.off('frame', broken);
  bus.on('frame', broken);
  bus.emit('frame');
  assert.equal(reports.length, 2, 'A new registration can report its own failure');
});

test('unhandled core hook failures remain fail-fast and the boundary can be explicitly removed', () => {
  const bus = createEventBus();
  const error = new Error('core bug');
  let other = 0;
  bus.on('beat', () => {
    throw error;
  });
  bus.on('beat', () => other++);
  assert.throws(
    () => bus.emit('beat'),
    (caught) => caught === error,
  );
  assert.equal(other, 0);
  bus.setErrorHandler(() => {});
  assert.equal(bus.emit('beat'), 2);
  assert.equal(other, 1);
  bus.setErrorHandler(null);
  assert.throws(
    () => bus.emit('beat'),
    (caught) => caught === error,
  );
  assert.throws(() => createEventBus({ onError: true }), TypeError);
});

test('async subscriber rejections enter the boundary once without changing synchronous emit counts', async () => {
  const reports = [],
    error = new Error('async extension hook');
  const bus = createEventBus({ onError: (caught, context) => reports.push({ caught, context }) });
  let other = 0;
  const broken = async () => {
    throw error;
  };
  bus.on('frame', broken);
  bus.on('frame', () => other++);
  for (let index = 0; index < 3; index++) assert.equal(bus.emit('frame', index), 2);
  assert.equal(reports.length, 0, 'emit remains synchronous');
  assert.equal(other, 3);
  await turn();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].caught, error);
  assert.equal(reports[0].context.type, 'frame');
  assert.equal(reports[0].context.listener, broken);
  assert.equal(reports[0].context.detail, 0);
});

test('unsubscribe and clear suppress late async failures without suppressing a replacement registration', async () => {
  for (const removal of ['unsubscribe', 'clear-type', 'clear-all']) {
    const reports = [],
      old = deferred(),
      current = deferred();
    let request = old;
    const bus = createEventBus({ onError: (error) => reports.push(error) });
    const listener = () => request.promise;
    const stop = bus.on('source', listener);
    assert.equal(bus.emit('source'), 1);
    if (removal === 'unsubscribe') stop();
    else if (removal === 'clear-type') bus.clear('source');
    else bus.clear();
    request = current;
    bus.on('source', listener);
    assert.equal(stop(), false, 'an old disposer cannot remove a replacement');
    const currentError = new Error('current source');
    bus.emit('source');
    old.reject(new Error('obsolete source'));
    current.reject(currentError);
    await turn();
    assert.deepEqual(reports, [currentError]);
  }
});

test('once retains error ownership for its actual async invocation while preventing recursive dispatch', async () => {
  const reports = [],
    gate = deferred(),
    error = new Error('once failed');
  const bus = createEventBus({ onError: (caught) => reports.push(caught) });
  let calls = 0;
  bus.once('loaded', async () => {
    calls++;
    assert.equal(bus.emit('loaded'), 0);
    await gate.promise;
    throw error;
  });
  assert.equal(bus.emit('loaded'), 1);
  assert.equal(bus.emit('loaded'), 0);
  gate.resolve();
  await turn();
  assert.equal(calls, 1);
  assert.deepEqual(reports, [error]);
});

test('explicit disposal or clear cancels error ownership of a pending once invocation', async () => {
  for (const removal of ['unsubscribe', 'clear-type', 'clear-all']) {
    const reports = [],
      pending = deferred();
    const bus = createEventBus({ onError: (error) => reports.push(error) });
    const stop = bus.once('loaded', () => pending.promise);
    bus.emit('loaded');
    if (removal === 'unsubscribe') assert.equal(stop(), true);
    else if (removal === 'clear-type') bus.clear('loaded');
    else bus.clear();
    assert.equal(stop(), false);
    pending.reject(new Error('disposed once'));
    await turn();
    assert.deepEqual(reports, []);
  }
});

test('async failures without a boundary are consumed and logged once while synchronous failures still throw', async () => {
  const original = console.error,
    logs = [],
    error = new Error('unconfigured async hook');
  console.error = (...args) => logs.push(args);
  try {
    const bus = createEventBus();
    bus.on('frame', async () => {
      throw error;
    });
    assert.equal(bus.emit('frame'), 1);
    assert.equal(bus.emit('frame'), 1);
    await turn();
    assert.equal(logs.length, 1);
    assert.equal(logs[0][1], error);
    bus.on('sync', () => {
      throw error;
    });
    assert.throws(
      () => bus.emit('sync'),
      (caught) => caught === error,
    );
  } finally {
    console.error = original;
  }
});

test('a rejecting async error reporter is consumed without recursively reporting or stopping other hooks', async () => {
  const original = console.error,
    logs = [],
    hookError = new Error('hook'),
    reporterError = new Error('reporter');
  console.error = (...args) => logs.push(args);
  try {
    let reports = 0,
      other = 0;
    const bus = createEventBus({
      onError: async () => {
        reports++;
        throw reporterError;
      },
    });
    bus.on('frame', async () => {
      throw hookError;
    });
    bus.on('frame', () => other++);
    assert.equal(bus.emit('frame'), 2);
    assert.equal(bus.emit('frame'), 2);
    await turn();
    assert.equal(reports, 1);
    assert.equal(other, 2);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][1], reporterError);
  } finally {
    console.error = original;
  }
});

test('an old handler release cannot clear a replacement and current release returns to the default boundary', () => {
  const bus = createEventBus(),
    error = new Error('owned handler'),
    reports = [];
  const releaseOld = bus.setErrorHandler(() => reports.push('old'));
  const releaseCurrent = bus.setErrorHandler(() => reports.push('current'));
  assert.equal(releaseOld(), false);
  bus.on('beat', () => {
    throw error;
  });
  assert.equal(bus.emit('beat'), 1);
  assert.deepEqual(reports, ['current']);
  assert.equal(releaseCurrent(), true);
  assert.equal(releaseCurrent(), false);
  assert.throws(
    () => bus.emit('beat'),
    (caught) => caught === error,
  );
  assert.deepEqual(reports, ['current'], 'releasing a handler never resurrects an old owner');
});

test('foreign thenables are consumed once even if they try to reject multiple times', async () => {
  const reports = [],
    error = new Error('foreign provider');
  const bus = createEventBus({ onError: (caught) => reports.push(caught) });
  bus.on('provider', () => ({
    then(resolve, reject) {
      reject(error);
      reject(new Error('duplicate'));
      resolve();
    },
  }));
  assert.equal(bus.emit('provider'), 1);
  await turn();
  assert.deepEqual(reports, [error]);
});

test('a throwing reporter is isolated once so subsequent synchronous hooks continue', () => {
  const original = console.error,
    logs = [],
    error = new Error('reporter failed');
  console.error = (...args) => logs.push(args);
  try {
    let others = 0;
    const bus = createEventBus({
      onError: () => {
        throw error;
      },
    });
    bus.on('frame', () => {
      throw new Error('hook failed');
    });
    bus.on('frame', () => others++);
    assert.equal(bus.emit('frame'), 2);
    assert.equal(bus.emit('frame'), 2);
    assert.equal(others, 2);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][1], error);
  } finally {
    console.error = original;
  }
});

test('disposed async subscribers do not log default-boundary errors after teardown', async () => {
  const original = console.error,
    logs = [],
    pending = deferred();
  console.error = (...args) => logs.push(args);
  try {
    const bus = createEventBus();
    const stop = bus.on('source', () => pending.promise);
    bus.emit('source');
    stop();
    pending.reject(new Error('closed provider'));
    await turn();
    assert.deepEqual(logs, []);
  } finally {
    console.error = original;
  }
});
