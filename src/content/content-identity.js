// FNV-1a128 constants: https://www.rfc-editor.org/rfc/rfc9923.html
// Independent implementation; this fingerprint is neither encryption nor a server id.
const FNV_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_PRIME = 0x0000000001000000000000000000013bn;
const utf8 = new TextEncoder();

/**
 * Local likes identify literal content while public parser ids remain compatible.
 * The versioned digest excludes original notes from storage keys. It is only for
 * local preference matching, never security, server identity or public deduplication.
 * Input is an already validated topic; metadata and presentation do not affect likes.
 */
export function getLikeKey(topic) {
  if (topic.id !== 'custom') return topic.id;
  // A tuple preserves title/line boundaries, quotes, whitespace and whole Unicode.
  const canonical = JSON.stringify([topic.title, topic.lines.map((line) => line.text)]);
  let hash = FNV_OFFSET;
  for (const byte of utf8.encode(canonical)) hash = BigInt.asUintN(128, (hash ^ BigInt(byte)) * FNV_PRIME);
  return `custom-like-v1:${hash.toString(16).padStart(32, '0')}`;
}
