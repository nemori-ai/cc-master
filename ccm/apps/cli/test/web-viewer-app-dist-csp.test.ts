import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WEB_VIEWER_APP_DIST_FILES } from '../src/generated/web-viewer-assets.js';
import { mimeType } from '../src/handlers/web-viewer.js';

// Regression guard for the web-viewer CSP `font-src 'self'` (no `data:`) directive:
// Vite's default asset inlining base64-encodes small fonts directly into the built
// CSS as `data:font/...` URIs, which the browser blocks under this CSP. Every font
// must ship as an on-disk asset served same-origin instead (vite.config.ts sets
// `build.assetsInlineLimit: 0` to guarantee this).

function decodeAsset(rel: string): string {
  const b64 = WEB_VIEWER_APP_DIST_FILES[rel];
  assert.ok(b64, `expected bundled asset ${rel} to exist`);
  return Buffer.from(b64, 'base64').toString('utf8');
}

test('bundled web-viewer CSS never inlines fonts as data: URIs', () => {
  const cssFiles = Object.keys(WEB_VIEWER_APP_DIST_FILES).filter((rel) => rel.endsWith('.css'));
  assert.ok(cssFiles.length > 0, 'expected at least one bundled CSS file');

  for (const rel of cssFiles) {
    const css = decodeAsset(rel);
    assert.ok(
      !/data:font\//i.test(css),
      `${rel} must not inline fonts as data: URIs (blocked by CSP font-src 'self')`,
    );
  }
});

test('bundled web-viewer asset map ships woff2 font files with correct content-type', () => {
  const fontFiles = Object.keys(WEB_VIEWER_APP_DIST_FILES).filter((rel) => rel.endsWith('.woff2'));
  assert.ok(fontFiles.length > 0, 'expected at least one bundled .woff2 font file');
  for (const rel of fontFiles) {
    assert.equal(mimeType(rel), 'font/woff2');
  }
});

test('bundled web-viewer asset map ships woff fallback fonts with correct content-type', () => {
  const fontFiles = Object.keys(WEB_VIEWER_APP_DIST_FILES).filter((rel) => rel.endsWith('.woff'));
  assert.ok(fontFiles.length > 0, 'expected at least one bundled .woff fallback font file');
  for (const rel of fontFiles) {
    assert.equal(mimeType(rel), 'font/woff');
  }
});
