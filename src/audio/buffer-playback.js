/**
 * Prepare a started Web Audio graph before the controller retires its current
 * source. A failed decode/connection/start therefore cannot silence the old
 * music or publish a half-committed source. No source identity lives here.
 */
export function prepareBufferPlayback(context, analyser, { buffer, loop = false, offset = 0 } = {}) {
  if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0)
    throw new TypeError('音频内容为空或时长无效。');
  const position = (Number.isFinite(offset) ? Math.max(0, offset) : 0) % buffer.duration;
  let node = null,
    output = null;
  try {
    node = context.createBufferSource();
    node.buffer = buffer;
    node.loop = loop;
    output = context.createGain();
    output.gain.value = 0.72;
    node.connect(analyser);
    node.connect(output);
    output.connect(context.destination);
    const startedAt = context.currentTime - position;
    node.start(0, position);
    return { node, output, startedAt };
  } catch (error) {
    stopAudioNode(node);
    disconnectAudioNode(output);
    throw error;
  }
}

export function disconnectAudioNode(node) {
  try {
    node?.disconnect();
  } catch {}
}

export function stopAudioNode(node) {
  if (!node) return;
  node.onended = null;
  try {
    node.stop?.();
  } catch {}
  disconnectAudioNode(node);
}
