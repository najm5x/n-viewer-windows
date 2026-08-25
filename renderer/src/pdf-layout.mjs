export const PDF_TO_CSS_UNITS = 96 / 72;

export function clampZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0.5, Math.min(3, Math.round(numeric * 10) / 10));
}

export function normalizeScaleMode(mode) {
  if (mode === 'actual-size' || mode === 'fit-page') return mode;
  return 'fit-width';
}

export function calculateDisplayScale({
  mode,
  zoom = 1,
  pageWidth,
  pageHeight,
  containerWidth,
  containerHeight,
  horizontalPadding = 48,
  verticalPadding = 56
}) {
  const safePageWidth = Math.max(1, Number(pageWidth) || 1);
  const safePageHeight = Math.max(1, Number(pageHeight) || 1);
  const availableWidth = Math.max(240, (Number(containerWidth) || 0) - horizontalPadding);
  const availableHeight = Math.max(240, (Number(containerHeight) || 0) - verticalPadding);
  const normalizedMode = normalizeScaleMode(mode);

  let baseScale;
  if (normalizedMode === 'actual-size') {
    baseScale = PDF_TO_CSS_UNITS;
  } else if (normalizedMode === 'fit-page') {
    baseScale = Math.min(availableWidth / safePageWidth, availableHeight / safePageHeight);
  } else {
    baseScale = availableWidth / safePageWidth;
  }

  return Math.max(0.1, Math.min(6, baseScale * clampZoom(zoom)));
}

export function calculateDisplayDimensions(options) {
  const scale = calculateDisplayScale(options);
  return {
    scale,
    width: Math.max(1, options.pageWidth * scale),
    height: Math.max(1, options.pageHeight * scale)
  };
}
