import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTextScript } from '../src/content/text-script.js';
test('local input preserves user text, including emoji and literal markup', () => {
  const script = parseTextScript(
    '节拍｜节拍是时间参照。\n🧠｜用自己的话解释。\nHTML｜<script>alert(1)</script>',
    '测试',
  );
  assert.equal(script.lines[0].text, '节拍是时间参照。');
  assert.equal(script.lines[1].keyword, '🧠');
  assert.ok(script.lines[2].text.includes('<script>'));
  assert.ok(script.lines.every((line) => line.text.includes(line.keyword)));
});
test('empty, incomplete and excessive input is rejected with a readable message', () => {
  assert.throws(() => parseTextScript(' '), /放入/);
  assert.throws(() => parseTextScript('节拍｜'), /讲解/);
  assert.throws(() => parseTextScript(Array(41).fill('节拍｜音乐').join('\n')), /40/);
});
