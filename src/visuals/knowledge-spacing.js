const finite = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);

/** Reserve the complete animation envelope without changing it when a word is active. */
export function phraseEnvelope({
  width,
  fontPx,
  keyword = false,
  marker = false,
  focusScale = 1,
  angle = 0,
  karaoke = false,
  decorationPx = 0,
  shiftX = 0,
  shiftY = 0,
}) {
  fontPx = finite(fontPx, 27);
  width = finite(width, fontPx);
  // Keyword pulse stays at 1.18; karaoke's last glyph can simultaneously reach 1.2.
  const scale = keyword ? 1.18 : focusScale;
  const radians = ((marker && keyword ? 5 : angle) * Math.PI) / 180;
  const decoration = marker && keyword ? 9 : decorationPx;
  const nestedGlyph = keyword || karaoke ? fontPx * 0.13 : 0;
  const rotatedWidth =
    (width + decoration * 2) * Math.cos(radians) + (fontPx + decoration * 2) * Math.sin(radians);
  const rotatedHeight =
    (fontPx + decoration * 2) * Math.cos(radians) + (width + decoration * 2) * Math.sin(radians);
  return {
    x: Math.ceil(
      Math.max(0, (rotatedWidth * scale - width) / 2) +
        nestedGlyph +
        Math.abs(shiftX) +
        (keyword ? 3 : focusScale > 1 ? 1 : 0),
    ),
    y: Math.ceil(
      Math.max(0, (rotatedHeight * scale - fontPx) / 2) +
        nestedGlyph +
        Math.abs(shiftY) +
        (keyword ? 3 : angle || focusScale > 1 ? 9 : 1),
    ),
  };
}

/** Fit both the headline's 1.45 push and its larger, rotated background in a separate band. */
export function inkHeadlineFit({ width, readingHeight, stageHeight, measuredWordWidth, fontPx }) {
  const gap = 12;
  const band = Math.max(0, stageHeight - readingHeight - gap);
  const ratio = finite(measuredWordWidth, fontPx) / finite(fontPx, 60);
  // Ghost: 1.6x font, up to 12deg; foreground: 1.45x font, 5deg.
  const ghostHeightPerEm = 1.6 * (Math.cos(Math.PI / 15) + ratio * Math.sin(Math.PI / 15));
  const ghostWidthPerEm = 1.6 * (ratio * Math.cos(Math.PI / 15) + Math.sin(Math.PI / 15));
  const fittedFont = Math.max(
    1,
    Math.min(finite(fontPx, 60), band / ghostHeightPerEm, Math.max(1, width - 12) / ghostWidthPerEm),
  );
  return { fontPx: fittedFont, centerY: band / 2, readingHeight, band, gap };
}
