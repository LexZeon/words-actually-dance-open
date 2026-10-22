import test from 'node:test';
import assert from 'node:assert/strict';
import { learningLibrary } from '../src/content/learning-library.js';
import { parseScriptInput, serializeScriptDocument } from '../src/content/script-document.js';
import { formatEditableScript } from '../src/core/local-state.js';

test('learning examples export and reimport through the real authoring contract without repairing text', () => {
  const ids = new Set();
  for (const topic of learningLibrary) {
    assert.ok(!ids.has(topic.id), 'sample identity must be unique');
    ids.add(topic.id);
    const document = serializeScriptDocument(topic);
    const restored = parseScriptInput(formatEditableScript({ ...topic, ...document }));
    assert.equal(restored.title, topic.title);
    assert.deepEqual(
      restored.lines.map((line) => line.text),
      topic.lines.map((line) => line.text),
    );
    assert.deepEqual(
      restored.lines.map((line) => line.keyword),
      topic.lines.map((line) => line.keyword),
    );
    assert.deepEqual(
      restored.lines.map((line) => line.holdBeats),
      topic.lines.map((line) => line.holdBeats),
    );
    for (const [index, line] of restored.lines.entries()) {
      assert.equal(line.keywords.filter((term) => term.role === 'primary').length, 1);
      assert.ok(line.keywords.length >= 2, 'examples should retain concepts for character transitions');
      assert.deepEqual(
        line.keywords.map((term) => term.text),
        topic.lines[index].keywords.map((term) => term.text),
      );
      for (const term of line.keywords) assert.ok(line.text.includes(term.text));
    }
  }
});
