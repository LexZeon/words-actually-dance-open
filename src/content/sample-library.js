import { annotateConcepts } from './concept-graph.js';
import { learningLibrary } from './learning-library.js';
import { extendedLibrary, easterEggTopic } from './extended-library.js';

/** Curated local examples. No AI service runs inside the application. */
export const sampleLibrary = [
  {
    id: 'rhythm',
    title: '音乐里的时间',
    keyword: '节奏',
    emoji: '♪',
    relations: [
      { from: '节奏', to: '节拍', type: 'part', label: '节拍提供参照' },
      { from: '节拍', to: 'BPM', type: 'measure', label: '用数量描述速度' },
      { from: 'BPM', to: '节奏', type: 'context', label: '速度不等于全部节奏' },
    ],
    lines: [
      { id: 'rhythm-1', text: '节奏，是声音长短与出现时刻的安排。', keyword: '节奏', holdBeats: 8 },
      { id: 'rhythm-2', text: '节拍，是音乐中反复出现的时间参照。', keyword: '节拍', holdBeats: 8 },
      {
        id: 'rhythm-3',
        text: 'BPM 表示每分钟的节拍数，120 BPM 对应每拍约半秒。',
        keyword: 'BPM',
        holdBeats: 12,
      },
      {
        id: 'rhythm-4',
        text: '节奏：相同速度，也能通过不同安排产生不同感觉。',
        keyword: '节奏',
        holdBeats: 8,
      },
    ],
  },
  {
    id: 'resonance',
    title: '振动为什么会变强',
    keyword: '共振',
    emoji: '〰',
    relations: [
      { from: '共振', to: '频率', type: 'condition', label: '取决于驱动频率' },
      { from: '频率', to: '振幅', type: 'effect', label: '接近固有频率时增强' },
      { from: '振幅', to: '阻尼', type: 'limit', label: '损耗限制振动' },
    ],
    lines: [
      {
        id: 'resonance-1',
        text: '共振：周期性驱动接近系统固有频率时，振动往往增强。',
        keyword: '共振',
        holdBeats: 12,
      },
      { id: 'resonance-2', text: '频率，描述每秒重复振动多少次。', keyword: '频率', holdBeats: 8 },
      { id: 'resonance-3', text: '振幅，描述偏离平衡位置的最大程度。', keyword: '振幅', holdBeats: 8 },
      { id: 'resonance-4', text: '阻尼会消耗振动能量，限制共振的强度。', keyword: '阻尼', holdBeats: 8 },
    ],
  },
  {
    id: 'compound',
    title: '增长如何继续增长',
    keyword: '复利',
    emoji: '↗',
    relations: [
      { from: '复利', to: '基数', type: 'mechanism', label: '新增量进入下一轮' },
      { from: '基数', to: '增长率', type: 'parameter', label: '增长依赖两个量' },
      { from: '增长率', to: '复利', type: 'condition', label: '恒定只是计算假设' },
    ],
    lines: [
      { id: 'compound-1', text: '复利，是把新增利息计入下一期计算的基数。', keyword: '复利', holdBeats: 8 },
      {
        id: 'compound-2',
        text: '基数从 100 变成 110，下一轮会从 110 开始计算。',
        keyword: '基数',
        holdBeats: 12,
      },
      {
        id: 'compound-3',
        text: '假设每期增长率为 10%，两期后是 100 × 1.1² = 121。',
        keyword: '增长率',
        holdBeats: 12,
      },
      {
        id: 'compound-4',
        text: '复利公式的结果依赖增长率与期数；实际增长率未必恒定。',
        keyword: '复利',
        holdBeats: 12,
      },
    ],
  },
  {
    id: 'focus',
    title: '给注意力一个落点',
    keyword: '专注',
    emoji: '◎',
    relations: [
      { from: '专注', to: '目标', type: 'direction', label: '确定注意力去向' },
      { from: '目标', to: '切换', type: 'contrast', label: '切换需要重建上下文' },
      { from: '切换', to: '专注', type: 'return', label: '回到当前任务' },
    ],
    lines: [
      { id: 'focus-1', text: '专注，是把当前注意力放在一个明确任务上。', keyword: '专注', holdBeats: 8 },
      {
        id: 'focus-2',
        text: '先写清目标，例如：读完这段，并解释其中一个概念。',
        keyword: '目标',
        holdBeats: 12,
      },
      { id: 'focus-3', text: '频繁切换任务，可能需要反复恢复上下文。', keyword: '切换', holdBeats: 8 },
      { id: 'focus-4', text: '专注不等于一直工作；任务完成后也需要休息。', keyword: '专注', holdBeats: 8 },
    ],
  },
  {
    id: 'parallel',
    title: '哪些工作可以一起做',
    keyword: '并行',
    emoji: '∥',
    relations: [
      { from: '并行', to: '独立', type: 'condition', label: '减少先后依赖' },
      { from: '独立', to: '依赖', type: 'contrast', label: '判断执行顺序' },
      { from: '依赖', to: '同步', type: 'coordination', label: '等待需要的结果' },
    ],
    lines: [
      { id: 'parallel-1', text: '并行，是在同一时间执行多个任务。', keyword: '并行', holdBeats: 8 },
      { id: 'parallel-2', text: '彼此独立的任务，更容易同时安排。', keyword: '独立', holdBeats: 8 },
      {
        id: 'parallel-3',
        text: '如果后一步依赖前一步的结果，就需要保持顺序。',
        keyword: '依赖',
        holdBeats: 12,
      },
      {
        id: 'parallel-4',
        text: '同步负责协调时机；它也会带来等待和管理成本。',
        keyword: '同步',
        holdBeats: 12,
      },
    ],
  },
  {
    id: 'connection',
    title: '把信息连成理解',
    keyword: '连接',
    emoji: '↔',
    relations: [
      { from: '连接', to: '类比', type: 'method', label: '从熟悉的概念出发' },
      { from: '类比', to: '边界', type: 'limit', label: '相似并不等于相同' },
      { from: '边界', to: '连接', type: 'refine', label: '保留适用关系' },
    ],
    lines: [
      {
        id: 'connection-1',
        text: '连接新知识与已有经验，可以为理解提供线索。',
        keyword: '连接',
        holdBeats: 8,
      },
      { id: 'connection-2', text: '类比用熟悉的关系解释陌生概念。', keyword: '类比', holdBeats: 8 },
      {
        id: 'connection-3',
        text: '边界：每个类比的相似之处不代表全部相同。',
        keyword: '边界',
        holdBeats: 12,
      },
      { id: 'connection-4', text: '好的连接，还要说清两个概念为什么有关。', keyword: '连接', holdBeats: 8 },
    ],
  },
];

const concepts = [
  [
    [
      ['声音', 'expand', '节奏安排声音'],
      ['长短', 'measure', '声音具有时值'],
      ['时刻', 'combine', '时值与时刻共同构成节奏'],
    ],
    [
      ['音乐', 'related', '节拍属于音乐时间'],
      ['时间参照', 'measure', '节拍提供时间参照'],
    ],
    [
      ['每分钟', 'measure', 'BPM 的时间单位'],
      ['节拍数', 'measure', '统计一分钟里的拍数'],
      ['半秒', 'progress', '120 BPM 换算成拍长'],
    ],
    [
      ['速度', 'related', '节奏包含速度因素'],
      ['感觉', 'cause', '节奏变化影响听感'],
    ],
  ],
  [
    [
      ['周期性驱动', 'condition', '共振需要周期性驱动'],
      ['固有频率', 'measure', '比较驱动与固有频率'],
      ['振动', 'cause', '频率接近时振动增强'],
    ],
    [
      ['每秒', 'measure', '频率的时间单位'],
      ['重复', 'related', '每秒统计重复次数'],
    ],
    [
      ['平衡位置', 'measure', '振幅以平衡位置为参照'],
      ['最大程度', 'measure', '度量最大偏离'],
    ],
    [
      ['能量', 'cause', '阻尼消耗能量'],
      ['共振', 'contrast', '损耗限制共振强度'],
    ],
  ],
  [
    [
      ['利息', 'expand', '复利包含新增利息'],
      ['基数', 'combine', '新增利息并入基数'],
    ],
    [
      ['100', 'measure', '最初基数'],
      ['110', 'progress', '增长后的基数'],
      ['下一轮', 'progress', '从新基数继续计算'],
    ],
    [
      ['10%', 'measure', '设定每期增长率'],
      ['两期', 'progress', '计算两个增长周期'],
      ['121', 'cause', '假设成立时的计算结果'],
    ],
    [
      ['增长率', 'condition', '公式依赖增长率'],
      ['期数', 'combine', '增长率与期数共同决定结果'],
      ['恒定', 'contrast', '实际增长率未必恒定'],
    ],
  ],
  [
    [
      ['注意力', 'expand', '专注涉及注意力'],
      ['任务', 'progress', '给注意力明确落点'],
    ],
    [
      ['读完', 'progress', '先完成阅读'],
      ['解释', 'progress', '再用解释检验理解'],
      ['概念', 'related', '明确解释对象'],
    ],
    [
      ['任务', 'related', '切换发生在任务之间'],
      ['上下文', 'cause', '切换后需要恢复上下文'],
    ],
    [
      ['工作', 'related', '专注用于当前工作'],
      ['休息', 'contrast', '完成后安排休息'],
    ],
  ],
  [
    [
      ['同一时间', 'measure', '并行的时间条件'],
      ['多个任务', 'combine', '多个任务共同执行'],
    ],
    [
      ['任务', 'related', '独立描述任务关系'],
      ['同时', 'progress', '独立任务可同时安排'],
    ],
    [
      ['前一步', 'related', '依赖前一步结果'],
      ['结果', 'condition', '结果就绪后再继续'],
      ['顺序', 'cause', '依赖约束执行顺序'],
    ],
    [
      ['时机', 'measure', '同步协调执行时机'],
      ['等待', 'cause', '协调可能带来等待'],
      ['成本', 'related', '等待和管理都有成本'],
    ],
  ],
  [
    [
      ['新知识', 'expand', '连接涉及新知识'],
      ['已有经验', 'combine', '用经验连接新知识'],
      ['理解', 'related', '连接为理解提供线索'],
    ],
    [
      ['熟悉', 'related', '从熟悉的关系出发'],
      ['陌生概念', 'progress', '用熟悉关系解释陌生概念'],
    ],
    [
      ['类比', 'related', '边界属于这个类比'],
      ['相似', 'related', '类比保留相似关系'],
      ['相同', 'contrast', '相似不等于全部相同'],
    ],
    [
      ['概念', 'combine', '连接两个概念'],
      ['有关', 'related', '说清概念的关系'],
    ],
  ],
];
sampleLibrary.forEach((topic, index) => {
  topic.lines = topic.lines.map((line, i) => annotateConcepts(line, concepts[index][i]));
});

sampleLibrary.push(...learningLibrary, ...extendedLibrary, easterEggTopic);

export default sampleLibrary;
