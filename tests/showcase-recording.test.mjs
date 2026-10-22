import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOWCASE_SCRIPTS,
  SHOWCASE_ENGLISH_SCRIPT,
  installShowcaseRecording,
} from '../src/dev/showcase-recording.js';
import { parseScriptInput } from '../src/content/script-document.js';
test('original recording scripts pass the real importer with literal keyword ranges', () => {
  for (const [title, text] of [...Object.values(SHOWCASE_SCRIPTS), SHOWCASE_ENGLISH_SCRIPT]) {
    const topic = parseScriptInput(text, title);
    assert.equal(topic.title, title);
    assert.equal(topic.lines.length, 3);
    for (const line of topic.lines) assert.ok(line.text.includes(line.keyword));
  }
});
test('recording hooks never install in a production app', () => {
  const app = { window: { desktop: { testMode: false } } };
  assert.equal(installShowcaseRecording(app), false);
  assert.equal(app.window.__wadRecordShowcase, undefined);
});
