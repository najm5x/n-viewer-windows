import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDF_TO_CSS_UNITS,
  calculateDisplayDimensions,
  calculateDisplayScale,
  clampZoom,
  normalizeScaleMode
} from '../renderer/src/pdf-layout.mjs';

test('PDF zoom is clamped and rounded consistently', () => {
  assert.equal(clampZoom(0.12), 0.5);
  assert.equal(clampZoom(1.26), 1.3);
  assert.equal(clampZoom(8), 3);
  assert.equal(clampZoom('not-a-number'), 1);
});

test('PDF scale modes produce stable, non-cropped dimensions', () => {
  const common = {
    pageWidth: 612,
    pageHeight: 792,
    containerWidth: 1200,
    containerHeight: 820,
    horizontalPadding: 48,
    verticalPadding: 58,
    zoom: 1
  };

  const fitWidth = calculateDisplayDimensions({ ...common, mode: 'fit-width' });
  assert.ok(fitWidth.width <= common.containerWidth - common.horizontalPadding + 0.001);

  const fitPage = calculateDisplayDimensions({ ...common, mode: 'fit-page' });
  assert.ok(fitPage.width <= common.containerWidth - common.horizontalPadding + 0.001);
  assert.ok(fitPage.height <= common.containerHeight - common.verticalPadding + 0.001);

  const actual = calculateDisplayScale({ ...common, mode: 'actual-size' });
  assert.equal(actual, PDF_TO_CSS_UNITS);
});

test('unknown PDF scale modes fall back to fit width', () => {
  assert.equal(normalizeScaleMode('fit-page'), 'fit-page');
  assert.equal(normalizeScaleMode('actual-size'), 'actual-size');
  assert.equal(normalizeScaleMode('anything-else'), 'fit-width');
});
