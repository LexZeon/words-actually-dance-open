import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScriptInput,
  serializeScriptDocument,
  stringifyScriptDocument,
  SCRIPT_INPUT_LIMIT,
} from '../src/content/script-document.js';
import { sampleLibrary } from '../src/content/sample-library.js';
import { parseTextScript } from '../src/content/text-script.js';
import {
  formatEditableScript,
  restoreCustomScript,
  restoreContentSelection,
} from '../src/core/local-state.js';

function fixture() {
  return {
    schemaVersion: 1,
    title: '注意力与目标',
    sourceMode: 'source-only',
    lines: [
      {
        text: '目标给注意力一个落点。',
        keyword: '注意力',
        keywords: [
          { text: '目标', role: 'secondary' },
          {
            text: '注意力',
            role: 'primary',
            relation: { from: '目标', to: '注意力', type: 'direction', label: '有一个落点' },
          },
        ],
        sentenceType: 'definition',
        holdBeats: 12,
      },
      {
        text: '切换任务后，需要恢复注意力。',
        keyword: '切换',
        keywords: [
          {
            text: '切换',
            role: 'primary',
            relation: { from: '目标', to: '切换', type: 'related', label: '材料中的两个概念' },
          },
          { text: '注意力', role: 'secondary' },
        ],
        sentenceType: 'fact',
      },
    ],
  };
}

test('standard JSON normalizes literal lines with an explicit primary independently of entry order', () => {
  const input = fixture();
  const topic = parseScriptInput(JSON.stringify(input), 'ignored fallback');
  assert.equal(topic.id, 'custom');
  assert.equal(topic.title, input.title);
  assert.equal(topic.schemaVersion, 1);
  assert.equal(topic.sourceMode, 'source-only');
  assert.equal(topic.keyword, '注意力');
  assert.equal(topic.lines[0].id, 'custom-0');
  assert.equal(topic.lines[1].id, 'custom-1');
  assert.equal(topic.lines[0].text, input.lines[0].text);
  assert.equal(topic.lines[0].keywords[0].role, 'secondary');
  assert.equal(topic.lines[0].keywords[1].role, 'primary');
  assert.equal(topic.lines[0].sentenceType, 'definition');
  assert.equal(topic.lines[0].holdBeats, 12);
  assert.equal(topic.lines[1].holdBeats, 8);
  assert.equal(topic.relations.length, 2);
});

test('document serialize, editing and disk restoration preserve sentence types and authored relationships', () => {
  const topic = parseScriptInput(fixture());
  topic.lines[0].runtimeSecret = 'do not export';
  topic.animationState = { cursor: 42 };
  const document = serializeScriptDocument(topic);
  assert.deepEqual(Object.keys(document), ['schemaVersion', 'title', 'sourceMode', 'lines']);
  assert.equal(document.lines[0].id, undefined);
  assert.equal(document.lines[0].runtimeSecret, undefined);
  assert.equal(document.animationState, undefined);
  assert.equal(document.lines[0].holdBeats, 12);
  assert.equal(document.lines[1].holdBeats, undefined);
  const reloaded = parseScriptInput(JSON.stringify(document));
  assert.equal(reloaded.lines[0].runtimeSecret, undefined);
  assert.deepEqual(
    reloaded.lines,
    topic.lines.map(({ runtimeSecret, ...line }) => line),
  );
  const editable = formatEditableScript(topic);
  assert.ok(editable.startsWith('{'));
  assert.deepEqual(parseScriptInput(editable).lines, reloaded.lines);
  const savedTopic = JSON.parse(JSON.stringify(reloaded));
  assert.deepEqual(restoreCustomScript(savedTopic), reloaded);
  assert.deepEqual(restoreCustomScript(document), reloaded);
  assert.equal(restoreContentSelection({ custom: document, topicIndex: -1 }, 3).topicIndex, -1);
});

test('single JSON fence and title fallback import without adding fence text to a sentence', () => {
  const document = fixture();
  delete document.title;
  const topic = parseScriptInput('```json\r\n' + JSON.stringify(document) + '\r\n```', '粘贴材料');
  assert.equal(topic.title, '粘贴材料');
  assert.deepEqual(
    topic.lines.map((line) => line.text),
    document.lines.map((line) => line.text),
  );
  assert.equal(parseScriptInput('```JSON\n' + JSON.stringify(fixture()) + '\n```').title, fixture().title);
  assert.throws(() => parseScriptInput('```json\n{}'), /完整/);
  assert.throws(() => parseScriptInput('```json\n{}\n```\n```json\n{}\n```'), /JSON 格式/);
  assert.throws(() => parseScriptInput('{ invalid json'), /JSON 格式/);
  assert.throws(() => parseScriptInput('[]'), /最外层/);
});

test('structured keywords never prepend or rewrite their sentence to hide a missing literal match', () => {
  const document = fixture();
  document.lines[0].text = '专注需要一个落点。';
  assert.throws(() => parseScriptInput(document), /主关键词必须完整出现/);
  const original = JSON.stringify(document);
  assert.throws(() => parseScriptInput(document));
  assert.equal(JSON.stringify(document), original);
});

test('missing, duplicate or mismatched primary roles and extra absent concepts are rejected', () => {
  for (const change of [
    (line) => {
      line.keywords[1].role = 'secondary';
    },
    (line) => {
      line.keywords[0].role = 'primary';
    },
    (line) => {
      line.keywords[0].role = 'primary';
      line.keywords[1].role = 'secondary';
    },
    (line) => {
      delete line.keywords[1].role;
    },
    (line) => {
      line.keywords.push({ text: '注意力', role: 'secondary' });
    },
    (line) => {
      line.keywords.push({ text: '旋律', role: 'secondary' });
    },
  ]) {
    const document = fixture();
    change(document.lines[0]);
    assert.throws(() => parseScriptInput(document), /primary|角色|重复|本句/);
    assert.equal(restoreCustomScript(document), null);
  }
});

test('relations must reference declared literal concepts and point at their own keyword', () => {
  const document = fixture();
  // A relation can link a concept from an earlier line; it cannot introduce one.
  assert.equal(parseScriptInput(document).lines[1].keywords[0].relation.from, '目标');
  for (const edit of [
    (edge) => {
      edge.from = '原文没有';
    },
    (edge) => {
      edge.to = '目标';
    },
    (edge) => {
      edge.type = '__proto__';
    },
    (edge) => {
      edge.type = null;
    },
    (edge) => {
      edge.label = '';
    },
  ]) {
    const invalid = fixture();
    edit(invalid.lines[1].keywords[0].relation);
    assert.throws(() => parseScriptInput(invalid), /实际关键词|to 必须|type|非空文字/);
  }
  const neutral = fixture();
  neutral.lines[1].keywords[0].relation = { from: '目标', to: '切换' };
  assert.deepEqual(parseScriptInput(neutral).lines[1].keywords[0].relation, {
    from: '目标',
    to: '切换',
    type: 'related',
    label: '关联',
  });
  const absent = fixture();
  delete absent.lines[1].keywords[0].relation;
  assert.equal(parseScriptInput(absent).lines[1].keywords[0].relation, undefined);
});

test('unsupported schema, mode, sentence type and beat durations fail with readable errors', () => {
  for (const [key, value, pattern] of [
    ['schemaVersion', 2, /schemaVersion/],
    ['sourceMode', 'pretend-ai', /sourceMode/],
    ['title', '题'.repeat(51), /标题最多 50/],
  ]) {
    const document = fixture();
    document[key] = value;
    assert.throws(() => parseScriptInput(document), pattern);
  }
  const sentence = fixture();
  sentence.lines[0].sentenceType = 'callback';
  assert.throws(() => parseScriptInput(sentence), /sentenceType/);
  for (const holdBeats of [0, 33, 1.5, '8', null]) {
    const document = fixture();
    document.lines[0].holdBeats = holdBeats;
    assert.throws(() => parseScriptInput(document), /holdBeats/);
  }
  for (const holdBeats of [1, 32]) {
    const document = fixture();
    document.lines[0].holdBeats = holdBeats;
    assert.equal(parseScriptInput(document).lines[0].holdBeats, holdBeats);
  }
});

test('input, line, keyword and keyword-count limits bound work at the public parser', () => {
  assert.throws(() => parseScriptInput('词'.repeat(100_001)), /100,000/);
  const largeObject = fixture();
  largeObject.unknownMetadata = 'x'.repeat(100_000);
  assert.throws(() => parseScriptInput(largeObject), /100,000/);
  const tooManyLines = fixture();
  tooManyLines.lines = Array.from({ length: 41 }, () => fixture().lines[0]);
  assert.throws(() => parseScriptInput(tooManyLines), /40/);
  const longLine = fixture();
  longLine.lines[0].text = '注意力' + '字'.repeat(58);
  assert.throws(() => parseScriptInput(longLine), /60/);
  const longKeyword = fixture();
  longKeyword.lines[0].keyword = '词'.repeat(13);
  longKeyword.lines[0].text = longKeyword.lines[0].keyword;
  assert.throws(() => parseScriptInput(longKeyword), /12/);
  const tooManyKeywords = fixture();
  tooManyKeywords.lines[0].keywords = Array.from({ length: 9 }, (_, i) => ({
    text: String(i),
    role: i ? 'secondary' : 'primary',
  }));
  assert.throws(() => parseScriptInput(tooManyKeywords), /1～8/);
});

test('HTML, punctuation, exact case and complete emoji remain literal text, not markup or partial glyphs', () => {
  const family = '👨‍👩‍👧‍👦';
  const document = {
    schemaVersion: 1,
    sourceMode: 'free-examples',
    title: '<文字>',
    lines: [
      {
        text: '<b>家庭</b> ' + family + ' 和 BPM 都是原样文字。',
        keyword: family,
        keywords: [
          { text: family, role: 'primary' },
          { text: '<b>', role: 'secondary' },
          { text: 'BPM', role: 'secondary' },
        ],
        sentenceType: 'example',
      },
    ],
  };
  const topic = parseScriptInput(document);
  assert.equal(topic.lines[0].text, document.lines[0].text);
  assert.deepEqual(parseScriptInput(formatEditableScript(topic)).lines, topic.lines);
  const partial = structuredSingle(family, '👨');
  assert.throws(() => parseScriptInput(partial), /完整出现/);
  assert.throws(() => parseScriptInput(structuredSingle('BPM', 'bpm')), /完整出现/);
  const maxEmoji = family.repeat(12);
  assert.equal(parseScriptInput(structuredSingle(maxEmoji, maxEmoji)).lines[0].keyword, maxEmoji);
  assert.throws(() => parseScriptInput(structuredSingle(family.repeat(13), family.repeat(13))), /12/);
  const line60 = family.repeat(60);
  assert.equal(parseScriptInput(structuredSingle(line60, family)).lines[0].text, line60);
  assert.throws(() => parseScriptInput(structuredSingle(line60 + family, family)), /60/);
});

test('legacy plain editor and local restoration retain their existing representation', () => {
  const plain = '节拍、速度｜节拍提供参照，速度影响感觉。\n注意力、目标｜目标给注意力一个落点。';
  const original = parseTextScript(plain, '旧笔记');
  assert.deepEqual(parseScriptInput(plain, '旧笔记'), original);
  assert.equal(parseScriptInput(plain).schemaVersion, undefined);
  assert.ok(!formatEditableScript(original).startsWith('{'));
  assert.deepEqual(parseTextScript(formatEditableScript(original), original.title).lines, original.lines);
  assert.deepEqual(restoreCustomScript(JSON.parse(JSON.stringify(original))), original);
  // Explicitly exporting legacy text migrates it to JSON without changing its words.
  const document = serializeScriptDocument(original);
  assert.equal(document.sourceMode, 'source-only');
  assert.deepEqual(
    parseScriptInput(document).lines.map((line) => line.text),
    original.lines.map((line) => line.text),
  );
  assert.ok(
    document.lines.every((line) => line.keywords.filter((entry) => entry.role === 'primary').length === 1),
  );
});

test('explicit legacy bracket keywords retain literal text without being mistaken for JSON', () => {
  for (const keyword of ['[专注]', '{专注}', '[]', '{}']) {
    const text = `\n  ${keyword}｜${keyword}帮助集中注意力。\n目标｜目标给阅读一个方向。`;
    assert.deepEqual(parseScriptInput(text, '旧括号笔记'), parseTextScript(text, '旧括号笔记'));
  }
  const multiple = '[专注]、目标|[专注]围绕目标安排阅读。';
  assert.deepEqual(parseScriptInput(multiple), parseTextScript(multiple));
});

test('JSON containing an old-format separator and damaged JSON never fall back to legacy text', () => {
  const document = structuredSingle('关键词｜讲解保持原样。', '关键词');
  assert.equal(parseScriptInput(JSON.stringify(document)).lines[0].text, document.lines[0].text);
  assert.equal(
    parseScriptInput('```json\n' + JSON.stringify(document) + '\n```').lines[0].text,
    document.lines[0].text,
  );
  for (const broken of [
    '{"a"｜讲解。',
    '{a:1}|讲解。',
    "{'a':1}|讲解。",
    '[{"a"｜讲解。',
    '["词｜讲解。',
    '[1,｜讲解。',
    '```json\n[专注]｜[专注]帮助阅读。\n```',
  ])
    assert.throws(() => parseScriptInput(broken), /JSON 格式/);
  assert.throws(() => parseScriptInput('{坏JSON没有完整对象'), /JSON 格式/);
  assert.throws(() => parseScriptInput('{"text":"关键词｜讲解。"}'), /schemaVersion/);
});

test('serialized structured documents cannot silently repair missing primary metadata', () => {
  const topic = parseScriptInput(fixture());
  delete topic.lines[0].keywords[1].role;
  assert.throws(() => serializeScriptDocument(topic), /角色/);
  const noKeywords = parseScriptInput(fixture());
  delete noKeywords.lines[0].keywords;
  assert.throws(() => serializeScriptDocument(noKeywords), /keywords/);
  const noMode = parseScriptInput(fixture());
  delete noMode.sourceMode;
  assert.throws(() => serializeScriptDocument(noMode), /sourceMode/);
});

test('all source and sentence modes roundtrip, and unrecognized metadata is excluded from normalized output', () => {
  for (const sourceMode of ['source-only', 'free-examples', 'free-expansion']) {
    for (const sentenceType of ['definition', 'contrast', 'steps', 'fact', 'example', 'summary', 'opening']) {
      const document = structuredSingle('关键词是原样文字。', '关键词');
      document.sourceMode = sourceMode;
      document.lines[0].sentenceType = sentenceType;
      document.lines[0].onClick = 'untrusted code';
      const topic = parseScriptInput(JSON.stringify(document));
      assert.equal(topic.lines[0].onClick, undefined);
      assert.equal(parseScriptInput(serializeScriptDocument(topic)).lines[0].sentenceType, sentenceType);
      assert.equal(topic.sourceMode, sourceMode);
    }
  }
  const fencedLiteral = structuredSingle('原样 ``` 文字。', '文字');
  assert.equal(
    parseScriptInput('```json\n' + JSON.stringify(fencedLiteral) + '\n```').lines[0].text,
    fencedLiteral.lines[0].text,
  );
  const circular = fixture();
  circular.circular = circular;
  assert.throws(() => parseScriptInput(circular), /标准 JSON 对象/);
});

function structuredSingle(text, keyword) {
  return {
    schemaVersion: 1,
    title: '字面测试',
    sourceMode: 'source-only',
    lines: [{ text, keyword, keywords: [{ text: keyword, role: 'primary' }] }],
  };
}

test('save-ready JSON is readable for short documents and has no appended newline', () => {
  const topic = parseScriptInput(fixture());
  const text = stringifyScriptDocument(topic);
  assert.equal(text, JSON.stringify(serializeScriptDocument(topic), null, 2));
  assert.equal(text.endsWith('\n'), false);
  assert.equal(formatEditableScript(topic), text);
  assert.deepEqual(parseScriptInput(text), topic);
});

test('legal 40-line, eight-keyword metadata exports compactly when pretty JSON would be too large', () => {
  const document = complexDocument();
  const topic = parseScriptInput(document);
  const serialized = serializeScriptDocument(topic);
  const pretty = JSON.stringify(serialized, null, 2);
  const compact = JSON.stringify(serialized);
  assert.ok(pretty.length > SCRIPT_INPUT_LIMIT, 'fixture must reproduce the pretty-export overflow');
  assert.ok(compact.length < SCRIPT_INPUT_LIMIT, 'the actual authoring document remains legal');
  assert.ok(
    JSON.stringify(topic).length > SCRIPT_INPUT_LIMIT,
    'runtime relation index must not limit restore',
  );
  const text = stringifyScriptDocument(topic);
  assert.equal(text, compact);
  assert.equal(formatEditableScript(topic), text);
  assert.equal(text.endsWith('\n'), false);
  assert.deepEqual(parseScriptInput(text), topic);
  assert.deepEqual(restoreCustomScript(JSON.parse(JSON.stringify(topic))), topic);
});

test('an exactly 100k compact document saves and reimports without a newline overflowing the cap', () => {
  const document = complexDocument();
  const baseline = JSON.stringify(serializeScriptDocument(document)).length;
  let delta = SCRIPT_INPUT_LIMIT - baseline;
  // A family replaces one visible character but occupies ten additional UTF-16
  // units in JSON. Backslash escaping fills the final single-unit remainder.
  const family = '👨‍👩‍👧‍👦';
  for (const line of document.lines) {
    for (const entry of line.keywords) {
      const glyphs = Array.from(entry.relation.label);
      for (let i = 1; i < glyphs.length && delta > 0; i++) {
        if (delta >= 10) {
          glyphs[i] = family;
          delta -= 10;
        } else {
          glyphs[i] = '\\';
          delta--;
        }
      }
      entry.relation.label = glyphs.join('');
    }
  }
  assert.equal(delta, 0, 'fixture has enough bounded label slots to reach the limit');
  const input = JSON.stringify(serializeScriptDocument(document));
  assert.equal(input.length, SCRIPT_INPUT_LIMIT);
  const topic = parseScriptInput(input);
  const text = stringifyScriptDocument(topic);
  assert.equal(text.length, SCRIPT_INPUT_LIMIT);
  assert.equal(text.endsWith('\n'), false);
  assert.deepEqual(parseScriptInput(text), topic);
  assert.deepEqual(restoreCustomScript(topic), topic);
  assert.throws(() => parseScriptInput(text + '\n'), /100,000/);
});

test('every curated sample exports an importable document with literal text, roles and line metadata', () => {
  for (const sample of sampleLibrary) {
    const text = stringifyScriptDocument(sample);
    assert.ok(text.length <= SCRIPT_INPUT_LIMIT, sample.title);
    const topic = parseScriptInput(text);
    assert.equal(topic.title, sample.title);
    assert.equal(topic.sourceMode, 'source-only');
    assert.deepEqual(
      topic.lines.map((line) => line.text),
      sample.lines.map((line) => line.text),
    );
    for (let i = 0; i < topic.lines.length; i++) {
      const line = topic.lines[i],
        original = sample.lines[i];
      assert.equal(line.keyword, original.keyword);
      assert.equal(line.holdBeats, original.holdBeats);
      assert.deepEqual(
        line.keywords.map((entry) => entry.text),
        original.keywords.map((entry) => entry.text),
      );
      assert.equal(line.keywords.filter((entry) => entry.role === 'primary').length, 1);
      assert.equal(line.keywords.find((entry) => entry.role === 'primary').text, original.keyword);
      assert.deepEqual(
        line.keywords.map((entry) => entry.relation),
        original.keywords.map((entry) => entry.relation),
      );
    }
    assert.deepEqual(parseScriptInput(stringifyScriptDocument(topic)), topic);
  }
});

function complexDocument() {
  const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ01234567';
  return {
    schemaVersion: 1,
    title: '复杂文案边界',
    sourceMode: 'source-only',
    lines: Array.from({ length: 40 }, (_, index) => ({
      text,
      keyword: text.slice(0, 12),
      keywords: Array.from({ length: 8 }, (_, termIndex) => ({
        text: text.slice(termIndex, termIndex + 12),
        role: termIndex === 0 ? 'primary' : 'secondary',
        relation: {
          from: text.slice((termIndex + 7) % 8, ((termIndex + 7) % 8) + 12),
          to: text.slice(termIndex, termIndex + 12),
          type: 'related',
          label: String.fromCharCode(0x4e00 + index) + '说'.repeat(59),
        },
      })),
      sentenceType: 'summary',
      holdBeats: 32,
    })),
  };
}
