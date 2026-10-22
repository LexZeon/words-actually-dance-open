import { sampleLibrary } from './sample-library.js';
import { annotateConcepts } from './concept-graph.js';
import {
  extendedLibrary,
  extendedEnglishLibrary,
  easterEggTopic,
  easterEggEnglishTopic,
} from './extended-library.js';

// Original English editions of the curated examples. Imported/user-authored
// content is never sent to a translation service or replaced by a matching ID.
// Each row retains the source's concept order, link types, IDs and beat budget.
const editions = {
  rhythm: {
    title: 'Time inside music',
    relations: ['Beats provide a reference', 'Count beats to describe tempo', 'Tempo is only part of rhythm'],
    lines: [
      [
        'Musical rhythm arranges sounds by their duration and timing.',
        ['rhythm', 'sounds', 'duration', 'timing'],
        ['Rhythm arranges sounds', 'Sounds have duration', 'Duration and timing form rhythm'],
      ],
      [
        'A beat is a recurring time marker in music.',
        ['beat', 'music', 'time marker'],
        ['Beats belong to musical time', 'A beat provides a time reference'],
      ],
      [
        'At 120 BPM: per minute, 120 beats; half a sec each.',
        ['BPM', 'per minute', 'beats', 'half a sec'],
        ['The time unit of BPM', 'Count the beats in a minute', 'Convert tempo to beat length'],
      ],
      [
        'The same speed can feel different when the rhythm changes.',
        ['rhythm', 'speed', 'feel'],
        ['Tempo contributes to rhythm', 'Rhythm changes how music feels'],
      ],
    ],
  },
  resonance: {
    title: 'Why vibrations grow',
    relations: [
      'Depends on the driving frequency',
      'Can grow near the natural frequency',
      'Energy loss limits the response',
    ],
    lines: [
      [
        'In resonance, drive near a natural rate can boost vibration.',
        ['resonance', 'drive', 'natural rate', 'vibration'],
        [
          'A periodic force drives the system',
          'Compare driving and natural rates',
          'Nearby rates can amplify vibration',
        ],
      ],
      [
        'The frequency counts how often it repeats per second.',
        ['frequency', 'per second', 'repeats'],
        ['Frequency uses a unit of time', 'Count repetitions in that time'],
      ],
      [
        'The amplitude is the maximum distance from a rest point.',
        ['amplitude', 'rest point', 'maximum'],
        ['Measure from the equilibrium point', 'Measure the greatest displacement'],
      ],
      [
        'Through damping, energy is lost and resonance is limited.',
        ['damping', 'energy', 'resonance'],
        ['Damping dissipates energy', 'Loss limits the resonant response'],
      ],
    ],
  },
  compound: {
    title: 'When growth joins the next round',
    relations: [
      'New gains join the next base',
      'Growth depends on both quantities',
      'A constant rate is an assumption',
    ],
    lines: [
      [
        'With compounding, new interest joins the next base.',
        ['compounding', 'interest', 'base'],
        ['Compounding includes new interest', 'New interest joins the base'],
      ],
      [
        'A base of 100 becomes 110; the next round starts from 110.',
        ['base', '100', '110', 'next round'],
        ['The starting base', 'The base after growth', 'Continue from the new base'],
      ],
      [
        'If the growth rate is 10%, two rounds give 100 × 1.1² = 121.',
        ['growth rate', '10%', 'two rounds', '121'],
        ['An assumed rate per period', 'Apply two growth periods', 'The result under this assumption'],
      ],
      [
        'In compounding, growth rate may vary; periods also count.',
        ['compounding', 'growth rate', 'periods', 'vary'],
        ['The formula depends on the rate', 'Rate and periods determine the result', 'Real rates may change'],
      ],
    ],
  },
  focus: {
    title: 'Give attention a destination',
    relations: ['Choose where attention goes', 'Switching requires context', 'Return to the current task'],
    lines: [
      [
        'With focus, you direct attention toward one clear task.',
        ['focus', 'attention', 'task'],
        ['Focus involves attention', 'Give attention a specific target'],
      ],
      [
        'Set a goal: read this paragraph, then explain one concept.',
        ['goal', 'read', 'explain', 'concept'],
        ['First finish reading', 'Then explain your understanding', 'Choose what to explain'],
      ],
      [
        'Switching from task to task can mean rebuilding context.',
        ['Switching', 'task', 'context'],
        ['Move between tasks', 'Rebuild context after a switch'],
      ],
      [
        'Having focus need not mean nonstop work; allow rest.',
        ['focus', 'work', 'rest'],
        ['Use focus for the current work', 'Allow a break after finishing'],
      ],
    ],
  },
  parallel: {
    title: 'What can run together?',
    relations: [
      'Reduce dependencies between tasks',
      'Check the required order',
      'Wait for the required result',
    ],
    lines: [
      [
        'In parallel, many tasks run at the same time.',
        ['parallel', 'same time', 'many tasks'],
        ['A shared time condition', 'Several tasks run together'],
      ],
      [
        'When independent, tasks are easier to arrange together.',
        ['independent', 'tasks', 'together'],
        ['Independence describes task relations', 'Independent tasks can overlap'],
      ],
      [
        "A dependency: wait for an earlier step's result; keep order.",
        ['dependency', 'earlier step', 'result', 'order'],
        [
          'A later step depends on an earlier one',
          'Continue when the result is ready',
          'Dependencies constrain the order',
        ],
      ],
      [
        'Use sync for timing; waiting adds management costs.',
        ['sync', 'timing', 'waiting', 'costs'],
        [
          'Coordinate when work proceeds',
          'Coordination can require waiting',
          'Waiting and management have costs',
        ],
      ],
    ],
  },
  connection: {
    title: 'Connect ideas into understanding',
    relations: ['Start with a familiar relation', 'Similarity has limits', 'Keep the relationship precise'],
    lines: [
      [
        'Use a link: new ideas + experience can help you understand.',
        ['link', 'new ideas', 'experience', 'understand'],
        ['Connect new information', 'Use what you already know', 'Connections offer a clue'],
      ],
      [
        'An analogy uses familiar relations to explain a new idea.',
        ['analogy', 'familiar', 'new idea'],
        ['Start with a known relationship', 'Use it to explain a new idea'],
      ],
      [
        'An analogy has limits: similar is not always the same.',
        ['limits', 'analogy', 'similar', 'same'],
        ['The limit belongs to the analogy', 'An analogy preserves similarities', 'Similar is not identical'],
      ],
      [
        'For a useful link, explain how the concepts are related.',
        ['link', 'concepts', 'related'],
        ['Connect the two concepts', 'Say what their relationship is'],
      ],
    ],
  },
  'learning-retrieval': {
    title: 'After reading, try saying it yourself',
    relations: [
      'Try recalling before looking',
      'Then check against the source',
      'Familiarity is not independent recall',
    ],
    lines: [
      [
        'Try recall: leave the source; bring the idea to mind.',
        ['recall', 'source', 'bring'],
        ['First look away from the material', 'Produce an answer yourself'],
      ],
      [
        'To remember evaporation, pause: liquid → gas at its surface.',
        ['remember', 'evaporation', 'pause'],
        ['An example concept', 'Leave time to recall'],
      ],
      [
        "Then check the source: did you miss the liquid's surface?",
        ['check', 'source', 'surface'],
        ['Compare against the material', 'Restore the qualifying detail'],
      ],
      [
        "An answer's familiarity is not proof you can explain it.",
        ['familiarity', 'answer', 'explain'],
        ['The answer feels familiar while visible', 'Explain without seeing the answer'],
      ],
      [
        'An example: explain the idea using drying clothes.',
        ['example', 'clothes', 'idea'],
        ['Connect with an everyday experience', 'Still explain the meaning clearly'],
      ],
      [
        'A self-test: pause, remember, then check the source.',
        ['self-test', 'pause', 'remember', 'check'],
        ['Try for yourself before continuing', 'Recall first', 'Then consult the source'],
      ],
    ],
  },
  'learning-spacing': {
    title: 'Return to it at another time',
    relations: [
      'Try again at another time',
      'Use recall to plan the next review',
      'An example is not an optimal formula',
    ],
    lines: [
      [
        'Use spacing: time gaps between reviews, not just looping.',
        ['spacing', 'time gaps', 'looping'],
        ['Distribute the review occasions', 'Different from continuous replay'],
      ],
      [
        'For recall, hide meanings; explain three words.',
        ['recall', 'three words', 'hide'],
        ['Concrete practice material', 'Try recalling before looking'],
      ],
      [
        'To adjust: difficulty, how long, and recall all matter.',
        ['adjust', 'difficulty', 'how long'],
        ['Consider the material', 'Consider the retention goal'],
      ],
      [
        'A reminder example: today, tomorrow, then a few days later.',
        ['reminder', 'tomorrow', 'example'],
        ['One possible review occasion', 'An illustration, not a fixed prescription'],
      ],
      [
        'Know the limits: no magic schedule; replay is not spacing.',
        ['limits', 'schedule', 'replay'],
        ['No universally optimal timetable', 'Continuous playback is not spacing'],
      ],
      [
        'A self-test: pause; compare looping with spaced recall.',
        ['self-test', 'pause', 'looping', 'recall'],
        ['Leave time for your own answer', 'Compare the two activities', 'Focus on actual recall'],
      ],
    ],
  },
  'learning-working-memory': {
    title: 'Give working memory some room',
    relations: [
      'Process small pieces step by step',
      'Start with the current point',
      'Return to your own understanding',
    ],
    lines: [
      [
        'Working memory has limited room for new ideas.',
        ['memory', 'new ideas', 'limited'],
        ['The material being understood', 'Avoid handling too much at once'],
      ],
      [
        'Use segments: prep first, then the next step of cooking.',
        ['segments', 'prep', 'next step'],
        ['Handle one step first', 'Then continue'],
      ],
      [
        'Keep focus: understand this step, not every animation.',
        ['focus', 'understand', 'animation'],
        ['Aim at the current point', 'Do not chase every movement'],
      ],
      [
        'Use notes: write down steps to hold less in mind at once.',
        ['notes', 'steps', 'write down'],
        ['The information to handle', 'Use an external record'],
      ],
      [
        'Less distraction: turn music down or reduce motion.',
        ['distraction', 'music', 'motion'],
        ['An experience that can distract', 'Adjust it to your reading needs'],
      ],
      [
        'A self-test: pause; why read one focus point at a time?',
        ['self-test', 'pause', 'focus'],
        ['Leave time to put it into words', 'Explain one important point'],
      ],
    ],
  },
};

const sources = new Set(sampleLibrary);
const englishTopics = new WeakMap();
const originals = new WeakMap();
for (const [index, topic] of extendedLibrary.entries()) {
  englishTopics.set(topic, extendedEnglishLibrary[index]);
  originals.set(extendedEnglishLibrary[index], topic);
}
englishTopics.set(easterEggTopic, easterEggEnglishTopic);
originals.set(easterEggEnglishTopic, easterEggTopic);

function englishEdition(source) {
  if (englishTopics.has(source)) return englishTopics.get(source);
  const edition = editions[source.id];
  if (!edition) return source;
  if (edition.lines.length !== source.lines.length || edition.relations.length !== source.relations.length)
    throw new Error(`Curated translation structure does not match ${source.id}`);
  const terms = new Map();
  const lines = source.lines.map((line, index) => {
    const [text, translatedTerms, labels] = edition.lines[index];
    if (translatedTerms.length !== line.keywords.length || labels.length !== line.keywords.length - 1)
      throw new Error(`Curated translation concepts do not match ${line.id}`);
    line.keywords.forEach((entry, termIndex) => {
      const previous = terms.get(entry.text);
      if (previous !== undefined && previous !== translatedTerms[termIndex])
        throw new Error(`Curated translation term is inconsistent in ${source.id}`);
      terms.set(entry.text, translatedTerms[termIndex]);
    });
    return annotateConcepts(
      { ...line, text, keyword: translatedTerms[0] },
      line.keywords
        .slice(1)
        .map((entry, termIndex) => [translatedTerms[termIndex + 1], entry.relation.type, labels[termIndex]]),
    );
  });
  const topic = {
    ...source,
    title: edition.title,
    keyword: terms.get(source.keyword),
    lines,
    relations: source.relations.map((relation, index) => ({
      ...relation,
      from: terms.get(relation.from),
      to: terms.get(relation.to),
      label: edition.relations[index],
    })),
  };
  englishTopics.set(source, topic);
  originals.set(topic, source);
  return topic;
}

/** Localize only curated object identities, including our own English editions.
 * Chinese returns the untouched original. A custom/cloned topic—even with a
 * built-in-looking ID—is returned verbatim. No external translation occurs.
 */
export function localizeSampleTopic(topic, locale = 'zh') {
  if (!topic || typeof topic !== 'object') return topic;
  const source = originals.get(topic) || (sources.has(topic) ? topic : null);
  if (!source) return topic;
  return typeof locale === 'string' && /^en(?:-|$)/i.test(locale) ? englishEdition(source) : source;
}
