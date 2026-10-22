import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeScriptFile,
  MAX_SCRIPT_FILE_BYTES,
  scriptTitleFromFilename,
} from '../src/content/script-file.js';

const utf8 = (text) => new TextEncoder().encode(text);
function utf16(text, littleEndian) {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
  const view = new DataView(bytes.buffer);
  for (let position = 0; position < text.length; position++)
    view.setUint16(2 + position * 2, text.charCodeAt(position), littleEndian);
  return bytes;
}

test('UTF-8 text and a UTF-8 BOM preserve Chinese, emoji and literal JSON markup', () => {
  const text = '知识👩‍💻\r\n{"text":"<script>文字</script>"}\n';
  const bytes = utf8(text);
  assert.equal(decodeScriptFile(bytes.buffer), text);
  const bom = new Uint8Array(bytes.length + 3);
  bom.set([0xef, 0xbb, 0xbf]);
  bom.set(bytes, 3);
  assert.equal(decodeScriptFile(bom), text);
  assert.equal(
    decodeScriptFile(utf8('开头\uFEFF中间')),
    '开头\uFEFF中间',
    'Only an encoding BOM may be stripped',
  );
});

test('UTF-16 BOMs preserve both byte orders and complete surrogate pairs', () => {
  const text = '知识👩🏽‍💻，连接\r\n说明。';
  assert.equal(decodeScriptFile(utf16(text, true)), text);
  assert.equal(decodeScriptFile(utf16(text, false)), text);
});

test('typed views decode exactly their byte offset and length without surrounding corrupt bytes', () => {
  const text = '保留👨‍👩‍👧‍👦与文字';
  const encoded = utf8(text);
  const buffer = new Uint8Array(encoded.length + 4);
  buffer.set([0xff, 0xff]);
  buffer.set(encoded, 2);
  buffer.set([0xc0, 0xaf], 2 + encoded.length);
  assert.equal(decodeScriptFile(new Uint8Array(buffer.buffer, 2, encoded.length)), text);
  assert.equal(decodeScriptFile(new DataView(buffer.buffer, 2, encoded.length)), text);
  assert.throws(() => decodeScriptFile(buffer.buffer), /编码/);
});

test('corrupt UTF-8 and incomplete UTF-16 fail instead of silently replacing knowledge characters', () => {
  for (const bytes of [
    [0xff],
    [0xe4, 0xb8],
    [0xc0, 0xaf],
    [0xff, 0xfe, 0x61],
    [0xfe, 0xff, 0],
    [0xff, 0xfe, 0, 0xd8],
  ]) {
    assert.throws(() => decodeScriptFile(new Uint8Array(bytes)), /编码/);
  }
});

test('real UTF-32 BOMs are rejected instead of becoming UTF-16 text with invisible NULs', () => {
  const text = '知识👩‍💻';
  for (const littleEndian of [true, false]) {
    const points = Array.from(text, (character) => character.codePointAt(0));
    const bytes = new Uint8Array(4 + points.length * 4);
    bytes.set(littleEndian ? [0xff, 0xfe, 0, 0] : [0, 0, 0xfe, 0xff]);
    const view = new DataView(bytes.buffer);
    points.forEach((point, index) => view.setUint32(4 + index * 4, point, littleEndian));
    assert.throws(() => decodeScriptFile(bytes), /UTF-32/);
  }
});

test('file limits count bytes in the chosen view and reject empty or non-binary input', () => {
  assert.equal(
    decodeScriptFile(new Uint8Array(MAX_SCRIPT_FILE_BYTES).fill(65)).length,
    MAX_SCRIPT_FILE_BYTES,
  );
  assert.throws(() => decodeScriptFile(new Uint8Array(MAX_SCRIPT_FILE_BYTES + 1)), /512 KB/);
  const backing = new Uint8Array(MAX_SCRIPT_FILE_BYTES + 4).fill(65);
  assert.equal(decodeScriptFile(backing.subarray(2, 4)), 'AA');
  assert.throws(() => decodeScriptFile(new ArrayBuffer(0)), /空/);
  for (const invalid of [null, {}, '知识']) assert.throws(() => decodeScriptFile(invalid), /无法读取/);
});

test('titles remove only known file suffixes and preserve meaningful punctuation', () => {
  assert.equal(scriptTitleFromFilename('知识.wad.json'), '知识');
  assert.equal(scriptTitleFromFilename('知识.WAD.JSON'), '知识');
  assert.equal(scriptTitleFromFilename('笔记.txt'), '笔记');
  assert.equal(scriptTitleFromFilename('1.2.3.json'), '1.2.3');
  assert.equal(scriptTitleFromFilename('资料.data.json'), '资料.data');
  assert.equal(scriptTitleFromFilename('.json'), '我的知识');
  assert.equal(scriptTitleFromFilename(''), '我的知识');
});
