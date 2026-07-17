#!/usr/bin/env node
/**
 * optimize-images.mjs — assets-src/*.png → public/images/viewer/*.webp (+optimized .png fallback)
 * and assets-src/viewer-loop.{mp4,webm} → public/images/viewer/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'assets-src');
const OUT = path.join(HERE, '..', 'public', 'images', 'viewer');

fs.mkdirSync(OUT, { recursive: true });

const pngs = fs.readdirSync(SRC).filter((f) => f.endsWith('.png'));
for (const file of pngs) {
  const name = file.replace(/\.png$/, '');
  const input = path.join(SRC, file);
  await sharp(input).webp({ quality: 82, effort: 5 }).toFile(path.join(OUT, `${name}.webp`));
  await sharp(input)
    .png({ compressionLevel: 9, palette: true, quality: 88 })
    .toFile(path.join(OUT, `${name}.png`));
  const w = fs.statSync(path.join(OUT, `${name}.webp`)).size / 1024;
  const p = fs.statSync(path.join(OUT, `${name}.png`)).size / 1024;
  console.log(`✓ ${name}: webp ${w.toFixed(0)}KB / png ${p.toFixed(0)}KB`);
}

for (const [from, to] of [
  ['viewer-loop.mp4', 'viewer-loop.mp4'],
  ['viewer-loop-opt.webm', 'viewer-loop.webm'],
]) {
  const src = path.join(SRC, from);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(OUT, to));
    console.log(`✓ ${to} ${(fs.statSync(src).size / 1024).toFixed(0)}KB`);
  }
}
