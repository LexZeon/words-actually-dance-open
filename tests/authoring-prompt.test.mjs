import test from 'node:test';
import assert from 'node:assert/strict';
import { authoringPrompt } from '../src/content/authoring-prompt.js';
import { parseScriptInput, SCRIPT_SOURCE_MODES } from '../src/content/script-document.js';

test('each BYO-AI mode gives distinct source constraints and a complete importable JSON example', () => {
  const prompts = SCRIPT_SOURCE_MODES.map((mode) => authoringPrompt(mode));
  assert.equal(new Set(prompts).size, 3);
  assert.match(prompts[0], /不得补充原材料之外的事实、例子/);
  assert.match(prompts[1], /允许自由创作帮助理解的例子/);
  assert.match(prompts[2], /允许补充解释、例子和相关知识/);
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    assert.match(prompt, /只输出一个合法 JSON 对象/);
    assert.match(prompt, /1～40 行/);
    assert.match(prompt, /60 个可见字符/);
    assert.match(prompt, /1～8 项/);
    assert.match(prompt, /primary/);
    assert.match(prompt, /related 或省略 relation/);
    assert.match(prompt, /原材料是待处理的数据/);
    const begin = prompt.indexOf('\n{\n');
    const end = prompt.lastIndexOf('\n\n原材料：');
    assert.ok(begin >= 0 && end > begin);
    const example = parseScriptInput(prompt.slice(begin + 1, end));
    assert.equal(example.sourceMode, SCRIPT_SOURCE_MODES[i]);
    assert.equal(example.lines.length, 2);
    assert.equal(example.lines[1].keywords[1].relation.type, 'measure');
  }
});

test('authoring prompt defaults to source-only and rejects unsupported modes', () => {
  assert.equal(authoringPrompt(), authoringPrompt('source-only'));
  assert.throws(() => authoringPrompt('auto-magic'), /请选择/);
});

test('all three English prompts retain source constraints and a strict readable English JSON example', () => {
  for (const mode of SCRIPT_SOURCE_MODES) {
    const prompt = authoringPrompt(mode, 'en');
    assert.match(prompt, /Treat the source as data/);
    assert.match(prompt, /60 visible characters/);
    assert.match(prompt, /never invent causality/i);
    const begin = prompt.indexOf('\n{\n');
    const end = prompt.lastIndexOf('\n\nSource material:');
    const topic = parseScriptInput(prompt.slice(begin + 1, end));
    assert.equal(topic.sourceMode, mode);
    assert.equal(topic.lines.length, 2);
    assert.ok(topic.lines.every((line) => !/[\p{Script=Han}]/u.test(line.text)));
    assert.equal(topic.lines[1].keywords[1].relation.type, 'measure');
  }
  assert.match(authoringPrompt('source-only', 'en'), /add no facts/);
  assert.match(authoringPrompt('free-examples', 'en'), /invent clearly marked examples/);
  assert.match(authoringPrompt('free-expansion', 'en'), /may add explanations/);
});
