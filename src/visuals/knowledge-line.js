const wordSegmenter =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

/** Build one literal sentence. Playback and its clock remain owned by KnowledgeStage. */
export function createKnowledgeLine(document, line, { scene, presentation }) {
  const el = document.createElement('div');
  el.className = 'knowledge-line current arriving';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', line.text);
  const track = document.createElement('span');
  track.className = 'reading-track';
  track.setAttribute('aria-hidden', 'true');
  const spotlight = document.createElement('span');
  spotlight.className = 'spotlight';
  spotlight.setAttribute('aria-hidden', 'true');
  const chars = [];
  const groups = [];
  const words = wordSegmenter
    ? [...wordSegmenter.segment(line.text)]
    : line.chars.map((segment, position) => ({ segment, index: position }));
  const wordEnds = new Set(words.map((entry) => entry.index + entry.segment.length));
  // Crossing/nested concepts share literal glyphs instead of duplicating wrappers.
  const boundaries = new Set(line.markers.flatMap((marker) => [marker.start, marker.end]));
  if (scene.splitAt > 0) boundaries.add(scene.splitAt);
  const appendGroup = prepareTrack(track, scene, presentation);
  let offset = 0;
  let position = 0;
  while (position < line.chars.length) {
    const start = position;
    const isKeyword = line.markers.some((marker) => marker.start <= position && marker.end > position);
    let end = position + 1;
    let stop = offset + line.chars[position].length;
    while (end < line.chars.length && !boundaries.has(end)) {
      // Preserve word rhythm with safe wrap opportunities for long tokens.
      if (!isKeyword && (wordEnds.has(stop) || end - start >= 8)) break;
      stop += line.chars[end].length;
      end++;
    }
    const group = document.createElement('span');
    group.className = isKeyword ? 'phrase keyword' : 'phrase';
    group.style.setProperty('--group-index', String(groups.length));
    group.style.setProperty('--step-offset', `${((groups.length % 3) - 1) * 7}px`);
    group.style.setProperty('--diagonal-offset', `${(groups.length % 2 ? 1 : -1) * 6}px`);
    const record = { el: group, start, end, keyword: isKeyword };
    groups.push(record);
    const glyphs = document.createElement('span');
    glyphs.className = 'phrase-glyphs';
    group.append(glyphs);
    for (; position < end; position++) {
      const char = document.createElement('span');
      char.className = 'char unread';
      char.textContent = line.chars[position];
      char.style.setProperty('--char-index', String(position));
      // Bounded, deterministic positions avoid visual randomness between frames.
      char.style.setProperty('--scatter-x', `${((position * 37) % 67) - 33}px`);
      char.style.setProperty('--scatter-y', `${((position * 19) % 49) - 24}px`);
      char.style.setProperty('--scatter-angle', `${((position * 13) % 29) - 14}deg`);
      glyphs.append(char);
      chars.push({ el: char, group: record });
      offset += line.chars[position].length;
    }
    appendGroup(record);
  }
  el.append(track, spotlight);
  const keywords = line.markers
    .map((marker) => ({
      ...marker,
      el: chars[marker.start]?.group.el,
      els: groups
        .filter((group) => group.start >= marker.start && group.end <= marker.end)
        .map((group) => group.el),
    }))
    .filter((marker) => marker.el);
  const current = {
    el,
    track,
    spotlight,
    chars,
    groups,
    keywords,
    firedRanges: new Set(),
    inkGhost: null,
    inkForeground: null,
    featuredKeyword: null,
    featuredMarker: null,
  };
  updateInkLayers(current, scene, presentation);
  return current;
}

/** Reparent existing glyph groups when presentation changes; never recreate text. */
export function refreshKnowledgeLine(current, { scene, presentation }) {
  const appendGroup = prepareTrack(current.track, scene, presentation);
  current.groups.forEach(appendGroup);
  updateInkLayers(current, scene, presentation);
}

function prepareTrack(track, scene, presentation) {
  track.replaceChildren();
  if (presentation !== 'scene' || scene.layout !== 'contrast' || scene.splitAt <= 0)
    return (group) => track.append(group.el);
  const document = track.ownerDocument;
  const left = document.createElement('span');
  left.className = 'text-half text-left';
  const right = document.createElement('span');
  right.className = 'text-half text-right';
  track.append(left, right);
  return (group) => (group.start < scene.splitAt ? left : right).append(group.el);
}

function updateInkLayers(current, scene, presentation) {
  if (presentation === 'scene' && scene.layout === 'ink') {
    if (current.inkForeground) return;
    const document = current.el.ownerDocument;
    current.inkGhost = document.createElement('span');
    current.inkGhost.className = 'ink-ghost';
    current.inkGhost.setAttribute('aria-hidden', 'true');
    current.inkForeground = document.createElement('span');
    current.inkForeground.className = 'ink-foreground';
    current.inkForeground.setAttribute('aria-hidden', 'true');
    current.el.append(current.inkGhost, current.inkForeground);
  } else {
    current.inkForeground?.remove();
    current.inkGhost?.remove();
    current.inkForeground = null;
    current.inkGhost = null;
  }
}
