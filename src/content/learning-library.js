import { annotateConcepts } from './concept-graph.js';

/** Original Chinese examples, not copied research text or AI-generated output.
 * Research and limits: docs/learning-science.md. Demonstrations invite voluntary
 * pause/recall; they do not implement assessment, grading or review scheduling.
 * Kept separate so existing sample IDs and saved indices remain unchanged.
 */
export const learningLibrary = [
  {
    id: 'learning-retrieval',
    title: '看懂之后，试着说出来',
    keyword: '检索练习',
    emoji: '？',
    relations: [
      { from: '检索练习', to: '回想', type: 'method', label: '先离开答案尝试回忆' },
      { from: '回想', to: '核对', type: 'progress', label: '再看材料检查遗漏' },
      { from: '熟悉感', to: '自测', type: 'contrast', label: '熟悉不等于能独立说出' },
    ],
    lines: [
      {
        id: 'learning-retrieval-1',
        text: '检索练习：先不看原文，试着把刚学的内容想出来。',
        keyword: '检索练习',
        sentenceType: 'definition',
        holdBeats: 12,
      },
      {
        id: 'learning-retrieval-2',
        text: '回想：读完“蒸发是液体表面变成气体”，暂停后说说什么是蒸发。',
        keyword: '回想',
        sentenceType: 'example',
        holdBeats: 16,
      },
      {
        id: 'learning-retrieval-3',
        text: '核对：再看原文，补上漏掉的“液体表面”，纠正说错的地方。',
        keyword: '核对',
        sentenceType: 'steps',
        holdBeats: 16,
      },
      {
        id: 'learning-retrieval-4',
        text: '熟悉感：看着答案觉得会了，和离开答案还能解释，可能不同。',
        keyword: '熟悉感',
        sentenceType: 'contrast',
        holdBeats: 12,
      },
      {
        id: 'learning-retrieval-5',
        text: '例子：再想想晾干衣服，试着把刚学的概念说清楚。',
        keyword: '例子',
        sentenceType: 'example',
        holdBeats: 12,
      },
      {
        id: 'learning-retrieval-6',
        text: '自测：先暂停，说出“回想、核对”两个步骤，再看原文。',
        keyword: '自测',
        sentenceType: 'summary',
        holdBeats: 16,
      },
    ],
  },
  {
    id: 'learning-spacing',
    title: '把复习分散到以后',
    keyword: '间隔',
    emoji: '↻',
    relations: [
      { from: '间隔', to: '回忆', type: 'method', label: '在不同时间再次尝试' },
      { from: '回忆', to: '调整', type: 'refine', label: '根据表现安排下次' },
      { from: '提醒', to: '边界', type: 'limit', label: '示例不等于最优公式' },
    ],
    lines: [
      {
        id: 'learning-spacing-1',
        text: '间隔：把复习放在不同时间，别只在一次会话里循环。',
        keyword: '间隔',
        sentenceType: 'definition',
        holdBeats: 12,
      },
      {
        id: 'learning-spacing-2',
        text: '回忆：学完三个词，之后先遮住解释，试着说出意思。',
        keyword: '回忆',
        sentenceType: 'example',
        holdBeats: 12,
      },
      {
        id: 'learning-spacing-3',
        text: '调整：什么时候复习，要看材料难度、想记住多久和回忆情况。',
        keyword: '调整',
        sentenceType: 'steps',
        holdBeats: 16,
      },
      {
        id: 'learning-spacing-4',
        text: '提醒：比如今天学，明天回想，几天后再试；这只是安排示例。',
        keyword: '提醒',
        sentenceType: 'example',
        holdBeats: 16,
      },
      {
        id: 'learning-spacing-5',
        text: '边界：没有人人通用的神奇时间表，连续重播也不等于间隔练习。',
        keyword: '边界',
        sentenceType: 'contrast',
        holdBeats: 16,
      },
      {
        id: 'learning-spacing-6',
        text: '自测：先暂停，说说“循环播放”和“隔一阵回忆”有何区别。',
        keyword: '自测',
        sentenceType: 'summary',
        holdBeats: 16,
      },
    ],
  },
  {
    id: 'learning-working-memory',
    title: '一次只处理一小块',
    keyword: '工作记忆',
    emoji: '□',
    relations: [
      { from: '工作记忆', to: '分段', type: 'method', label: '少量内容逐步处理' },
      { from: '分段', to: '重点', type: 'direction', label: '先处理当前要点' },
      { from: '分心', to: '自测', type: 'return', label: '回到自己的理解' },
    ],
    lines: [
      {
        id: 'learning-working-memory-1',
        text: '工作记忆：理解新内容时，能同时处理的信息有限。',
        keyword: '工作记忆',
        sentenceType: 'definition',
        holdBeats: 12,
      },
      {
        id: 'learning-working-memory-2',
        text: '分段：学做一道菜，先看备料这一步，再看下一步。',
        keyword: '分段',
        sentenceType: 'example',
        holdBeats: 12,
      },
      {
        id: 'learning-working-memory-3',
        text: '重点：先理解当前这一步，不必追着屏幕上所有动画看。',
        keyword: '重点',
        sentenceType: 'steps',
        holdBeats: 12,
      },
      {
        id: 'learning-working-memory-4',
        text: '外部记录：把步骤写下来，减少同时在脑中保留的内容。',
        keyword: '外部记录',
        sentenceType: 'example',
        holdBeats: 12,
      },
      {
        id: 'learning-working-memory-5',
        text: '分心：音乐或动画抢走注意力时，试试调低声音、降低舞动强度。',
        keyword: '分心',
        sentenceType: 'steps',
        holdBeats: 16,
      },
      {
        id: 'learning-working-memory-6',
        text: '自测：先暂停，用自己的话说说，为什么可以一次只读一个重点。',
        keyword: '自测',
        sentenceType: 'summary',
        holdBeats: 16,
      },
    ],
  },
];

const concepts = [
  [
    [
      ['原文', 'related', '先离开材料尝试'],
      ['想出来', 'method', '主动产生回答'],
    ],
    [
      ['蒸发', 'related', '示例概念'],
      ['暂停', 'method', '留出回忆时间'],
    ],
    [
      ['原文', 'method', '对照材料'],
      ['液体表面', 'refine', '补回限定条件'],
    ],
    [
      ['答案', 'related', '可见时的熟悉体验'],
      ['解释', 'contrast', '离开答案独立表达'],
    ],
    [
      ['晾干衣服', 'related', '尝试联系已有经验'],
      ['概念', 'refine', '仍需说清含义'],
    ],
    [
      ['暂停', 'method', '自己尝试再继续'],
      ['回想', 'progress', '先回忆'],
      ['核对', 'progress', '再查看材料'],
    ],
  ],
  [
    [
      ['不同时间', 'method', '分散复习时点'],
      ['循环', 'contrast', '区别连续重播'],
    ],
    [
      ['三个词', 'related', '具体练习材料'],
      ['遮住解释', 'method', '先尝试回忆'],
    ],
    [
      ['材料难度', 'parameter', '安排时参考'],
      ['记住多久', 'parameter', '考虑保留目标'],
    ],
    [
      ['明天', 'related', '一个安排示例'],
      ['示例', 'limit', '不是固定处方'],
    ],
    [
      ['时间表', 'limit', '不承诺通用最优'],
      ['重播', 'contrast', '连续播放不是跨时复习'],
    ],
    [
      ['暂停', 'method', '留出独立回答时间'],
      ['循环播放', 'contrast', '比较两种行为'],
      ['回忆', 'refine', '关注实际回忆'],
    ],
  ],
  [
    [
      ['新内容', 'related', '正在理解的材料'],
      ['有限', 'limit', '不同时塞入过多信息'],
    ],
    [
      ['备料', 'related', '先处理一个步骤'],
      ['下一步', 'progress', '再继续'],
    ],
    [
      ['理解', 'direction', '以当前要点为目标'],
      ['动画', 'contrast', '不必追逐全部运动'],
    ],
    [
      ['步骤', 'related', '需要处理的内容'],
      ['写下来', 'method', '使用外部记录'],
    ],
    [
      ['音乐', 'related', '可能分心的体验'],
      ['舞动强度', 'method', '按阅读需要调整'],
    ],
    [
      ['暂停', 'method', '留出表达时间'],
      ['重点', 'related', '说清一个要点'],
    ],
  ],
];

learningLibrary.forEach((topic, index) => {
  topic.lines = topic.lines.map((line, lineIndex) => annotateConcepts(line, concepts[index][lineIndex]));
});

export default learningLibrary;
