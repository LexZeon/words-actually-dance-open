import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directKnowledgeScene,
  findKnowledgeMarkers,
  KNOWLEDGE_SCENES,
  SENTENCE_LAYOUTS,
} from '../src/visuals/knowledge-director.js';
import { EFFECTS } from '../src/visuals/effect-catalog.js';

test('sentence direction makes distinct scenes from meaning, without rewriting text', () => {
  const cases = [
    [{ text: 'Words can move', keyword: 'Words' }, 0, 'opening'],
    [{ text: '文字也能跳舞', keyword: '文字' }, 0, 'ink'],
    [{ text: '节拍，是音乐里的时间参照。', keyword: '节拍' }, 1, 'definition'],
    [{ text: '看起来相似，但结果可能完全不同。', keyword: '结果' }, 2, 'contrast'],
    [{ text: '先理解目标，再安排执行顺序。', keyword: '目标' }, 3, 'steps'],
    [{ text: '100 × 1.1² = 121。', keyword: '121' }, 4, 'spotlight'],
    [{ text: '把分散的信息连成一段能向别人清楚解释的文字。', keyword: '信息' }, 6, 'diagonal'],
    [{ text: '把分散的信息连成一段能向别人清楚解释的文字。', keyword: '信息' }, 7, 'flip'],
  ];
  const effects = new Set(EFFECTS.map(({ id }) => id));
  assert.equal(KNOWLEDGE_SCENES.length, 8);
  for (const [line, index, expected] of cases) {
    const source = JSON.stringify(line);
    const result = directKnowledgeScene({ line, index, lineCount: 8 });
    assert.equal(result.layout, expected);
    assert.ok(effects.has(result.effect), `Unavailable effect ${result.effect}`);
    assert.equal(JSON.stringify(line), source, 'Original meaning must not be edited');
    assert.deepEqual(
      directKnowledgeScene({ line, index, lineCount: 8 }),
      result,
      'Reveal ticks must not randomize scenes',
    );
  }
});

test('font and split choices keep long knowledge and grapheme-rich content readable', () => {
  const short = directKnowledgeScene({ line: { text: 'Learn', keyword: 'Learn' }, index: 0 });
  const long = directKnowledgeScene({ line: { text: '知'.repeat(60), keyword: '知' }, index: 0 });
  assert.equal(short.typography.fontPx, 72);
  assert.equal(long.typography.fontPx, 27);
  const emoji = directKnowledgeScene({
    line: { text: '👩‍💻工作很忙，但专注有助于完成任务。', keyword: '专注' },
    index: 1,
  });
  assert.equal(emoji.layout, 'contrast');
  assert.ok(emoji.splitAt >= 3 && emoji.splitAt < emoji.length - 2);
});

test('concept relationships affect layout even without connective wording', () => {
  assert.equal(
    directKnowledgeScene({
      line: { text: '速度与方向', keyword: '速度' },
      index: 1,
      relation: { type: 'contrast' },
    }).layout,
    'contrast',
  );
  assert.equal(
    directKnowledgeScene({
      line: { text: '任务之间的连接', keyword: '任务' },
      index: 1,
      relation: { type: 'progress' },
    }).layout,
    'steps',
  );
});

test('a strongly unbalanced long comparison keeps a full-width readable sentence', () => {
  const text = '短句，但' + '知识'.repeat(25);
  const scene = directKnowledgeScene({ line: { text, keyword: '知识' }, index: 1 });
  assert.equal(scene.layout, 'contrast');
  assert.equal(scene.splitAt, 0, 'Do not squeeze a long half into a narrow column');
  assert.equal(scene.typography.fontPx, 27);
});

test('multiple exact keyword occurrences retain relations and deduplicate only equal ranges', () => {
  const line = {
    text: '👩‍💻先连接，再协作，连接帮助理解。',
    keyword: '连接',
    keywords: [
      { text: '连接', relation: { from: '专注', to: '连接', type: 'combine', label: '把线索连起来' } },
      { text: '连接' },
      { text: '协作', relation: { from: '连接', to: '协作', type: 'progress', label: '一起完成' } },
      { text: '缺失' },
    ],
  };
  const before = JSON.stringify(line);
  const markers = findKnowledgeMarkers(line);
  assert.equal(markers.length, 3);
  assert.deepEqual(
    markers.map(({ text }) => text),
    ['连接', '协作', '连接'],
  );
  assert.equal(markers[0].start, 2, 'Emoji should occupy one grapheme');
  assert.equal(markers[0].relation.type, 'combine');
  assert.equal(markers[1].relation.from, '连接');
  assert.equal(new Set(markers.map(({ key }) => key)).size, 3);
  assert.equal(JSON.stringify(line), before);
});

test('explicit sentence tags override regex, position and concept relation guesses', () => {
  for (const [sentenceType, layout] of Object.entries(SENTENCE_LAYOUTS)) {
    const line = { text: '先连接线索，但解释是另一种任务。', keyword: '连接', sentenceType };
    const scene = directKnowledgeScene({ line, index: 0, relation: { type: 'progress' } });
    assert.equal(scene.layout, layout);
    assert.equal(scene.sentenceType, sentenceType);
    assert.equal(scene.directionSource, 'explicit');
  }
  const fallback = directKnowledgeScene({
    line: { text: '连接线索。', keyword: '连接', sentenceType: 'unknown' },
    index: 0,
  });
  assert.equal(fallback.layout, 'ink');
  assert.equal(fallback.directionSource, 'inferred');
  assert.equal(fallback.sentenceType, null);
});

test('exact keyword markers preserve supplied roles and leave old roles inferable', () => {
  const markers = findKnowledgeMarkers({
    text: '连接带来理解和解释。',
    keyword: '连接',
    keywords: [{ text: '连接', role: 'primary' }, { text: '理解', role: 'secondary' }, { text: '解释' }],
  });
  assert.deepEqual(
    markers.map(({ role }) => role),
    ['primary', 'secondary', null],
  );
});

test('comparison columns never divide a crossing or nested literal keyword', () => {
  for (const line of [
    {
      text: '机器学习系统形成结构',
      keyword: '机器学习',
      sentenceType: 'contrast',
      keywords: ['机器学习', '学习系统'],
    },
    {
      text: '机器学习系统',
      keyword: '机器学习',
      sentenceType: 'contrast',
      keywords: ['机器学习', '学习系统'],
    },
    {
      text: '👩‍💻连接信息，但连接不等于理解。',
      keyword: '连接',
      sentenceType: 'contrast',
      keywords: ['连接', '信息'],
    },
  ]) {
    const scene = directKnowledgeScene({ line, index: 0 });
    assert.equal(scene.layout, 'contrast');
    assert.ok(
      scene.splitAt === 0 ||
        !findKnowledgeMarkers(line).some(({ start, end }) => start < scene.splitAt && scene.splitAt < end),
    );
  }
  const full = directKnowledgeScene({
    line: { text: '机器学习系统', keyword: '机器学习系统', sentenceType: 'contrast' },
  });
  assert.equal(full.splitAt, 0, 'Use full width when no complete-word column boundary exists');
});
