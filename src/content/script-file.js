export const MAX_SCRIPT_FILE_BYTES = 512 * 1024;

/** Decode local text without executing markup or changing the script's contents. */
export function decodeScriptFile(input) {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : null;
  if (!bytes) throw new Error('无法读取文案文件。');
  if (bytes.byteLength > MAX_SCRIPT_FILE_BYTES) throw new Error('请选择小于 512 KB 的文案文件。');
  if (!bytes.byteLength) throw new Error('文案文件是空的。');
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
  )
    throw new Error('暂不支持 UTF-32，请把文案保存为 UTF-8 文件。');
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error('文案编码无法读取，请保存为 UTF-8 或带 BOM 的 UTF-16 文件。');
  }
}

export function scriptTitleFromFilename(name) {
  return String(name || '我的知识').replace(/\.(?:wad\.)?(?:json|txt)$/iu, '') || '我的知识';
}
