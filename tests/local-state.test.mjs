import test from 'node:test';
import assert from 'node:assert/strict';
import {
  restoreContentSelection,
  restoreCustomScript,
  formatEditableScript,
} from '../src/core/local-state.js';
import { parseTextScript } from '../src/content/text-script.js';

test('a saved custom topic remains selected after restarting, with editable content', () => {
  const original = parseTextScript('节拍｜节拍，是音乐的时间参照。\n专注｜专注需要明确目标。', '自己的笔记');
  const disk = JSON.parse(JSON.stringify({ topicIndex: -1, custom: original }));
  const restored = restoreContentSelection(disk, 6);
  assert.equal(restored.topicIndex, -1);
  assert.equal(restored.custom.title, '自己的笔记');
  const editedAgain = parseTextScript(formatEditableScript(restored.custom), restored.custom.title);
  assert.deepEqual(editedAgain.lines, original.lines);
});

test('switching to a sample does not discard an existing editable custom topic', () => {
  const custom = parseTextScript('共振｜共振可能放大振动。', '保存的材料');
  const restored = restoreContentSelection({ topicIndex: 3, custom }, 6);
  assert.equal(restored.topicIndex, 3);
  assert.equal(restored.custom.title, '保存的材料');
  assert.equal(restoreContentSelection({ topicIndex: 999, custom }, 6).topicIndex, 0);
});

test('malformed saved scripts cannot become active or create unbounded rendering work', () => {
  const badScripts = [
    null,
    { lines: [] },
    { lines: { every: true } },
    { lines: [{ text: '一行内容', keyword: '缺失' }] },
    { lines: [{ text: '关键词\n第二行', keyword: '关键词' }] },
    { lines: [{ text: '词'.repeat(13_000), keyword: '词' }] },
    { lines: Array.from({ length: 41 }, () => ({ text: '词', keyword: '词' })) },
  ];
  for (const custom of badScripts) {
    assert.equal(restoreCustomScript(custom), null);
    assert.deepEqual(restoreContentSelection({ topicIndex: -1, custom }, 6), { custom: null, topicIndex: 0 });
  }
});

test('malformed optional keyword metadata cannot prevent restoring a valid local script', () => {
  const topic = {
    title: '恢复测试',
    lines: [{ text: '节奏连接声音。', keyword: '节奏', keywords: { corrupt: true } }],
  };
  assert.equal(restoreCustomScript(topic).lines[0].text, topic.lines[0].text);
});
