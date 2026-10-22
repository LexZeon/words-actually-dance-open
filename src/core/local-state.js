import { parseTextScript } from '../content/text-script.js';
import { parseScriptInput, stringifyScriptDocument } from '../content/script-document.js';
import { SCRIPT_LIMITS, localScriptTitle } from '../content/text-boundaries.js';

/** Read only the current local script format; unrelated saved fields are ignored. */
export function restoreCustomScript(value) {
  if (value && Object.prototype.hasOwnProperty.call(value, 'schemaVersion')) {
    try {
      // Saved normalized topics also contain a derived relation index and ids.
      // Only the authoring document counts toward the shared 100k input cap.
      return parseScriptInput(stringifyScriptDocument(value));
    } catch {
      return null;
    }
  }
  if (!value || !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 40) return null;
  if (
    !value.lines.every(
      (line) =>
        line &&
        typeof line.text === 'string' &&
        line.text.trim() &&
        typeof line.keyword === 'string' &&
        line.keyword.trim() &&
        !/[\r\n\u2028\u2029|｜]/.test(line.keyword) &&
        !/[\r\n\u2028\u2029]/.test(line.text) &&
        line.text.includes(line.keyword),
    )
  )
    return null;
  try {
    // Validate one stored row at a time: editor keyword prefixes duplicate text,
    // and must not make a valid saved Unicode document fail a stale 12k cap.
    if (value.lines.map((line) => line.text).join('\n').length > SCRIPT_LIMITS.inputCodeUnits) return null;
    let title;
    try {
      title = localScriptTitle(value.title);
    } catch {
      title = '我的知识';
    } // A corrupt legacy header need not discard valid notes.
    const topics = value.lines.map((line) => parseTextScript(formatEditableScript({ lines: [line] }), title));
    return {
      ...topics[0],
      lines: topics.map((topic, index) => ({ ...topic.lines[0], id: `custom-${index}` })),
    };
  } catch {
    return null;
  }
}

export function restoreContentSelection(stored, sampleCount) {
  const custom = restoreCustomScript(stored?.custom);
  const selected = stored?.topicIndex;
  const topicIndex =
    selected === -1 && custom
      ? -1
      : Number.isInteger(selected) && selected >= 0 && selected < sampleCount
        ? selected
        : 0;
  return { custom, topicIndex };
}

/** Round-trippable local editor representation, not a generated explanation. */
export function formatEditableScript(topic) {
  if (topic?.schemaVersion !== undefined) {
    return stringifyScriptDocument(topic);
  }
  return topic.lines
    .map((line) => {
      const entries = Array.isArray(line.keywords) ? line.keywords : [];
      const keywords = [
        ...new Set(
          [line.keyword, ...entries.map((entry) => (typeof entry === 'string' ? entry : entry?.text))].filter(
            (term) => typeof term === 'string' && term,
          ),
        ),
      ];
      return `${keywords.join('、')}｜${line.text}`;
    })
    .join('\n');
}
